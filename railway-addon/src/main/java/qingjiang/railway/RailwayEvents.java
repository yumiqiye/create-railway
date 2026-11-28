package qingjiang.railway;

import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import qingjiang.railway.ModItems;
import qingjiang.railway.dispatch.DispatchConfig;
import qingjiang.railway.dispatch.DispatchService;
import qingjiang.railway.dispatch.DispatchSyncNet;
import qingjiang.railway.menu.RailwayVendorMenu;

import java.nio.file.Path;

/** 方块交互、闸机刷卡、设置同步全部通过 NeoForge 事件完成。 */
public final class RailwayEvents {
    private static int tickCounter = 0;

    private RailwayEvents() {}

    @SubscribeEvent
    public static void onServerStarted(ServerStartedEvent event) {
        EmbeddedWebService.startIfEnabled();
        RailwayStore.load(event.getServer());
        RailwaySettings.refreshAsync();
        RailwayStore.refreshRemoteAsync();
        RailwayStore.refreshDeviceConfigAsync();

        Path dispatchDir = FMLPaths.CONFIGDIR.get().resolve("railway_plus");
        DispatchService.CONFIG = DispatchConfig.load(dispatchDir.resolve("dispatch.json"));
        DispatchService.SERVICE = new DispatchService(DispatchService.CONFIG);
        DispatchService.SERVICE.startWeb();
    }

    @SubscribeEvent
    public static void onServerStopping(ServerStoppingEvent event) {
        RailwayStore.save(event.getServer());
        RailwayStore.unload();
        EmbeddedWebService.stop();
        if (DispatchService.SERVICE != null) {
            DispatchService.SERVICE.stop();
            DispatchService.CONFIG.save();
            DispatchService.SERVICE = null;
            DispatchService.CONFIG = null;
        }
    }

    @SubscribeEvent
    public static void onPlayerLoggedOut(PlayerEvent.PlayerLoggedOutEvent event) {
        DispatchSyncNet.onPlayerLeave(event.getEntity().getUUID());
    }

    @SubscribeEvent
    public static void onClientLogin(ClientPlayerNetworkEvent.LoggingIn event) {
        DispatchSyncNet.sendSubscribe();
    }

    @SubscribeEvent
    public static void onClientLogout(ClientPlayerNetworkEvent.LoggingOut event) {
        if (DispatchService.SERVICE != null) DispatchService.SERVICE.clearRemote();
    }

