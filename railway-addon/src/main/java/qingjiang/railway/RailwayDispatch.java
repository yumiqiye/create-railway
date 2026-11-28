package qingjiang.railway;

import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.phys.Vec3;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

/** 调度室本地频道：同维度附近司机 / 调度员可见，后续可接网页后台消息记录。 */
public final class RailwayDispatch {
    private static final int RADIUS = 64;
    private static final int MAX_HISTORY = 30;
    private static final List<Message> MESSAGES = new ArrayList<>();
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm:ss");

    private RailwayDispatch() {}

    public record Message(String time, String sender, String text) {}

    public static List<Message> history() {
        return List.copyOf(MESSAGES);
    }

    public static void broadcast(ServerPlayer sender, String text) {
        String safeText = text == null ? "" : text.trim();
        if (safeText.isEmpty()) return;
        String time = LocalTime.now().format(TIME);
        MESSAGES.add(new Message(time, sender.getGameProfile().getName(), safeText));
        if (MESSAGES.size() > MAX_HISTORY) MESSAGES.remove(0);

        Vec3 origin = sender.position();
        Component component = Component.literal("[调度] " + sender.getGameProfile().getName() + "：" + safeText)
                .withStyle(net.minecraft.ChatFormatting.AQUA);
        for (ServerPlayer player : sender.server.getPlayerList().getPlayers()) {
            if (player.level() != sender.level()) continue;
            if (player.position().distanceTo(origin) <= RADIUS || player.hasPermissions(2)) {
                player.displayClientMessage(component, false);
            }
        }
    }
}
