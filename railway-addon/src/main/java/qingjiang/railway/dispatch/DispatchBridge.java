package qingjiang.railway.dispatch;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.neoforged.fml.ModList;
import net.neoforged.fml.ModContainer;

import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.entity.Entity;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.network.chat.Component;
import net.minecraft.core.BlockPos;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.level.Level;
import qingjiang.railway.RailwayAddon;
import qingjiang.railway.RailwayStore;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/**
 * Create 反射桥接层。完全不编译依赖 Create：Create 缺席或版本差异都不会让游戏崩溃，
 * 只会让调度台显示“未检测到 Create”。由原 PyRailDispatch 的 CreateBridge 内置迁入。
 */
public final class DispatchBridge {

    public static final class TrainView {
        public String id = "";
        public String name = "";
        public String dimension = "minecraft:overworld";
        public double x, y, z;
        public double speed;
        public double distanceToDest = -1;
        public int passengers;
        public boolean waitingSignal;
        public boolean derailed;
        public String nextStationId = "";
        public String nextStationName = "";
        public String stationId = "";
        public String stationName = "";
        public List<String> carriageEntities = new ArrayList<>();
        public List<String> scheduleStations = new ArrayList<>();
    }

    public static final class PlatformView {
        public String id = "";
        public String name = "";
        public String dimension = "minecraft:overworld";
        public double x, y, z;
        public boolean present;
        public boolean imminent;
        /** 所属逻辑车站 id（grp:<车站名>）；未落入任何车站范围时为 ungrouped。 */
        public String groupId = "ungrouped";
        public String groupName = "未分配";
    }

    public static final class SignalView {
        public String id = "";
        public String dimension = "minecraft:overworld";
        public double x, y, z;
        public String state = "UNKNOWN";
        public String type = "";
        public boolean forced;
        public boolean occupied;
    }

    private static boolean inited;
    private static boolean ready;
    private static String createVersion = "";
    private static String coupleClass = "";
    private static final List<String> addons = new ArrayList<>();
    private static final Set<String> warned = Collections.newSetFromMap(new ConcurrentHashMap<>());

    private static Class<?> C_CREATE, C_MGR, C_TRAIN, C_NAV, C_CAR, C_STATION, C_SIGBE, C_BND,
            C_GRAPH, C_NODE, C_EDGE, C_EPT, C_COUPLE, C_RT, C_SCHED, C_ENTRY, C_DESTIN, C_GROUP;

    private static Field F_RAILWAYS, F_TRAINS, F_GRAPHS, F_GROUPS,
            F_TR_ID, F_TR_NAME, F_TR_SPEED, F_TR_NAV, F_TR_CARRIAGES, F_TR_GRAPH, F_TR_DERAILED,
            F_NAV_DEST, F_NAV_DIST, F_NAV_WAIT,
            F_ST_NAME, F_ST_POS, F_ST_DIM,
            F_SIG_STATE,
            F_BND_BLOCKENTS, F_BND_SIDES, F_BND_GROUPS, F_BND_TYPES,
            F_GROUP_TRAINS;

    private static Method M_COUNT_PASSENGERS, M_POINT_POS, M_CAR_LEADING, M_CAR_FOREACH,
            M_NAV_FIND, M_NAV_START, M_GRAPH_NODES, M_GRAPH_LOCATE, M_GRAPH_CONNECTIONS, M_GRAPH_POINTS,
            M_GRAPH_CHECKSUM, M_NODE_LOCATION, M_EDGE_POS, M_EDGE_LEN, M_ST_PRESENT, M_ST_IMMINENT,
            M_COUPLE_GET, M_COUPLE_SET, M_RT_GET_SCHEDULE, M_DEST_FILTER, M_TRAIN_GET_STATION;

    private static Object EPT_SIGNAL, EPT_STATION;
    private static final Map<String, TrackCache> TRACK_CACHE = new ConcurrentHashMap<>();

    private static final class TrackCache {
        int checksum = Integer.MIN_VALUE;
        String json = "[]";
        int lines;
        int points;
    }