    @SubscribeEvent
    public static void onServerTick(ServerTickEvent.Post event) {
        if (++tickCounter % 1200 == 0) {
            RailwaySettings.refreshAsync();
            RailwayStore.refreshRemoteAsync();
            RailwayStore.refreshDeviceConfigAsync();
        }
        var server = net.neoforged.neoforge.server.ServerLifecycleHooks.getCurrentServer();
        if (server != null) {
            for (ServerPlayer player : server.getPlayerList().getPlayers()) {
                if (tickCounter % 1200 == 600) {
                    OrderNotifier.refresh(player);
                }
            }
            if (DispatchService.SERVICE != null) DispatchService.SERVICE.onEndTick(server);
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
            if (stack.is(ModItems.ADMIN_CARD.get())) {
                if (client) {
                    event.setCanceled(true);
                    event.setCancellationResult(InteractionResult.SUCCESS);
                    return;
                }
                if (!(event.getEntity() instanceof ServerPlayer player)) return;
                if (!isAdmin(player)) {
                    player.displayClientMessage(Component.literal("管理员闸机卡仅限工作人员使用")
                            .withStyle(ChatFormatting.RED), true);
                    event.setCanceled(true);
                    event.setCancellationResult(InteractionResult.FAIL);
                    return;
                }
                RailwayStore.GateSetting setting = RailwayStore.gate(player.level(), pos, state);
                CrhCompat.openGate(player.level(), pos);
                String message = "管理员卡放行";
                RailwayStore.setGateMessage(player.level(), pos, setting, message, 6000L);
                player.displayClientMessage(Component.literal(message).withStyle(ChatFormatting.GREEN), true);
                broadcast(player, pos, setting, message);
                event.setCanceled(true);
                event.setCancellationResult(InteractionResult.SUCCESS);
                return;
            }
            boolean ticketLike = stack.isEmpty() || TicketNbt.isIdCard(stack) || TicketNbt.hasTicket(stack)
                    || CrhCompat.isVoucher(stack) || CrhCompat.isWrench(stack);
            if (!ticketLike && !isAdmin(event.getEntity())) return;
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
        RailwayStore.VendorSetting vendor = RailwayStore.vendor(player.level(), pos);
        if ("disabled".equals(vendor.status)) {
            player.displayClientMessage(Component.literal("该购票机已停用，请联系工作人员")
                    .withStyle(ChatFormatting.RED), true);
            return true;
        }
        if ("maintenance".equals(vendor.status)) {
            player.displayClientMessage(Component.literal("该购票机正在维护，暂不可用")
                    .withStyle(ChatFormatting.YELLOW), true);
            return true;
        }
        RailwayStore.CardData stored = RailwayStore.cardAt(player.level(), pos);
        if (MetroNbt.isMetroCard(stack)) {
            if (stored != null && !stored.metroCardSnbt.isBlank()) {
                player.displayClientMessage(Component.literal("售票机内已有地铁卡，请先 Shift+右键取出")
                        .withStyle(ChatFormatting.YELLOW), true);
                return true;
            }
            RailwayStore.CardData data = stored == null ? new RailwayStore.CardData() : stored;
            data.updateMetroCardFrom(stack);
            RailwayStore.putCard(player.level(), pos, data);
            stack.shrink(1);
            RailwayStore.save(player.getServer());
            player.displayClientMessage(Component.literal("地铁卡已识别，再次右键售票机即可打开窗口")
                    .withStyle(ChatFormatting.AQUA), true);
            return true;
        }
        if (TicketNbt.isIdCard(stack)) {
            String idNo = TicketNbt.idCardNumber(stack);
            if (idNo.isBlank()) {
                TicketNbt.writeIdentity(stack, player.getGameProfile().getName(),
                        qingjiang.railway.item.IdCardItem.generateId(player.getUUID()));
                idNo = TicketNbt.idCardNumber(stack);
            }
            RailwayStore.CardData data = stored == null ? new RailwayStore.CardData() : stored;
            RailwayStore.CardData identity = RailwayStore.CardData.fromStack(stack);
            data.name = identity.name;
            data.idNo = identity.idNo;
            data.ticketSnbt = identity.ticketSnbt;
            RailwayStore.putCard(player.level(), pos, data);
            stack.shrink(1);
            RailwayStore.save(player.getServer());
            player.displayClientMessage(Component.literal("身份证已识别，再次右键售票机即可打开窗口")
                    .withStyle(ChatFormatting.AQUA), true);
            return true;
        }
        if (stack.isEmpty()) {
            if (stored != null && player.isShiftKeyDown()) {
                if (!stored.metroCardSnbt.isBlank()) {
                    ItemStack metro = stored.toMetroStack();
                    stored.metroCardSnbt = "";
                    if (stored.name.isBlank() && stored.idNo.isBlank() && stored.ticketSnbt.isBlank()) {
                        RailwayStore.removeCard(player.level(), pos);
                    } else {
                        RailwayStore.putCard(player.level(), pos, stored);
                    }
                    if (!player.getInventory().add(metro)) player.drop(metro, false);
                    RailwayStore.save(player.getServer());
                    player.displayClientMessage(Component.literal("已取回地铁卡").withStyle(ChatFormatting.GREEN), true);
                    return true;
                }
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
            player.displayClientMessage(Component.literal("请先用身份证或地铁卡右键售票机").withStyle(ChatFormatting.RED), true);
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
        String metroCardNo = "";
        String metroBalance = "";
        if (card != null && !card.metroCardSnbt.isBlank()) {
            ItemStack metro = card.toMetroStack();
            if (MetroNbt.isMetroCard(metro)) {
                metroCardNo = MetroNbt.cardNo(metro);
                metroBalance = String.valueOf(MetroNbt.balance(metro));
            }
        }
        Component title = Component.literal("TVM\u0001" + station + "\u0001" + name + "\u0001" + idNo
                + "\u0001" + metroCardNo + "\u0001" + metroBalance);
        player.openMenu(new SimpleMenuProvider(
                (id, inventory, p) -> new RailwayVendorMenu(id, inventory), title));
    }

    private static boolean handleGate(ServerPlayer player, ItemStack stack, BlockPos pos, BlockState state) {
        if (isAdmin(player) && CrhCompat.isWrench(stack)) {
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
        if (!ticketLike || CrhCompat.isWrench(stack)) return false;

        RailwayStore.GateSetting setting = RailwayStore.gate(player.level(), pos, state);
        String station = CrhCompat.stationNameAt(player.level(), pos);
        GateLogic.Result result = GateLogic.validate(stack, setting.type, setting.disabled, station);
        if (result.allowed()) {
            String message = GateLogic.pass(stack, setting.type, station);
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

    private static boolean isAdmin(Player player) {
        return player instanceof ServerPlayer serverPlayer && serverPlayer.hasPermissions(2);
    }

    private static void broadcast(ServerPlayer player, BlockPos pos, RailwayStore.GateSetting setting, String message) {
        // 用户要求取消闸机上方悬浮字，提示只走动作栏/聊天栏；这里保留空方法以兼容旧调用点。
    }
}
