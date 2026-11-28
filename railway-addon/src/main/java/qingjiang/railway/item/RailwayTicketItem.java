package qingjiang.railway.item;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.Item.TooltipContext;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;

import java.util.List;

/** 本模组自带铁路电子客票物品。 */
public class RailwayTicketItem extends Item {
    public RailwayTicketItem(Properties properties) {
        super(properties);
    }

    @Override
    public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> tooltip, TooltipFlag flag) {
        tooltip.add(Component.literal("铁路电子客票").withStyle(ChatFormatting.AQUA));
        String orderNo = qingjiang.railway.TicketNbt.orderNumber(stack);
        if (!orderNo.isBlank()) {
            tooltip.add(Component.literal("订单号：" + orderNo).withStyle(ChatFormatting.GRAY));
        }
    }
}
