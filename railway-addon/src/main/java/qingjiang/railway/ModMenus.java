package qingjiang.railway;

import net.minecraft.core.registries.Registries;
import net.minecraft.world.flag.FeatureFlags;
import net.minecraft.world.inventory.MenuType;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;
import qingjiang.railway.menu.RailwayVendorMenu;
import qingjiang.railway.menu.StaffTerminalMenu;

/**
 * 人工终端的模式不使用网络 buffer（原版开屏包不带额外数据，buffer 在客户端为 null）。
 * 因此拆成电脑/检票两个菜单类型，各自固定模式。
 */
public final class ModMenus {
    public static final DeferredRegister<MenuType<?>> MENUS =
            DeferredRegister.create(Registries.MENU, RailwayAddon.MOD_ID);

    public static final DeferredHolder<MenuType<?>, MenuType<RailwayVendorMenu>> VENDOR =
            MENUS.register("railway_vendor", () -> new MenuType<>(
                    (id, inventory) -> new RailwayVendorMenu(id, inventory), FeatureFlags.VANILLA_SET));

    public static final DeferredHolder<MenuType<?>, MenuType<StaffTerminalMenu>> STAFF_COMPUTER =
            MENUS.register("staff_computer", () -> new MenuType<>(
                    (id, inventory) -> new StaffTerminalMenu(id, inventory, 0), FeatureFlags.VANILLA_SET));

    public static final DeferredHolder<MenuType<?>, MenuType<StaffTerminalMenu>> STAFF_CHECK =
            MENUS.register("staff_check", () -> new MenuType<>(
                    (id, inventory) -> new StaffTerminalMenu(id, inventory, 2), FeatureFlags.VANILLA_SET));

    private ModMenus() {}
}
