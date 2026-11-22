package qingjiang.railway.item;

import net.minecraft.ChatFormatting;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.Item.TooltipContext;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import qingjiang.railway.TicketNbt;

import java.util.List;

/** 报销凭证：只用于报销；tooltip 直接显示订单车次和区间。 */
public class ReimbursementItem extends Item {
    public ReimbursementItem(Properties properties) {
        super(properties);
    }

    @Override
    public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> tooltip, TooltipFlag flag) {
        CompoundTag tag = TicketNbt.copy(stack);
        CompoundTag info = tag.getCompound(TicketNbt.TICKET_INFO);
        CompoundTag station = tag.getCompound(TicketNbt.STATION_INFO);
        String trainNo = info.getString("trainNo");
        String from = station.getString("from");
        String to = station.getString("to");
        if (trainNo.isBlank() && from.isBlank() && to.isBlank()) {
            tooltip.add(Component.literal("空的报销凭证").withStyle(ChatFormatting.GRAY));
            return;
        }
        String train = info.getString("trainName");
        if (train.isBlank()) train = trainNo;
        tooltip.add(Component.literal("报销凭证").withStyle(ChatFormatting.GOLD));
        tooltip.add(Component.literal(train + " " + from + "->" + to).withStyle(ChatFormatting.WHITE));
        String date = info.getString("date");
        String depart = info.getString("departTime");
        if (!date.isBlank() || !depart.isBlank()) {
            tooltip.add(Component.literal((date + " " + depart).trim()).withStyle(ChatFormatting.GRAY));
        }
        String passenger = tag.getCompound(TicketNbt.PASSENGER_INFO).getString("name");
        String orderNo = info.getString("orderNo");
        if (!passenger.isBlank() || !orderNo.isBlank()) {
            tooltip.add(Component.literal((passenger + "  " + orderNo).trim()).withStyle(ChatFormatting.DARK_GRAY));
        }
    }
}
