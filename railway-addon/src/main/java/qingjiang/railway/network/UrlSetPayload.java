package qingjiang.railway.network;

import net.minecraft.core.BlockPos;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import qingjiang.railway.RailwayAddon;

/** 客户端把配置好的网页提交回服务端。target：0=电视，1=平板。 */
public record UrlSetPayload(int target, BlockPos pos, String url, boolean reset) implements CustomPacketPayload {
    public static final Type<UrlSetPayload> TYPE =
            new Type<>(ResourceLocation.fromNamespaceAndPath(RailwayAddon.MOD_ID, "url_set"));

    public static final StreamCodec<RegistryFriendlyByteBuf, UrlSetPayload> STREAM_CODEC = StreamCodec.of(
            (buf, payload) -> {
                buf.writeVarInt(payload.target);
                buf.writeBlockPos(payload.pos);
                buf.writeUtf(payload.url == null ? "" : payload.url);
                buf.writeBoolean(payload.reset);
            },
            buf -> new UrlSetPayload(buf.readVarInt(), buf.readBlockPos(), buf.readUtf(), buf.readBoolean())
    );

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
