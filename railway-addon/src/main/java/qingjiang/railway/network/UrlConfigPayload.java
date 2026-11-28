package qingjiang.railway.network;

import net.minecraft.core.BlockPos;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import qingjiang.railway.RailwayAddon;

/** 服务端通知客户端打开网页配置输入框。target：0=电视，1=平板。 */
public record UrlConfigPayload(int target, BlockPos pos, String currentUrl) implements CustomPacketPayload {
    public static final Type<UrlConfigPayload> TYPE =
            new Type<>(ResourceLocation.fromNamespaceAndPath(RailwayAddon.MOD_ID, "url_config"));

    public static final StreamCodec<RegistryFriendlyByteBuf, UrlConfigPayload> STREAM_CODEC = StreamCodec.of(
            (buf, payload) -> {
                buf.writeVarInt(payload.target);
                buf.writeBlockPos(payload.pos);
                buf.writeUtf(payload.currentUrl == null ? "" : payload.currentUrl);
            },
            buf -> new UrlConfigPayload(buf.readVarInt(), buf.readBlockPos(), buf.readUtf())
    );

    @Override
    public Type<? extends CustomPacketPayload> type() {
        return TYPE;
    }
}
