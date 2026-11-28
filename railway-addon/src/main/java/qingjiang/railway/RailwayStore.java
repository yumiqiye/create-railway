package qingjiang.railway;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.TagParser;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.storage.LevelResource;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 附属自己的世界数据：车站范围、闸机设置、售票机里的身份证。
 * 与 CRH 的世界文件完全分离，卸载附属不会破坏 CRH 存档。
 */
public final class RailwayStore {
    public static final int GATE_ENTRY = 0;
    public static final int GATE_CHECK = 1;
    public static final int GATE_EXIT = 2;

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Map<String, Station> STATIONS = new LinkedHashMap<>();
    private static final Map<String, GateSetting> GATES = new LinkedHashMap<>();
    private static final Map<String, VendorSetting> VENDORS = new LinkedHashMap<>();
    private static final Map<String, CardData> CARDS = new LinkedHashMap<>();
    private static Path file;
    private static boolean loaded;

    private RailwayStore() {}

    public static final class Station {
        public String name = "";
        public String dimension = "minecraft:overworld";
        public int x1, y1, z1, x2, y2, z2;
        public int cx, cy, cz;
        public final List<BlockPos> gates = new ArrayList<>();
        public final List<BlockPos> vendors = new ArrayList<>();
        public String backendId = "";

        public boolean contains(BlockPos pos) {
            return pos.getX() >= Math.min(x1, x2) && pos.getX() <= Math.max(x1, x2)
                    && pos.getY() >= Math.min(y1, y2) && pos.getY() <= Math.max(y1, y2)
                    && pos.getZ() >= Math.min(z1, z2) && pos.getZ() <= Math.max(z1, z2);
        }
    }

    public static final class GateSetting {
        public int type = GATE_ENTRY;
        public boolean disabled = false;
        public String deviceId = "";
        public String gateNo = "";
        public String status = "normal";
        public String maintenanceText = "";
        public String mode = "auto";
        public boolean cameraEnabled = true;
        public boolean showScanPreview = false;
        public String welcomeText = "";
        public int configVersion = 0;
        public String lastMessage = "";
        public long messageUntil = 0L;
    }

    public static final class VendorSetting {
        public String deviceId = "";
        public String name = "";
        public String kind = "ticket-machine";
        public String status = "normal";
        public int configVersion = 0;
    }

    public static final class CardData {
        public String name = "";
        public String idNo = "";
        public String ticketSnbt = "";
        public String metroCardSnbt = "";

        public ItemStack toStack() {
            ItemStack stack = new ItemStack(ModItems.ID_CARD.get());
            TicketNbt.writeIdentity(stack, name, idNo);
            if (ticketSnbt != null && !ticketSnbt.isBlank()) {
                try {
                    CompoundTag ticket = TagParser.parseTag(ticketSnbt);
                    CompoundTag card = TicketNbt.copy(stack);
                    for (String key : new String[]{TicketNbt.TICKET_INFO, TicketNbt.STATION_INFO, TicketNbt.PASSENGER_INFO}) {
                        if (ticket.contains(key)) card.put(key, ticket.getCompound(key).copy());
                    }
                    card.putBoolean(TicketNbt.TICKET, true);
                    TicketNbt.set(stack, card);
                } catch (Exception ignored) {
                }
            }
            return stack;
        }

        public static CardData fromStack(ItemStack stack) {
            CardData data = new CardData();
            data.name = TicketNbt.idCardName(stack);
            data.idNo = TicketNbt.idCardNumber(stack);
            CompoundTag tag = TicketNbt.copy(stack);
            if (tag.getBoolean(TicketNbt.TICKET) && tag.contains(TicketNbt.TICKET_INFO)) {
                CompoundTag ticket = new CompoundTag();
                for (String key : new String[]{TicketNbt.TICKET_INFO, TicketNbt.STATION_INFO, TicketNbt.PASSENGER_INFO}) {
                    if (tag.contains(key)) ticket.put(key, tag.getCompound(key).copy());
                }
                data.ticketSnbt = ticket.toString();
            }
            return data;
        }

