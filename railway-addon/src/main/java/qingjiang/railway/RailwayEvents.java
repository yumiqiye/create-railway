package qingjiang.railway;

import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import net.neoforged.neoforge.network.PacketDistributor;
import qingjiang.railway.menu.RailwayVendorMenu;
import qingjiang.railway.network.GateStatusPayload;

/** 方块交互、闸机刷卡、设置同步全部通过 NeoForge 事件完成，不改 CRH 源码。 */
public final class RailwayEvents {
    private static int tickCounter = 0;

    private RailwayEvents() {}

    @SubscribeEvent
    public static void onServerStarted(ServerStartedEvent event) {
        RailwayStore.load(event.getServer());
        RailwaySettings.refreshAsync();
    }

    @SubscribeEvent
    public static void onServerStopping(ServerStoppingEvent event) {
        RailwayStore.save(event.getServer());
        RailwayStore.unload();
    }

    @SubscribeEvent
    public static void onServerTick(ServerTickEvent.Post event) {
        if (++tickCounter % 1200 == 0) {
            RailwaySettings.refreshAsync();
        }
        if (tickCounter % 1200 == 600) {
            var server = net.neoforged.neoforge.server.ServerLifecycleHooks.getCurrentServer();
            if (server != null) {
                for (ServerPlayer player : server.getPlayerList().getPlayers()) {
                    OrderNotifier.refresh(player);
                }
            }
        }
    }

    @SubscribeEvent
    public static void onRightClickBlock(PlayerInteractEvent.RightClickBlock event) {
        BlockPos pos = event.getPos();
        BlockState state = event.getLevel().getBlockState(pos);
        boolean client = event.getLevel().isClientSide();

        if (CrhCompat.isTicketVendor(state)) {
            if (client) {
                event.setCanceled(true);
                event.setCancellationResult(InteractionResult.SUCCESS);
                return;
            }
            if (!(event.getEntity() instanceof ServerPlayer player)) return;
            boolean handled = handleVendor(player, event.getItemStack(), pos, state);
            if (handled) {
                event.setCanceled(true);
                event.setCancellationResult(InteractionResult.SUCCESS);
            }
            return;
        }

        if (CrhCompat.isGate(state)) {
            ItemStack stack = event.getItemStack();
            boolean ticketLike = stack.isEmpty() || TicketNbt.isIdCard(stack) || TicketNbt.hasTicket(stack) || CrhCompat.isVoucher(stack);
            boolean brush = CrhCompat.isCrhBrush(stack);
            if (!ticketLike && !brush) return;
            if (client) {
                event.setCanceled(true);
                event.setCancellationResult(InteractionResult.SUCCESS);
                return;
            }
            if (!(event.getEntity() instanceof ServerPlayer player)) return;
            boolean handled = handleGate(player, stack, pos, state);
            if (handled) {
                event.setCanceled(true);
                event.setCancellationResult(InteractionResult.SUCCESS);
            }
        }
    }

    private static boolean handleVendor(ServerPlayer player, ItemStack stack, BlockPos pos, BlockState state) {
        RailwayStore.CardData stored = RailwayStore.cardAt(player.level(), pos);
        if (TicketNbt.isIdCard(stack)) {
            String idNo = TicketNbt.idCardNumber(stack);
            if (idNo.isBlank()) {
                TicketNbt.writeIdentity(stack, player.getGameProfile().getName(),
                        qingjiang.railway.item.IdCardItem.generateId(player.getUUID()));
                idNo = TicketNbt.idCardNumber(stack);
            }
            RailwayStore.putCard(player.level(), pos, RailwayStore.CardData.fromStack(stack));
            stack.shrink(1);
            RailwayStore.save(player.getServer());
            openVendor(player, pos, state);
            return true;
        }
        if (stack.isEmpty()) {
            if (stored != null && player.isShiftKeyDown()) {
                ItemStack card = stored.toStack();
                if (!player.getInventory().add(card)) player.drop(card, false);
                RailwayStore.removeCard(player.level(), pos);
                RailwayStore.save(player.getServer());
                player.displayClientMessage(Component.literal("已取回身份证").withStyle(ChatFormatting.GREEN), true);
                return true;
            }
            if (stored != null) {
                openVendor(player, pos, state);
                return true;
            }
            player.displayClientMessage(Component.literal("请先用身份证右键售票机").withStyle(ChatFormatting.RED), true);
            return true;
        }
        player.displayClientMessage(Component.literal("请先用身份证右键售票机").withStyle(ChatFormatting.YELLOW), true);
        return false;
    }

