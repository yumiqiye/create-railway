package qingjiang.railway;

import com.google.gson.JsonObject;
import net.minecraft.world.item.ItemStack;

/** 闸机通过状态与网页后台同步；进站允许重复刷入，检票 / 出站以本地票据标记为准。 */
public final class OrderGateSync {
    private OrderGateSync() {}

    /** 进站成功后把检票状态回写网页后台。 */
    public static void markEntered(ItemStack stack, String passengerName, String mode) {
        String orderNo = TicketNbt.orderNumber(stack);
        if (orderNo == null || orderNo.isBlank()) return;
        JsonObject body = new JsonObject();
        body.addProperty("idNo", passengerIdNo(stack));
        body.addProperty("name", passengerName);
        body.addProperty("mode", mode);
        RailwayWeb.postAsync("/railway/orders/" + ManualService.enc(orderNo) + "/checkin", body,
                result -> {
                }, error -> RailwayAddon.LOGGER.warn("回写检票状态失败 {}：{}", orderNo, error));
    }

    public static String passengerName(ItemStack stack) {
        String name = TicketNbt.copy(stack).getCompound(TicketNbt.PASSENGER_INFO).getString("name");
        return name.isBlank() ? "" : name;
    }

    public static String passengerIdNo(ItemStack stack) {
        String idNo = TicketNbt.copy(stack).getCompound(TicketNbt.PASSENGER_INFO).getString("idNo");
        return idNo.isBlank() ? TicketNbt.idCardNumber(stack) : idNo;
    }
}