        public void updateTicketFrom(ItemStack ticketStack) {
            CompoundTag ticket = new CompoundTag();
            CompoundTag source = TicketNbt.copy(ticketStack);
            for (String key : new String[]{TicketNbt.TICKET_INFO, TicketNbt.STATION_INFO, TicketNbt.PASSENGER_INFO}) {
                if (source.contains(key)) ticket.put(key, source.getCompound(key).copy());
            }
            this.ticketSnbt = ticket.toString();
        }

        public ItemStack toMetroStack() {
            ItemStack stack = new ItemStack(ModItems.METRO_CARD.get());
            if (metroCardSnbt != null && !metroCardSnbt.isBlank()) {
                try {
                    CompoundTag tag = TagParser.parseTag(metroCardSnbt);
                    MetroNbt.set(stack, tag);
                } catch (Exception ignored) {
                }
            }
            return stack;
        }

        public static CardData fromMetroStack(ItemStack stack) {
            CardData data = new CardData();
            data.metroCardSnbt = MetroNbt.copy(stack).toString();
            return data;
        }

        public void updateMetroCardFrom(ItemStack metroStack) {
            this.metroCardSnbt = MetroNbt.copy(metroStack).toString();
        }
    }

    public static void load(MinecraftServer server) {
        if (loaded) return;
        loaded = true;
        file = server.getWorldPath(LevelResource.ROOT).resolve("railway_plus_addon.json");
        STATIONS.clear();
        GATES.clear();
        VENDORS.clear();
        CARDS.clear();
        if (!Files.exists(file)) return;
        try {
            JsonObject root = new JsonParser().parse(Files.readString(file, StandardCharsets.UTF_8)).getAsJsonObject();
            JsonArray stations = root.has("stations") ? root.getAsJsonArray("stations") : new JsonArray();
            for (JsonElement element : stations) {
                Station station = readStation(element.getAsJsonObject());
                STATIONS.put(station.name, station);
            }
            JsonObject gates = root.has("gates") ? root.getAsJsonObject("gates") : new JsonObject();
            for (String key : gates.keySet()) {
                JsonObject object = gates.getAsJsonObject(key);
                GateSetting setting = new GateSetting();
                setting.type = object.has("type") ? object.get("type").getAsInt() : GATE_ENTRY;
                setting.disabled = object.has("disabled") && object.get("disabled").getAsBoolean();
                setting.deviceId = RailwayWeb.str(object, "deviceId", "");
                setting.gateNo = RailwayWeb.str(object, "gateNo", "");
                setting.status = RailwayWeb.str(object, "status", "normal");
                setting.maintenanceText = RailwayWeb.str(object, "maintenanceText", "");
                setting.mode = RailwayWeb.str(object, "mode", "auto");
                setting.cameraEnabled = RailwayWeb.b(object, "cameraEnabled", true);
                setting.showScanPreview = RailwayWeb.b(object, "showScanPreview", false);
                setting.welcomeText = RailwayWeb.str(object, "welcomeText", "");
                setting.configVersion = RailwayWeb.i(object, "configVersion", 0);
                GATES.put(key, setting);
            }
            JsonObject vendors = root.has("vendors") ? root.getAsJsonObject("vendors") : new JsonObject();
            for (String key : vendors.keySet()) {
                JsonObject object = vendors.getAsJsonObject(key);
                VendorSetting vendor = new VendorSetting();
                vendor.deviceId = RailwayWeb.str(object, "deviceId", "");
                vendor.name = RailwayWeb.str(object, "name", "");
                vendor.kind = RailwayWeb.str(object, "kind", "ticket-machine");
                vendor.status = RailwayWeb.str(object, "status", "normal");
                vendor.configVersion = RailwayWeb.i(object, "configVersion", 0);
                VENDORS.put(key, vendor);
            }
            JsonObject cards = root.has("cards") ? root.getAsJsonObject("cards") : new JsonObject();
            for (String key : cards.keySet()) {
                JsonObject object = cards.getAsJsonObject(key);
                CardData card = new CardData();
                card.name = RailwayWeb.str(object, "name", "");
                card.idNo = RailwayWeb.str(object, "idNo", "");
                card.ticketSnbt = RailwayWeb.str(object, "ticket", "");
                card.metroCardSnbt = RailwayWeb.str(object, "metroCard", "");
                CARDS.put(key, card);
            }
        } catch (Exception ignored) {
        }
    }

