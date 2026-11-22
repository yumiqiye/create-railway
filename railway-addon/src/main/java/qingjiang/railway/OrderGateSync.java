package qingjiang.railway;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import net.minecraft.world.item.ItemStack;

/** 闸机进站状态与网页后台同步：一票只能进站一次，后台取消检票后可重进。 */
public final class OrderGateSync {
    private OrderGateSync() {}

    /** 网页后台是否已取消该订单的检票；只有明确 false 才放行重进。 */
    public static boolean canReenter(ItemStack stack) {
        String orderNo = TicketNbt.orderNumber(stack);
        if (orderNo == null || orderNo.isBlank()) return false;
        try {
            JsonObject envelope = RailwayWeb.blockingGet("/railway/orders/" + ManualService.enc(orderNo), 3000);
            JsonObject order = RailwayWeb.data(envelope);
            return !RailwayWeb.b(order, "checkedIn", true);
        } catch (Exception ignored) {
            return false;
        }
    }

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
