package qingjiang.railway.dispatch;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonSyntaxException;
import qingjiang.railway.RailwayAddon;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 调度台设置。全部保存在 config/railway_plus/dispatch.json，重启后保留。
 * 由原 PyRailDispatch 的 DispatchConfig 内置迁入，不再依赖独立 py 模组。
 */
public final class DispatchConfig {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    /** 网页端口，只监听 127.0.0.1 */
    public int port = 2217;
    /** 网页刷新间隔（毫秒），在调度台设置页可调 */
    public int refreshMs = 1000;
    /** 服务端快照采样间隔（tick）。10 tick = 0.5 秒 */
    public int buildIntervalTicks = 10;
    /** 强制信号机状态的重应用间隔（tick） */
    public int signalApplyIntervalTicks = 60;
    /** 单条轨道路段采样段数 */
    public int trackSampleSteps = 4;
    /** 线路图最大采样点，防止超大存档拖慢 */
    public int maxTrackPoints = 24000;
    /** 是否把快照同步给联机客户端 */
    public boolean syncToClients = true;
    /** 客户端同步间隔（tick） */
    public int syncIntervalTicks = 20;
    /** 默认主题：dark / light */
    public String theme = "dark";
    /** 时刻表：trainId -> platformId -> HH:MM:SS */
    public Map<String, Map<String, String>> timetable = new LinkedHashMap<>();
    /** 手动强制红灯的信号机：signalId -> true */
    public Map<String, Boolean> forcedSignals = new LinkedHashMap<>();

    private transient Path file;
    /** 实际监听端口：配置端口被别的游戏实例占用时会顺延。运行期字段，不写入配置。 */
    private transient int activePort;

    /** 网页实际使用的端口（顺延后）。 */
    public int activePort() {
        return activePort > 0 ? activePort : port;
    }

    public void activePort(int p) {
        activePort = p;
    }

    public static DispatchConfig load(Path path) {
        DispatchConfig cfg = new DispatchConfig();
        cfg.file = path;
        if (Files.isRegularFile(path)) {
            try (Reader r = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
                DispatchConfig read = GSON.fromJson(r, DispatchConfig.class);
                if (read != null) {
                    read.file = path;
                    read.normalize();
                    cfg = read;
                }
            } catch (IOException | JsonSyntaxException e) {
                RailwayAddon.LOGGER.warn("[dispatch] 配置文件读取失败，使用默认设置: {}", e.toString());
            }
        }
        cfg.normalize();
        cfg.save();
        return cfg;
    }

    private void normalize() {
        if (port < 1024 || port > 65535) port = 2217;
        if (refreshMs < 200) refreshMs = 200;
        if (refreshMs > 10000) refreshMs = 10000;
        if (buildIntervalTicks < 2) buildIntervalTicks = 2;
        if (buildIntervalTicks > 200) buildIntervalTicks = 200;
        if (signalApplyIntervalTicks < 5) signalApplyIntervalTicks = 5;
        if (trackSampleSteps < 2) trackSampleSteps = 2;
        if (trackSampleSteps > 12) trackSampleSteps = 12;
        if (maxTrackPoints < 1000) maxTrackPoints = 1000;
        if (syncIntervalTicks < 10) syncIntervalTicks = 10;
        if (!"light".equals(theme) && !"dark".equals(theme)) theme = "dark";
        if (timetable == null) timetable = new LinkedHashMap<>();
        if (forcedSignals == null) forcedSignals = new LinkedHashMap<>();
    }

    public synchronized void save() {
        if (file == null) return;
        try {
            Files.createDirectories(file.getParent());
            Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
            try (Writer w = Files.newBufferedWriter(tmp, StandardCharsets.UTF_8)) {
                GSON.toJson(this, w);
            }
            Files.move(tmp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            RailwayAddon.LOGGER.warn("[dispatch] 配置保存失败: {}", e.toString());
        }
    }
}
