package qingjiang.railway;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.suggestion.SuggestionProvider;
import net.minecraft.ChatFormatting;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.EntityArgument;
import net.minecraft.commands.arguments.coordinates.BlockPosArgument;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** /railway pay|print|voucher|status|admin station|stations|sync|buy */
public final class RailwayCommands {
    private static final Map<UUID, PendingStation> PENDING = new HashMap<>();
    private static List<String> stationCache = List.of();
    private static long stationCacheAt = 0L;

    private record PendingStation(String name, BlockPos pos1, String dimension) {}

    private static final SuggestionProvider<CommandSourceStack> STATION_SUGGESTIONS = (context, builder) -> {
        for (String name : webStationNames()) {
            if (!name.contains(" ")) builder.suggest(name);
        }
        return builder.buildFuture();
    };

    private static final SuggestionProvider<CommandSourceStack> ORDER_SUGGESTIONS = (context, builder) -> {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return builder.buildFuture();
        try {
            JsonArray orders = ManualService.listOrders(player, player.getGameProfile().getName());
            for (JsonElement element : orders) {
                if (!element.isJsonObject()) continue;
                JsonObject order = element.getAsJsonObject();
                if (!"pending".equals(RailwayWeb.str(order, "status", ""))) continue;
                String no = RailwayWeb.str(order, "orderNo", "");
                builder.suggest(no);
            }
        } catch (Exception ignored) {
        }
        return builder.buildFuture();
    };

