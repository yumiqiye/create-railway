package qingjiang.railway.item;

import net.minecraft.ChatFormatting;
import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.Item.TooltipContext;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraft.world.level.Level;

import java.util.List;
import java.util.UUID;

/** 身份证：获得后第一次进入玩家背包时自动写入姓名与由 UUID 生成的证件号。 */
public class IdCardItem extends Item {
    public static final String ID_INFO = "idInfo";
    public static final String TICKET = "ticket";

    public IdCardItem(Properties properties) {
        super(properties);
    }

    @Override
    public void inventoryTick(ItemStack stack, Level level, Entity entity, int slot, boolean selected) {
        if (level.isClientSide || !(entity instanceof Player player)) return;
        CompoundTag data = stack.getOrDefault(DataComponents.CUSTOM_DATA, net.minecraft.world.item.component.CustomData.EMPTY).copyTag();
        CompoundTag info = data.getCompound(ID_INFO);
        if (!info.getString("name").isBlank() && !info.getString("idNo").isBlank()) return;
        info.putString("name", player.getGameProfile().getName());
        info.putString("idNo", generateId(player.getUUID()));
        data.put(ID_INFO, info);
        stack.set(DataComponents.CUSTOM_DATA, net.minecraft.world.item.component.CustomData.of(data));
    }

    /** 由 UUID 生成稳定的 18 位号码，仅用于游戏内身份标识，不对应真实证件。 */
    public static String generateId(UUID uuid) {
        long most = uuid.getMostSignificantBits();
        long least = uuid.getLeastSignificantBits();
        long mixed = most ^ (least * 0x9E3779B97F4A7C15L);
        String digits = String.format("%015d", Math.abs(mixed) % 1_000_000_000_000_000L);
        String body = "320101" + digits.substring(0, 11);
        char check = "10X98765432".charAt(checksum(body));
        return body + check;
    }

    /** 简化版 GB 11643 校验位算法。 */
    private static int checksum(String body) {
        int[] weight = {7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2};
        int sum = 0;
        for (int i = 0; i < body.length() && i < weight.length; i++) {
            sum += Character.digit(body.charAt(i), 10) * weight[i];
        }
        return sum % 11;
    }

    @Override
    public void appendHoverText(ItemStack stack, TooltipContext context, List<Component> tooltip, TooltipFlag flag) {
        CompoundTag data = stack.getOrDefault(DataComponents.CUSTOM_DATA, net.minecraft.world.item.component.CustomData.EMPTY).copyTag();
        CompoundTag info = data.getCompound(ID_INFO);
        String name = info.getString("name");
        String idNo = info.getString("idNo");
        if (!name.isBlank()) tooltip.add(Component.literal("姓名：" + name).withStyle(ChatFormatting.GRAY));
        if (!idNo.isBlank()) {
            String masked = idNo.length() > 8 ? idNo.substring(0, 4) + "**********" + idNo.substring(idNo.length() - 4) : idNo;
            tooltip.add(Component.literal("证件号：" + masked).withStyle(ChatFormatting.DARK_GRAY));
        }
        if (data.contains(TICKET)) {
            tooltip.add(Component.literal("已绑定电子车票，可直接刷身份证检票").withStyle(ChatFormatting.GREEN));
        } else {
            tooltip.add(Component.literal("放入售票机后可购买车票").withStyle(ChatFormatting.DARK_GRAY));
        }
    }
}
