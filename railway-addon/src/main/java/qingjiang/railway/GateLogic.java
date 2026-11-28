package qingjiang.railway;

import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/** 进站 / 检票 / 出站三类闸机的刷卡规则。 */
public final class GateLogic {
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm");

    private GateLogic() {}

    public record Result(boolean allowed, String message) {}

    public static Result validate(ItemStack stack, int gateType, boolean disabled, String stationName) {
        if (disabled) return new Result(false, "此闸机已停用，请联系工作人员");
        if (stack.isEmpty()) return new Result(false, "请刷身份证或车票");
        if (CrhCompat.isVoucher(stack)) return new Result(false, "报销凭证不能通过闸机，请使用车票或身份证");
        if (TicketNbt.isItinerary(stack)) return new Result(false, "行程信息单不能检票，请使用车票或身份证");

        if (!TicketNbt.hasTicket(stack)) {
            return new Result(false, "未读取到有效车票，请先在售票机购票");
        }
        if (TicketNbt.used(stack)) {
            return new Result(false, "车票已使用或已失效，请联系工作人员");
        }
        if (gateType == RailwayStore.GATE_CHECK) {
            if (TicketNbt.checkedIn(stack)) {
                return new Result(false, "该票已检票，不能重复检票");
            }
            long departure = TicketNbt.departureTime(stack);
            long start = departure > 0
                    ? departure - RailwaySettings.checkinMinutes() * 60_000L
                    : TicketNbt.checkinStart(stack);
            long now = System.currentTimeMillis();
            if (start > 0 && now < start) {
                return new Result(false, "不在开检时间（" + format(start) + " 开始检票）");
            }
            if (departure > 0 && now > departure + 10 * 60_000L) {
                return new Result(false, "已停止检票，请联系工作人员");
            }
            if (start == 0 && departure == 0) {
                return new Result(false, "车票缺少开检时间，请联系工作人员");
            }
        }
        if (gateType == RailwayStore.GATE_EXIT) {
            String entered = TicketNbt.enteredStation(stack);
            if (entered == null || entered.isBlank()) {
                return new Result(false, "请联系工作人员（无进站记录）");
            }
        }
        // 进站闸机允许同一张票重复刷入；仅排除已出站 / 已失效车票。
        return new Result(true, "");
    }

    /** 放行后写入状态；返回给玩家的成功提示。 */
    public static String pass(ItemStack stack, int gateType, String stationName) {
        if (gateType == RailwayStore.GATE_ENTRY) {
            TicketNbt.markEntry(stack, stationName);
            return "进站成功 · " + TicketNbt.trainName(stack) + " · " + TicketNbt.fromStation(stack) + " → " + TicketNbt.toStation(stack);
        }
        if (gateType == RailwayStore.GATE_CHECK) {
            TicketNbt.markCheckin(stack);
            return "检票成功 · " + TicketNbt.trainName(stack) + " · " + TicketNbt.fromStation(stack) + " → " + TicketNbt.toStation(stack);
        }
        TicketNbt.markUsed(stack);
        return "出站成功 · 欢迎下次乘坐" + RailwaySettings.systemName();
    }

    public static void notifyPlayer(Player player, String message, boolean success) {
        player.displayClientMessage(
                Component.literal(message).withStyle(success ? net.minecraft.ChatFormatting.GREEN : net.minecraft.ChatFormatting.RED),
                true);
    }

    public static String typeName(int type) {
        return type == RailwayStore.GATE_CHECK ? "检票闸机" : type == RailwayStore.GATE_EXIT ? "出站闸机" : "进站闸机";
    }

    private static String format(long millis) {
        return LocalDateTime.ofInstant(Instant.ofEpochMilli(millis), ZoneId.systemDefault()).format(TIME);
    }
}
