package qingjiang.railway;

import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.SimpleMenuProvider;
import qingjiang.railway.menu.StaffTerminalMenu;

/** 人工终端入口：电脑、POS、人工检票共用。 */
public final class StaffTerminal {
    private StaffTerminal() {}

    public static void open(ServerPlayer player, int mode) {
        String title = mode == 1 ? "手持 POS · 人工收款" : mode == 2 ? "人工检票机" : "铁路人工售票终端";
        player.openMenu(new SimpleMenuProvider(
                (id, inventory, p) -> new StaffTerminalMenu(id, inventory, mode),
                Component.literal("STAFF\u0001" + title + "\u0001" + mode)));
    }
}