    public static synchronized void save(MinecraftServer server) {        if (file == null) {
            if (server == null) return;
            file = server.getWorldPath(LevelResource.ROOT).resolve("railway_plus_addon.json");
        }
        JsonObject root = new JsonObject();
        JsonArray stations = new JsonArray();
        for (Station station : STATIONS.values()) stations.add(writeStation(station));
        root.add("stations", stations);

        JsonObject gates = new JsonObject();
        for (Map.Entry<String, GateSetting> entry : GATES.entrySet()) {
            JsonObject object = new JsonObject();
            object.addProperty("type", entry.getValue().type);
            object.addProperty("disabled", entry.getValue().disabled);
            object.addProperty("deviceId", entry.getValue().deviceId);
            object.addProperty("gateNo", entry.getValue().gateNo);
            object.addProperty("status", entry.getValue().status);
            object.addProperty("maintenanceText", entry.getValue().maintenanceText);
            object.addProperty("mode", entry.getValue().mode);
            object.addProperty("cameraEnabled", entry.getValue().cameraEnabled);
            object.addProperty("showScanPreview", entry.getValue().showScanPreview);
            object.addProperty("welcomeText", entry.getValue().welcomeText);
            object.addProperty("configVersion", entry.getValue().configVersion);
            gates.add(entry.getKey(), object);
        }
        root.add("gates", gates);

        JsonObject vendors = new JsonObject();
        for (Map.Entry<String, VendorSetting> entry : VENDORS.entrySet()) {
            JsonObject object = new JsonObject();
            object.addProperty("deviceId", entry.getValue().deviceId);
            object.addProperty("name", entry.getValue().name);
            object.addProperty("kind", entry.getValue().kind);
            object.addProperty("status", entry.getValue().status);
            object.addProperty("configVersion", entry.getValue().configVersion);
            vendors.add(entry.getKey(), object);
        }
        root.add("vendors", vendors);

        JsonObject cards = new JsonObject();
        for (Map.Entry<String, CardData> entry : CARDS.entrySet()) {
            JsonObject object = new JsonObject();
            object.addProperty("name", entry.getValue().name);
            object.addProperty("idNo", entry.getValue().idNo);
            object.addProperty("ticket", entry.getValue().ticketSnbt);
            object.addProperty("metroCard", entry.getValue().metroCardSnbt);
            cards.add(entry.getKey(), object);
        }
        root.add("cards", cards);

        try {
            Files.createDirectories(file.getParent());
            Files.writeString(file, GSON.toJson(root), StandardCharsets.UTF_8);
        } catch (IOException ignored) {
        }
    }

    private static JsonObject writeStation(Station station) {
        JsonObject object = new JsonObject();
        object.addProperty("name", station.name);
        object.addProperty("dimension", station.dimension);
        object.addProperty("x1", station.x1);
        object.addProperty("y1", station.y1);
        object.addProperty("z1", station.z1);
        object.addProperty("x2", station.x2);
        object.addProperty("y2", station.y2);
        object.addProperty("z2", station.z2);
        object.addProperty("cx", station.cx);
        object.addProperty("cy", station.cy);
        object.addProperty("cz", station.cz);
        object.addProperty("backendId", station.backendId);
        JsonArray gates = new JsonArray();
        for (BlockPos pos : station.gates) gates.add(pos.asLong());
        object.add("gates", gates);
        JsonArray vendors = new JsonArray();
        for (BlockPos pos : station.vendors) vendors.add(pos.asLong());
        object.add("vendors", vendors);
        return object;
    }

