package qingjiang.railway.network;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import qingjiang.railway.RailwayAddon;

/** 客户端人工终端 -> 服务端：查询/收款/出票/检票。 */
public record StaffActionPayload(String action, String query, int mode) implements CustomPacketPayload {
    public static final Type<StaffActionPayload> TYPE = new Type<>(
            ResourceLocation.fromNamespaceAndPath(RailwayAddon.MOD_ID, "staff_action"));
    public static final StreamCodec<RegistryFriendlyByteBuf, StaffActionPayload> STREAM_CODEC =
            StreamCodec.composite(
                    ByteBufCodecs.STRING_UTF8, StaffActionPayload::action,
                    ByteBufCodecs.STRING_UTF8, StaffActionPayload::query,
                    ByteBufCodecs.VAR_INT, StaffActionPayload::mode,
                    StaffActionPayload::new);

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
