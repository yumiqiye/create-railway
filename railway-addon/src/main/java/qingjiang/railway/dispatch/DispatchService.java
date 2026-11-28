package qingjiang.railway.dispatch;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.server.MinecraftServer;
import qingjiang.railway.RailwayAddon;

import java.io.IOException;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 调度台服务：服务端 tick 采样 -> 快照 JSON -> 网页线程只读；
 * 网页下发的指令回到服务端线程执行，保证不破坏 Create 的线程模型。
 * 由原 PyRailDispatch 的 DispatchService 内置迁入。
 */
public final class DispatchService {
    private static final Gson GSON = new Gson();
    private static final DateTimeFormatter CLOCK = DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneId.systemDefault());

    public static String VERSION = "1.0.0";
    public static DispatchConfig CONFIG;
    public static DispatchService SERVICE;

    private final DispatchConfig cfg;
    private final DispatchWebServer web;
    private final DispatchScheduler scheduler = new DispatchScheduler();

    private volatile String localJson;
    private volatile String remoteJson;
    private volatile MinecraftServer server;
    private final JsonArray logs = new JsonArray();

    public DispatchService(DispatchConfig cfg) {
        this.cfg = cfg;
        this.web = new DispatchWebServer(cfg.port, this::route);
    }

    public void startWeb() {
        try {
            web.start();
            int p = web.port();
            cfg.activePort(p);
            if (p != cfg.port) {
                RailwayAddon.LOGGER.warn("[dispatch] 调度台配置端口 {} 已被其他游戏实例占用，本次改用 {}", cfg.port, p);
            }
            RailwayAddon.LOGGER.info("[dispatch] 调度台已启动: http://127.0.0.1:{}", p);
        } catch (IOException e) {
            RailwayAddon.LOGGER.error("[dispatch] 调度台端口 {} 启动失败: {}", cfg.port, e.toString());
        }
    }

    public void stop() {
        scheduler.reset();
        try {
            web.close();
        } catch (Throwable ignored) {
        }
    }

    /** 实际监听端口，可能因配置端口被占而顺延。 */
    public int port() {
        return web.port();
    }

    // ---------------- 服务端 tick ----------------
    public void onEndTick(MinecraftServer s) {
        server = s;
        int tick = s.getTickCount();
        DispatchSnapshot.noteTick(tick);
        try {
            if (tick % cfg.buildIntervalTicks == 0) {
                for (String dim : DispatchBridge.dimensions()) {
                    DispatchBridge.rebuildTracks(dim, cfg);
                }
                JsonObject snap = DispatchSnapshot.build(s, cfg);
                snap.add("logs", logsCopy());
                localJson = GSON.toJson(snap);
            }
            if (tick % cfg.signalApplyIntervalTicks == 0) {
                DispatchBridge.reapplyForced(s, cfg);
            }
            // 时刻表到点自动改派目的地
            scheduler.tick(s, cfg, this::log);
            if (cfg.syncToClients && tick % cfg.syncIntervalTicks == 0) {
                DispatchSyncNet.broadcast(s, currentJson());
            }
        } catch (Throwable t) {
            RailwayAddon.LOGGER.warn("[dispatch] 调度台快照构建失败: {}", t.toString());
        }
    }

    public String currentJson() {
        String local = localJson;
        if (local != null) return local;
        String remote = remoteJson;
        if (remote != null) return remote;
        JsonObject o = new JsonObject();
        o.addProperty("ok", false);
        o.addProperty("pending", true);
        JsonObject meta = new JsonObject();
        meta.addProperty("createPresent", DispatchBridge.available());
        meta.addProperty("createVersion", DispatchBridge.createVersion());
        meta.addProperty("modVersion", VERSION);
        meta.addProperty("refreshMs", cfg.refreshMs);
        meta.addProperty("theme", cfg.theme);
        o.add("meta", meta);
        o.add("trains", new JsonArray());
        o.add("stations", new JsonArray());
        o.add("stationGroups", new JsonArray());
        o.add("signals", new JsonArray());
        o.add("players", new JsonArray());
        o.add("logs", logsCopy());
        return GSON.toJson(o);
    }

    public void setRemoteJson(String json) {
        if (json != null && json.length() > 10) remoteJson = json;
    }

    public void clearRemote() {
        remoteJson = null;
    }

    // ---------------- 调度日志 ----------------
    private void log(String text) {
        synchronized (logs) {
            JsonObject o = new JsonObject();
            o.addProperty("time", CLOCK.format(Instant.now()));
            o.addProperty("text", text);
            logs.add(o);
            while (logs.size() > 40) logs.remove(0);
        }
    }

    private JsonArray logsCopy() {
        synchronized (logs) {
            return logs.deepCopy();
        }
    }

    // ---------------- 指令 ----------------
    private JsonObject dispatch(String type, JsonObject payload, MinecraftServer s) {
        JsonObject result;
        if ("signal".equals(type)) {
            String id = str(payload, "id");
            String mode = str(payload, "mode", "red");
            result = DispatchBridge.setSignal(s, id, mode);
            if (ok(result)) {
                if ("red".equalsIgnoreCase(mode)) cfg.forcedSignals.put(id, true);
                else cfg.forcedSignals.remove(id);
                cfg.save();
                log(("red".equalsIgnoreCase(mode) ? "信号机强制红灯 " : "信号机释放 ") + prettySignal(id));
            }
        } else if ("destination".equals(type)) {
            String trainId = str(payload, "trainId");
            String platformId = str(payload, "stationId");
            result = DispatchBridge.setDestination(trainId, platformId);
            if (ok(result)) log("列车改派目的地 -> " + str(payload, "stationName", platformId));
        } else {
            result = fail("未知指令: " + type);
        }
        return result;
    }

    private static boolean ok(JsonObject o) {
        try {
            return o != null && o.has("ok") && o.get("ok").getAsBoolean();
        } catch (Throwable t) {
            return false;
        }
    }

    private String prettySignal(String id) {
        String[] p = id.split("\\|");
        if (p.length == 4) return p[1] + "," + p[2] + "," + p[3] + " (" + p[0] + ")";
        return id;
    }

    private JsonObject runOnServer(String type, JsonObject payload) {
        MinecraftServer s = server;
        if (s == null) return forward(type, payload);
        JsonObject[] out = new JsonObject[1];
        CountDownLatch latch = new CountDownLatch(1);
        s.execute(() -> {
            try {
                out[0] = dispatch(type, payload, s);
            } catch (Throwable t) {
                out[0] = fail("执行异常: " + t);
            } finally {
                latch.countDown();
            }
        });
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) return fail("服务端执行超时");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return fail("请求被中断");
        }
        return out[0] == null ? fail("无返回结果") : out[0];
    }

    /** 作为联机客户端时，把指令发给服务端处理 */
    private JsonObject forward(String type, JsonObject payload) {
        payload.addProperty("type", type);
        boolean sent = DispatchSyncNet.sendAction(payload);
        if (!sent) return fail("尚未连接到安装了本模组的服务端，无法下发指令");
        log("已向服务端转发指令: " + type);
        JsonObject r = new JsonObject();
        r.addProperty("ok", true);
        r.addProperty("forwarded", true);
        r.addProperty("message", "指令已发送到服务端执行");
        return r;
    }

    /** 服务端收到客户端转发来的指令 */
    public JsonObject handleRemoteAction(JsonObject payload) {
        String type = str(payload, "type");
        MinecraftServer s = server;
        if (s == null) return fail("服务端尚未就绪");
        return dispatch(type, payload, s);
    }

    // ---------------- HTTP 路由 ----------------
    private String worldName() {
        try {
            MinecraftServer s = server;
            if (s == null || s.getWorldData() == null) return "";
            return s.getWorldData().getLevelName();
        } catch (Throwable t) {
            return "";
        }
    }

    private DispatchWebServer.Response route(String method, String path, String query, String body) throws Exception {
        if ("/api/state".equals(path)) {
            return DispatchWebServer.Response.json(currentJson());
        }
        if ("/api/health".equals(path)) {
            JsonObject o = new JsonObject();
            o.addProperty("ok", true);
            o.addProperty("mod", "机械动力:铁路增强");
            o.addProperty("version", VERSION);
            o.addProperty("port", port());
            o.addProperty("configuredPort", cfg.port);
            o.addProperty("createPresent", DispatchBridge.available());
            o.addProperty("createVersion", DispatchBridge.createVersion());
            o.addProperty("serverSide", server != null);
            o.addProperty("world", worldName());
            return DispatchWebServer.Response.json(GSON.toJson(o));
        }
        if ("/api/tracks".equals(path)) {
            String dim = queryParam(query, "dim");
            if (dim == null || dim.isEmpty()) dim = "minecraft:overworld";
            JsonObject o = new JsonObject();
            o.addProperty("ok", true);
            o.addProperty("dimension", dim);
            String json = DispatchBridge.tracksJson(dim);
            o.add("lines", json == null || json.isEmpty() ? new JsonArray() : JsonParser.parseString(json));
            return DispatchWebServer.Response.json(GSON.toJson(o));
        }
        if ("/api/logs".equals(path)) {
            JsonObject o = new JsonObject();
            o.add("logs", logsCopy());
            return DispatchWebServer.Response.json(GSON.toJson(o));
        }
        if ("/api/signal".equals(path)) {
            if (!"POST".equals(method)) return DispatchWebServer.Response.json(405, "{\"ok\":false,\"message\":\"请使用 POST\"}");
            JsonObject payload = parse(body);
            if (payload == null) return DispatchWebServer.Response.json(400, "{\"ok\":false,\"message\":\"JSON 无效\"}");
            return DispatchWebServer.Response.json(GSON.toJson(runOnServer("signal", payload)));
        }
        if ("/api/destination".equals(path)) {
            if (!"POST".equals(method)) return DispatchWebServer.Response.json(405, "{\"ok\":false,\"message\":\"请使用 POST\"}");
            JsonObject payload = parse(body);
            if (payload == null) return DispatchWebServer.Response.json(400, "{\"ok\":false,\"message\":\"JSON 无效\"}");
            return DispatchWebServer.Response.json(GSON.toJson(runOnServer("destination", payload)));
        }
        if ("/api/config".equals(path)) {
            if ("POST".equals(method)) {
                JsonObject payload = parse(body);
                if (payload == null) return DispatchWebServer.Response.json(400, "{\"ok\":false,\"message\":\"JSON 无效\"}");
                applyConfig(payload);
                log("调度台设置已更新");
                JsonObject r = new JsonObject();
                r.addProperty("ok", true);
                r.addProperty("message", "设置已保存");
                r.addProperty("refreshMs", cfg.refreshMs);
                r.addProperty("theme", cfg.theme);
                return DispatchWebServer.Response.json(GSON.toJson(r));
            }
            JsonObject o = new JsonObject();
            o.addProperty("port", cfg.port);
            o.addProperty("refreshMs", cfg.refreshMs);
            o.addProperty("buildIntervalTicks", cfg.buildIntervalTicks);
            o.addProperty("signalApplyIntervalTicks", cfg.signalApplyIntervalTicks);
            o.addProperty("trackSampleSteps", cfg.trackSampleSteps);
            o.addProperty("maxTrackPoints", cfg.maxTrackPoints);
            o.addProperty("syncToClients", cfg.syncToClients);
            o.addProperty("syncIntervalTicks", cfg.syncIntervalTicks);
            o.addProperty("theme", cfg.theme);
            return DispatchWebServer.Response.json(GSON.toJson(o));
        }
        if ("/api/timetable".equals(path)) {
            if (!"POST".equals(method)) return DispatchWebServer.Response.json(405, "{\"ok\":false,\"message\":\"请使用 POST\"}");
            JsonObject payload = parse(body);
            if (payload == null) return DispatchWebServer.Response.json(400, "{\"ok\":false,\"message\":\"JSON 无效\"}");
            String trainId = str(payload, "trainId");
            String platformId = str(payload, "stationId");
            String time = str(payload, "time", "");
            if (trainId.isEmpty() || platformId.isEmpty()) {
                return DispatchWebServer.Response.json(400, "{\"ok\":false,\"message\":\"缺少列车或站台\"}");
            }
            Map<String, Map<String, String>> tt = cfg.timetable;
            Map<String, String> row = tt.computeIfAbsent(trainId, k -> new java.util.LinkedHashMap<>());
            if (time.isEmpty()) row.remove(platformId);
            else row.put(platformId, normalizeTime(time));
            if (row.isEmpty()) tt.remove(trainId);
            cfg.save();
            JsonObject r = new JsonObject();
            r.addProperty("ok", true);
            r.addProperty("message", "时刻表已保存");
            return DispatchWebServer.Response.json(GSON.toJson(r));
        }
        return DispatchWebServer.Response.json(404, "{\"ok\":false,\"message\":\"接口不存在\"}");
    }

    /** 逐项容错：任何一项传了脏值都不该让整次保存失败。 */
    private void applyConfig(JsonObject p) {
        try {
            if (p.has("refreshMs")) cfg.refreshMs = clamp(intOf(p, "refreshMs", cfg.refreshMs), 300, 10000);
            if (p.has("buildIntervalTicks")) cfg.buildIntervalTicks = clamp(intOf(p, "buildIntervalTicks", cfg.buildIntervalTicks), 2, 100);
            if (p.has("signalApplyIntervalTicks")) cfg.signalApplyIntervalTicks = clamp(intOf(p, "signalApplyIntervalTicks", cfg.signalApplyIntervalTicks), 5, 100);
            if (p.has("trackSampleSteps")) cfg.trackSampleSteps = clamp(intOf(p, "trackSampleSteps", cfg.trackSampleSteps), 2, 10);
            if (p.has("maxTrackPoints")) cfg.maxTrackPoints = clamp(intOf(p, "maxTrackPoints", cfg.maxTrackPoints), 1500, 40000);
            if (p.has("syncIntervalTicks")) cfg.syncIntervalTicks = clamp(intOf(p, "syncIntervalTicks", cfg.syncIntervalTicks), 10, 100);
            if (p.has("syncToClients")) {
                try {
                    cfg.syncToClients = p.get("syncToClients").getAsBoolean();
                } catch (Throwable ignored) {
                }
            }
            if (p.has("theme")) {
                String theme = str(p, "theme", "dark");
                cfg.theme = "light".equals(theme) ? "light" : "dark";
            }
        } catch (Throwable t) {
            RailwayAddon.LOGGER.warn("[dispatch] 配置更新失败: {}", t.toString());
        }
        try {
            cfg.save();
        } catch (Throwable t) {
            RailwayAddon.LOGGER.warn("[dispatch] 配置写盘失败: {}", t.toString());
        }
    }

    private static int intOf(JsonObject p, String key, int fallback) {
        try {
            JsonElement e = p.get(key);
            return e == null ? fallback : e.getAsInt();
        } catch (Throwable t) {
            return fallback;
        }
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }

    private static String normalizeTime(String time) {
        String t = time.trim();
        String[] p = t.split(":");
        try {
            int h = Integer.parseInt(p[0]);
            int m = p.length > 1 ? Integer.parseInt(p[1]) : 0;
            int s = p.length > 2 ? Integer.parseInt(p[2]) : 0;
            return String.format("%02d:%02d:%02d", Math.min(23, Math.max(0, h)), Math.min(59, Math.max(0, m)), Math.min(59, Math.max(0, s)));
        } catch (Throwable e) {
            return "00:00:00";
        }
    }

    private static JsonObject parse(String body) {
        try {
            JsonElement e = JsonParser.parseString(body);
            return e.isJsonObject() ? e.getAsJsonObject() : null;
        } catch (Throwable t) {
            return null;
        }
    }

    private static String str(JsonObject o, String key) {
        return str(o, key, "");
    }

    private static String str(JsonObject o, String key, String def) {
        try {
            JsonElement e = o.get(key);
            return e == null || e.isJsonNull() ? def : e.getAsString();
        } catch (Throwable t) {
            return def;
        }
    }

    private static String queryParam(String query, String key) {
        if (query == null || query.isEmpty()) return null;
        for (String part : query.split("&")) {
            int i = part.indexOf('=');
            if (i > 0 && part.substring(0, i).equals(key)) {
                try {
                    return java.net.URLDecoder.decode(part.substring(i + 1), "UTF-8");
                } catch (Throwable t) {
                    return part.substring(i + 1);
                }
            }
        }
        return null;
    }

    private static JsonObject fail(String message) {
        JsonObject o = new JsonObject();
        o.addProperty("ok", false);
        o.addProperty("message", message);
        return o;
    }
}
