package qingjiang.railway.menu;

import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.item.ItemStack;

/** 人工终端：电脑方块、手持 POS、人工检票机共用；mode 0=电脑 1=POS 2=检票。 */
public class StaffTerminalMenu extends AbstractContainerMenu {
    private final int mode;

    public StaffTerminalMenu(int id, Inventory inventory, int mode) {
        super(typeFor(mode), id);
        this.mode = mode;
    }

    private static MenuType<?> typeFor(int mode) {
        if (mode == 1) return qingjiang.railway.ModMenus.STAFF_POS.get();
        if (mode == 2) return qingjiang.railway.ModMenus.STAFF_CHECK.get();
        return qingjiang.railway.ModMenus.STAFF_COMPUTER.get();
    }

    public int mode() {
        return mode;
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
