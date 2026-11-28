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

/** 车载调度屏：工作人员右击打开调度终端；普通玩家暂不开放。 */
public class DispatchScreenBlock extends Block {
    public DispatchScreenBlock(Properties properties) {
        super(properties);
    }

    @Override
    protected InteractionResult useWithoutItem(BlockState state, Level level, BlockPos pos, Player player, BlockHitResult hit) {
        if (!level.isClientSide && player instanceof ServerPlayer serverPlayer) {
            if (serverPlayer.hasPermissions(2)) {
                StaffTerminal.open(serverPlayer, 3);
            } else {
                serverPlayer.displayClientMessage(net.minecraft.network.chat.Component.literal("车载调度屏仅限工作人员使用")
                        .withStyle(net.minecraft.ChatFormatting.RED), true);
            }
        }
        return InteractionResult.SUCCESS;
    }
}
