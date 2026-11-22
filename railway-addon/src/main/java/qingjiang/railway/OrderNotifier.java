package qingjiang.railway;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;

import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** 轮询已支付订单，只对最近 10 分钟内新支付的订单发送一次购票成功通知。 */
public final class OrderNotifier {
    private static final Set<String> ANNOUNCED = ConcurrentHashMap.newKeySet();
    private static final long FRESH_MILLIS = Duration.ofMinutes(10).toMillis();
    /** 只通知本次服务端启动之后创建的订单，避免把历史订单全部播报一遍。 */
    private static final long SESSION_START = System.currentTimeMillis() - 60_000L;

    private OrderNotifier() {}

    /** 已经由命令/人工终端当面提示过的订单，不再重复播报。 */
    public static void mark(String orderNo) {
        if (orderNo != null && !orderNo.isBlank()) ANNOUNCED.add(orderNo);
    }

    public static void refresh(ServerPlayer player) {
        String name = player.getGameProfile().getName();
        RailwayWeb.getAsync("/railway/orders?player=" + ManualService.enc(name), envelope -> {
            JsonElement list = RailwayWeb.data(envelope).get("orders");
            if (list == null || !list.isJsonArray()) return;
            JsonArray orders = list.getAsJsonArray();
            for (JsonElement element : orders) {
                if (!element.isJsonObject()) continue;
                JsonObject order = element.getAsJsonObject();
                if (!"paid".equals(RailwayWeb.str(order, "status", ""))) continue;
                String no = RailwayWeb.str(order, "orderNo", "");
                if (no.isBlank() || ANNOUNCED.contains(no)) continue;
                if (!isFresh(order)) {
                    ANNOUNCED.add(no);
                    continue;
                }
                ANNOUNCED.add(no);
                String gate = RailwayWeb.str(order, "gateInfo", "");
                String seat = (RailwayWeb.str(order, "seat", "") + RailwayWeb.str(order, "seatNo", "")).trim();
                String text = name + "购票成功 "
                        + RailwayWeb.str(order, "trainNo", "") + " "
                        + station(RailwayWeb.str(order, "fromStationName", "")) + "->"
                        + station(RailwayWeb.str(order, "toStationName", ""))
                        + (gate.isBlank() ? "" : " " + gate)
                        + (seat.isBlank() ? "" : " " + seat);
                if (player.getServer() != null) {
                    player.getServer().execute(() -> player.displayClientMessage(
                            Component.literal(text).withStyle(net.minecraft.ChatFormatting.GREEN), false));
                }
            }
        }, error -> {
        });
    }

    private static boolean isFresh(JsonObject order) {
        String created = RailwayWeb.str(order, "createdAt", "");
        if (created.isBlank()) return false;
        try {
            long millis = Instant.parse(created).toEpochMilli();
            long now = System.currentTimeMillis();
            return millis >= SESSION_START && now - millis <= FRESH_MILLIS;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static String station(String name) {
        if (name == null || name.isBlank()) return "";
        return name.endsWith("站") ? name : name + "站";
    }
}
