package qingjiang.railway;

import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

/** 支付货币：由配置决定物品与显示名，默认绿宝石，可改钻石等。 */
public final class RailwayCurrency {
    private RailwayCurrency() {}

    public static Item item() {
        Item item = BuiltInRegistries.ITEM.get(RailwayConfig.currencyItem());
        return item == Items.AIR ? Items.EMERALD : item;
    }

    public static String name() {
        return RailwayConfig.currencyName();
    }

    public static int needFor(Player player, String currency, double price) {
        int base = Math.max(1, (int) Math.ceil(price));
        return base * RailwayConfig.emeraldsPerUnit();
    }

    public static int count(Player player) {
        Item currency = item();
        int count = 0;
        for (int i = 0; i < player.getInventory().getContainerSize(); i++) {
            ItemStack stack = player.getInventory().getItem(i);
            if (!stack.isEmpty() && stack.is(currency)) count += stack.getCount();
        }
        return count;
    }

    public static boolean consume(Player player, int amount) {
        Item currency = item();
        int left = amount;
        for (int i = 0; i < player.getInventory().getContainerSize() && left > 0; i++) {
            ItemStack stack = player.getInventory().getItem(i);
            if (stack.isEmpty() || !stack.is(currency)) continue;
            int take = Math.min(left, stack.getCount());
            stack.shrink(take);
            left -= take;
        }
        player.getInventory().setChanged();
        return left <= 0;
    }

    public static String label(int amount) {
        return amount + " " + name();
    }
}
