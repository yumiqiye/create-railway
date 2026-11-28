package qingjiang.railway.dispatch;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.world.entity.Entity;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 在服务端线程把 Create 的实时数据整理成一份快照 JSON，
 * 网页线程只读这份 JSON，避免跨线程访问 Create 内部数据结构。
 * 由原 PyRailDispatch 的 SnapshotBuilder 内置迁入。
 */
public final class DispatchSnapshot {

    private static final DateTimeFormatter CLOCK = DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneId.systemDefault());

    /** 以「tick 计数 / 真实毫秒」估算服务端 TPS，不依赖任何内部字段。 */
    private static long winStartMs;
    private static int winStartTicks = -1;
    private static volatile double lastTps = 20.0;

    private DispatchSnapshot() {
    }

    /** 每个服务端 tick 调用一次，只累加两个整数，开销可忽略。 */
    public static void noteTick(int ticks) {
        long now = System.currentTimeMillis();
        if (winStartTicks < 0) {
            winStartTicks = ticks;
            winStartMs = now;
            return;
        }
        int span = ticks - winStartTicks;
        if (span >= 100) {
            long dt = now - winStartMs;
            if (dt > 0) {
                double tps = span * 1000.0 / dt;
                if (tps > 20.0) tps = 20.0;
                lastTps = tps;
            }
            winStartTicks = ticks;
            winStartMs = now;
        }
    }

    public static JsonObject build(MinecraftServer server, DispatchConfig cfg) {
        JsonObject root = new JsonObject();
        long now = System.currentTimeMillis();
        root.addProperty("ok", true);
        root.addProperty("updatedAt", now);
        root.addProperty("clock", CLOCK.format(Instant.ofEpochMilli(now)));

        JsonObject meta = new JsonObject();
        meta.addProperty("modVersion", DispatchService.VERSION);
        meta.addProperty("author", "Qingjiang Railway");
        meta.addProperty("createVersion", DispatchBridge.createVersion());
        meta.addProperty("createPresent", DispatchBridge.available());
        meta.addProperty("serverSide", server != null);
        meta.addProperty("serverName", server == null ? "" : safeName(server));
        double tps = lastTps;
        double tickMs = tps <= 0 ? 0 : 1000.0 / tps;
        meta.addProperty("tps", Math.round(tps * 10) / 10.0);
        meta.addProperty("tickMs", Math.round(tickMs * 100) / 100.0);
        JsonArray addons = new JsonArray();
        for (String a : DispatchBridge.addons()) addons.add(a);
        meta.add("addons", addons);
        JsonArray dims = new JsonArray();
        for (String d : DispatchBridge.dimensions()) dims.add(d);
        meta.add("dimensions", dims);
        meta.addProperty("port", cfg.activePort());
        meta.addProperty("refreshMs", cfg.refreshMs);
        meta.addProperty("theme", cfg.theme);
        meta.addProperty("buildIntervalTicks", cfg.buildIntervalTicks);
        meta.addProperty("signalApplyIntervalTicks", cfg.signalApplyIntervalTicks);
        meta.addProperty("trackSampleSteps", cfg.trackSampleSteps);
        meta.addProperty("maxTrackPoints", cfg.maxTrackPoints);
        meta.addProperty("syncToClients", cfg.syncToClients);
        meta.addProperty("syncIntervalTicks", cfg.syncIntervalTicks);
        root.add("meta", meta);

        // 在线玩家
        JsonArray players = new JsonArray();
        Map<String, String> entityTrainMap = new HashMap<>();
        if (server != null) {
            for (ServerPlayer p : server.getPlayerList().getPlayers()) {
                JsonObject pj = new JsonObject();
                pj.addProperty("name", p.getName().getString());
                pj.addProperty("uuid", p.getUUID().toString());
                pj.addProperty("x", round(p.getX()));
                pj.addProperty("y", round(p.getY()));
                pj.addProperty("z", round(p.getZ()));
                players.add(pj);
            }
        }
        root.add("players", players);

        List<DispatchBridge.TrainView> trains = DispatchBridge.collectTrains();
        for (DispatchBridge.TrainView t : trains) {
            for (String e : t.carriageEntities) entityTrainMap.put(e, t.id);
        }

        // 谁在哪辆车上
        Map<String, String> playerOnTrain = new HashMap<>();
        if (server != null) {
            for (ServerPlayer p : server.getPlayerList().getPlayers()) {
                Entity vehicle = p.getVehicle();
                int guard = 0;
                while (vehicle != null && guard++ < 8) {
                    String trainId = entityTrainMap.get(vehicle.getUUID().toString());
                    if (trainId != null) {
                        playerOnTrain.put(p.getName().getString(), trainId);
                        break;
                    }
                    vehicle = vehicle.getVehicle();
                }
            }
        }

        JsonArray trainArr = new JsonArray();
        for (DispatchBridge.TrainView t : trains) {
            JsonObject j = new JsonObject();
            j.addProperty("id", t.id);
            j.addProperty("name", t.name);
            j.addProperty("dimension", t.dimension);
            j.addProperty("x", round(t.x));
            j.addProperty("y", round(t.y));
            j.addProperty("z", round(t.z));
            j.addProperty("speed", round(t.speed * 20.0));
            j.addProperty("speedAbs", round(Math.abs(t.speed) * 20.0));
            j.addProperty("reverse", t.speed < 0);
            j.addProperty("speedKph", round(Math.abs(t.speed) * 20.0 * 3.6));
            j.addProperty("passengers", t.passengers);
            j.addProperty("derailed", t.derailed);
            j.addProperty("waitingSignal", t.waitingSignal);
            j.addProperty("status", statusOf(t));
            j.addProperty("nextStationId", t.nextStationId);
            j.addProperty("nextStationName", t.nextStationName);
            j.addProperty("stationId", t.stationId);
            j.addProperty("stationName", t.stationName);
            j.addProperty("distanceToDest", t.distanceToDest < 0 ? -1 : Math.round(t.distanceToDest));

            JsonArray onBoard = new JsonArray();
            for (Map.Entry<String, String> e : playerOnTrain.entrySet()) {
                if (e.getValue().equals(t.id)) onBoard.add(e.getKey());
            }
            j.add("onBoard", onBoard);

            JsonArray sched = new JsonArray();
            for (String s : t.scheduleStations) sched.add(s);
            j.add("createSchedule", sched);

            // 时刻表与早晚点
            JsonObject tt = timetableFor(cfg, t.id);
            j.add("timetable", tt.deepCopy());
            computeTiming(j, cfg, t, now);
            trainArr.add(j);
        }
        root.add("trains", trainArr);

        // 站台（Create 车站方块），并按逻辑车站聚合
        List<DispatchBridge.PlatformView> platforms = DispatchBridge.collectPlatforms();
        JsonArray stationArr = new JsonArray();
        Map<String, JsonObject> groups = new LinkedHashMap<>();
        for (DispatchBridge.PlatformView s : platforms) {
            JsonObject j = new JsonObject();
            j.addProperty("id", s.id);
            j.addProperty("name", s.name);
            j.addProperty("dimension", s.dimension);
            j.addProperty("x", round(s.x));
            j.addProperty("y", round(s.y));
            j.addProperty("z", round(s.z));
            j.addProperty("present", s.present);
            j.addProperty("imminent", s.imminent);
            j.addProperty("groupId", s.groupId);
            j.addProperty("groupName", s.groupName);
            stationArr.add(j);

            JsonObject group = groups.computeIfAbsent(s.groupId, g -> {
                JsonObject o = new JsonObject();
                o.addProperty("id", g);
                o.addProperty("name", s.groupName);
                o.addProperty("dimension", s.dimension);
                o.add("platforms", new JsonArray());
                o.addProperty("present", false);
                o.addProperty("imminent", false);
                return o;
            });
            JsonArray pl = group.getAsJsonArray("platforms");
            JsonObject pj = new JsonObject();
            pj.addProperty("id", s.id);
            pj.addProperty("name", s.name);
            pj.addProperty("x", round(s.x));
            pj.addProperty("y", round(s.y));
            pj.addProperty("z", round(s.z));
            pl.add(pj);
            if (s.present) group.addProperty("present", true);
            if (s.imminent) group.addProperty("imminent", true);
        }
        root.add("stations", stationArr);
        JsonArray groupArr = new JsonArray();
        groups.values().forEach(groupArr::add);
        root.add("stationGroups", groupArr);

        JsonArray signalArr = new JsonArray();
        for (DispatchBridge.SignalView s : DispatchBridge.collectSignals(server)) {
            JsonObject j = new JsonObject();
            j.addProperty("id", s.id);
            j.addProperty("dimension", s.dimension);
            j.addProperty("x", round(s.x));
            j.addProperty("y", round(s.y));
            j.addProperty("z", round(s.z));
            j.addProperty("state", s.state);
            j.addProperty("type", s.type);
            j.addProperty("forced", s.forced);
            j.addProperty("occupied", s.occupied);
            signalArr.add(j);
        }
        root.add("signals", signalArr);

        JsonObject tracksMeta = new JsonObject();
        JsonArray dimsArr = new JsonArray();
        for (String d : DispatchBridge.dimensions()) {
            JsonObject o = new JsonObject();
            o.addProperty("dimension", d);
            o.addProperty("available", true);
            dimsArr.add(o);
        }
        tracksMeta.add("list", dimsArr);
        root.add("tracks", tracksMeta);
        return root;
    }

    private static String safeName(MinecraftServer server) {
        try {
            return server.getWorldData().getLevelName();
        } catch (Throwable t) {
            return "";
        }
    }

    private static String statusOf(DispatchBridge.TrainView t) {
        if (t.derailed) return "脱轨";
        double speed = Math.abs(t.speed);
        if (t.nextStationName == null || t.nextStationName.isEmpty()) {
            return speed > 0.01 ? "手动驾驶" : "待命";
        }
        if (t.waitingSignal) return "等待信号";
        if (speed <= 0.01) return "停车";
        return "运行中";
    }

    private static JsonObject timetableFor(DispatchConfig cfg, String trainId) {
        JsonObject o = new JsonObject();
        Map<String, String> m = cfg.timetable.get(trainId);
        if (m != null) {
            for (Map.Entry<String, String> e : m.entrySet()) o.addProperty(e.getKey(), e.getValue());
        }
        return o;
    }

    /**
     * 计算预计到站时间与早晚点。
     * 以实际时间（系统时钟）为准；延误立即重算。
     */
    private static void computeTiming(JsonObject train, DispatchConfig cfg, DispatchBridge.TrainView t, long now) {
        String planned = "";
        Map<String, String> tt = cfg.timetable.get(t.id);
        if (tt != null && !t.nextStationId.isEmpty()) {
            planned = tt.getOrDefault(t.nextStationId, "");
        }
        train.addProperty("plannedTime", planned);

        // Create 的 speed 带方向符号（反向行驶为负），算 ETA 必须取绝对值
        double speed = Math.abs(t.speed) * 20.0; // 格/秒
        double etaSeconds = -1;
        if (t.distanceToDest > 0 && speed > 0.05) {
            etaSeconds = t.distanceToDest / speed;
        }
        train.addProperty("etaSeconds", etaSeconds < 0 ? -1 : Math.round(etaSeconds));
        long etaMillis = etaSeconds < 0 ? -1 : now + (long) (etaSeconds * 1000);
        train.addProperty("etaClock", etaMillis < 0 ? "--:--:--" : CLOCK.format(Instant.ofEpochMilli(etaMillis)));

        if (planned.isEmpty() || etaMillis < 0) {
            train.addProperty("delaySeconds", 0);
            train.addProperty("delayText", planned.isEmpty() ? "未排点" : "待推算");
            train.addProperty("delayState", planned.isEmpty() ? "none" : "unknown");
            return;
        }
        long plannedMillis = plannedMillisToday(planned, now);
        if (plannedMillis < 0) {
            train.addProperty("delaySeconds", 0);
            train.addProperty("delayText", "时刻格式错误");
            train.addProperty("delayState", "unknown");
            return;
        }
        long diff = etaMillis - plannedMillis;
        long abs = Math.abs(diff);
        train.addProperty("delaySeconds", Math.round(diff / 1000.0));
        if (abs < 30_000) {
            train.addProperty("delayText", "准点");
            train.addProperty("delayState", "ontime");
        } else if (diff > 0) {
            train.addProperty("delayText", "晚点 " + human(abs));
            train.addProperty("delayState", "late");
        } else {
            train.addProperty("delayText", "早点 " + human(abs));
            train.addProperty("delayState", "early");
        }
    }

    private static long plannedMillisToday(String hhmmss, long now) {
        try {
            String[] parts = hhmmss.split(":");
            int h = Integer.parseInt(parts[0]);
            int m = Integer.parseInt(parts[1]);
            int s = parts.length > 2 ? Integer.parseInt(parts[2]) : 0;
            if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) return -1;
            java.time.LocalDate today = Instant.ofEpochMilli(now).atZone(ZoneId.systemDefault()).toLocalDate();
            return today.atTime(h, m, s).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        } catch (Throwable t) {
            return -1;
        }
    }

    private static String human(long millis) {
        long totalSeconds = Math.max(1, (long) Math.ceil(millis / 1000.0));
        long m = totalSeconds / 60;
        long s = totalSeconds % 60;
        if (m <= 0) return s + " 秒";
        return m + " 分 " + s + " 秒";
    }

    private static double round(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