    static synchronized void init() {
        if (inited) return;
        inited = true;
        try {
            C_CREATE = cls("com.simibubi.create.Create");
            C_MGR = cls("com.simibubi.create.content.trains.GlobalRailwayManager");
            C_TRAIN = cls("com.simibubi.create.content.trains.entity.Train");
            C_NAV = cls("com.simibubi.create.content.trains.entity.Navigation");
            C_CAR = cls("com.simibubi.create.content.trains.entity.Carriage");
            C_STATION = cls("com.simibubi.create.content.trains.station.GlobalStation");
            C_SIGBE = cls("com.simibubi.create.content.trains.signal.SignalBlockEntity");
            C_BND = cls("com.simibubi.create.content.trains.signal.SignalBoundary");
            C_GRAPH = cls("com.simibubi.create.content.trains.graph.TrackGraph");
            C_NODE = cls("com.simibubi.create.content.trains.graph.TrackNode");
            C_EDGE = cls("com.simibubi.create.content.trains.graph.TrackEdge");
            C_EPT = cls("com.simibubi.create.content.trains.graph.EdgePointType");
            C_COUPLE = cls("net.createmod.catnip.data.Couple");
            if (C_COUPLE == null) {
                C_COUPLE = cls("com.simibubi.create.foundation.utility.Couple");
            }
            if (C_COUPLE != null) coupleClass = C_COUPLE.getName();
            C_RT = cls("com.simibubi.create.content.trains.schedule.ScheduleRuntime");
            C_SCHED = cls("com.simibubi.create.content.trains.schedule.Schedule");
            C_ENTRY = cls("com.simibubi.create.content.trains.schedule.ScheduleEntry");
            C_DESTIN = cls("com.simibubi.create.content.trains.schedule.destination.DestinationInstruction");
            C_GROUP = cls("com.simibubi.create.content.trains.signal.SignalEdgeGroup");

            F_RAILWAYS = field(C_CREATE, "RAILWAYS");
            F_TRAINS = field(C_MGR, "trains");
            F_GRAPHS = field(C_MGR, "trackNetworks");
            F_GROUPS = field(C_MGR, "signalEdgeGroups");

            F_TR_ID = field(C_TRAIN, "id");
            F_TR_NAME = field(C_TRAIN, "name");
            F_TR_SPEED = field(C_TRAIN, "speed");
            F_TR_NAV = field(C_TRAIN, "navigation");
            F_TR_CARRIAGES = field(C_TRAIN, "carriages");
            F_TR_GRAPH = field(C_TRAIN, "graph");
            F_TR_DERAILED = field(C_TRAIN, "derailed");

            F_NAV_DEST = field(C_NAV, "destination");
            F_NAV_DIST = field(C_NAV, "distanceToDestination");
            F_NAV_WAIT = field(C_NAV, "waitingForSignal");

            F_ST_NAME = field(C_STATION, "name");
            F_ST_POS = field(C_STATION, "blockEntityPos");
            F_ST_DIM = field(C_STATION, "blockEntityDimension");

            F_SIG_STATE = field(C_SIGBE, "state");

            F_BND_BLOCKENTS = field(C_BND, "blockEntities");
            F_BND_SIDES = field(C_BND, "sidesToUpdate");
            F_BND_GROUPS = field(C_BND, "groups");
            F_BND_TYPES = field(C_BND, "types");

            F_GROUP_TRAINS = field(C_GROUP, "trains");

            Class<?> cPoint = cls("com.simibubi.create.content.trains.entity.TravellingPoint");
            Class<?> cDiscovered = cls("com.simibubi.create.content.trains.graph.DiscoveredPath");
            Class<?> cNodeLocation = cls("com.simibubi.create.content.trains.graph.TrackNodeLocation");

            M_COUNT_PASSENGERS = method(C_TRAIN, "countPlayerPassengers");
            M_TRAIN_GET_STATION = method(C_TRAIN, "getCurrentStation");
            M_POINT_POS = method(cPoint, "getPosition", C_GRAPH);
            M_CAR_LEADING = method(C_CAR, "getLeadingPoint");
            M_CAR_FOREACH = method(C_CAR, "forEachPresentEntity", Consumer.class);
            M_NAV_FIND = method(C_NAV, "findPathTo", C_STATION, double.class);
            M_NAV_START = method(C_NAV, "startNavigation", cDiscovered);
            M_GRAPH_NODES = method(C_GRAPH, "getNodes");
            M_GRAPH_LOCATE = method(C_GRAPH, "locateNode", cNodeLocation);
            M_GRAPH_CONNECTIONS = method(C_GRAPH, "getConnectionsFrom", C_NODE);
            M_GRAPH_POINTS = method(C_GRAPH, "getPoints", C_EPT);
            M_GRAPH_CHECKSUM = method(C_GRAPH, "getChecksum");
            M_NODE_LOCATION = method(C_NODE, "getLocation");
            M_EDGE_POS = method(C_EDGE, "getPosition", C_GRAPH, double.class);
            M_EDGE_LEN = method(C_EDGE, "getLength");
            M_ST_PRESENT = method(C_STATION, "getPresentTrain");
            M_ST_IMMINENT = method(C_STATION, "getImminentTrain");
            M_COUPLE_GET = method(C_COUPLE, "get", boolean.class);
            M_COUPLE_SET = method(C_COUPLE, "set", boolean.class, Object.class);
            M_RT_GET_SCHEDULE = method(C_RT, "getSchedule");
            M_DEST_FILTER = method(C_DESTIN, "getFilter");

            if (C_EPT != null) {
                try {
                    EPT_SIGNAL = C_EPT.getField("SIGNAL").get(null);
                } catch (Throwable ignored) {
                }
                try {
                    EPT_STATION = C_EPT.getField("STATION").get(null);
                } catch (Throwable ignored) {
                }
            }
            ready = C_CREATE != null && C_MGR != null && F_RAILWAYS != null && F_TRAINS != null && F_GRAPHS != null
                    && C_COUPLE != null && M_COUPLE_GET != null && M_COUPLE_SET != null;
            readModInfo();
        } catch (Throwable t) {
            ready = false;
            warn("init", t);
        }
    }

