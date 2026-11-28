package qingjiang.railway;

import com.google.gson.JsonObject;
import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.CustomData;

/** 地铁单程票与储值卡的物品 NBT 结构。 */
public final class MetroNbt {
    public static final String CARD_INFO = "metroCard";
    public static final String TICKET_INFO = "metroTicket";

    private MetroNbt() {}

    public static CompoundTag copy(ItemStack stack) {
        return stack.getOrDefault(DataComponents.CUSTOM_DATA, CustomData.EMPTY).copyTag();
    }

    public static void set(ItemStack stack, CompoundTag tag) {
        stack.set(DataComponents.CUSTOM_DATA, CustomData.of(tag));
    }

    public static boolean isMetroCard(ItemStack stack) {
        return !stack.isEmpty() && copy(stack).contains(CARD_INFO);
    }

    public static boolean isMetroTicket(ItemStack stack) {
        return !stack.isEmpty() && copy(stack).contains(TICKET_INFO);
    }

    public static String cardNo(ItemStack stack) {
        return copy(stack).getCompound(CARD_INFO).getString("cardNo");
    }

    public static double balance(ItemStack stack) {
        return copy(stack).getCompound(CARD_INFO).getDouble("balance");
    }

    public static void writeCard(ItemStack stack, JsonObject card) {
        CompoundTag tag = copy(stack);
        CompoundTag info = new CompoundTag();
        info.putString("cardNo", RailwayWeb.str(card, "cardNo", ""));
        info.putString("playerName", RailwayWeb.str(card, "playerName", ""));
        info.putDouble("balance", card.has("balance") ? card.get("balance").getAsDouble() : 0);
        info.putDouble("deposit", card.has("deposit") ? card.get("deposit").getAsDouble() : 0);
        tag.put(CARD_INFO, info);
        set(stack, tag);
    }

    public static void writeTicket(ItemStack stack, JsonObject ticket) {
        CompoundTag tag = copy(stack);
        CompoundTag info = new CompoundTag();
        info.putString("ticketNo", RailwayWeb.str(ticket, "ticketNo", ""));
        info.putString("playerName", RailwayWeb.str(ticket, "playerName", ""));
        info.putString("fromStation", RailwayWeb.str(ticket, "fromStation", ""));
        info.putString("toStation", RailwayWeb.str(ticket, "toStation", ""));
        info.putDouble("fare", ticket.has("fare") ? ticket.get("fare").getAsDouble() : 0);
        info.putString("status", RailwayWeb.str(ticket, "status", "sold"));
        tag.put(TICKET_INFO, info);
        set(stack, tag);
    }
}