    private static Station readStation(JsonObject object) {
        Station station = new Station();
        station.name = RailwayWeb.str(object, "name", "");
        station.dimension = RailwayWeb.str(object, "dimension", "minecraft:overworld");
        station.x1 = RailwayWeb.i(object, "x1", 0);
        station.y1 = RailwayWeb.i(object, "y1", 0);
        station.z1 = RailwayWeb.i(object, "z1", 0);
        station.x2 = RailwayWeb.i(object, "x2", 0);
        station.y2 = RailwayWeb.i(object, "y2", 0);
        station.z2 = RailwayWeb.i(object, "z2", 0);
        station.cx = RailwayWeb.i(object, "cx", 0);
        station.cy = RailwayWeb.i(object, "cy", 0);
        station.cz = RailwayWeb.i(object, "cz", 0);
        station.backendId = RailwayWeb.str(object, "backendId", "");
        if (object.has("gates")) for (JsonElement e : object.getAsJsonArray("gates")) station.gates.add(BlockPos.of(e.getAsLong()));
        if (object.has("vendors")) for (JsonElement e : object.getAsJsonArray("vendors")) station.vendors.add(BlockPos.of(e.getAsLong()));
        return station;
    }

    public static Station stationAt(Level level, BlockPos pos) {
        String dimension = level.dimension().location().toString();
        for (Station station : STATIONS.values()) {
            if (station.dimension.equals(dimension) && station.contains(pos)) return station;
        }
        return null;
    }

    public static Station stationByName(String name) {
        return STATIONS.get(name);
    }

    public static Map<String, Station> stations() {
        return STATIONS;
    }

    /**
     * 从网页后台拉取车站台账，补齐后台新建车站，并回填本地车站的后端 ID、维度和中心点。
     * 本地已划定的范围、闸机和售票机清单不会被远端覆盖；远端无本地方块记录的车站先按中心点登记为占位台账。
     */
    public static synchronized int[] pullRemote(JsonObject envelope) {
        JsonObject data = RailwayWeb.data(envelope);
        JsonElement list = data.get("stations");
        if (list == null || !list.isJsonArray()) return new int[]{0, 0};

        int added = 0;
        int updated = 0;
        for (JsonElement element : list.getAsJsonArray()) {
            if (!element.isJsonObject()) continue;
            JsonObject remote = element.getAsJsonObject();
            String name = RailwayWeb.str(remote, "name", "").trim();
            String backendId = RailwayWeb.str(remote, "id", "").trim();
            if (name.isBlank()) continue;

            int x = RailwayWeb.i(remote, "x", 0);
            int y = RailwayWeb.i(remote, "y", 0);
            int z = RailwayWeb.i(remote, "z", 0);
            String dimension = RailwayWeb.str(remote, "dimension", "minecraft:overworld");

            Station local = null;
            for (Station station : STATIONS.values()) {
                if (!backendId.isBlank() && backendId.equals(station.backendId)) {
                    local = station;
                    break;
                }
            }
            if (local == null) local = STATIONS.get(name);

            if (local == null) {
                local = new Station();
                local.name = name;
                local.backendId = backendId;
                local.dimension = dimension;
                local.cx = x;
                local.cy = y;
                local.cz = z;
                local.x1 = local.x2 = x;
                local.y1 = local.y2 = y;
                local.z1 = local.z2 = z;
                STATIONS.put(name, local);
                added++;
                continue;
            }

            if (!backendId.isBlank()) local.backendId = backendId;
            if (!dimension.isBlank()) local.dimension = dimension;
            if (x != 0 || y != 0 || z != 0) {
                local.cx = x;
                local.cy = y;
                local.cz = z;
                if (local.x1 == 0 && local.y1 == 0 && local.z1 == 0
                        && local.x2 == 0 && local.y2 == 0 && local.z2 == 0) {
                    local.x1 = local.x2 = x;
                    local.y1 = local.y2 = y;
                    local.z1 = local.z2 = z;
                }
            }
            updated++;
        }
        return new int[]{added, updated};
    }