    private static void readModInfo() {
        try {
            ModList modList = ModList.get();
            for (var info : modList.getMods()) {
                String id = info.getModId();
                if ("railway_plus".equals(id) || "minecraft".equals(id) || "neoforge".equals(id)) continue;
                String name = info.getDisplayName();
                String lower = name == null ? "" : name.toLowerCase();
                if (id.contains("create") || id.contains("rail") || lower.contains("create") || lower.contains("rail")) {
                    addons.add(name + " " + info.getVersion());
                }
            }
            ModContainer create = modList.getModContainerById("create").orElse(null);
            createVersion = create == null ? "" : create.getModInfo().getVersion().toString();
        } catch (Throwable ignored) {
        }
        if (createVersion == null) createVersion = "";
    }

    public static String createVersion() {
        init();
        return createVersion;
    }

    public static List<String> addons() {
        init();
        return addons;
    }

    public static boolean available() {
        init();
        return ready;
    }

    private static Class<?> cls(String name) {
        try {
            return Class.forName(name);
        } catch (Throwable t) {
            return null;
        }
    }

    private static Field field(Class<?> c, String name) {
        if (c == null) return null;
        Class<?> cur = c;
        while (cur != null) {
            try {
                Field f = cur.getDeclaredField(name);
                f.setAccessible(true);
                return f;
            } catch (Throwable ignored) {
            }
            cur = cur.getSuperclass();
        }
        return null;
    }

    private static Method method(Class<?> c, String name, Class<?>... params) {
        if (c == null) return null;
        try {
            Method m = c.getMethod(name, params);
            m.setAccessible(true);
            return m;
        } catch (Throwable t) {
            return null;
        }
    }

    private static Object get(Field f, Object target) {
        if (f == null) return null;
        try {
            return f.get(target);
        } catch (Throwable t) {
            return null;
        }
    }

    private static Object call(Method m, Object target, Object... args) {
        if (m == null) return null;
        try {
            return m.invoke(target, args);
        } catch (Throwable t) {
            warn("call:" + m.getName(), t);
            return null;
        }
    }

    private static void warn(String where, Throwable t) {
        if (!warned.add(where)) return;
        RailwayAddon.LOGGER.warn("[dispatch] Create 桥接异常 {}: {}", where, t.toString());
    }

    private static Object manager() {
        init();
        return get(F_RAILWAYS, null);
    }

    @SuppressWarnings("unchecked")
    private static Map<UUID, Object> map(Object source) {
        if (source instanceof Map) return (Map<UUID, Object>) source;
        return Collections.emptyMap();
    }

    @SuppressWarnings("unchecked")
    private static Map<Object, Object> rawMap(Object source) {
        if (source instanceof Map) return (Map<Object, Object>) source;
        return Collections.emptyMap();
    }

    /**
     * 写入信号边界其中一侧的 blockEntities 表，并标记该侧待重算。
     * Create 6.x 的单侧表可能是不可变 Map，直接 put 会抛 UnsupportedOperationException，
     * 此时整表复制后通过 Couple.set 回填，行为与就地修改一致。
     */
    private static boolean writeSide(Object couple, Object boundary, boolean side, Object sideMap, Object key, boolean value) {
        if (M_COUPLE_SET == null) return false;
        try {
            rawMap(sideMap).put(key, value);
        } catch (UnsupportedOperationException uoe) {
            try {
                Map<Object, Object> copy = new HashMap<>(rawMap(sideMap));
                copy.put(key, value);
                call(M_COUPLE_SET, couple, side, copy);
            } catch (Throwable t) {
                warn("writeSide:copy", t);
                return false;
            }
        } catch (Throwable t) {
            warn("writeSide:put", t);
            return false;
        }
        call(M_COUPLE_SET, get(F_BND_SIDES, boundary), side, true);
        return true;
    }

