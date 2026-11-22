package qingjiang.railway;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import qingjiang.railway.item.ReimbursementItem;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** 人工终端（电脑/POS/人工检票机）的业务逻辑。 */
public final class ManualService {
    private ManualService() {}

    public record Result(boolean success, String message) {}

    public static Result handle(ServerPlayer staff, String action, String query, int mode) {
        String q = query == null ? "" : query.trim();
        if (q.isEmpty() && !"payall".equals(action)) return new Result(false, "请输入订单号、身份证号或乘客名");
        try {
            if ("query".equals(action)) return query(staff, q);
            if ("pay".equals(action)) return pay(staff, q);
            if ("print".equals(action)) return print(staff, q);
            if ("voucher".equals(action)) return voucher(staff, q);
            if ("check".equals(action)) return check(staff, q, mode);
            return new Result(false, "未知操作");
        } catch (Exception e) {
            return new Result(false, e.getMessage() == null ? "票务系统连接失败" : e.getMessage());
        }
    }

    private static JsonObject findOrder(ServerPlayer staff, String query) throws Exception {
        JsonObject exact;
        try {
            exact = RailwayWeb.blockingGet("/railway/orders/" + enc(query), 4000);
            JsonObject data = RailwayWeb.data(exact);
            if (data.has("orderNo")) return data;
        } catch (Exception ignored) {
            // 不是订单号，继续按身份证/姓名搜索
        }
        JsonArray list = listOrders(staff, query);
        if (list.isEmpty()) throw new IllegalStateException("未找到订单：" + query);
        for (JsonElement element : list) {
            if (!element.isJsonObject()) continue;
            JsonObject order = element.getAsJsonObject();
            if (query.equalsIgnoreCase(RailwayWeb.str(order, "orderNo", "")) ||
                    query.equalsIgnoreCase(RailwayWeb.str(order, "idNo", ""))) {
                return order;
            }
        }
        return list.get(0).getAsJsonObject();
    }

    public static JsonArray listOrders(ServerPlayer player, String keyword) throws Exception {
        String url = "/railway/orders?keyword=" + enc(keyword == null ? "" : keyword);
        JsonObject envelope = RailwayWeb.blockingGet(url, 5000);
        JsonObject data = RailwayWeb.data(envelope);
        JsonElement orders = data.get("orders");
        return orders != null && orders.isJsonArray() ? orders.getAsJsonArray() : new JsonArray();
    }

    private static Result query(ServerPlayer staff, String query) throws Exception {
        JsonObject order = findOrder(staff, query);
        StringBuilder text = new StringBuilder();
        text.append(RailwayWeb.str(order, "trainNo", ""))
                .append(' ').append(RailwayWeb.str(order, "fromStationName", ""))
                .append("->").append(RailwayWeb.str(order, "toStationName", ""));
        text.append("\n乘客：").append(RailwayWeb.str(order, "passengerName", ""))
                .append("  订单：").append(RailwayWeb.str(order, "orderNo", ""));
        text.append("\n状态：").append(statusText(RailwayWeb.str(order, "status", "pending")));
        return new Result(true, text.toString());
    }

    private static Result pay(ServerPlayer staff, String query) throws Exception {
        JsonObject order = findOrder(staff, query);
        String orderNo = RailwayWeb.str(order, "orderNo", "");
        String status = RailwayWeb.str(order, "status", "pending");
        if ("paid".equals(status)) return new Result(false, "该订单已支付：" + orderNo);
        JsonObject body = new JsonObject();
        body.addProperty("player", staff.getGameProfile().getName());
        body.addProperty("amount", 0);
        body.addProperty("method", "cash");
        body.addProperty("currency", RailwayConfig.currencyName());
        RailwayWeb.blockingPost("/railway/orders/" + enc(orderNo) + "/pay", body, 5000);
        notifyPaid(order);
        return new Result(true, "已完成现金支付：" + orderNo + "\n可点击“打印车票”出票");
    }

    private static Result print(ServerPlayer staff, String query) throws Exception {
        JsonObject order = findOrder(staff, query);
        if (!"paid".equals(RailwayWeb.str(order, "status", "pending"))) {
            return new Result(false, "订单未支付，不能出票");
        }
        if (RailwayWeb.b(order, "printed", false)) return new Result(false, "该订单已打印过车票");
        ServerPlayer target = findTarget(staff, RailwayWeb.str(order, "passengerName", ""));
        if (target == null) return new Result(false, "乘客不在线，无法把车票放进其背包");
        giveTicket(target, order);
        JsonObject body = new JsonObject();
        body.addProperty("by", staff.getGameProfile().getName());
        RailwayWeb.blockingPost("/railway/orders/" + enc(RailwayWeb.str(order, "orderNo", "")) + "/print", body, 5000);
        return new Result(true, "已出票给 " + target.getGameProfile().getName() + "\n"
                + RailwayWeb.str(order, "trainNo", "") + " "
                + RailwayWeb.str(order, "fromStationName", "") + "->"
                + RailwayWeb.str(order, "toStationName", ""));
    }

    private static Result voucher(ServerPlayer staff, String query) throws Exception {
        JsonObject order = findOrder(staff, query);
        if (!"paid".equals(RailwayWeb.str(order, "status", "pending"))) {
            return new Result(false, "订单未支付，不能打印报销凭证");
        }
        ServerPlayer target = findTarget(staff, RailwayWeb.str(order, "passengerName", ""));
        if (target == null) return new Result(false, "乘客不在线，无法打印报销凭证");
        ItemStack voucher = new ItemStack(ModItems.REIMBURSEMENT.get());
        TicketNbt.writeVoucher(voucher, order, target.getGameProfile().getName(),
                RailwayWeb.str(order, "idNo", ""));
        give(target, voucher);
        return new Result(true, "已打印报销凭证：" + RailwayWeb.str(order, "trainNo", ""));
    }

