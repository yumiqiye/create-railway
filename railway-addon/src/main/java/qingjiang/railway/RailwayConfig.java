package qingjiang.railway;

import net.neoforged.neoforge.common.ModConfigSpec;

/** 公共配置：客户端读取网页地址，服务端读取令牌与兜底值；开检时间优先使用网页后台同步值。 */
public final class RailwayConfig {
    public static final ModConfigSpec SPEC;
    public static final ModConfigSpec.ConfigValue<String> WEB_BASE;
    public static final ModConfigSpec.ConfigValue<String> ADMIN_TOKEN;
    public static final ModConfigSpec.IntValue FALLBACK_CHECKIN_MINUTES;
    public static final ModConfigSpec.IntValue EMERALDS_PER_UNIT;
    public static final ModConfigSpec.ConfigValue<String> CURRENCY_ITEM;
    public static final ModConfigSpec.ConfigValue<String> CURRENCY_NAME;
    public static final ModConfigSpec.IntValue CURRENCY_PER_UNIT;
    public static final ModConfigSpec.IntValue GATE_OPEN_TICKS;

    static {
        ModConfigSpec.Builder builder = new ModConfigSpec.Builder();
        builder.comment("清江铁路网页端（独立进程，默认 3000 端口）").push("web");
        WEB_BASE = builder.comment("网页后端根地址，不要以 / 结尾")
                .define("baseUrl", "http://127.0.0.1:3000");
        ADMIN_TOKEN = builder.comment("与网页端 [railway] adminToken 一致")
                .define("adminToken", "qingjiang-railway-mod");
        FALLBACK_CHECKIN_MINUTES = builder.comment("网页端无法提供开检时间时，按发车前多少分钟开检")
                .defineInRange("fallbackCheckinMinutes", 30, 1, 180);
        EMERALDS_PER_UNIT = builder.comment("票价换算成货币物品数量的系数，通常为 1")
                .defineInRange("emeraldsPerFareUnit", 1, 1, 64);
        CURRENCY_ITEM = builder.comment("支付货币物品注册名，例如 minecraft:emerald / minecraft:diamond")
                .define("currencyItem", "minecraft:emerald");
        CURRENCY_NAME = builder.comment("提示中显示的货币名称，例如 绿宝石 / 钻石")
                .define("currencyName", "绿宝石");
        CURRENCY_PER_UNIT = builder.comment("每 1 票价需要多少货币物品；与 emeraldsPerFareUnit 取较大值")
                .defineInRange("currencyPerFareUnit", 1, 1, 64);
        GATE_OPEN_TICKS = builder.comment("闸机放行后保持开门的 tick 数；20 tick=1 秒，越小越防尾随")
                .defineInRange("gateOpenTicks", 15, 5, 60);
        builder.pop();
        SPEC = builder.build();
    }

    private RailwayConfig() {}

    public static String baseUrl() {
        String value = WEB_BASE.get();
        if (value == null || value.isBlank()) return "http://127.0.0.1:3000";
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }

    public static String adminToken() {
        return ADMIN_TOKEN.get();
    }

    public static int fallbackCheckinMinutes() {
        return FALLBACK_CHECKIN_MINUTES.get();
    }

    public static int emeraldsPerUnit() {
        return Math.max(EMERALDS_PER_UNIT.get(), CURRENCY_PER_UNIT.get());
    }

    public static net.minecraft.resources.ResourceLocation currencyItem() {
        String value = CURRENCY_ITEM.get();
        var id = net.minecraft.resources.ResourceLocation.tryParse(value == null ? "" : value.trim());
        return id == null ? net.minecraft.resources.ResourceLocation.withDefaultNamespace("emerald") : id;
    }

    public static String currencyName() {
        String value = CURRENCY_NAME.get();
        return value == null || value.isBlank() ? "绿宝石" : value;
    }

    public static int gateOpenTicks() {
        return GATE_OPEN_TICKS.get();
    }
}
