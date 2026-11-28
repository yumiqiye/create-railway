package qingjiang.railway.block;

import com.mojang.serialization.MapCodec;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.minecraft.world.level.block.state.properties.BooleanProperty;
import net.minecraft.world.level.block.state.properties.EnumProperty;
import net.minecraft.util.RandomSource;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.Shapes;
import net.minecraft.world.phys.shapes.VoxelShape;
import qingjiang.railway.RailwayConfig;

/** 模组自带闸机方块：外观保留原 CRH 两类闸机，逻辑仍支持进站 / 检票 / 出站三模式。 */
public class RailwayGateBlock extends Block {
    public static final BooleanProperty OPEN = BlockStateProperties.OPEN;
    public static final EnumProperty<Direction> FACING = BlockStateProperties.HORIZONTAL_FACING;

    public RailwayGateBlock(Properties properties) {
        super(properties);
        registerDefaultState(stateDefinition.any()
                .setValue(FACING, Direction.NORTH)
                .setValue(OPEN, false));
    }

    /** 像素(0~16)换算为方块坐标(0~1)的系数。 */
    private static final double P = 1.0 / 16.0;

    /** 固定箱体：两侧立柱/机身，无论开关都保留碰撞。 */
    private static VoxelShape fixedShape(Direction facing) {
        if (facing.getAxis() == Direction.Axis.Z) {
            return Shapes.or(
                    Shapes.box(0, 0, 0, 3.5 * P, 14 * P, 1),
                    Shapes.box(12.5 * P, 0, 0, 1, 14 * P, 1));
        }
        return Shapes.or(
                Shapes.box(0, 0, 0, 1, 14 * P, 3.5 * P),
                Shapes.box(0, 0, 12.5 * P, 1, 14 * P, 1));
    }

    /** 活动门栏：关闭时横在通道中间阻挡，放行后随 OPEN 消失。 */
    private static VoxelShape gateBarShape(Direction facing) {
        if (facing.getAxis() == Direction.Axis.Z) {
            return Shapes.box(3.5 * P, 5 * P, 9.25 * P, 12.5 * P, 10 * P, 9.75 * P);
        }
        return Shapes.box(9.25 * P, 5 * P, 3.5 * P, 9.75 * P, 10 * P, 12.5 * P);
    }

    private static VoxelShape shape(BlockState state) {
        Direction facing = state.getValue(FACING);
        VoxelShape fixed = fixedShape(facing);
        return state.getValue(OPEN) ? fixed : Shapes.or(fixed, gateBarShape(facing));
    }

    @Override
    protected MapCodec<? extends Block> codec() {
        return simpleCodec(RailwayGateBlock::new);
    }

    @Override
    protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
        builder.add(FACING, OPEN);
    }

    @Override
    public BlockState getStateForPlacement(BlockPlaceContext context) {
        return defaultBlockState().setValue(FACING, context.getHorizontalDirection().getOpposite());
    }

    public static boolean openGate(Level level, BlockPos pos) {
        BlockState state = level.getBlockState(pos);
        if (!(state.getBlock() instanceof RailwayGateBlock)) return false;
        if (!state.getValue(OPEN)) {
            level.setBlock(pos, state.setValue(OPEN, true), 3);
        }
        level.playSound(null, pos, SoundEvents.IRON_DOOR_OPEN, SoundSource.BLOCKS, 0.9F, 1.0F);
        level.scheduleTick(pos, state.getBlock(), RailwayConfig.gateOpenTicks());
        return true;
    }

    @Override
    public VoxelShape getCollisionShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return shape(state);
    }

    @Override
    public VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext context) {
        return shape(state);
    }

    @Override
    protected void tick(BlockState state, ServerLevel level, BlockPos pos, RandomSource random) {
        if (state.getValue(OPEN)) {
            level.setBlock(pos, state.setValue(OPEN, false), 3);
        }
    }
}
