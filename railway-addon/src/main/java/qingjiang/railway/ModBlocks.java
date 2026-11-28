package qingjiang.railway;

import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredRegister;
import qingjiang.railway.block.DispatchScreenBlock;
import qingjiang.railway.block.GuideScreenBlock;
import qingjiang.railway.block.RailwayComputerBlock;
import qingjiang.railway.block.RailwayGateBlock;
import qingjiang.railway.block.RailwayTvBlock;
import qingjiang.railway.block.RailwayVendorBlock;
import qingjiang.railway.block.VehicleDisplayBlock;

public final class ModBlocks {
    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(RailwayAddon.MOD_ID);

    public static final DeferredBlock<Block> COMPUTER = BLOCKS.registerBlock(
            "computer",
            RailwayComputerBlock::new,
            BlockBehaviour.Properties.of()
                    .strength(2.0F, 3.0F)
                    .sound(SoundType.METAL)
                    .requiresCorrectToolForDrops());

    public static final DeferredBlock<Block> TICKET_VENDOR = BLOCKS.registerBlock(
            "ticket_vendor",
            RailwayVendorBlock::new,
            BlockBehaviour.Properties.of()
                    .strength(2.0F, 3.0F)
                    .sound(SoundType.METAL)
                    .noOcclusion()
                    .requiresCorrectToolForDrops());

    public static final DeferredBlock<Block> GATE_A = BLOCKS.registerBlock(
            "gate_a",
            RailwayGateBlock::new,
            BlockBehaviour.Properties.of()
                    .strength(2.0F, 3.0F)
                    .sound(SoundType.METAL)
                    .noOcclusion()
                    .requiresCorrectToolForDrops());

    public static final DeferredBlock<Block> GATE_B = BLOCKS.registerBlock(
            "gate_b",
            RailwayGateBlock::new,
            BlockBehaviour.Properties.of()
                    .strength(2.0F, 3.0F)
                    .sound(SoundType.METAL)
                    .noOcclusion()
                    .requiresCorrectToolForDrops());

    public static final DeferredBlock<Block> GUIDE_SCREEN = BLOCKS.registerBlock(
            "guide_screen",
            GuideScreenBlock::new,
            BlockBehaviour.Properties.of()
                    .strength(2.0F, 3.0F)
                    .sound(SoundType.METAL)
                    .noOcclusion()
                    .requiresCorrectToolForDrops());

    public static final DeferredBlock<Block> TV = BLOCKS.registerBlock(
            "tv",
            RailwayTvBlock::new,
            BlockBehaviour.Properties.of()
                    .strength(2.0F, 3.0F)
                    .sound(SoundType.METAL)
                    .noOcclusion()
                    .requiresCorrectToolForDrops());

    public static final DeferredBlock<Block> VEHICLE_DISPLAY = BLOCKS.registerBlock(
            "vehicle_display",
            VehicleDisplayBlock::new,
            BlockBehaviour.Properties.of()
                    .strength(2.0F, 3.0F)
                    .sound(SoundType.METAL)
                    .noOcclusion()
                    .requiresCorrectToolForDrops());

    public static final DeferredBlock<Block> DISPATCH_SCREEN = BLOCKS.registerBlock(
            "dispatch_screen",
            DispatchScreenBlock::new,
            BlockBehaviour.Properties.of()
                    .strength(2.0F, 3.0F)
                    .sound(SoundType.METAL)
                    .noOcclusion()
                    .requiresCorrectToolForDrops());

    private ModBlocks() {}
}
