package qingjiang.railway;

import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.SimpleMenuProvider;
import qingjiang.railway.menu.StaffTerminalMenu;

/** 人工终端入口：电脑、人工检票共用。 */
public final class StaffTerminal {
    private StaffTerminal() {}

    public static void open(ServerPlayer player, int mode) {
        open(player, mode, "");
    }

    public static void open(ServerPlayer player, int mode, String url) {
        String title = switch (mode) {
            case 2 -> "人工检票机";
            case 3 -> "车载调度屏";
            case 4 -> "手持平板 · 铁路网页";
            case 5 -> "世界电视 · 网页";
            default -> "铁路人工售票终端";
        };
        String targetUrl = url == null ? "" : url;
        player.openMenu(new SimpleMenuProvider(
                (id, inventory, p) -> new StaffTerminalMenu(id, inventory, mode),
                Component.literal("STAFF\u0001" + title + "\u0001" + mode + "\u0001" + targetUrl)));
    }
}
