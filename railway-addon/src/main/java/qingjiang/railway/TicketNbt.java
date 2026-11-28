package qingjiang.railway;

import com.google.gson.JsonObject;
import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.CustomData;

import java.time.LocalDateTime;
import java.time.ZoneId;

/** 车票/身份证共用的 NBT 结构；全部写在 minecraft:custom_data 里。 */
public final class TicketNbt {
    public static final String TICKET_INFO = "ticketInfo";
    public static final String STATION_INFO = "stationInfo";
    public static final String PASSENGER_INFO = "passengerInfo";
    public static final String ID_INFO = "idInfo";
    public static final String TICKET = "ticket";
    public static final String ENTERED_STATION = "enteredStation";
    public static final String ENTRY_USED = "entryUsed";
    public static final String CHECKED_IN = "checkedIn";
    public static final String USED = "used";
    public static final String VOUCHER = "voucher";
    public static final String ITINERARY = "itinerary";

    private TicketNbt() {}

    public static CompoundTag copy(ItemStack stack) {
        return stack.getOrDefault(DataComponents.CUSTOM_DATA, CustomData.EMPTY).copyTag();
    }

    public static void set(ItemStack stack, CompoundTag tag) {
        stack.set(DataComponents.CUSTOM_DATA, CustomData.of(tag));
    }

    public static boolean isIdCard(ItemStack stack) {
        return !stack.isEmpty() && stack.is(ModItems.ID_CARD.get());
    }

    public static boolean isVoucher(ItemStack stack) {
        return copy(stack).getBoolean(VOUCHER);
    }

    public static String orderNumber(ItemStack stack) {
        return copy(stack).getCompound(TICKET_INFO).getString("orderNo");
    }

    public static String idCardName(ItemStack stack) {
        return copy(stack).getCompound(ID_INFO).getString("name");
    }

    public static String idCardNumber(ItemStack stack) {
        return copy(stack).getCompound(ID_INFO).getString("idNo");
    }

    public static void writeIdentity(ItemStack card, String name, String idNo) {
        CompoundTag tag = copy(card);
        CompoundTag info = new CompoundTag();
        info.putString("name", name);
        info.putString("idNo", idNo);
        tag.put(ID_INFO, info);
        set(card, tag);
    }

    public static void writeTicket(ItemStack ticket, JsonObject order, String passengerName, String idNo) {
        CompoundTag tag = copy(ticket);
        CompoundTag info = new CompoundTag();
        info.putString("orderNo", RailwayWeb.str(order, "orderNo", ""));
        info.putString("trainNo", RailwayWeb.str(order, "trainNo", ""));
        info.putString("trainName", RailwayWeb.str(order, "trainName", RailwayWeb.str(order, "trainNo", "")));
        info.putString("date", RailwayWeb.str(order, "date", ""));
        info.putString("departTime", RailwayWeb.str(order, "departTime", ""));
        info.putString("checkinStart", RailwayWeb.str(order, "checkinStart", ""));
        info.putDouble("price", order.has("price") ? order.get("price").getAsDouble() : 0.0);
        info.putString("currency", RailwayWeb.str(order, "currency", "emerald"));
        info.putString("seatType", RailwayWeb.str(order, "seat", RailwayWeb.str(order, "seatType", "")));
        info.putString("seatNo", RailwayWeb.str(order, "seatNo", ""));
        info.putString("passengerType", RailwayWeb.str(order, "passengerType", "成人"));
        tag.put(TICKET_INFO, info);

        CompoundTag station = new CompoundTag();
        station.putString("from", RailwayWeb.str(order, "fromStationName", ""));
        station.putString("to", RailwayWeb.str(order, "toStationName", ""));
        tag.put(STATION_INFO, station);

        CompoundTag passenger = new CompoundTag();
        passenger.putString("name", passengerName);
        passenger.putString("idNo", idNo);
        tag.put(PASSENGER_INFO, passenger);
        set(ticket, tag);
    }

