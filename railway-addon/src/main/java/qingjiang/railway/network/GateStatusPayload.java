package qingjiang.railway.network;

import net.minecraft.core.BlockPos;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import qingjiang.railway.RailwayAddon;

/** 服务端把闸机状态广播给客户端，用于闸机上方悬浮提示。 */
public record GateStatusPayload(BlockPos pos, String station, int gateType, boolean disabled, String message)
        implements CustomPacketPayload {
    public static final Type<GateStatusPayload> TYPE =
            new Type<>(ResourceLocation.fromNamespaceAndPath(RailwayAddon.MOD_ID, "gate_status"));

    public static final StreamCodec<RegistryFriendlyByteBuf, GateStatusPayload> STREAM_CODEC = StreamCodec.of(
            (buf, payload) -> {
                buf.writeBlockPos(payload.pos);
                buf.writeUtf(payload.station == null ? "" : payload.station);
                buf.writeVarInt(payload.gateType);
                buf.writeBoolean(payload.disabled);
                buf.writeUtf(payload.message == null ? "" : payload.message);
            },
            buf -> new GateStatusPayload(buf.readBlockPos(), buf.readUtf(), buf.readVarInt(), buf.readBoolean(), buf.readUtf())
    );

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
