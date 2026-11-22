package qingjiang.railway.menu;

import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.item.ItemStack;

/** 售票机界面容器：不存放槽位，所有数据走网页接口。 */
public class RailwayVendorMenu extends AbstractContainerMenu {
    public RailwayVendorMenu(int id, Inventory inventory) {
        super(qingjiang.railway.ModMenus.VENDOR.get(), id);
    }

    @Override
    public ItemStack quickMoveStack(Player player, int index) {
        return ItemStack.EMPTY;
    }

    @Override
    public boolean stillValid(Player player) {
        return true;
    }
}
