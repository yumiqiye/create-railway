package qingjiang.railway;

import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredRegister;
import qingjiang.railway.block.GuideScreenBlock;
import qingjiang.railway.block.RailwayComputerBlock;

public final class ModBlocks {
    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(RailwayAddon.MOD_ID);

    public static final DeferredBlock<Block> COMPUTER = BLOCKS.registerBlock(
            "computer",
            RailwayComputerBlock::new,
            BlockBehaviour.Properties.of()
                    .strength(2.0F, 3.0F)
                    .sound(SoundType.METAL)
                    .requiresCorrectToolForDrops());

    public static final DeferredBlock<Block> GUIDE_SCREEN = BLOCKS.registerBlock(
            "guide_screen",
            GuideScreenBlock::new,
            BlockBehaviour.Properties.of()
                    .strength(2.0F, 3.0F)
                    .sound(SoundType.METAL)
                    .noOcclusion()
                    .requiresCorrectToolForDrops());

    private ModBlocks() {}
}
