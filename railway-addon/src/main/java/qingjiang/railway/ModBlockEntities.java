package qingjiang.railway;

import net.minecraft.core.registries.Registries;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.neoforged.neoforge.registries.DeferredRegister;
import qingjiang.railway.block.GuideScreenBlockEntity;

import java.util.function.Supplier;

/** 方块实体注册。 */
public final class ModBlockEntities {
    public static final DeferredRegister<BlockEntityType<?>> BLOCK_ENTITIES =
            DeferredRegister.create(Registries.BLOCK_ENTITY_TYPE, RailwayAddon.MOD_ID);

    public static final Supplier<BlockEntityType<GuideScreenBlockEntity>> GUIDE_SCREEN =
            BLOCK_ENTITIES.register("guide_screen", () -> BlockEntityType.Builder
                    .of(GuideScreenBlockEntity::new, ModBlocks.GUIDE_SCREEN.get())
                    .build(null));

    private ModBlockEntities() {}
}
