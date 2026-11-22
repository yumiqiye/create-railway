package qingjiang.railway.item;

import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import qingjiang.railway.StaffTerminal;

/** 人工检票机：右击输入身份证号或订单号，人工放行。 */
public class ManualCheckItem extends Item {
    public ManualCheckItem(Properties properties) {
        super(properties);
    }

    @Override
    public InteractionResultHolder<ItemStack> use(Level level, Player player, InteractionHand hand) {
        if (!level.isClientSide && player instanceof ServerPlayer serverPlayer) {
            if (!serverPlayer.hasPermissions(2)) {
                serverPlayer.displayClientMessage(net.minecraft.network.chat.Component.literal("人工检票机仅限工作人员使用")
                        .withStyle(net.minecraft.ChatFormatting.RED), true);
                return InteractionResultHolder.fail(player.getItemInHand(hand));
            }
            StaffTerminal.open(serverPlayer, 2);
        }
        return InteractionResultHolder.sidedSuccess(player.getItemInHand(hand), level.isClientSide);
    }
}