    private static Result check(ServerPlayer staff, String query, int mode) throws Exception {
        JsonObject order = findOrder(staff, query);
        if (!"paid".equals(RailwayWeb.str(order, "status", "pending"))) {
            return new Result(false, "订单未支付，不能检票");
        }
        ServerPlayer target = findTarget(staff, RailwayWeb.str(order, "passengerName", ""));
        if (target == null) return new Result(false, "乘客不在线，无法核验车票");
        ItemStack ticket = findTicket(target, RailwayWeb.str(order, "orderNo", ""));
        if (ticket.isEmpty()) return new Result(false, "乘客背包中没有该订单的车票，请先出票");
        String station = CrhCompat.stationNameAt(staff.level(), staff.blockPosition());
        int gateType = -1;
        var hit = staff.pick(6.0D, 0.0F, false);
        if (hit instanceof net.minecraft.world.phys.BlockHitResult blockHit) {
            var state = staff.level().getBlockState(blockHit.getBlockPos());
            if (CrhCompat.isGate(state)) {
                gateType = RailwayStore.gate(staff.level(), blockHit.getBlockPos(), state).type;
            }
        }
        if (gateType == RailwayStore.GATE_ENTRY || mode == 0) {
            TicketNbt.markEntry(ticket, station);
            OrderGateSync.markEntered(ticket, target.getGameProfile().getName(), "manual-entry");
        } else if (gateType == RailwayStore.GATE_CHECK || mode == 2) {
            TicketNbt.markCheckin(ticket);
            OrderGateSync.markEntered(ticket, target.getGameProfile().getName(), "manual-check");
        }
        boolean gate = false;
        if (hit instanceof net.minecraft.world.phys.BlockHitResult blockHit) {
            gate = CrhCompat.openGate(staff.level(), blockHit.getBlockPos());
        }
        target.displayClientMessage(net.minecraft.network.chat.Component.literal(
                "人工检票通过 · " + RailwayWeb.str(order, "trainNo", "") + " "
                        + RailwayWeb.str(order, "fromStationName", "") + "->"
                        + RailwayWeb.str(order, "toStationName", "")).withStyle(net.minecraft.ChatFormatting.GREEN), false);
        return new Result(true, "已人工检票：" + target.getGameProfile().getName()
                + (gate ? "，闸机已开启" : "（面前没有可开启的闸机）"));
    }

    private static void giveTicket(ServerPlayer target, JsonObject order) {
        ItemStack ticket = CrhCompat.newTicketStack();
        TicketNbt.writeTicket(ticket, order, target.getGameProfile().getName(), RailwayWeb.str(order, "idNo", ""));
        give(target, ticket);
        for (int i = 0; i < target.getInventory().getContainerSize(); i++) {
            ItemStack stack = target.getInventory().getItem(i);
            if (TicketNbt.isIdCard(stack)) {
                TicketNbt.mirrorToCard(stack, ticket);
                break;
            }
        }
    }

    private static void give(ServerPlayer player, ItemStack stack) {
        if (!player.getInventory().add(stack)) player.drop(stack, false);
    }

    private static ItemStack findTicket(ServerPlayer player, String orderNo) {
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            ItemStack stack = player.getInventory().getItem(i);
            if (TicketNbt.hasTicket(stack) && orderNo.equals(TicketNbt.orderNumber(stack))) {
                if (TicketNbt.isIdCard(stack)) return stack;
                return stack;
            }
        }
        return ItemStack.EMPTY;
    }

    private static ServerPlayer findTarget(ServerPlayer staff, String name) {
        if (name == null || name.isBlank() || staff.getServer() == null) return null;
        ServerPlayer online = staff.getServer().getPlayerList().getPlayerByName(name);
        if (online != null) return online;
        for (ServerPlayer candidate : staff.getServer().getPlayerList().getPlayers()) {
            if (candidate.getGameProfile().getName().equalsIgnoreCase(name)) return candidate;
        }
        return null;
    }

    public static void notifyPaid(JsonObject order) {
        OrderNotifier.mark(RailwayWeb.str(order, "orderNo", ""));
        String name = RailwayWeb.str(order, "passengerName", "");
        if (name.isBlank() || net.neoforged.neoforge.server.ServerLifecycleHooks.getCurrentServer() == null) return;
        ServerPlayer player = net.neoforged.neoforge.server.ServerLifecycleHooks.getCurrentServer()
                .getPlayerList().getPlayerByName(name);
        if (player == null) return;
        String gate = RailwayWeb.str(order, "gateInfo", "");
        String seat = (RailwayWeb.str(order, "seat", "") + RailwayWeb.str(order, "seatNo", "")).trim();
        player.displayClientMessage(net.minecraft.network.chat.Component.literal(
                name + "购票成功 " + RailwayWeb.str(order, "trainNo", "") + " "
                        + station(RailwayWeb.str(order, "fromStationName", "")) + "->"
                        + station(RailwayWeb.str(order, "toStationName", ""))
                        + (gate.isBlank() ? "" : " " + gate)
                        + (seat.isBlank() ? "" : " " + seat)
        ).withStyle(net.minecraft.ChatFormatting.GREEN), false);
    }

    private static String station(String name) {
        if (name == null || name.isBlank()) return "";
        return name.endsWith("站") ? name : name + "站";
    }

    public static String statusText(String status) {
        return switch (status) {
            case "paid" -> "已支付";
            case "printed" -> "已出票";
            case "used" -> "已使用";
            case "cancelled" -> "已取消";
            default -> "未支付";
        };
    }

    public static String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
