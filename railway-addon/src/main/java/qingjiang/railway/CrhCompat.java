package qingjiang.railway;

import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.fml.ModList;

/** 只按注册名识别 CRH 的方块/物品，不引用 CRH 的 Java 类，因此附属可独立编译、独立发布。 */
public final class CrhCompat {
    public static final String CRH_MODID = "hexie";
    public static final ResourceLocation TICKET_VENDOR = ResourceLocation.fromNamespaceAndPath(CRH_MODID, "ticket_vendor");
    public static final ResourceLocation TURNSTILE_A = ResourceLocation.fromNamespaceAndPath(CRH_MODID, "turns_a_block");
    public static final ResourceLocation TURNSTILE_B = ResourceLocation.fromNamespaceAndPath(CRH_MODID, "turns_b_block");
    public static final ResourceLocation CRH_TICKET = ResourceLocation.fromNamespaceAndPath(CRH_MODID, "red_ticket");
    public static final ResourceLocation CRH_COUPON = ResourceLocation.fromNamespaceAndPath(CRH_MODID, "reimbursement");

    private CrhCompat() {}

    public static boolean crhLoaded() {
        return ModList.get() != null && ModList.get().isLoaded(CRH_MODID);
    }

    public static ResourceLocation blockId(BlockState state) {
        return BuiltInRegistries.BLOCK.getKey(state.getBlock());
    }

    public static ResourceLocation itemId(ItemStack stack) {
        return BuiltInRegistries.ITEM.getKey(stack.getItem());
    }

    public static boolean isTicketVendor(BlockState state) {
        return TICKET_VENDOR.equals(blockId(state));
    }

    public static boolean isGate(BlockState state) {
        ResourceLocation id = blockId(state);
        return CRH_MODID.equals(id.getNamespace()) && id.getPath().startsWith("turns_");
    }

    public static boolean isGate(Block block) {
        ResourceLocation id = BuiltInRegistries.BLOCK.getKey(block);
        return CRH_MODID.equals(id.getNamespace()) && id.getPath().startsWith("turns_");
    }

    /** CRH 的 turns_b 一般是出站/到达闸机，没有额外数据时按出站处理。 */
    public static int defaultGateType(BlockState state) {
        return TURNSTILE_B.equals(blockId(state)) ? RailwayStore.GATE_EXIT : RailwayStore.GATE_ENTRY;
    }

    public static boolean isCrhBrush(ItemStack stack) {
        ResourceLocation id = itemId(stack);
        return CRH_MODID.equals(id.getNamespace()) && id.getPath().contains("brush");
    }

    public static boolean isVoucher(ItemStack stack) {
        if (stack.isEmpty()) return false;
        if (stack.is(ModItems.REIMBURSEMENT.get())) return true;
        ResourceLocation id = itemId(stack);
        if (CRH_COUPON.equals(id)) return true;
        return TicketNbt.isVoucher(stack);
    }

    /** 车票物品：优先使用 CRH 的 red_ticket；CRH 缺失时退回附属自带车票。 */
    public static ItemStack newTicketStack() {
        Item crh = BuiltInRegistries.ITEM.get(CRH_TICKET);
        if (crh != Items.AIR) return new ItemStack(crh);
        return new ItemStack(ModItems.RAILWAY_TICKET.get());
    }

    public static String stationNameAt(net.minecraft.world.level.Level level, BlockPos pos) {
        RailwayStore.Station station = RailwayStore.stationAt(level, pos);
        return station == null ? "" : station.name;
    }

    /**
     * 真正让 CRH 闸机开门。CRH 的 TurnstileBlockEntity.tick() 在 timer>0 时把 open 设为 true，
     * 归零后自动关门，因此反射调用 setTimer(60) 与原生右键成功后的行为一致。
     */
    public static boolean openGate(net.minecraft.world.level.Level level, BlockPos pos) {
        if (level == null || pos == null) return false;
        BlockState state = level.getBlockState(pos);
        if (!isGate(state)) return false;
        var be = level.getBlockEntity(pos);
        if (be != null) {
            try {
                var method = be.getClass().getMethod("setTimer", int.class);
                method.invoke(be, RailwayConfig.gateOpenTicks());
                level.playSound(null, pos, net.minecraft.sounds.SoundEvents.IRON_DOOR_OPEN,
                        net.minecraft.sounds.SoundSource.BLOCKS, 0.9F, 1.0F);
                return true;
            } catch (ReflectiveOperationException ignored) {
                // 方法名可能随 CRH 版本变化，下面直接改 open 属性兜底
            }
        }
        for (var property : state.getProperties()) {
            if (property.getName().equals("open") && property.getValueClass() == Boolean.class) {
                @SuppressWarnings("unchecked")
                net.minecraft.world.level.block.state.properties.BooleanProperty openProp =
                        (net.minecraft.world.level.block.state.properties.BooleanProperty) property;
                level.setBlockAndUpdate(pos, state.setValue(openProp, true));
                level.playSound(null, pos, net.minecraft.sounds.SoundEvents.IRON_DOOR_OPEN,
                        net.minecraft.sounds.SoundSource.BLOCKS, 0.9F, 1.0F);
                return true;
            }
        }
        return false;
    }
}