    public static void writeVoucher(ItemStack voucher, JsonObject order, String passengerName, String idNo) {
        CompoundTag tag = copy(voucher);
        tag.putBoolean(VOUCHER, true);
        tag.putString("orderNo", RailwayWeb.str(order, "orderNo", ""));
        tag.putString("trainNo", RailwayWeb.str(order, "trainNo", ""));
        tag.putString("passengerName", passengerName);
        tag.putString("idNo", idNo);

        CompoundTag info = new CompoundTag();
        info.putString("orderNo", RailwayWeb.str(order, "orderNo", ""));
        info.putString("trainNo", RailwayWeb.str(order, "trainNo", ""));
        info.putString("trainName", RailwayWeb.str(order, "trainName", RailwayWeb.str(order, "trainNo", "")));
        info.putString("date", RailwayWeb.str(order, "date", ""));
        info.putString("departTime", RailwayWeb.str(order, "departTime", ""));
        info.putString("seatType", RailwayWeb.str(order, "seat", RailwayWeb.str(order, "seatType", "")));
        info.putString("seatNo", RailwayWeb.str(order, "seatNo", ""));
        info.putDouble("price", order.has("price") ? order.get("price").getAsDouble() : 0.0);
        info.putString("currency", RailwayWeb.str(order, "currency", "emerald"));
        info.putString("seatType", RailwayWeb.str(order, "seat", RailwayWeb.str(order, "seatType", "")));
        info.putString("seatNo", RailwayWeb.str(order, "seatNo", ""));
        info.putString("passengerType", RailwayWeb.str(order, "passengerType", "成人"));
        tag.put(TICKET_INFO, info);

        CompoundTag station = new CompoundTag();
        station.putString("from", RailwayWeb.str(order, "fromStationName", ""));
        station.putString("to", RailwayWeb.str(order, "toStationName", ""));
        tag.put(STATION_INFO, station);

        CompoundTag passenger = new CompoundTag();
        passenger.putString("name", passengerName);
        passenger.putString("idNo", idNo);
        tag.put(PASSENGER_INFO, passenger);
        set(voucher, tag);
    }

    public static void writeItinerary(ItemStack paper, JsonObject order, String passengerName, String idNo) {
        CompoundTag tag = copy(paper);
        tag.putBoolean(ITINERARY, true);
        tag.putString("orderNo", RailwayWeb.str(order, "orderNo", ""));
        tag.putString("trainNo", RailwayWeb.str(order, "trainNo", ""));
        tag.putString("passengerName", passengerName);
        tag.putString("idNo", idNo);

        CompoundTag info = new CompoundTag();
        info.putString("orderNo", RailwayWeb.str(order, "orderNo", ""));
        info.putString("trainNo", RailwayWeb.str(order, "trainNo", ""));
        info.putString("trainName", RailwayWeb.str(order, "trainName", RailwayWeb.str(order, "trainNo", "")));
        info.putString("date", RailwayWeb.str(order, "date", ""));
        info.putString("departTime", RailwayWeb.str(order, "departTime", ""));
        info.putString("seatType", RailwayWeb.str(order, "seat", RailwayWeb.str(order, "seatType", "")));
        info.putString("seatNo", RailwayWeb.str(order, "seatNo", ""));
        info.putDouble("price", order.has("price") ? order.get("price").getAsDouble() : 0.0);
        info.putString("currency", RailwayWeb.str(order, "currency", "emerald"));
        info.putString("passengerType", RailwayWeb.str(order, "passengerType", "成人"));
        tag.put(TICKET_INFO, info);

        CompoundTag station = new CompoundTag();
        station.putString("from", RailwayWeb.str(order, "fromStationName", ""));
        station.putString("to", RailwayWeb.str(order, "toStationName", ""));
        tag.put(STATION_INFO, station);

        CompoundTag passenger = new CompoundTag();
        passenger.putString("name", passengerName);
        passenger.putString("idNo", idNo);
        tag.put(PASSENGER_INFO, passenger);
        set(paper, tag);
    }

    public static boolean isItinerary(ItemStack stack) {
        return copy(stack).getBoolean(ITINERARY);
    }

    /** 车票镜像进身份证：闸机读身份证时等同于读车票。 */
    public static void mirrorToCard(ItemStack card, ItemStack ticket) {
        CompoundTag cardTag = copy(card);
        CompoundTag ticketTag = copy(ticket);
        copyInto(cardTag, ticketTag, TICKET_INFO);
        copyInto(cardTag, ticketTag, STATION_INFO);
        copyInto(cardTag, ticketTag, PASSENGER_INFO);
        cardTag.putBoolean(TICKET, true);
        set(card, cardTag);
    }

