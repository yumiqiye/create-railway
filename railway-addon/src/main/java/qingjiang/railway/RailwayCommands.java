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
import net.minecraft.world.level.block.state.BlockState;
import qingjiang.railway.block.GuideScreenBlockEntity;
import qingjiang.railway.block.RailwayTvBlockEntity;
import qingjiang.railway.block.VehicleDisplayBlockEntity;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
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
            builder.suggest(name.contains(" ") ? "\"" + name + "\"" : name);
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
                                .executes(context -> print(context, StringArgumentType.getString(context, "orderNo"), "ticket", false))))
                .then(Commands.literal("reprint")
                        .then(Commands.argument("orderNo", StringArgumentType.word())
                                .suggests(ORDER_SUGGESTIONS)
                                .executes(context -> print(context, StringArgumentType.getString(context, "orderNo"), "ticket", true))))
                .then(Commands.literal("voucher")
                        .then(Commands.argument("orderNo", StringArgumentType.word())
                                .suggests(ORDER_SUGGESTIONS)
                                .executes(context -> print(context, StringArgumentType.getString(context, "orderNo"), "voucher", true))))
                .then(Commands.literal("itinerary")
                        .then(Commands.argument("orderNo", StringArgumentType.word())
                                .suggests(ORDER_SUGGESTIONS)
                                .executes(context -> print(context, StringArgumentType.getString(context, "orderNo"), "itinerary", true))))
                .then(Commands.literal("refund")
                        .then(Commands.argument("orderNo", StringArgumentType.word())
                                .suggests(ORDER_SUGGESTIONS)
                                .executes(context -> refund(context, StringArgumentType.getString(context, "orderNo")))))
                .then(Commands.literal("change")
                        .then(Commands.argument("orderNo", StringArgumentType.word())
                                .suggests(ORDER_SUGGESTIONS)
                                .then(Commands.argument("trainNo", StringArgumentType.word())
                                        .then(Commands.argument("date", StringArgumentType.word())
                                                .then(Commands.argument("seatType", StringArgumentType.word())
                                                        .executes(context -> change(context,
                                                                StringArgumentType.getString(context, "orderNo"),
                                                                StringArgumentType.getString(context, "trainNo"),
                                                                StringArgumentType.getString(context, "date"),
                                                                StringArgumentType.getString(context, "seatType"))))))))
                .then(Commands.literal("status").executes(RailwayCommands::status))
                .then(Commands.literal("dispatch")
                        .then(Commands.literal("history").executes(RailwayCommands::dispatchHistory))
                        .then(Commands.argument("message", StringArgumentType.greedyString())
                                .executes(RailwayCommands::sendDispatch)))
                .then(Commands.literal("admin")
                        .requires(source -> source.hasPermission(2))
                        .then(Commands.literal("station")
                                .then(Commands.literal("delete")
                                        .then(Commands.argument("name", StringArgumentType.string())
                                                .suggests(STATION_SUGGESTIONS)
                                                .executes(RailwayCommands::deleteStation))
                                .then(Commands.argument("name", StringArgumentType.string())
                                        .suggests(STATION_SUGGESTIONS)
                                        .then(Commands.literal("delete").executes(RailwayCommands::deleteStation))
                                        .then(Commands.literal("POS1")
                                                .executes(context -> setPos(context, 1, null))
                                                .then(Commands.argument("pos", BlockPosArgument.blockPos())
                                                        .executes(context -> setPos(context, 1, BlockPosArgument.getBlockPos(context, "pos"))))
                                        .then(Commands.literal("POS2")
                                                .executes(context -> setPos(context, 2, null))
                                                .then(Commands.argument("pos", BlockPosArgument.blockPos())
                                                        .executes(context -> setPos(context, 2, BlockPosArgument.getBlockPos(context, "pos"))))))))
                        .then(Commands.literal("stations").executes(RailwayCommands::listStations))
                        .then(Commands.literal("screen")
                                .then(Commands.literal("scale")
                                        .then(Commands.argument("pos", BlockPosArgument.blockPos())
                                                .then(Commands.argument("scale", StringArgumentType.word())
                                                        .executes(RailwayCommands::setGuideScreenScale)))))
                        .then(Commands.literal("display")
                                .then(Commands.argument("pos", BlockPosArgument.blockPos())
                                        .then(Commands.argument("line", StringArgumentType.string())
                                                .then(Commands.argument("destination", StringArgumentType.string())
                                                        .then(Commands.argument("next", StringArgumentType.string())
                                                                .executes(RailwayCommands::setVehicleDisplay))))))
                        .then(Commands.literal("tv")
                                .then(Commands.argument("pos", BlockPosArgument.blockPos())
                                        .then(Commands.argument("url", StringArgumentType.greedyString())
                                                .executes(RailwayCommands::setTvUrl))))
                        .then(Commands.literal("pull").executes(RailwayCommands::pullRemoteStations))
                        .then(Commands.literal("devices").executes(RailwayCommands::listDeviceBindings))
                        .then(Commands.literal("gate")
                                .then(Commands.literal("bind")
                                        .then(Commands.argument("gateNo", StringArgumentType.string())
                                                .executes(RailwayCommands::bindGate))))
                        .then(Commands.literal("sync").executes(RailwayCommands::syncAll))
                        .then(Commands.literal("buy")
                                .then(Commands.argument("player", EntityArgument.player())
                                        .then(Commands.argument("trainNo", StringArgumentType.word())
                                                .then(Commands.argument("from", StringArgumentType.string())
                                                        .suggests(STATION_SUGGESTIONS)
                                                        .then(Commands.argument("to", StringArgumentType.string())
                                                                .suggests(STATION_SUGGESTIONS)
                                                                .executes(RailwayCommands::adminBuy)))))))));

        dispatcher.register(Commands.literal("metro")
                .then(Commands.literal("arrivals")
                        .then(Commands.argument("station", StringArgumentType.string())
                                .suggests(STATION_SUGGESTIONS)
                                .executes(RailwayCommands::metroArrivals)))
                .then(Commands.literal("estimate")
                        .then(Commands.argument("from", StringArgumentType.string())
                                .suggests(STATION_SUGGESTIONS)
                                .then(Commands.argument("to", StringArgumentType.string())
                                        .suggests(STATION_SUGGESTIONS)
                                        .executes(RailwayCommands::metroEstimate))))
                .then(Commands.literal("ticket")
                        .then(Commands.literal("buy")
                                .then(Commands.argument("from", StringArgumentType.string())
                                        .suggests(STATION_SUGGESTIONS)
                                        .then(Commands.argument("to", StringArgumentType.string())
                                                .suggests(STATION_SUGGESTIONS)
                                                .executes(RailwayCommands::metroBuyTicket)))))
                .then(Commands.literal("card")
                        .then(Commands.literal("new").executes(RailwayCommands::metroNewCard))
                        .then(Commands.literal("balance").executes(RailwayCommands::metroCardBalance))
                        .then(Commands.literal("recharge")
                                .then(Commands.argument("amount", StringArgumentType.word())
                                        .executes(RailwayCommands::metroRecharge)))));
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

    private static int print(CommandContext<CommandSourceStack> context, String orderNo, String kind, boolean reprint) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        try {
            JsonObject envelope = RailwayWeb.blockingGet("/railway/orders/" + ManualService.enc(orderNo), 3000);
            JsonObject order = RailwayWeb.data(envelope);
            if (!"paid".equals(RailwayWeb.str(order, "status", ""))) {
                reply(player, "订单未支付，请先执行 /railway pay " + orderNo, ChatFormatting.RED);
                return 0;
            }
            boolean ticket = "ticket".equals(kind);
            boolean alreadyPrinted = RailwayWeb.b(order, "printed", false);
            if (ticket && alreadyPrinted && !reprint) {
                reply(player, "该订单已打印过车票；补打请用 /railway reprint " + orderNo, ChatFormatting.YELLOW);
                return 0;
            }
            JsonArray passengers = order.has("passengers") && order.get("passengers").isJsonArray()
                    ? order.getAsJsonArray("passengers") : new JsonArray();
            List<JsonObject> list = new ArrayList<>();
            if (passengers.size() == 0) {
                JsonObject single = order.deepCopy();
                single.addProperty("passengerName", RailwayWeb.str(order, "passengerName", ""));
                single.addProperty("idNo", RailwayWeb.str(order, "idNo", ""));
                list.add(single);
            } else {
                for (JsonElement element : passengers) {
                    if (element.isJsonObject()) list.add(element.getAsJsonObject());
                }
            }
            String orderId = RailwayWeb.str(order, "orderNo", orderNo);
            for (JsonObject p : list) {
                String passengerName = RailwayWeb.str(p, "name", RailwayWeb.str(order, "passengerName", ""));
                String idNo = RailwayWeb.str(p, "idNo", RailwayWeb.str(order, "idNo", ""));
                JsonObject paperOrder = order.deepCopy();
                paperOrder.addProperty("passengerName", passengerName);
                paperOrder.addProperty("idNo", idNo);
                paperOrder.addProperty("seatNo", RailwayWeb.str(p, "seatNo", RailwayWeb.str(order, "seatNo", "")));
                if (p.has("price")) paperOrder.add("price", p.get("price"));
                ItemStack paper;
                if ("voucher".equals(kind)) {
                    paper = new ItemStack(ModItems.REIMBURSEMENT.get());
                    TicketNbt.writeVoucher(paper, paperOrder, passengerName, idNo);
                } else if ("itinerary".equals(kind)) {
                    paper = new ItemStack(net.minecraft.world.item.Items.PAPER);
                    paper.set(net.minecraft.core.component.DataComponents.CUSTOM_NAME,
                            Component.literal("行程信息单 · " + RailwayWeb.str(order, "trainNo", "")));
                    TicketNbt.writeItinerary(paper, paperOrder, passengerName, idNo);
                } else {
                    paper = CrhCompat.newTicketStack();
                    TicketNbt.writeTicket(paper, paperOrder, passengerName, idNo);
                }
                give(player, paper);
                returnVendorCard(player, idNo, passengerName, paper, ticket);
            }

            if (ticket) {
                String endpoint = reprint ? "/reprint" : "/print";
                RailwayWeb.blockingPost("/railway/orders/" + orderId + endpoint, new JsonObject(), 3000);
            } else {
                JsonObject body = new JsonObject();
                body.addProperty("kind", kind);
                RailwayWeb.blockingPost("/railway/orders/" + orderId + "/reprint", body, 3000);
            }
            String train = RailwayWeb.str(order, "trainName", RailwayWeb.str(order, "trainNo", ""));
            String label = "voucher".equals(kind) ? "报销凭证" : "itinerary".equals(kind) ? "行程信息单" : "车票";
            reply(player, "已打印 " + train + " " + label + " " + list.size() + " 份并放入背包"
                    + (ticket ? "；刷身份证可直接检票" : ""), ChatFormatting.GREEN);
            return 1;
        } catch (Exception e) {
            reply(player, "打印失败：" + e.getMessage(), ChatFormatting.RED);
            return 0;
        }
    }

    private static int refund(CommandContext<CommandSourceStack> context, String orderNo) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        try {
            JsonObject envelope = RailwayWeb.blockingPost("/railway/orders/" + ManualService.enc(orderNo) + "/refund", new JsonObject(), 4000);
            JsonObject data = RailwayWeb.data(envelope);
            double amount = data.has("refundAmount") ? data.get("refundAmount").getAsDouble() : 0;
            double fee = data.has("fee") ? data.get("fee").getAsDouble() : 0;
            RailwayCurrency.give(player, RailwayCurrency.refundItems(amount));
            reply(player, "退票成功：手续费 " + fee + "，退回 " + RailwayCurrency.label(RailwayCurrency.refundItems(amount)), ChatFormatting.GREEN);
            return 1;
        } catch (Exception e) {
            reply(player, "退票失败：" + e.getMessage(), ChatFormatting.RED);
            return 0;
        }
    }

    private static int change(CommandContext<CommandSourceStack> context, String orderNo, String trainNo, String date, String seatType) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        try {
            JsonObject quoteBody = new JsonObject();
            quoteBody.addProperty("trainNo", trainNo);
            quoteBody.addProperty("date", date);
            quoteBody.addProperty("seatType", seatType);
            quoteBody.addProperty("dryRun", true);
            JsonObject quoteEnvelope = RailwayWeb.blockingPost(
                    "/railway/orders/" + ManualService.enc(orderNo) + "/change", quoteBody, 4000);
            JsonObject quote = RailwayWeb.data(quoteEnvelope);
            double needPay = quote.has("needPay") ? quote.get("needPay").getAsDouble() : 0;
            double refund = quote.has("refund") ? quote.get("refund").getAsDouble() : 0;
            int remaining = quote.has("remaining") ? quote.get("remaining").getAsInt() : 0;
            if (remaining <= 0) throw new IllegalStateException("新车次席别已无余票");
            int needItems = RailwayCurrency.needFor(player, "", needPay);
            if (needItems > 0) {
                int have = RailwayCurrency.count(player);
                if (have < needItems) throw new IllegalStateException("余额不足，需补 " + RailwayCurrency.label(needItems));
                RailwayCurrency.consume(player, needItems);
            }
            try {
                JsonObject body = new JsonObject();
                body.addProperty("trainNo", trainNo);
                body.addProperty("date", date);
                body.addProperty("seatType", seatType);
                RailwayWeb.blockingPost("/railway/orders/" + ManualService.enc(orderNo) + "/change", body, 4000);
            } catch (Exception failure) {
                if (needItems > 0) RailwayCurrency.give(player, needItems);
                throw failure;
            }
            if (refund > 0) RailwayCurrency.give(player, RailwayCurrency.refundItems(refund));
            reply(player, "改签成功：" + trainNo + " " + date + " " + seatType
                    + (needItems > 0 ? "，补交 " + RailwayCurrency.label(needItems) : "")
                    + (refund > 0 ? "，退回 " + RailwayCurrency.label(RailwayCurrency.refundItems(refund)) : "")
                    + "；请重新打印车票", ChatFormatting.GREEN);
            return 1;
        } catch (Exception e) {
            reply(player, "改签失败：" + e.getMessage(), ChatFormatting.RED);
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

    /** 票据打印后，把售票机内身份证连同车票/凭证一起取出；本机无卡时只同步背包身份证。 */
    private static void returnVendorCard(ServerPlayer player, String idNo, String passengerName,
                                        ItemStack paper, boolean ticket) {
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            ItemStack stack = player.getInventory().getItem(i);
            if (!TicketNbt.isIdCard(stack)) continue;
            if (!idNo.isBlank() && !idNo.equals(TicketNbt.idCardNumber(stack))) continue;
            if (!passengerName.isBlank() && !passengerName.equals(TicketNbt.idCardName(stack))) continue;
            if (ticket) TicketNbt.mirrorToCard(stack, paper);
            return;
        }

        RailwayStore.CardData data = RailwayStore.removeNearbyVendorCard(
                player.level(), player.blockPosition(), 24, idNo, passengerName);
        if (data == null) return;
        if (ticket) data.updateTicketFrom(paper);
        RailwayStore.save(player.getServer());
        give(player, data.toStack());
    }

    private static void give(ServerPlayer player, ItemStack stack) {
        if (!player.getInventory().add(stack)) {
            player.drop(stack, false);
        }
    }

    private static String enc(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }

    private record MetroTarget(ItemStack held, RailwayStore.CardData stored, BlockPos storedPos) {}

    private static ItemStack heldMetroCard(ServerPlayer player) {
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            ItemStack stack = player.getInventory().getItem(i);
            if (MetroNbt.isMetroCard(stack)) return stack;
        }
        return ItemStack.EMPTY;
    }

    private static MetroTarget metroTarget(ServerPlayer player) {
        ItemStack held = heldMetroCard(player);
        if (!held.isEmpty()) return new MetroTarget(held, null, null);
        BlockPos pos = RailwayStore.nearbyMetroCardPos(player.level(), player.blockPosition(), 6);
        if (pos != null) return new MetroTarget(ItemStack.EMPTY, RailwayStore.cardAt(player.level(), pos), pos);
        return null;
    }

    private static String metroCardNo(MetroTarget target) {
        if (!target.held().isEmpty()) return MetroNbt.cardNo(target.held());
        ItemStack stored = target.stored() == null ? ItemStack.EMPTY : target.stored().toMetroStack();
        return MetroNbt.isMetroCard(stored) ? MetroNbt.cardNo(stored) : "";
    }

    private static void writeMetroTarget(ServerPlayer player, MetroTarget target, JsonObject card) {
        if (!target.held().isEmpty()) {
            MetroNbt.writeCard(target.held(), card);
            return;
        }
        if (target.stored() != null) {
            ItemStack temp = new ItemStack(ModItems.METRO_CARD.get());
            MetroNbt.writeCard(temp, card);
            target.stored().updateMetroCardFrom(temp);
            RailwayStore.putCard(player.level(), target.storedPos(), target.stored());
            RailwayStore.save(player.getServer());
        }
    }

    private static int metroArrivals(CommandContext<CommandSourceStack> context) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        String station = unquote(StringArgumentType.getString(context, "station"));
        try {
            JsonObject envelope = RailwayWeb.blockingGet("/railway/metro/arrivals?station=" + enc(station), 3000);
            JsonObject data = RailwayWeb.data(envelope);
            JsonArray arrivals = data.has("arrivals") && data.get("arrivals").isJsonArray()
                    ? data.getAsJsonArray("arrivals") : new JsonArray();
            reply(player, "「" + station + "」地铁到站预报：", ChatFormatting.AQUA);
            if (arrivals.isEmpty()) reply(player, "  暂无后续班次", ChatFormatting.GRAY);
            for (JsonElement element : arrivals) {
                if (!element.isJsonObject()) continue;
                JsonObject row = element.getAsJsonObject();
                String line = RailwayWeb.str(row, "line", "");
                String trainNo = RailwayWeb.str(row, "trainNo", "");
                String destination = RailwayWeb.str(row, "destination", "");
                String nextStation = RailwayWeb.str(row, "nextStation", "");
                String departTime = RailwayWeb.str(row, "departTime", "--:--");
                int minutes = RailwayWeb.i(row, "minutes", 0);
                String label = line.isBlank() ? trainNo : line + " " + trainNo;
                reply(player, "  " + departTime + " · " + label + " → " + destination
                        + (nextStation.isBlank() ? "" : "（下一站 " + nextStation + "）")
                        + " · " + minutes + " 分钟后", ChatFormatting.GRAY);
            }
            return 1;
        } catch (Exception e) {
            reply(player, "查询到站预报失败：" + e.getMessage(), ChatFormatting.RED);
            return 0;
        }
    }

    private static int metroEstimate(CommandContext<CommandSourceStack> context) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        String from = unquote(StringArgumentType.getString(context, "from"));
        String to = unquote(StringArgumentType.getString(context, "to"));
        try {
            JsonObject envelope = RailwayWeb.blockingGet(
                    "/railway/metro/estimate?from=" + enc(from) + "&to=" + enc(to), 3000);
            JsonObject data = RailwayWeb.data(envelope);
            reply(player, "地铁票价：" + from + " → " + to + "，" + RailwayWeb.i(data, "fare", 0) + " 元",
                    ChatFormatting.GREEN);
            return 1;
        } catch (Exception e) {
            reply(player, "票价试算失败：" + e.getMessage(), ChatFormatting.RED);
            return 0;
        }
    }

    private static int metroBuyTicket(CommandContext<CommandSourceStack> context) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        String from = unquote(StringArgumentType.getString(context, "from"));
        String to = unquote(StringArgumentType.getString(context, "to"));
        try {
            JsonObject body = new JsonObject();
            body.addProperty("playerName", player.getGameProfile().getName());
            body.addProperty("from", from);
            body.addProperty("to", to);
            JsonObject envelope = RailwayWeb.blockingPost("/railway/metro/tickets", body, 4000);
            JsonObject ticket = RailwayWeb.data(envelope);
            ItemStack stack = new ItemStack(ModItems.METRO_TICKET.get());
            MetroNbt.writeTicket(stack, ticket);
            give(player, stack);
            reply(player, "已购买地铁单程票：" + from + " → " + to + "，票价 "
                    + RailwayWeb.i(ticket, "fare", 0) + " 元", ChatFormatting.GREEN);
            return 1;
        } catch (Exception e) {
            reply(player, "购买地铁票失败：" + e.getMessage(), ChatFormatting.RED);
            return 0;
        }
    }

    private static int metroNewCard(CommandContext<CommandSourceStack> context) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        try {
            JsonObject body = new JsonObject();
            body.addProperty("playerName", player.getGameProfile().getName());
            JsonObject envelope = RailwayWeb.blockingPost("/railway/metro/cards", body, 4000);
            JsonObject card = RailwayWeb.data(envelope);
            ItemStack stack = new ItemStack(ModItems.METRO_CARD.get());
            MetroNbt.writeCard(stack, card);
            give(player, stack);
            reply(player, "已开通地铁储值卡 " + RailwayWeb.str(card, "cardNo", ""), ChatFormatting.GREEN);
            return 1;
        } catch (Exception e) {
            reply(player, "开卡失败：" + e.getMessage(), ChatFormatting.RED);
            return 0;
        }
    }

    private static int metroCardBalance(CommandContext<CommandSourceStack> context) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        MetroTarget target = metroTarget(player);
        if (target == null) {
            reply(player, "背包或附近售票机内没有地铁储值卡", ChatFormatting.YELLOW);
            return 0;
        }
        String cardNo = metroCardNo(target);
        try {
            JsonObject envelope = RailwayWeb.blockingGet("/railway/metro/cards?cardNo=" + enc(cardNo), 3000);
            JsonObject data = RailwayWeb.data(envelope);
            JsonArray cards = data.has("cards") && data.get("cards").isJsonArray()
                    ? data.getAsJsonArray("cards") : new JsonArray();
            if (cards.isEmpty()) {
                reply(player, "储值卡不存在或已注销", ChatFormatting.RED);
                return 0;
            }
            JsonObject card = cards.get(0).getAsJsonObject();
            writeMetroTarget(player, target, card);
            reply(player, "储值卡 " + cardNo + " 余额 " + RailwayWeb.str(card, "balance", "0") + " 元",
                    ChatFormatting.GREEN);
            return 1;
        } catch (Exception e) {
            reply(player, "查询余额失败：" + e.getMessage(), ChatFormatting.RED);
            return 0;
        }
    }

    private static int metroRecharge(CommandContext<CommandSourceStack> context) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        MetroTarget target = metroTarget(player);
        if (target == null) {
            reply(player, "背包或附近售票机内没有地铁储值卡", ChatFormatting.YELLOW);
            return 0;
        }
        double amount;
        try {
            amount = Double.parseDouble(StringArgumentType.getString(context, "amount"));
        } catch (NumberFormatException e) {
            reply(player, "充值金额无效", ChatFormatting.RED);
            return 0;
        }
        if (amount <= 0) {
            reply(player, "充值金额必须大于 0", ChatFormatting.RED);
            return 0;
        }
        try {
            JsonObject body = new JsonObject();
            body.addProperty("cardNo", metroCardNo(target));
            body.addProperty("action", "recharge");
            body.addProperty("amount", amount);
            JsonObject envelope = RailwayWeb.blockingPost("/railway/metro/cards", body, 4000);
            JsonObject card = RailwayWeb.data(envelope);
            writeMetroTarget(player, target, card);
            reply(player, "充值成功，当前余额 " + RailwayWeb.str(card, "balance", "0") + " 元",
                    ChatFormatting.GREEN);
            return 1;
        } catch (Exception e) {
            reply(player, "充值失败：" + e.getMessage(), ChatFormatting.RED);
            return 0;
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

    private static int setGuideScreenScale(CommandContext<CommandSourceStack> context) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        BlockPos pos = BlockPosArgument.getBlockPos(context, "pos");
        float scale;
        try {
            scale = Float.parseFloat(StringArgumentType.getString(context, "scale").trim());
        } catch (NumberFormatException e) {
            reply(player, "缩放系数需为 0.5~1.5 的数字", ChatFormatting.RED);
            return 0;
        }
        if (!(scale >= 0.5F && scale <= 1.5F)) {
            reply(player, "缩放系数需在 0.5~1.5 之间", ChatFormatting.RED);
            return 0;
        }
        ServerLevel level = (ServerLevel) player.level();
        if (!(level.getBlockEntity(pos) instanceof GuideScreenBlockEntity screen)) {
            reply(player, "该位置不是引导屏方块", ChatFormatting.RED);
            return 0;
        }
        screen.setScale(scale);
        level.sendBlockUpdated(pos, level.getBlockState(pos), level.getBlockState(pos), 3);
        reply(player, "引导屏 " + pos.toShortString() + " 缩放已设为 " + scale, ChatFormatting.GREEN);
        return 1;
    }

    private static int sendDispatch(CommandContext<CommandSourceStack> context) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        String message = StringArgumentType.getString(context, "message");
        RailwayDispatch.broadcast(player, message);
        return 1;
    }

    private static int dispatchHistory(CommandContext<CommandSourceStack> context) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        List<RailwayDispatch.Message> history = RailwayDispatch.history();
        if (history.isEmpty()) {
            reply(player, "暂无调度消息", ChatFormatting.GRAY);
            return 1;
        }
        reply(player, "最近调度消息：", ChatFormatting.AQUA);
        for (RailwayDispatch.Message message : history) {
            reply(player, "[" + message.time() + "] " + message.sender() + "：" + message.text(), ChatFormatting.GRAY);
        }
        return 1;
    }

    private static int setTvUrl(CommandContext<CommandSourceStack> context) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        BlockPos pos = BlockPosArgument.getBlockPos(context, "pos");
        String url = StringArgumentType.getString(context, "url").trim();
        ServerLevel level = (ServerLevel) player.level();
        if (!(level.getBlockEntity(pos) instanceof RailwayTvBlockEntity tv)) {
            reply(player, "该位置不是世界内电视", ChatFormatting.RED);
            return 0;
        }
        int count = UrlConfigService.applyToGroup(level, pos, url.trim(), false);
        reply(player, "电视网页已设置：" + url + "（整组 " + count + " 台）", ChatFormatting.GREEN);
        return 1;
    }

    private static int setVehicleDisplay(CommandContext<CommandSourceStack> context) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        BlockPos pos = BlockPosArgument.getBlockPos(context, "pos");
        String line = StringArgumentType.getString(context, "line");
        String destination = StringArgumentType.getString(context, "destination");
        String next = StringArgumentType.getString(context, "next");
        ServerLevel level = (ServerLevel) player.level();
        if (!(level.getBlockEntity(pos) instanceof VehicleDisplayBlockEntity display)) {
            reply(player, "该位置不是车辆走字屏", ChatFormatting.RED);
            return 0;
        }
        display.setText(line, destination, next);
        reply(player, "走字屏已更新：" + line + " → " + destination + "（下一站：" + next + "）", ChatFormatting.GREEN);
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

    private static int pullRemoteStations(CommandContext<CommandSourceStack> context) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        try {
            JsonObject envelope = RailwayWeb.blockingGet("/railway/stations", 2500);
            int[] counts = RailwayStore.pullRemote(envelope);
            RailwayStore.save(player.getServer());
            stationCacheAt = 0L;
            reply(player, "已从网页端拉取车站台账：新增 " + counts[0] + " 个，更新 " + counts[1] + " 个", ChatFormatting.GREEN);
            return 1;
        } catch (Exception e) {
            reply(player, "拉取车站台账失败：" + e.getMessage(), ChatFormatting.RED);
            return 0;
        }
    }

    private static int bindGate(CommandContext<CommandSourceStack> context) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        String gateNo = StringArgumentType.getString(context, "gateNo").trim();
        if (gateNo.isBlank()) {
            reply(player, "闸机编号不能为空", ChatFormatting.RED);
            return 0;
        }

        var hit = player.pick(6.0D, 0.0F, false);
        BlockPos pos;
        if (hit instanceof net.minecraft.world.phys.BlockHitResult blockHit) {
            pos = blockHit.getBlockPos();
        } else {
            reply(player, "请看向要绑定的闸机方块", ChatFormatting.RED);
            return 0;
        }

        BlockState state = player.level().getBlockState(pos);
        if (!CrhCompat.isGate(state)) {
            reply(player, "看向的方块不是闸机", ChatFormatting.RED);
            return 0;
        }

        RailwayStore.GateSetting setting = RailwayStore.gate(player.level(), pos, state);
        setting.gateNo = gateNo;
        RailwayStore.save(player.getServer());
        reply(player, "闸机 " + pos.toShortString() + " 已绑定编号 " + gateNo, ChatFormatting.GREEN);
        return 1;
    }

    private static int listDeviceBindings(CommandContext<CommandSourceStack> context) {
        ServerPlayer player = context.getSource().getPlayer();
        if (player == null) return 0;
        try {
            RailwayStore.pullRemoteDevices(RailwayWeb.blockingGet("/railway/admin/devices", 2500));
            RailwayStore.pullRemoteTvms(RailwayWeb.blockingGet("/railway/admin/tvms", 2500));
        } catch (Exception ignored) {
        }

        int gates = 0;
        int vendors = 0;
        int disabled = 0;
        for (RailwayStore.Station station : RailwayStore.stations().values()) {
            for (BlockPos pos : station.gates) {
                gates++;
                RailwayStore.GateSetting setting = RailwayStore.gateIfPresent(player.level(), pos);
                if (setting != null && !"normal".equals(setting.status)) disabled++;
                String label = setting == null || setting.gateNo.isBlank() ? "未编号" : setting.gateNo;
                String status = setting == null ? "本地默认" : setting.status;
                reply(player, "闸机｜" + station.name + "｜" + label + "｜" + pos.toShortString() + "｜" + status,
                        "disabled".equals(status) ? ChatFormatting.RED : ChatFormatting.AQUA);
            }
            for (BlockPos pos : station.vendors) {
                vendors++;
                RailwayStore.VendorSetting vendor = RailwayStore.vendorIfPresent(player.level(), pos);
                String name = vendor == null || vendor.name.isBlank() ? "未登记购票机" : vendor.name;
                String status = vendor == null ? "本地默认" : vendor.status;
                if (!"normal".equals(status)) disabled++;
                reply(player, "购票机｜" + station.name + "｜" + name + "｜" + pos.toShortString() + "｜" + status,
                        "disabled".equals(status) ? ChatFormatting.RED : ChatFormatting.AQUA);
            }
        }
        reply(player, "设备台账：闸机 " + gates + " 台，购票机 " + vendors + " 台，停用/维修 " + disabled + " 台",
                ChatFormatting.GREEN);
        return 1;
    }

    private static int syncAll(CommandContext<CommandSourceStack> context) {
        ServerPlayer player = context.getSource().getPlayer();
        int pulled = 0;
        try {
            JsonObject envelope = RailwayWeb.blockingGet("/railway/stations", 2500);
            int[] counts = RailwayStore.pullRemote(envelope);
            pulled = counts[0] + counts[1];
            RailwayStore.save(context.getSource().getServer());
        } catch (Exception ignored) {
            // 反向拉取失败不阻断本地车站向网页端同步。
        }

        int ok = 0;
        for (RailwayStore.Station station : RailwayStore.stations().values()) {
            if (syncStation(station)) ok++;
        }
        stationCacheAt = 0L;
        String message = "已拉取后台 " + pulled + " 个车站台账，并同步 " + ok + " 个本地车站到网页端";
        if (player != null) {
            reply(player, message, ChatFormatting.GREEN);
        } else {
            context.getSource().sendSuccess(() -> Component.literal(message), false);
        }
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