    private static String signalId(String dim, BlockPos pos) {
        return dim + "|" + pos.getX() + "|" + pos.getY() + "|" + pos.getZ();
    }

    private static String dimName(ResourceKey<Level> key) {
        return key == null ? "minecraft:overworld" : key.location().toString();
    }

    private static String enumName(Object e) {
        return e instanceof Enum<?> ? ((Enum<?>) e).name() : "UNKNOWN";
    }

    private static ResourceKey<Level> keyOf(Object loc) {
        if (loc == null) return null;
        Object d = get(field(loc.getClass(), "dimension"), loc);
        if (d instanceof ResourceKey) {
            @SuppressWarnings("unchecked")
            ResourceKey<Level> key = (ResourceKey<Level>) d;
            return key;
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private static Collection<?> pointsOf(Object graph, Object type) {
        if (graph == null || type == null || M_GRAPH_POINTS == null) return Collections.emptyList();
        try {
            Object r = M_GRAPH_POINTS.invoke(graph, type);
            if (r instanceof Collection) return (Collection<?>) r;
        } catch (Throwable t) {
            warn("points", t);
        }
        return Collections.emptyList();
    }

    public static List<TrainView> collectTrains() {
        if (!available()) return new ArrayList<>();
        List<TrainView> out = new ArrayList<>();
        for (Object train : map(get(F_TRAINS, manager())).values()) {
            try {
                TrainView v = toView(train);
                if (v != null) out.add(v);
            } catch (Throwable t) {
                warn("train", t);
            }
        }
        return out;
    }

    private static TrainView toView(Object train) {
        if (train == null) return null;
        TrainView v = new TrainView();
        Object id = get(F_TR_ID, train);
        v.id = id == null ? "" : id.toString();
        Object name = get(F_TR_NAME, train);
        if (name instanceof Component) {
            try {
                v.name = ((Component) name).getString();
            } catch (Throwable ignored) {
            }
        }
        if (v.name == null || v.name.isEmpty()) v.name = "未命名列车";
        Number speed = (Number) get(F_TR_SPEED, train);
        v.speed = speed == null ? 0 : speed.doubleValue();
        Object derailed = get(F_TR_DERAILED, train);
        v.derailed = derailed instanceof Boolean && (Boolean) derailed;

        Object nav = get(F_TR_NAV, train);
        if (nav != null) {
            Object dest = get(F_NAV_DEST, nav);
            if (dest != null) {
                Object destName = get(F_ST_NAME, dest);
                v.nextStationName = destName == null ? "" : String.valueOf(destName);
                v.nextStationId = stationIdOf(dest);
            }
            Number dist = (Number) get(F_NAV_DIST, nav);
            v.distanceToDest = dist == null ? -1 : dist.doubleValue();
            v.waitingSignal = get(F_NAV_WAIT, nav) != null;
        }
        Number passengers = (Number) call(M_COUNT_PASSENGERS, train);
        v.passengers = passengers == null ? 0 : passengers.intValue();

        Object graph = get(F_TR_GRAPH, train);
        Object carriagesObj = get(F_TR_CARRIAGES, train);
        if (carriagesObj instanceof List && !((List<?>) carriagesObj).isEmpty()) {
            Object carriage = ((List<?>) carriagesObj).get(0);
            Object point = call(M_CAR_LEADING, carriage);
            if (point != null && graph != null) {
                Object pos = call(M_POINT_POS, point, graph);
                if (pos instanceof Vec3) {
                    Vec3 vec = (Vec3) pos;
                    v.x = vec.x;
                    v.y = vec.y;
                    v.z = vec.z;
                }
                Object node1 = get(field(point.getClass(), "node1"), point);
                if (node1 != null) {
                    ResourceKey<Level> key = keyOf(call(M_NODE_LOCATION, node1));
                    if (key != null) v.dimension = dimName(key);
                }
            }
            final TrainView ref = v;
            if (M_CAR_FOREACH != null && carriage != null) {
                try {
                    M_CAR_FOREACH.invoke(carriage, (Consumer<Object>) entity -> {
                        if (entity instanceof Entity) {
                            ref.carriageEntities.add(((Entity) entity).getUUID().toString());
                        }
                    });
                } catch (Throwable ignored) {
                }
            }
        }

        try {
            Object st = call(M_TRAIN_GET_STATION, train);
            if (st != null) {
                Object n = get(F_ST_NAME, st);
                v.stationName = n == null ? "" : String.valueOf(n);
                v.stationId = stationIdOf(st);
            }
        } catch (Throwable ignored) {
        }

        try {
            Object runtime = get(field(C_TRAIN, "runtime"), train);
            if (runtime != null) {
                Object schedule = call(M_RT_GET_SCHEDULE, runtime);
                if (schedule != null) {
                    Object entries = get(field(C_SCHED, "entries"), schedule);
                    if (entries instanceof List) {
                        for (Object entry : (List<?>) entries) {
                            Object instruction = get(field(C_ENTRY, "instruction"), entry);
                            if (instruction != null && C_DESTIN != null && C_DESTIN.isInstance(instruction)) {
                                Object filter = call(M_DEST_FILTER, instruction);
                                if (filter != null) v.scheduleStations.add(String.valueOf(filter));
                            }
                        }
                    }
                }
            }
        } catch (Throwable ignored) {
        }
        return v;
    }

    private static String stationIdOf(Object station) {
        try {
            Object pos = get(F_ST_POS, station);
            if (pos instanceof BlockPos) {
                ResourceKey<Level> key = keyOfDim(get(F_ST_DIM, station));
                return signalId(dimName(key), (BlockPos) pos);
            }
        } catch (Throwable ignored) {
        }
        return "";
    }

    private static ResourceKey<Level> keyOfDim(Object dim) {
        if (dim instanceof ResourceKey) {
            @SuppressWarnings("unchecked")
            ResourceKey<Level> key = (ResourceKey<Level>) dim;
            return key;
        }
        return null;
    }

    /** 按本模组台账里的车站范围，把 Create 站台归属到对应逻辑车站。 */
    private static void assignGroup(PlatformView p) {
        try {
            BlockPos pos = BlockPos.containing(p.x, p.y, p.z);
            for (RailwayStore.Station st : RailwayStore.stations().values()) {
                if (st.dimension.equals(p.dimension) && st.contains(pos)) {
                    p.groupId = "grp:" + st.name;
                    p.groupName = st.name;
                    return;
                }
            }
        } catch (Throwable ignored) {
        }
        p.groupId = "ungrouped";
        p.groupName = "未分配";
    }

    public static List<PlatformView> collectPlatforms() {
        if (!available()) return new ArrayList<>();
        List<PlatformView> out = new ArrayList<>();
        for (Object graph : map(get(F_GRAPHS, manager())).values()) {
            for (Object station : pointsOf(graph, EPT_STATION)) {
                try {
                    PlatformView v = new PlatformView();
                    Object name = get(F_ST_NAME, station);
                    v.name = name == null ? "未命名车站" : String.valueOf(name);
                    Object pos = get(F_ST_POS, station);
                    if (pos instanceof BlockPos) {
                        BlockPos p = (BlockPos) pos;
                        v.x = p.getX() + 0.5;
                        v.y = p.getY();
                        v.z = p.getZ() + 0.5;
                        v.id = stationIdOf(station);
                    }
                    ResourceKey<Level> key = keyOfDim(get(F_ST_DIM, station));
                    if (key != null) v.dimension = dimName(key);
                    v.present = call(M_ST_PRESENT, station) != null;
                    v.imminent = call(M_ST_IMMINENT, station) != null;
                    assignGroup(v);
                    if (!v.id.isEmpty()) out.add(v);
                } catch (Throwable t) {
                    warn("station", t);
                }
            }
        }
        return out;
    }

    public static List<SignalView> collectSignals(MinecraftServer server) {
        if (!available()) return new ArrayList<>();
        Map<String, SignalView> uniq = new LinkedHashMap<>();
        Map<UUID, Object> groups = map(get(F_GROUPS, manager()));
        for (Object graph : map(get(F_GRAPHS, manager())).values()) {
            for (Object boundary : pointsOf(graph, EPT_SIGNAL)) {
                try {
                    for (SignalView v : signalsOfBoundary(server, boundary, groups)) {
                        SignalView existing = uniq.get(v.id);
                        if (existing != null) {
                            existing.occupied |= v.occupied;
                            existing.forced |= v.forced;
                            if (!"UNKNOWN".equals(v.state)) existing.state = v.state;
                        } else {
                            uniq.put(v.id, v);
                        }
                    }
                } catch (Throwable t) {
                    warn("signal", t);
                }
            }
        }
        return new ArrayList<>(uniq.values());
    }

    private static List<SignalView> signalsOfBoundary(MinecraftServer server, Object boundary, Map<UUID, Object> groups) {
        List<SignalView> out = new ArrayList<>();
        Object couple = get(F_BND_BLOCKENTS, boundary);
        Object typesCouple = get(F_BND_TYPES, boundary);
        Object groupsCouple = get(F_BND_GROUPS, boundary);
        Object locations = get(field(C_BND, "edgeLocation"), boundary);
        ResourceKey<Level> dimKey = null;
        if (locations != null) {
            Object loc = call(M_COUPLE_GET, locations, false);
            if (loc == null) loc = call(M_COUPLE_GET, locations, true);
            dimKey = keyOf(loc);
        }
        String dim = dimName(dimKey);
        for (boolean side : new boolean[]{false, true}) {
            Object sideMap = call(M_COUPLE_GET, couple, side);
            if (!(sideMap instanceof Map)) continue;
            boolean occupied = false;
            Object groupId = call(M_COUPLE_GET, groupsCouple, side);
            if (groupId instanceof UUID) {
                Object group = groups.get(groupId);
                Object trains = get(F_GROUP_TRAINS, group);
                occupied = trains instanceof Collection && !((Collection<?>) trains).isEmpty();
            }
            Object type = call(M_COUPLE_GET, typesCouple, side);
            for (Map.Entry<?, ?> entry : rawMap(sideMap).entrySet()) {
                if (!(entry.getKey() instanceof BlockPos)) continue;
                BlockPos pos = (BlockPos) entry.getKey();
                SignalView v = new SignalView();
                v.id = signalId(dim, pos);
                v.dimension = dim;
                v.x = pos.getX() + 0.5;
                v.y = pos.getY() + 0.5;
                v.z = pos.getZ() + 0.5;
                v.type = enumName(type);
                v.occupied = occupied;
                v.forced = Boolean.TRUE.equals(entry.getValue());
                v.state = readSignalState(server, dimKey, pos);
                out.add(v);
            }
        }
        return out;
    }

    private static String readSignalState(MinecraftServer server, ResourceKey<Level> dimKey, BlockPos pos) {
        try {
            if (server == null || dimKey == null) return "UNKNOWN";
            ServerLevel world = server.getLevel(dimKey);
            if (world == null) return "UNKNOWN";
            if (!world.hasChunk(pos.getX() >> 4, pos.getZ() >> 4)) return "UNLOADED";
            BlockEntity be = world.getBlockEntity(pos);
            if (be == null || C_SIGBE == null || !C_SIGBE.isInstance(be)) return "UNKNOWN";
            return enumName(get(F_SIG_STATE, be));
        } catch (Throwable t) {
            warn("signalState", t);
            return "UNKNOWN";
        }
    }

    public static Set<String> dimensions() {
        Set<String> dims = new LinkedHashSet<>();
        if (!available()) return dims;
        for (Object graph : map(get(F_GRAPHS, manager())).values()) {
            Object nodes = call(M_GRAPH_NODES, graph);
            if (!(nodes instanceof Collection)) continue;
            for (Object nodeLoc : (Collection<?>) nodes) {
                ResourceKey<Level> key = keyOf(nodeLoc);
                if (key != null) dims.add(dimName(key));
            }
        }
        return dims;
    }

    public static int graphChecksum() {
        int sum = 0;
        for (Object graph : map(get(F_GRAPHS, manager())).values()) {
            Number c = (Number) call(M_GRAPH_CHECKSUM, graph);
            if (c != null) sum += c.intValue();
        }
        return sum;
    }

    public static String tracksJson(String dimension) {
        TrackCache cache = TRACK_CACHE.get(dimension);
        return cache == null ? "[]" : cache.json;
    }

    /** 仅服务端线程调用：仅在轨道校验和变化时重建线路图 */
    public static void rebuildTracks(String dimension, DispatchConfig cfg) {
        if (!available()) return;
        TrackCache cache = TRACK_CACHE.computeIfAbsent(dimension, k -> new TrackCache());
        int checksum = graphChecksum();
        if (cache.checksum == checksum) return;

        JsonArray lines = new JsonArray();
        int points = 0;
        outer:
        for (Object graph : map(get(F_GRAPHS, manager())).values()) {
            Object nodes = call(M_GRAPH_NODES, graph);
            if (!(nodes instanceof Collection)) continue;
            Set<String> seen = new java.util.HashSet<>();
            for (Object nodeLoc : (Collection<?>) nodes) {
                ResourceKey<Level> key = keyOf(nodeLoc);
                if (key == null || !dimName(key).equals(dimension)) continue;
                Object node = call(M_GRAPH_LOCATE, graph, nodeLoc);
                if (node == null) continue;
                Object conns = call(M_GRAPH_CONNECTIONS, graph, node);
                if (!(conns instanceof Map)) continue;
                for (Map.Entry<?, ?> entry : rawMap(conns).entrySet()) {
                    Object edge = entry.getValue();
                    if (edge == null) continue;
                    String edgeKey = Math.min(netId(node), netId(entry.getKey())) + ":"
                            + Math.max(netId(node), netId(entry.getKey()));
                    if (!seen.add(edgeKey)) continue;
                    JsonArray line = sampleEdge(edge, graph, cfg.trackSampleSteps);
                    if (line != null && line.size() >= 4) {
                        lines.add(line);
                        points += line.size() / 2;
                    }
                    if (points >= cfg.maxTrackPoints) break outer;
                }
            }
        }
        cache.checksum = checksum;
        cache.json = lines.toString();
        cache.lines = lines.size();
        cache.points = points;
    }

    private static int netId(Object node) {
        if (node == null) return 0;
        Object v = call(method(C_NODE, "getNetId"), node);
        return v instanceof Number ? ((Number) v).intValue() : node.hashCode();
    }

    private static JsonArray sampleEdge(Object edge, Object graph, int steps) {
        try {
            Number len = (Number) call(M_EDGE_LEN, edge);
            if (len == null || len.doubleValue() <= 0.01) return null;
            JsonArray arr = new JsonArray();
            for (int i = 0; i <= steps; i++) {
                double t = (double) i / steps;
                Object pos = call(M_EDGE_POS, edge, graph, t);
                if (!(pos instanceof Vec3)) return null;
                Vec3 vec = (Vec3) pos;
                arr.add(Math.round(vec.x * 100.0) / 100.0);
                arr.add(Math.round(vec.z * 100.0) / 100.0);
            }
            return arr;
        } catch (Throwable t) {
            warn("sampleEdge", t);
            return null;
        }
    }

    public static JsonObject setSignal(MinecraftServer server, String id, String mode) {
        JsonObject r = new JsonObject();
        if (!available()) return fail(r, "未检测到 Create");
        BlockPos target = parsePos(id);
        if (target == null) return fail(r, "信号机编号无效");
        boolean red = "red".equalsIgnoreCase(mode);
        boolean applied = false;
        ResourceKey<Level> dimKey = null;
        for (Object graph : map(get(F_GRAPHS, manager())).values()) {
            for (Object boundary : pointsOf(graph, EPT_SIGNAL)) {
                Object couple = get(F_BND_BLOCKENTS, boundary);
                for (boolean side : new boolean[]{false, true}) {
                    Object sideMap = call(M_COUPLE_GET, couple, side);
                    if (!(sideMap instanceof Map)) continue;
                    Map<Object, Object> map = rawMap(sideMap);
                    Object current = null;
                    for (Object key : map.keySet()) {
                        if (key instanceof BlockPos && ((BlockPos) key).equals(target)) {
                            current = key;
                            break;
                        }
                    }
                    if (current == null) continue;
                    Object old = map.get(current);
                    // 已是目标状态就不重复写，避免每个周期都无谓触发一次信号重算
                    if (!Boolean.valueOf(red).equals(old)) {
                        if (!writeSide(couple, boundary, side, sideMap, current, red)) {
                            return fail(r, "写入信号状态失败：Couple 桥接不可用（Create " + createVersion + "）");
                        }
                    }
                    applied = true;
                    if (dimKey == null) {
                        Object locations = get(field(C_BND, "edgeLocation"), boundary);
                        if (locations != null) {
                            Object loc = call(M_COUPLE_GET, locations, false);
                            if (loc == null) loc = call(M_COUPLE_GET, locations, true);
                            dimKey = keyOf(loc);
                        }
                    }
                }
            }
        }
        if (!applied) return fail(r, "该信号机尚未与轨道信号边界绑定");
        r.addProperty("ok", true);
        r.addProperty("signalId", id);
        r.addProperty("forced", red);
        r.addProperty("state", readSignalState(server, dimKey, target));
        r.addProperty("message", red ? "已强制红灯：列车会在该信号机前停车等待" : "已释放强制红灯：信号机恢复按区间占用自动显示");
        return r;
    }

    public static JsonObject setDestination(String trainId, String platformId) {
        JsonObject r = new JsonObject();
        if (!available()) return fail(r, "未检测到 Create");
        Object train;
        try {
            train = map(get(F_TRAINS, manager())).get(UUID.fromString(trainId));
        } catch (Throwable t) {
            return fail(r, "列车 ID 无效");
        }
        if (train == null) return fail(r, "找不到该列车");
        Object station = findPlatform(platformId);
        if (station == null) return fail(r, "找不到该站台");
        Object nav = get(F_TR_NAV, train);
        if (nav == null) return fail(r, "该列车没有导航系统");
        Object path = call(M_NAV_FIND, nav, station, 100000.0d);
        if (path == null) return fail(r, "无法规划到该站台的路径（检查轨道是否连通）");
        call(M_NAV_START, nav, path);
        Number dist = (Number) get(F_NAV_DIST, nav);
        Object stationName = get(F_ST_NAME, station);
        r.addProperty("ok", true);
        r.addProperty("message", "调度指令已下达：下一站 " + String.valueOf(stationName)
                + (dist == null ? "" : "（剩余 " + Math.round(dist.doubleValue()) + " 格）"));
        return r;
    }

    private static Object findPlatform(String platformId) {
        for (Object graph : map(get(F_GRAPHS, manager())).values()) {
            for (Object station : pointsOf(graph, EPT_STATION)) {
                if (platformId.equals(stationIdOf(station))) return station;
            }
        }
        return null;
    }

    private static BlockPos parsePos(String id) {
        String[] parts = id.split("\\|");
        if (parts.length != 4) return null;
        try {
            return new BlockPos(Integer.parseInt(parts[1]), Integer.parseInt(parts[2]), Integer.parseInt(parts[3]));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static JsonObject fail(JsonObject o, String message) {
        o.addProperty("ok", false);
        o.addProperty("message", message);
        return o;
    }

    /**
     * 周期性把强制红灯写回 Create。全图只遍历一次（不是每个信号遍历一次），
     * 且只对“当前不是强制红”的信号写入，避免无效触发信号重算。
     */
    public static int reapplyForced(MinecraftServer server, DispatchConfig cfg) {
        if (!available() || cfg.forcedSignals.isEmpty()) return 0;
        int applied = 0;
        for (Object graph : map(get(F_GRAPHS, manager())).values()) {
            for (Object boundary : pointsOf(graph, EPT_SIGNAL)) {
                try {
                    Object couple = get(F_BND_BLOCKENTS, boundary);
                    Object locations = get(field(C_BND, "edgeLocation"), boundary);
                    ResourceKey<Level> dimKey = null;
                    if (locations != null) {
                        Object loc = call(M_COUPLE_GET, locations, false);
                        if (loc == null) loc = call(M_COUPLE_GET, locations, true);
                        dimKey = keyOf(loc);
                    }
                    String dim = dimName(dimKey);
                    for (boolean side : new boolean[]{false, true}) {
                        Object sideMap = call(M_COUPLE_GET, couple, side);
                        if (!(sideMap instanceof Map)) continue;
                        Map<Object, Object> m = rawMap(sideMap);
                        List<Object> pending = new ArrayList<>();
                        for (Map.Entry<Object, Object> en : new ArrayList<>(m.entrySet())) {
                            if (!(en.getKey() instanceof BlockPos)) continue;
                            String sid = signalId(dim, (BlockPos) en.getKey());
                            if (!Boolean.TRUE.equals(cfg.forcedSignals.get(sid))) continue;
                            if (Boolean.TRUE.equals(en.getValue())) continue;
                            pending.add(en.getKey());
                        }
                        if (pending.isEmpty()) continue;
                        try {
                            // 就地写：绝大多数版本 blockEntities 的单侧表是可变的
                            for (Object k : pending) m.put(k, true);
                        } catch (UnsupportedOperationException uoe) {
                            // Create 6.x 若换成不可变表，整表复制后回填
                            Map<Object, Object> copy = new HashMap<>(m);
                            for (Object k : pending) copy.put(k, true);
                            call(M_COUPLE_SET, couple, side, copy);
                        }
                        call(M_COUPLE_SET, get(F_BND_SIDES, boundary), side, true);
                        applied += pending.size();
                    }
                } catch (Throwable t) {
                    warn("reapply", t);
                }
            }
        }
        return applied;
    }
}