    private static void openVendor(ServerPlayer player, BlockPos pos, BlockState state) {
        String station = CrhCompat.stationNameAt(player.level(), pos);
        RailwayStore.CardData card = RailwayStore.cardAt(player.level(), pos);
        String name = card == null ? "" : card.name;
        String idNo = card == null ? "" : card.idNo;
        Component title = Component.literal("TVM\u0001" + station + "\u0001" + name + "\u0001" + idNo);
        player.openMenu(new SimpleMenuProvider(
                (id, inventory, p) -> new RailwayVendorMenu(id, inventory), title));
    }

    private static boolean handleGate(ServerPlayer player, ItemStack stack, BlockPos pos, BlockState state) {
        if (CrhCompat.isCrhBrush(stack)) {
            RailwayStore.GateSetting setting = RailwayStore.gate(player.level(), pos, state);
            if (player.isShiftKeyDown()) {
                setting.disabled = !setting.disabled;
            } else {
                setting.type = (setting.type + 1) % 3;
            }
            RailwayStore.save(player.getServer());
            String message = setting.disabled ? "闸机已停用" : "闸机类型：" + GateLogic.typeName(setting.type);
            player.displayClientMessage(Component.literal(message).withStyle(ChatFormatting.AQUA), true);
            broadcast(player, pos, setting, message);
            return true;
        }
        boolean ticketLike = stack.isEmpty() || TicketNbt.isIdCard(stack) || TicketNbt.hasTicket(stack) || CrhCompat.isVoucher(stack);
        if (!ticketLike) return false;

        RailwayStore.GateSetting setting = RailwayStore.gate(player.level(), pos, state);
        String station = CrhCompat.stationNameAt(player.level(), pos);
        boolean reenter = false;
        if (setting.type == RailwayStore.GATE_ENTRY && TicketNbt.entryUsed(stack)
                && OrderGateSync.canReenter(stack)) {
            TicketNbt.clearEntry(stack);
            reenter = true;
        }
        GateLogic.Result result = GateLogic.validate(stack, setting.type, setting.disabled, station);
        if (result.allowed()) {
            String message = GateLogic.pass(stack, setting.type, station);
            if (reenter) message = "后台已取消检票，可重新进站 · " + message;
            GateLogic.notifyPlayer(player, message, true);
            if (setting.type == RailwayStore.GATE_ENTRY || setting.type == RailwayStore.GATE_CHECK) {
                OrderGateSync.markEntered(stack, OrderGateSync.passengerName(stack),
                        setting.type == RailwayStore.GATE_ENTRY ? "entry-gate" : "checkin-gate");
            }
            CrhCompat.openGate(player.level(), pos);
            RailwayStore.setGateMessage(player.level(), pos, setting, message, 6000L);
            broadcast(player, pos, setting, message);
        } else {
            GateLogic.notifyPlayer(player, result.message(), false);
            RailwayStore.setGateMessage(player.level(), pos, setting, result.message(), 6000L);
            broadcast(player, pos, setting, result.message());
        }
        return true;
    }

    private static void broadcast(ServerPlayer player, BlockPos pos, RailwayStore.GateSetting setting, String message) {
        // 用户要求取消闸机上方悬浮字，提示只走动作栏/聊天栏；这里保留空方法以兼容旧调用点。
    }
}
