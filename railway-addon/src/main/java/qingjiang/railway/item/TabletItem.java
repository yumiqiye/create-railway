package qingjiang.railway.item;

import net.minecraft.core.BlockPos;
import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.CustomData;
import net.minecraft.world.level.Level;
import net.neoforged.neoforge.network.PacketDistributor;
import qingjiang.railway.StaffTerminal;
import qingjiang.railway.UrlConfigService;
import qingjiang.railway.network.UrlConfigPayload;

/** 手持平板：与世界电视一致，右键打开自定义网页终端，仅可手持；管理员潜行右键修改网页。 */
public class TabletItem extends Item {
    public TabletItem(Properties properties) {
        super(properties);
    }

    public static String url(ItemStack stack) {
        CompoundTag tag = stack.getOrDefault(DataComponents.CUSTOM_DATA, CustomData.EMPTY).copyTag();
        return tag.getString(UrlConfigService.URL_TAG);
    }

    @Override
    public InteractionResultHolder<ItemStack> use(Level level, Player player, InteractionHand hand) {
        ItemStack stack = player.getItemInHand(hand);
        if (level.isClientSide) return InteractionResultHolder.sidedSuccess(stack, true);
        if (player instanceof ServerPlayer serverPlayer) {
            if (serverPlayer.hasPermissions(2) && serverPlayer.isShiftKeyDown()) {
                PacketDistributor.sendToPlayer(serverPlayer,
                        new UrlConfigPayload(UrlConfigService.TARGET_TABLET, BlockPos.ZERO, url(stack)));
            } else {
                StaffTerminal.open(serverPlayer, 4, url(stack));
            }
        }
        return InteractionResultHolder.sidedSuccess(stack, false);
    }
}
