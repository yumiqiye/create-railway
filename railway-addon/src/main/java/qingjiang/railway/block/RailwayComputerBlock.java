package qingjiang.railway.block;

import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import qingjiang.railway.StaffTerminal;

/** 铁路电脑方块：右击打开人工售票/收款终端。 */
public class RailwayComputerBlock extends Block {
    public RailwayComputerBlock(Properties properties) {
        super(properties);
    }

    @Override
    protected InteractionResult useWithoutItem(BlockState state, Level level, BlockPos pos, Player player, BlockHitResult hit) {
        if (!level.isClientSide && player instanceof ServerPlayer serverPlayer) {
            if (serverPlayer.hasPermissions(2)) {
                qingjiang.railway.StaffTerminal.open(serverPlayer, 0);
            } else {
                qingjiang.railway.PaymentAssist.request(serverPlayer);
            }
        }
        return InteractionResult.SUCCESS;
    }
}
