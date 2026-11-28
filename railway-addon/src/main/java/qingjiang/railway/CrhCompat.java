package qingjiang.railway;

import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import qingjiang.railway.block.RailwayGateBlock;

/**
 * 模组自带票务方块 / 物品识别辅助。
 * 所有判断都基于本模组注册名或物品实例。
 */
public final class CrhCompat {
    private CrhCompat() {}

    private static final ResourceLocation CREATE_WRENCH =
            ResourceLocation.fromNamespaceAndPath("create", "wrench");

    public static ResourceLocation blockId(BlockState state) {
        return BuiltInRegistries.BLOCK.getKey(state.getBlock());
    }

    public static ResourceLocation itemId(ItemStack stack) {
        return BuiltInRegistries.ITEM.getKey(stack.getItem());
    }

    public static boolean isTicketVendor(BlockState state) {
        return ModBlocks.TICKET_VENDOR.get().equals(state.getBlock());
    }

    public static boolean isGate(BlockState state) {
        return isGate(state.getBlock());
    }

    public static boolean isGate(Block block) {
        return ModBlocks.GATE_A.get().equals(block) || ModBlocks.GATE_B.get().equals(block);
    }

    /** B 型外观默认按出站闸机处理；A 型默认按进站闸机处理。仍可在设置中切换三模式。 */
    public static int defaultGateType(BlockState state) {
        return ModBlocks.GATE_B.get().equals(state.getBlock())
                ? RailwayStore.GATE_EXIT
                : RailwayStore.GATE_ENTRY;
    }

    public static boolean isVoucher(ItemStack stack) {
        if (stack.isEmpty()) return false;
        if (stack.is(ModItems.REIMBURSEMENT.get())) return true;
        return TicketNbt.isVoucher(stack);
    }

    /** 机械动力扳手：仅按物品注册名识别，未安装 Create 时恒为 false。 */
    public static boolean isWrench(ItemStack stack) {
        if (stack.isEmpty()) return false;
        return CREATE_WRENCH.equals(itemId(stack));
    }

    public static ItemStack newTicketStack() {
        return new ItemStack(ModItems.RAILWAY_TICKET.get());
    }

    public static String stationNameAt(net.minecraft.world.level.Level level, BlockPos pos) {
        RailwayStore.Station station = RailwayStore.stationAt(level, pos);
        return station == null ? "" : station.name;
    }

    public static boolean openGate(net.minecraft.world.level.Level level, BlockPos pos) {
        return RailwayGateBlock.openGate(level, pos);
    }
}
