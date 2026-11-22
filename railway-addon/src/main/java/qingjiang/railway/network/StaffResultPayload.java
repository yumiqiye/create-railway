package qingjiang.railway.network;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import qingjiang.railway.RailwayAddon;

/** 服务端 -> 人工终端界面：一行结果文本。 */
public record StaffResultPayload(String message, boolean success) implements CustomPacketPayload {
    public static final Type<StaffResultPayload> TYPE = new Type<>(
            ResourceLocation.fromNamespaceAndPath(RailwayAddon.MOD_ID, "staff_result"));
    public static final StreamCodec<RegistryFriendlyByteBuf, StaffResultPayload> STREAM_CODEC =
            StreamCodec.composite(
                    ByteBufCodecs.STRING_UTF8, StaffResultPayload::message,
                    ByteBufCodecs.BOOL, StaffResultPayload::success,
                    StaffResultPayload::new);

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