    /** 异步拉取后台车站台账；失败时保留本地数据不变。 */
    public static void refreshRemoteAsync() {
        RailwayWeb.getAsync("/railway/stations", RailwayStore::applyRemoteEnvelope, ignored -> {});
    }

    private static void applyRemoteEnvelope(JsonObject envelope) {
        pullRemote(envelope);
    }

    /** 异步拉取后台检票机与购票机台账；失败时保留本地设备配置不变。 */
    public static void refreshDeviceConfigAsync() {
        RailwayWeb.getAsync("/railway/admin/devices", RailwayStore::applyRemoteDevices, ignored -> {});
        RailwayWeb.getAsync("/railway/admin/tvms", RailwayStore::applyRemoteTvms, ignored -> {});
    }

    private static void applyRemoteDevices(JsonObject envelope) {
        pullRemoteDevices(envelope);
    }

    private static void applyRemoteTvms(JsonObject envelope) {
        pullRemoteTvms(envelope);
    }

    public static synchronized int[] pullRemoteDevices(JsonObject envelope) {
        JsonArray list = resultArray(envelope);
        int applied = 0;
        for (JsonElement element : list) {
            if (!element.isJsonObject()) continue;
            JsonObject remote = element.getAsJsonObject();
            String stationId = RailwayWeb.str(remote, "stationId", "");
            String stationName = RailwayWeb.str(remote, "stationName", "");
            String gateNo = RailwayWeb.str(remote, "gateNo", "").trim();
            Station station = matchStation(stationId, stationName);
            if (station == null || gateNo.isBlank()) continue;

            String gateType = RailwayWeb.str(remote, "gateType", "checkin");
            String status = RailwayWeb.str(remote, "status", "normal");
            JsonObject config = remote.has("remoteConfig") && remote.get("remoteConfig").isJsonObject()
                    ? remote.getAsJsonObject("remoteConfig") : new JsonObject();

            for (BlockPos pos : station.gates) {
                String key = station.dimension + "@" + pos.asLong();
                GateSetting setting = GATES.computeIfAbsent(key, ignored -> new GateSetting());
                if (!setting.gateNo.isBlank() && !setting.gateNo.equals(gateNo)) continue;

                setting.deviceId = RailwayWeb.str(remote, "id", "");
                setting.gateNo = gateNo;
                setting.type = switch (gateType) {
                    case "entry" -> GATE_ENTRY;
                    case "exit" -> GATE_EXIT;
                    default -> GATE_CHECK;
                };
                setting.status = status;
                setting.disabled = !"normal".equals(status);
                setting.maintenanceText = RailwayWeb.str(remote, "maintenanceText", "");
                setting.mode = RailwayWeb.str(config, "mode", "auto");
                setting.cameraEnabled = RailwayWeb.b(config, "cameraEnabled", true);
                setting.showScanPreview = RailwayWeb.b(config, "showScanPreview", false);
                setting.welcomeText = RailwayWeb.str(config, "welcomeText", "");
                setting.configVersion = RailwayWeb.i(remote, "configVersion", 0);
                applied++;
                break;
            }
        }
        return new int[]{applied};
    }

    public static synchronized int[] pullRemoteTvms(JsonObject envelope) {
        JsonArray list = resultArray(envelope);
        int applied = 0;
        for (JsonElement element : list) {
            if (!element.isJsonObject()) continue;
            JsonObject remote = element.getAsJsonObject();
            Station station = matchStation(RailwayWeb.str(remote, "stationId", ""),
                    RailwayWeb.str(remote, "stationName", ""));
            if (station == null) continue;

            JsonObject posObject = remote.has("pos") && remote.get("pos").isJsonObject()
                    ? remote.getAsJsonObject("pos") : new JsonObject();
            int rx = RailwayWeb.i(posObject, "x", Integer.MIN_VALUE);
            int ry = RailwayWeb.i(posObject, "y", Integer.MIN_VALUE);
            int rz = RailwayWeb.i(posObject, "z", Integer.MIN_VALUE);

            for (BlockPos pos : station.vendors) {
                boolean posMatched = rx == Integer.MIN_VALUE || (rx == pos.getX() && ry == pos.getY() && rz == pos.getZ());
                if (!posMatched) continue;
                String key = station.dimension + "@" + pos.asLong();
                VendorSetting vendor = VENDORS.computeIfAbsent(key, ignored -> new VendorSetting());
                vendor.deviceId = RailwayWeb.str(remote, "id", "");
                vendor.name = RailwayWeb.str(remote, "name", "");
                vendor.kind = RailwayWeb.str(remote, "kind", "ticket-machine");
                vendor.status = RailwayWeb.str(remote, "status", "normal");
                vendor.configVersion = RailwayWeb.i(remote, "configVersion", 0);
                applied++;
                break;
            }
        }
        return new int[]{applied};
    }