    private static void copyInto(CompoundTag target, CompoundTag source, String key) {
        if (source.contains(key)) target.put(key, source.get(key).copy());
    }

    public static boolean hasTicket(ItemStack stack) {
        CompoundTag tag = copy(stack);
        if (stack.isEmpty()) return false;
        if (isIdCard(stack)) return tag.getBoolean(TICKET) && tag.contains(TICKET_INFO);
        return tag.contains(TICKET_INFO);
    }

    /** 返回票据根数据（身份证会读取镜像后的根数据）。 */
    public static CompoundTag ticketData(ItemStack stack) {
        return copy(stack);
    }

    public static String fromStation(ItemStack stack) {
        return copy(stack).getCompound(STATION_INFO).getString("from");
    }

    public static String toStation(ItemStack stack) {
        return copy(stack).getCompound(STATION_INFO).getString("to");
    }

    public static String trainName(ItemStack stack) {
        CompoundTag info = copy(stack).getCompound(TICKET_INFO);
        String name = info.getString("trainName");
        return name.isBlank() ? info.getString("trainNo") : name;
    }

    public static String enteredStation(ItemStack stack) {
        return copy(stack).getString(ENTERED_STATION);
    }

    public static boolean checkedIn(ItemStack stack) {
        return copy(stack).getBoolean(CHECKED_IN);
    }

    public static boolean used(ItemStack stack) {
        return copy(stack).getBoolean(USED);
    }

    public static void markEntry(ItemStack stack, String stationName) {
        CompoundTag tag = copy(stack);
        tag.putString(ENTERED_STATION, stationName);
        tag.putBoolean(ENTRY_USED, true);
        set(stack, tag);
    }

    /** 后台取消检票后允许重新进站：清除进站标记，保留车票本身。 */
    public static void clearEntry(ItemStack stack) {
        CompoundTag tag = copy(stack);
        tag.remove(ENTRY_USED);
        tag.remove(ENTERED_STATION);
        set(stack, tag);
    }

    public static boolean entryUsed(ItemStack stack) {
        CompoundTag tag = copy(stack);
        return tag.getBoolean(ENTRY_USED) || !tag.getString(ENTERED_STATION).isBlank();
    }

    public static void markCheckin(ItemStack stack) {
        CompoundTag tag = copy(stack);
        tag.putBoolean(CHECKED_IN, true);
        set(stack, tag);
    }

    /** 出站后车票置为已使用，出站闸机不能再次通过。 */
    public static void markUsed(ItemStack stack) {
        CompoundTag tag = copy(stack);
        tag.putBoolean(USED, true);
        set(stack, tag);
    }

    /**
     * 从车票读取开检时间；没有 checkinStart 时按网页后台同步的提前分钟数计算。
     * 返回值是 epoch 毫秒，0 表示无法解析。
     */
    public static long checkinStart(ItemStack stack) {
        CompoundTag info = copy(stack).getCompound(TICKET_INFO);
        String explicit = info.getString("checkinStart");
        if (!explicit.isBlank()) {
            long parsed = explicit.matches("\\d+") ? Long.parseLong(explicit) : parse(explicit);
            if (parsed > 0) return parsed;
        }
        String date = info.getString("date");
        String depart = info.getString("departTime");
        if (date.isBlank() || depart.isBlank()) return 0;
        long departure = parse(date + "T" + (depart.length() == 5 ? depart : "00:00"));
        if (departure <= 0) return 0;
        return departure - RailwaySettings.checkinMinutes() * 60_000L;
    }

    public static long departureTime(ItemStack stack) {
        CompoundTag info = copy(stack).getCompound(TICKET_INFO);
        String date = info.getString("date");
        String depart = info.getString("departTime");
        if (date.isBlank() || depart.isBlank()) return 0;
        return parse(date + "T" + (depart.length() == 5 ? depart : "00:00"));
    }

    private static long parse(String value) {
        try {
            return LocalDateTime.parse(value).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        } catch (Exception ignored) {
            try {
                return LocalDateTime.parse(value.replace(' ', 'T')).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
            } catch (Exception ignoredAgain) {
                return 0;
            }
        }
    }
}