    private RailwayCommands() {}

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("railway")
                .then(Commands.literal("pay")
                        .executes(RailwayCommands::payAll)
                        .then(Commands.argument("orderNo", StringArgumentType.word())
                                .suggests(ORDER_SUGGESTIONS)
                                .executes(context -> pay(context, StringArgumentType.getString(context, "orderNo")))))
                .then(Commands.literal("print")
                        .then(Commands.argument("orderNo", StringArgumentType.word())
                                .suggests(ORDER_SUGGESTIONS)
                                .executes(context -> print(context, StringArgumentType.getString(context, "orderNo"), false))))
                .then(Commands.literal("voucher")
                        .then(Commands.argument("orderNo", StringArgumentType.word())
                                .suggests(ORDER_SUGGESTIONS)
                                .executes(context -> print(context, StringArgumentType.getString(context, "orderNo"), true))))
                .then(Commands.literal("status").executes(RailwayCommands::status))
                .then(Commands.literal("admin")
                        .requires(source -> source.hasPermission(2))
                        .then(Commands.literal("station")
                                .then(Commands.literal("delete")
                                        .then(Commands.argument("name", StringArgumentType.word())
                                                .suggests(STATION_SUGGESTIONS)
                                                .executes(RailwayCommands::deleteStation)))
                                .then(Commands.argument("name", StringArgumentType.word())
                                        .suggests(STATION_SUGGESTIONS)
                                        .then(Commands.literal("delete").executes(RailwayCommands::deleteStation))
                                        .then(Commands.literal("POS1")
                                                .executes(context -> setPos(context, 1, null))
                                                .then(Commands.argument("pos", BlockPosArgument.blockPos())
                                                        .executes(context -> setPos(context, 1, BlockPosArgument.getBlockPos(context, "pos")))))
                                        .then(Commands.literal("POS2")
                                                .executes(context -> setPos(context, 2, null))
                                                .then(Commands.argument("pos", BlockPosArgument.blockPos())
                                                        .executes(context -> setPos(context, 2, BlockPosArgument.getBlockPos(context, "pos"))))))
                        .then(Commands.literal("stations").executes(RailwayCommands::listStations))
                        .then(Commands.literal("sync").executes(RailwayCommands::syncAll))
                        .then(Commands.literal("buy")
                                .then(Commands.argument("player", EntityArgument.player())
                                        .then(Commands.argument("trainNo", StringArgumentType.word())
                                                .then(Commands.argument("from", StringArgumentType.word())
                                                        .suggests(STATION_SUGGESTIONS)
                                                        .then(Commands.argument("to", StringArgumentType.word())
                                                                .suggests(STATION_SUGGESTIONS)
                                                                .executes(RailwayCommands::adminBuy)))))))));
    }

    private static int payAll(CommandContext<CommandSourceStack> context) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        try {
            JsonArray orders = ManualService.listOrders(player, player.getGameProfile().getName());
            List<JsonObject> pending = new ArrayList<>();
            int need = 0;
            for (JsonElement element : orders) {
                if (!element.isJsonObject()) continue;
                JsonObject order = element.getAsJsonObject();
                if (!"pending".equals(RailwayWeb.str(order, "status", ""))) continue;
                if (!player.getGameProfile().getName().equalsIgnoreCase(RailwayWeb.str(order, "passengerName", ""))) continue;
                pending.add(order);
                need += RailwayCurrency.needFor(player, "", order.has("price") ? order.get("price").getAsDouble() : 1);
            }
            if (pending.isEmpty()) {
                reply(player, "没有未支付的车票", ChatFormatting.YELLOW);
                return 0;
            }
            int have = RailwayCurrency.count(player);
            if (have < need) {
                reply(player, "支付失败：余额不足，需要 " + RailwayCurrency.label(need) + "，当前 " + RailwayCurrency.label(have),
                        ChatFormatting.RED);
                return 0;
            }
            RailwayCurrency.consume(player, need);
            int paid = 0;
            for (JsonObject order : pending) {
                try {
                    String no = RailwayWeb.str(order, "orderNo", "");
                    JsonObject body = new JsonObject();
                    body.addProperty("player", player.getGameProfile().getName());
                    body.addProperty("amount", RailwayCurrency.needFor(player, "",
                            order.has("price") ? order.get("price").getAsDouble() : 1));
                    body.addProperty("currency", RailwayCurrency.name());
                    RailwayWeb.blockingPost("/railway/orders/" + ManualService.enc(no) + "/pay", body, 4000);
                    paid++;
                } catch (Exception ignored) {
                }
            }
            if (paid == pending.size()) {
                reply(player, "已支付全部 " + paid + " 张车票，共 " + RailwayCurrency.label(need), ChatFormatting.GREEN);
            } else {
                reply(player, "支付完成 " + paid + "/" + pending.size() + " 张，其余失败请重试", ChatFormatting.YELLOW);
            }
            player.getInventory().setChanged();
            return paid > 0 ? 1 : 0;
        } catch (Exception e) {
            reply(player, "支付失败：" + e.getMessage(), ChatFormatting.RED);
            return 0;
        }
    }

    private static int pay(CommandContext<CommandSourceStack> context, String orderNo) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        try {
            JsonObject envelope = RailwayWeb.blockingGet("/railway/orders/" + ManualService.enc(orderNo), 3000);
            JsonObject order = RailwayWeb.data(envelope);
            if ("paid".equals(RailwayWeb.str(order, "status", ""))) {
                reply(player, "该订单已支付，无需重复支付", ChatFormatting.YELLOW);
                return 1;
            }
            int need = RailwayCurrency.needFor(player, "", order.has("price") ? order.get("price").getAsDouble() : 1);
            int have = RailwayCurrency.count(player);
            if (have < need) {
                reply(player, "支付失败：余额不足，需要 " + RailwayCurrency.label(need) + "，当前 " + RailwayCurrency.label(have),
                        ChatFormatting.RED);
                return 0;
            }
            RailwayCurrency.consume(player, need);
            JsonObject paid = new JsonObject();
            paid.addProperty("player", player.getGameProfile().getName());
            paid.addProperty("amount", need);
            paid.addProperty("currency", RailwayCurrency.name());
            RailwayWeb.blockingPost("/railway/orders/" + ManualService.enc(orderNo) + "/pay", paid, 3000);
            String train = RailwayWeb.str(order, "trainName", RailwayWeb.str(order, "trainNo", ""));
            reply(player, "已支付 " + train + "（" + RailwayCurrency.label(need) + "）", ChatFormatting.GREEN);
            ManualService.notifyPaid(order);
            player.getInventory().setChanged();
            return 1;
        } catch (Exception e) {
            reply(player, "支付失败：" + e.getMessage(), ChatFormatting.RED);
            return 0;
        }
    }

    private static int print(CommandContext<CommandSourceStack> context, String orderNo, boolean voucher) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        try {
            JsonObject envelope = RailwayWeb.blockingGet("/railway/orders/" + ManualService.enc(orderNo), 3000);
            JsonObject order = RailwayWeb.data(envelope);
            if (!"paid".equals(RailwayWeb.str(order, "status", ""))) {
                reply(player, "订单未支付，请先执行 /railway pay " + orderNo, ChatFormatting.RED);
                return 0;
            }
            if (!voucher && RailwayWeb.b(order, "printed", false)) {
                reply(player, "该订单已打印过车票，不能重复打印", ChatFormatting.YELLOW);
                return 0;
            }
            String orderId = RailwayWeb.str(order, "orderNo", orderNo);
            String passengerName = RailwayWeb.str(order, "passengerName", "");
            String idNo = RailwayWeb.str(order, "idNo", "");
            ItemStack paper;
            if (voucher) {
                paper = new ItemStack(ModItems.REIMBURSEMENT.get());
                TicketNbt.writeVoucher(paper, order, passengerName, idNo);
            } else {
                paper = CrhCompat.newTicketStack();
                TicketNbt.writeTicket(paper, order, passengerName, idNo);
            }
            give(player, paper);

            if (!voucher) {
                mirrorCard(player, order, idNo);
                RailwayWeb.blockingPost("/railway/orders/" + orderId + "/print", new JsonObject(), 3000);
            }
            String train = RailwayWeb.str(order, "trainName", RailwayWeb.str(order, "trainNo", ""));
            if (voucher) {
                reply(player, "已打印 " + train + " 报销凭证并放入背包", ChatFormatting.GOLD);
            } else {
                reply(player, "已打印 " + train + " 车票并放入背包；刷身份证可直接检票", ChatFormatting.GREEN);
            }
            return 1;
        } catch (Exception e) {
            reply(player, "打印失败：" + e.getMessage(), ChatFormatting.RED);
            return 0;
        }
    }

    private static int status(CommandContext<CommandSourceStack> context) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        String station = CrhCompat.stationNameAt(player.level(), player.blockPosition());
        reply(player, "所在车站：" + (station.isBlank() ? "不在车站范围内" : station), ChatFormatting.AQUA);
        try {
            JsonArray orders = ManualService.listOrders(player, player.getGameProfile().getName());
            List<JsonObject> paid = new ArrayList<>();
            List<JsonObject> pending = new ArrayList<>();
            for (JsonElement element : orders) {
                if (!element.isJsonObject()) continue;
                JsonObject order = element.getAsJsonObject();
                if (!player.getGameProfile().getName().equalsIgnoreCase(RailwayWeb.str(order, "passengerName", ""))) continue;
                if ("pending".equals(RailwayWeb.str(order, "status", ""))) pending.add(order);
                else paid.add(order);
            }
            reply(player, "已购车票 " + paid.size() + " 张", ChatFormatting.GREEN);
            for (JsonObject order : paid) {
                reply(player, "  " + orderLine(order) + " · 订单 " + RailwayWeb.str(order, "orderNo", ""), ChatFormatting.GRAY);
            }
            reply(player, "未支付车票 " + pending.size() + " 张", pending.isEmpty() ? ChatFormatting.GRAY : ChatFormatting.YELLOW);
            for (JsonObject order : pending) {
                reply(player, "  " + orderLine(order) + " · 订单 " + RailwayWeb.str(order, "orderNo", "")
                        + " · /railway pay " + RailwayWeb.str(order, "orderNo", ""), ChatFormatting.YELLOW);
            }
            return 1;
        } catch (Exception e) {
            reply(player, "读取车票失败：" + e.getMessage(), ChatFormatting.RED);
            return 0;
        }
    }

    private static String orderLine(JsonObject order) {
        return RailwayWeb.str(order, "trainNo", "") + " "
                + RailwayWeb.str(order, "fromStationName", "") + "->"
                + RailwayWeb.str(order, "toStationName", "");
    }

    private static int adminBuy(CommandContext<CommandSourceStack> context) {
        ServerPlayer staff = context.getSource().getPlayer();
        if (staff == null) return 0;
        try {
            ServerPlayer target = EntityArgument.getPlayer(context, "player");
            String trainNo = StringArgumentType.getString(context, "trainNo");
            String from = unquote(StringArgumentType.getString(context, "from"));
            String to = unquote(StringArgumentType.getString(context, "to"));
            String idNo = "";
            for (int i = 0; i < target.getInventory().getContainerSize(); i++) {
                ItemStack stack = target.getInventory().getItem(i);
                if (TicketNbt.isIdCard(stack)) {
                    idNo = TicketNbt.idCardNumber(stack);
                    break;
                }
            }
            if (idNo.isBlank()) idNo = "ADMIN-" + target.getGameProfile().getName();
            JsonObject body = new JsonObject();
            body.addProperty("trainNo", trainNo);
            body.addProperty("stationName", from);
            body.addProperty("toStationName", to);
            body.addProperty("passengerName", target.getGameProfile().getName());
            body.addProperty("idNo", idNo);
            body.addProperty("source", "machine");
            JsonObject envelope = RailwayWeb.blockingPost("/railway/orders", body, 5000);
            JsonObject result = RailwayWeb.data(envelope);
            JsonObject order = result.has("order") && result.get("order").isJsonObject()
                    ? result.getAsJsonObject("order") : result;
            String no = RailwayWeb.str(order, "orderNo", "");
            ItemStack paper = CrhCompat.newTicketStack();
            TicketNbt.writeTicket(paper, order, target.getGameProfile().getName(), idNo);
            if (!target.getInventory().add(paper)) target.drop(paper, false);
            try {
                RailwayWeb.blockingPost("/railway/orders/" + ManualService.enc(no) + "/print", new JsonObject(), 4000);
            } catch (Exception ignored) {
            }
            reply(staff, "已为 " + target.getGameProfile().getName() + " 购票：" + orderLine(order) + " · 订单 " + no,
                    ChatFormatting.GREEN);
            OrderNotifier.mark(no);
            target.displayClientMessage(Component.literal("购票成功 " + orderLine(order) + " 订单 " + no)
                    .withStyle(ChatFormatting.GREEN), false);
            return 1;
        } catch (Exception e) {
            reply(staff, "管理员购票失败：" + e.getMessage(), ChatFormatting.RED);
            return 0;
        }
    }

    private static void mirrorCard(ServerPlayer player, JsonObject order, String idNo) {
        ItemStack paper = CrhCompat.newTicketStack();
        TicketNbt.writeTicket(paper, order, RailwayWeb.str(order, "passengerName", ""), idNo);
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            ItemStack stack = player.getInventory().getItem(i);
            if (TicketNbt.isIdCard(stack) && (idNo.isBlank() || idNo.equals(TicketNbt.idCardNumber(stack)))) {
                TicketNbt.mirrorToCard(stack, paper);
                return;
            }
        }
        RailwayStore.CardData data = RailwayStore.nearbyVendorCard(player.level(), player.blockPosition(), 24, idNo);
        if (data != null) {
            data.updateTicketFrom(paper);
            RailwayStore.save(player.getServer());
        }
    }

    private static void give(ServerPlayer player, ItemStack stack) {
        if (!player.getInventory().add(stack)) {
            player.drop(stack, false);
        }
    }

    private static int deleteStation(CommandContext<CommandSourceStack> context) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        String name = unquote(StringArgumentType.getString(context, "name"));
        RailwayStore.Station station = RailwayStore.removeStation(name);
        RailwayStore.save(player.getServer());
        stationCacheAt = 0L;
        JsonObject body = new JsonObject();
        body.addProperty("name", name);
        body.addProperty("id", station == null ? "" : station.backendId);
        boolean webDeleted = false;
        try {
            RailwayWeb.blockingPost("/railway/admin/station/delete", body, 4000);
            webDeleted = true;
        } catch (Exception ignored) {
        }
        if (station == null && !webDeleted) {
            reply(player, "未找到车站：" + name, ChatFormatting.RED);
            return 0;
        }
        reply(player, "已删除车站 " + name
                + (webDeleted ? "，网页后台车站与相关票价已删除" : "（本地已删除，网页端删除失败，请稍后重试）"),
                webDeleted ? ChatFormatting.GREEN : ChatFormatting.YELLOW);
        return 1;
    }

    private static int setPos(CommandContext<CommandSourceStack> context, int corner, BlockPos explicit) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        String name = unquote(StringArgumentType.getString(context, "name"));
        BlockPos pos = explicit;
        if (pos == null) {
            var hit = player.pick(48.0D, 0.0F, false);
            if (hit.getType() == net.minecraft.world.phys.HitResult.Type.BLOCK) {
                pos = ((net.minecraft.world.phys.BlockHitResult) hit).getBlockPos();
            } else {
                pos = player.blockPosition().below();
            }
        }
        if (corner == 1) {
            PENDING.put(player.getUUID(), new PendingStation(name, pos, player.level().dimension().location().toString()));
            reply(player, "已记录 " + name + " 的 POS1 " + pos.toShortString() + "，请再设置 POS2", ChatFormatting.AQUA);
            return 1;
        }
        PendingStation pending = PENDING.get(player.getUUID());
        if (pending == null || !pending.name.equals(name)) {
            reply(player, "请先设置 " + name + " 的 POS1", ChatFormatting.RED);
            return 0;
        }
        ServerLevel level = (ServerLevel) player.level();
        RailwayStore.Station station = RailwayStore.registerStation(level, name, pending.pos1, pos);
        RailwayStore.save(player.getServer());
        boolean synced = syncStation(station);
        reply(player, "车站 " + name + " 已划定：" + station.gates.size() + " 台闸机、" + station.vendors.size()
                + " 台售票机，中心 " + station.cx + "," + station.cy + "," + station.cz
                + (synced ? "，已同步网页端并自动生成票价" : "（网页端同步失败，稍后可用 /railway admin sync 重试）"),
                synced ? ChatFormatting.GREEN : ChatFormatting.YELLOW);
        stationCacheAt = 0L;
        PENDING.remove(player.getUUID());
        return 1;
    }

    private static int listStations(CommandContext<CommandSourceStack> context) {
        CommandSourceStack source = context.getSource();
        if (RailwayStore.stations().isEmpty()) {
            source.sendSuccess(() -> Component.literal("尚未登记任何车站"), false);
            return 0;
        }
        for (RailwayStore.Station station : RailwayStore.stations().values()) {
            source.sendSuccess(() -> Component.literal(station.name + " · " + station.dimension
                    + " · 中心 " + station.cx + "," + station.cy + "," + station.cz
                    + " · 闸机 " + station.gates.size() + " · 售票机 " + station.vendors.size()), false);
        }
        return 1;
    }

    private static int syncAll(CommandContext<CommandSourceStack> context) {
        int ok = 0;
        for (RailwayStore.Station station : RailwayStore.stations().values()) {
            if (syncStation(station)) ok++;
        }
        stationCacheAt = 0L;
        int count = ok;
        context.getSource().sendSuccess(() -> Component.literal("已同步 " + count + " 个车站到网页端"), false);
        return ok;
    }

    public static boolean syncStation(RailwayStore.Station station) {
        JsonObject body = new JsonObject();
        body.addProperty("name", station.name);
        body.addProperty("dimension", station.dimension);
        body.addProperty("backendId", station.backendId);
        JsonObject center = new JsonObject();
        center.addProperty("x", station.cx);
        center.addProperty("y", station.cy);
        center.addProperty("z", station.cz);
        body.add("center", center);
        body.add("pos1", pos(station.x1, station.y1, station.z1));
        body.add("pos2", pos(station.x2, station.y2, station.z2));
        JsonArray gates = new JsonArray();
        for (BlockPos pos : station.gates) gates.add(pos(pos.getX(), pos.getY(), pos.getZ()));
        body.add("gates", gates);
        JsonArray vendors = new JsonArray();
        for (BlockPos pos : station.vendors) vendors.add(pos(pos.getX(), pos.getY(), pos.getZ()));
        body.add("vendors", vendors);
        try {
            JsonObject envelope = RailwayWeb.blockingPost("/railway/admin/station", body, 4000);
            JsonObject result = RailwayWeb.data(envelope);
            String id = RailwayWeb.str(result, "id", RailwayWeb.str(result, "stationId", ""));
            if (!id.isBlank()) station.backendId = id;
            return true;
        } catch (Exception e) {
            RailwayAddon.LOGGER.warn("同步车站 {} 失败：{}", station.name, e.getMessage());
            return false;
        }
    }

    private static JsonObject pos(int x, int y, int z) {
        JsonObject object = new JsonObject();
        object.addProperty("x", x);
        object.addProperty("y", y);
        object.addProperty("z", z);
        return object;
    }

    /** 车站补全：本地已划定的车站 + 网页后台新建的车站。 */
    public static List<String> webStationNames() {
        if (System.currentTimeMillis() - stationCacheAt < 30_000L) return stationCache;
        Set<String> names = new LinkedHashSet<>();
        for (RailwayStore.Station station : RailwayStore.stations().values()) names.add(station.name);
        try {
            JsonObject envelope = RailwayWeb.blockingGet("/railway/stations", 2500);
            JsonElement list = RailwayWeb.data(envelope).get("stations");
            if (list != null && list.isJsonArray()) {
                for (JsonElement element : list.getAsJsonArray()) {
                    if (element.isJsonObject()) {
                        String name = RailwayWeb.str(element.getAsJsonObject(), "name", "");
                        if (!name.isBlank()) names.add(name);
                    }
                }
            }
        } catch (Exception ignored) {
        }
        stationCache = new ArrayList<>(names);
        stationCacheAt = System.currentTimeMillis();
        return stationCache;
    }

    private static String unquote(String value) {
        if (value == null) return "";
        String trimmed = value.trim();
        if (trimmed.length() >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
            return trimmed.substring(1, trimmed.length() - 1);
        }
        return trimmed;
    }

    private static void reply(ServerPlayer player, String text, ChatFormatting color) {
        player.displayClientMessage(Component.literal(text).withStyle(color), false);
    }
}