    private static Station matchStation(String backendId, String name) {
        if (!backendId.isBlank()) {
            for (Station station : STATIONS.values()) {
                if (backendId.equals(station.backendId)) return station;
            }
        }
        return name.isBlank() ? null : STATIONS.get(name);
    }

    private static JsonArray resultArray(JsonObject envelope) {
        JsonElement result = envelope.get("result");
        if (result != null && result.isJsonArray()) return result.getAsJsonArray();
        if (result != null && result.isJsonObject()) {
            JsonElement stations = result.getAsJsonObject().get("stations");
            if (stations != null && stations.isJsonArray()) return stations.getAsJsonArray();
        }
        return new JsonArray();
    }

    /** 删除本地车站及其闸机/售票机设置；网页端由命令另行通知删除。 */
    public static Station removeStation(String name) {
        Station station = STATIONS.remove(name);
        if (station == null) return null;
        for (BlockPos pos : station.gates) {
            GATES.remove(station.dimension + "@" + pos.asLong());
            CARDS.remove(station.dimension + "@" + pos.asLong());
        }
        for (BlockPos pos : station.vendors) {
            String key = station.dimension + "@" + pos.asLong();
            VENDORS.remove(key);
            CARDS.remove(key);
        }
        return station;
    }

    public static Station registerStation(Level level, String name, BlockPos pos1, BlockPos pos2) {
        Station station = STATIONS.computeIfAbsent(name, key -> new Station());
        station.name = name;
        station.dimension = level.dimension().location().toString();
        station.x1 = Math.min(pos1.getX(), pos2.getX());
        station.y1 = Math.min(pos1.getY(), pos2.getY());
        station.z1 = Math.min(pos1.getZ(), pos2.getZ());
        station.x2 = Math.max(pos1.getX(), pos2.getX());
        station.y2 = Math.max(pos1.getY(), pos2.getY());
        station.z2 = Math.max(pos1.getZ(), pos2.getZ());
        station.cx = (station.x1 + station.x2) / 2;
        station.cy = (station.y1 + station.y2) / 2;
        station.cz = (station.z1 + station.z2) / 2;
        scan(level, station);
        return station;
    }

    private static void scan(Level level, Station station) {
        station.gates.clear();
        station.vendors.clear();
        long volume = (long) (station.x2 - station.x1 + 1) * (station.y2 - station.y1 + 1) * (station.z2 - station.z1 + 1);
        if (volume > 500_000L) return;
        BlockPos.MutableBlockPos cursor = new BlockPos.MutableBlockPos();
        for (int x = station.x1; x <= station.x2; x++) {
            for (int y = station.y1; y <= station.y2; y++) {
                for (int z = station.z1; z <= station.z2; z++) {
                    cursor.set(x, y, z);
                    BlockState state = level.getBlockState(cursor);
                    if (CrhCompat.isTicketVendor(state)) station.vendors.add(cursor.immutable());
                    else if (CrhCompat.isGate(state)) station.gates.add(cursor.immutable());
                }
            }
        }
    }

    public static String gateKey(Level level, BlockPos pos) {
        return level.dimension().location() + "@" + pos.asLong();
    }

