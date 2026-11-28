package qingjiang.railway.dispatch;

import com.google.gson.JsonObject;
import net.minecraft.server.MinecraftServer;

import java.time.Instant;
import java.time.ZoneId;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/**
 * 时刻表自动调度：到点自动给列车改派下一站目的地。
 * 与 Create 原生时刻表互不冲突；本调度器只负责“按计划时刻把列车派往下一站台”。
 */
public final class DispatchScheduler {

    /** 检查间隔（tick），20 tick = 1 秒。 */
    private static final int CHECK_INTERVAL = 100;

    private final Set<String> fired = ConcurrentHashMap.newKeySet();
    private int tick;

    public void tick(MinecraftServer server, DispatchConfig cfg, Consumer<String> log) {
        if (++tick % CHECK_INTERVAL != 0) return;
        if (cfg.timetable.isEmpty()) return;

        long now = System.currentTimeMillis();
        String today = LocalDate.ofInstant(Instant.ofEpochMilli(now), ZoneId.systemDefault()).toString();

        List<DispatchBridge.TrainView> trains = DispatchBridge.collectTrains();
        Map<String, DispatchBridge.TrainView> trainById = new HashMap<>();
        for (DispatchBridge.TrainView t : trains) trainById.put(t.id, t);

        Map<String, String> platformName = new HashMap<>();
        for (DispatchBridge.PlatformView p : DispatchBridge.collectPlatforms()) platformName.put(p.id, p.name);

        for (Map.Entry<String, Map<String, String>> entry : cfg.timetable.entrySet()) {
            String trainId = entry.getKey();
            DispatchBridge.TrainView t = trainById.get(trainId);
            if (t == null || t.derailed) continue;

            for (Map.Entry<String, String> plan : entry.getValue().entrySet()) {
                String platformId = plan.getKey();
                String time = plan.getValue();
                String key = trainId + "|" + platformId + "|" + today;
                if (fired.contains(key)) continue;

                long planned = plannedMillisToday(time, now);
                if (planned < 0 || now < planned) continue;

                // 已经在该站台或目的地已是该站台，只标记不再重复下发
                if (platformId.equals(t.nextStationId) || platformId.equals(t.stationId)) {
                    fired.add(key);
                    continue;
                }

                JsonObject result = DispatchBridge.setDestination(trainId, platformId);
                boolean ok = result != null && result.has("ok") && result.get("ok").getAsBoolean();
                if (ok) {
                    fired.add(key);
                    String name = platformName.getOrDefault(platformId, platformId);
                    log.accept("时刻表自动调度：" + t.name + " -> " + name);
                }
            }
        }
    }

    private static long plannedMillisToday(String hhmmss, long now) {
        try {
            String[] parts = hhmmss.split(":");
            int h = Integer.parseInt(parts[0]);
            int m = parts.length > 1 ? Integer.parseInt(parts[1]) : 0;
            int s = parts.length > 2 ? Integer.parseInt(parts[2]) : 0;
            if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) return -1;
            LocalDate date = Instant.ofEpochMilli(now).atZone(ZoneId.systemDefault()).toLocalDate();
            return date.atTime(h, m, s).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        } catch (Throwable t) {
            return -1;
        }
    }

    /** 切换存档 / 退服时清空当日触发记录。 */
    public void reset() {
        fired.clear();
        tick = 0;
    }
}
