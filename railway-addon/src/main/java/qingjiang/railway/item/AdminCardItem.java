package qingjiang.railway.item;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;

import java.util.List;

/** 管理员卡：右键任意闸机直接放行，不校验车票、身份证或票卡状态。 */
public class AdminCardItem extends Item {
    public AdminCardItem(Properties properties) {
        super(properties);
    }

    @Override
    public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> tooltip, TooltipFlag flag) {
        tooltip.add(Component.literal("管理员专用：右键任意闸机直接放行").withStyle(ChatFormatting.RED));
        tooltip.add(Component.literal("不校验车票、身份证或储值卡").withStyle(ChatFormatting.GRAY));
    }
}
