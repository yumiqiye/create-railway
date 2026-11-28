package qingjiang.railway;

import net.neoforged.neoforge.common.ModConfigSpec;

/** 公共配置：客户端读取网页地址，服务端读取令牌与兜底值；开检时间优先使用网页后台同步值。 */
public final class RailwayConfig {
    public static final ModConfigSpec SPEC;
    public static final ModConfigSpec.ConfigValue<String> WEB_BASE;
    public static final ModConfigSpec.ConfigValue<String> ADMIN_WEB_BASE;
    public static final ModConfigSpec.ConfigValue<String> ADMIN_TOKEN;
    public static final ModConfigSpec.IntValue FALLBACK_CHECKIN_MINUTES;
    public static final ModConfigSpec.IntValue EMERALDS_PER_UNIT;
    public static final ModConfigSpec.ConfigValue<String> CURRENCY_ITEM;
    public static final ModConfigSpec.ConfigValue<String> CURRENCY_NAME;
    public static final ModConfigSpec.IntValue CURRENCY_PER_UNIT;
    public static final ModConfigSpec.IntValue GATE_OPEN_TICKS;
    public static final ModConfigSpec.BooleanValue EMBED_WEB;
    public static final ModConfigSpec.ConfigValue<String> NODE_COMMAND;
    public static final ModConfigSpec.IntValue TICKET_PORT;
    public static final ModConfigSpec.IntValue ADMIN_PORT;

    static {
        ModConfigSpec.Builder builder = new ModConfigSpec.Builder();
        builder.comment("清江铁路网页端（默认由模组内嵌 Node 进程提供）").push("web");
        WEB_BASE = builder.comment("网页后端根地址，不要以 / 结尾；内嵌启动成功后通常指向 127.0.0.1:ticketPort")
                .define("baseUrl", "http://127.0.0.1:3000");
        ADMIN_WEB_BASE = builder.comment("人工终端内嵌的后台根地址，不要以 / 结尾；内嵌启动成功后通常指向 127.0.0.1:adminPort")
                .define("adminBaseUrl", "http://127.0.0.1:8001");
        EMBED_WEB = builder.comment("是否启动模组 Jar 内捆绑的 Node 票务后端；关闭后使用 baseUrl/adminBaseUrl 指向外部服务")
                .define("embedNode", true);
        NODE_COMMAND = builder.comment("本机 Node 启动命令；PATH 中可直接使用 node，也可填写 node.exe 绝对路径")
                .define("nodeCommand", "node");
        TICKET_PORT = builder.comment("内嵌票务后端端口")
                .defineInRange("ticketPort", 3000, 1024, 65535);
        ADMIN_PORT = builder.comment("内嵌后台静态服务端口")
                .defineInRange("adminPort", 8001, 1024, 65535);
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

    public static String adminBaseUrl() {
        String value = ADMIN_WEB_BASE.get();
        if (value == null || value.isBlank()) return "http://localhost:8001";
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }

    public static String adminToken() {
        return ADMIN_TOKEN.get();
    }

    public static boolean embedWeb() {
        return EMBED_WEB.get();
    }

    public static String nodeCommand() {
        String value = NODE_COMMAND.get();
        return value == null || value.isBlank() ? "node" : value.trim();
    }

    public static int ticketPort() {
        return TICKET_PORT.get();
    }

    public static int adminPort() {
        return ADMIN_PORT.get();
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
