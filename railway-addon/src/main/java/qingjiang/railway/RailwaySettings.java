package qingjiang.railway;

import com.google.gson.JsonObject;

/** 网页后台设置缓存：开检提前分钟、系统名称、公告、LOGO，定时自动同步。 */
public final class RailwaySettings {
    private static volatile int checkinMinutes = 30;
    private static volatile String systemName = "清江铁路";
    private static volatile String announcement = "";
    private static volatile String logoUrl = "";
    private static volatile boolean loading = false;

    private RailwaySettings() {}

    public static int checkinMinutes() {
        return checkinMinutes;
    }

    public static String systemName() {
        return systemName;
    }

    public static String announcement() {
        return announcement;
    }

    public static String logoUrl() {
        return logoUrl;
    }

    public static void refreshAsync() {
        if (loading) return;
        loading = true;
        RailwayWeb.getAsync("/railway/config", RailwaySettings::apply, error -> loading = false);
    }

    public static void apply(JsonObject envelope) {
        try {
            JsonObject data = RailwayWeb.data(envelope);
            int minutes = RailwayWeb.i(data, "checkinMinutes", RailwayConfig.fallbackCheckinMinutes());
            if (minutes > 0) checkinMinutes = minutes;
            systemName = RailwayWeb.str(data, "systemName", systemName);
            announcement = RailwayWeb.str(data, "announcement", announcement);
            logoUrl = RailwayWeb.str(data, "logoUrl", logoUrl);
        } finally {
            loading = false;
        }
    }
}