    public static GateSetting gate(Level level, BlockPos pos, BlockState state) {
        return GATES.computeIfAbsent(gateKey(level, pos), key -> {
            GateSetting setting = new GateSetting();
            setting.type = CrhCompat.defaultGateType(state);
            return setting;
        });
    }

    public static GateSetting gateIfPresent(Level level, BlockPos pos) {
        return GATES.get(gateKey(level, pos));
    }

    public static VendorSetting vendor(Level level, BlockPos pos) {
        return VENDORS.computeIfAbsent(gateKey(level, pos), key -> new VendorSetting());
    }

    public static VendorSetting vendorIfPresent(Level level, BlockPos pos) {
        return VENDORS.get(gateKey(level, pos));
    }

    public static void setGateMessage(Level level, BlockPos pos, GateSetting setting, String message, long millis) {
        setting.lastMessage = message == null ? "" : message;
        setting.messageUntil = System.currentTimeMillis() + millis;
    }

    public static CardData cardAt(Level level, BlockPos pos) {
        return CARDS.get(gateKey(level, pos));
    }

    public static void putCard(Level level, BlockPos pos, CardData data) {
        CARDS.put(gateKey(level, pos), data);
    }

    public static CardData removeCard(Level level, BlockPos pos) {
        return CARDS.remove(gateKey(level, pos));
    }

    public static CardData nearbyVendorCard(Level level, BlockPos origin, int radius, String idNo) {
        for (Map.Entry<String, CardData> entry : CARDS.entrySet()) {
            String prefix = level.dimension().location() + "@";
            if (!entry.getKey().startsWith(prefix)) continue;
            BlockPos pos = BlockPos.of(Long.parseLong(entry.getKey().substring(prefix.length())));
            if (pos.distManhattan(origin) <= radius && (idNo.isBlank() || entry.getValue().idNo.equals(idNo))) {
                return entry.getValue();
            }
        }
        return null;
    }

    public static CardData nearbyMetroCard(Level level, BlockPos origin, int radius) {
        String prefix = level.dimension().location() + "@";
        for (Map.Entry<String, CardData> entry : CARDS.entrySet()) {
            if (entry.getValue().metroCardSnbt.isBlank()) continue;
            if (!entry.getKey().startsWith(prefix)) continue;
            BlockPos pos = BlockPos.of(Long.parseLong(entry.getKey().substring(prefix.length())));
            if (pos.distManhattan(origin) <= radius) return entry.getValue();
        }
        return null;
    }

    public static BlockPos nearbyMetroCardPos(Level level, BlockPos origin, int radius) {
        String prefix = level.dimension().location() + "@";
        for (Map.Entry<String, CardData> entry : CARDS.entrySet()) {
            if (entry.getValue().metroCardSnbt.isBlank()) continue;
            if (!entry.getKey().startsWith(prefix)) continue;
            BlockPos pos = BlockPos.of(Long.parseLong(entry.getKey().substring(prefix.length())));
            if (pos.distManhattan(origin) <= radius) return pos;
        }
        return null;
    }

    /** 找到并移除附近售票机内与证件号/乘客名匹配的身份证，供出票后连同票据一起取出。 */
    public static CardData removeNearbyVendorCard(Level level, BlockPos origin, int radius, String idNo, String name) {
        String prefix = level.dimension().location() + "@";
        for (Map.Entry<String, CardData> entry : CARDS.entrySet()) {
            if (!entry.getKey().startsWith(prefix)) continue;
            BlockPos pos = BlockPos.of(Long.parseLong(entry.getKey().substring(prefix.length())));
            if (pos.distManhattan(origin) > radius) continue;
            CardData data = entry.getValue();
            if (!idNo.isBlank() && !idNo.equals(data.idNo)) continue;
            if (!name.isBlank() && !name.equals(data.name)) continue;
            CARDS.remove(entry.getKey());
            return data;
        }
        return null;
    }

    /** 退出世界后清空内存，单机切换存档时会重新从新存档加载。 */
    public static synchronized void unload() {
        loaded = false;
        file = null;
        STATIONS.clear();
        GATES.clear();
        VENDORS.clear();
        CARDS.clear();
    }
}
