package qingjiang.railway;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;

/** 普通玩家在电脑上发起现金支付：列出未支付订单，并通知有权限的工作人员。 */
public final class PaymentAssist {
    private PaymentAssist() {}

    public static void request(ServerPlayer player) {
        String name = player.getGameProfile().getName();
        player.displayClientMessage(Component.literal("正在查询未支付车票...").withStyle(ChatFormatting.GRAY), false);
        RailwayWeb.getAsync("/railway/orders?player=" + ManualService.enc(name), envelope -> {
            JsonElement list = RailwayWeb.data(envelope).get("orders");
            JsonArray orders = list != null && list.isJsonArray() ? list.getAsJsonArray() : new JsonArray();
            JsonArray pending = new JsonArray();
            for (JsonElement element : orders) {
                if (!element.isJsonObject()) continue;
                JsonObject order = element.getAsJsonObject();
                if ("pending".equals(RailwayWeb.str(order, "status", ""))) pending.add(order);
            }
            if (player.getServer() == null) return;
            player.getServer().execute(() -> {
                if (pending.isEmpty()) {
                    player.displayClientMessage(Component.literal("您没有未支付的车票")
                            .withStyle(ChatFormatting.GRAY), false);
                    return;
                }
                player.displayClientMessage(Component.literal("您有未支付的车票信息")
                        .withStyle(ChatFormatting.YELLOW), false);
                for (JsonElement element : pending) {
                    JsonObject order = element.getAsJsonObject();
                    player.displayClientMessage(Component.literal("订单号 " + RailwayWeb.str(order, "orderNo", "")
                            + "  " + RailwayWeb.str(order, "trainNo", "") + " "
                            + RailwayWeb.str(order, "fromStationName", "") + "->"
                            + RailwayWeb.str(order, "toStationName", "") + "  票价 "
                            + RailwayWeb.str(order, "price", "0") + " " + RailwayConfig.currencyName())
                            .withStyle(ChatFormatting.WHITE), false);
                }
                player.displayClientMessage(Component.literal("请到人工窗口用现金支付，工作人员确认后即可出票")
                        .withStyle(ChatFormatting.GRAY), false);
                for (ServerPlayer staff : player.getServer().getPlayerList().getPlayers()) {
                    if (!staff.hasPermissions(2)) continue;
                    staff.displayClientMessage(Component.literal(name + " 发起现金支付，共 "
                            + pending.size() + " 张未支付车票").withStyle(ChatFormatting.GOLD), false);
                }
            });
        }, error -> {
            if (player.getServer() != null) {
                player.getServer().execute(() -> player.displayClientMessage(
                        Component.literal("查询失败：" + error).withStyle(ChatFormatting.RED), false));
            }
        });
    }
}
