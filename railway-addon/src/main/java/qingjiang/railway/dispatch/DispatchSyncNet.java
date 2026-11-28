package qingjiang.railway.dispatch;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.handling.IPayloadContext;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;
import qingjiang.railway.RailwayAddon;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

/**
 * 联机同步：服务端把压缩后的快照推给订阅的客户端，客户端再把指令回传。
 * 只在有订阅者时发包，空闲时零开销。由原 PyRailDispatch 的 SyncNet 内置迁入。
 */
public final class DispatchSyncNet {

    /** 单个自定义包上限约 1MB；超过只让客户端被踢，宁可跳过同步也不发。 */
    private static final int MAX_PAYLOAD = 900_000;

    private DispatchSyncNet() {
    }

    // ---------------- 载荷定义 ----------------

    public static final class StatePayload implements CustomPacketPayload {
        public static final Type<StatePayload> TYPE =
                new Type<>(ResourceLocation.fromNamespaceAndPath("railway_plus", "dispatch_state"));
        public static final StreamCodec<RegistryFriendlyByteBuf, StatePayload> CODEC = StreamCodec.of(
                (buf, payload) -> buf.writeByteArray(payload.data),
                buf -> new StatePayload(buf.readByteArray(MAX_PAYLOAD)));

        public final byte[] data;

        public StatePayload(byte[] data) {
            this.data = data;
        }

        @Override
        public Type<? extends CustomPacketPayload> type() {
            return TYPE;
        }
    }

    public static final class ActionPayload implements CustomPacketPayload {
        public static final Type<ActionPayload> TYPE =
                new Type<>(ResourceLocation.fromNamespaceAndPath("railway_plus", "dispatch_action"));
        public static final StreamCodec<RegistryFriendlyByteBuf, ActionPayload> CODEC = StreamCodec.of(
                (buf, payload) -> buf.writeUtf(payload.json, 262144),
                buf -> new ActionPayload(buf.readUtf(262144)));

        public final String json;

        public ActionPayload(String json) {
            this.json = json;
        }

        @Override
        public Type<? extends CustomPacketPayload> type() {
            return TYPE;
        }
    }

    public static final class SubscribePayload implements CustomPacketPayload {
        public static final Type<SubscribePayload> TYPE =
                new Type<>(ResourceLocation.fromNamespaceAndPath("railway_plus", "dispatch_subscribe"));
        public static final StreamCodec<RegistryFriendlyByteBuf, SubscribePayload> CODEC = StreamCodec.of(
                (buf, payload) -> {
                },
                buf -> new SubscribePayload());

        @Override
        public Type<? extends CustomPacketPayload> type() {
            return TYPE;
        }
    }

    private static final Set<UUID> SUBSCRIBERS = ConcurrentHashMap.newKeySet();
    private static final java.util.concurrent.atomic.AtomicBoolean OVERSIZE_WARNED =
            new java.util.concurrent.atomic.AtomicBoolean();

    // ---------------- 注册 ----------------

    /** 由 RailwayNetwork 统一注册。 */
    public static void register(PayloadRegistrar registrar) {
        registrar.playToClient(StatePayload.TYPE, StatePayload.CODEC, DispatchSyncNet::handleState);
        registrar.playToServer(SubscribePayload.TYPE, SubscribePayload.CODEC, DispatchSyncNet::handleSubscribe);
        registrar.playToServer(ActionPayload.TYPE, ActionPayload.CODEC, DispatchSyncNet::handleAction);
    }

    private static void handleState(StatePayload payload, IPayloadContext ctx) {
        final String json;
        try {
            json = gunzip(payload.data);
        } catch (Throwable t) {
            return;
        }
        ctx.enqueueWork(() -> {
            if (DispatchService.SERVICE != null) DispatchService.SERVICE.setRemoteJson(json);
        });
    }

    private static void handleSubscribe(SubscribePayload payload, IPayloadContext ctx) {
        ctx.enqueueWork(() -> SUBSCRIBERS.add(ctx.player().getUUID()));
    }

    private static void handleAction(ActionPayload payload, IPayloadContext ctx) {
        JsonObject parsed;
        try {
            parsed = JsonParser.parseString(payload.json).getAsJsonObject();
        } catch (Throwable t) {
            return;
        }
        ctx.enqueueWork(() -> {
            try {
                if (DispatchService.SERVICE != null) DispatchService.SERVICE.handleRemoteAction(parsed);
            } catch (Throwable t2) {
                RailwayAddon.LOGGER.warn("[dispatch] 处理联机指令失败: {}", t2.toString());
            }
        });
    }

    public static void onPlayerLeave(UUID id) {
        try {
            SUBSCRIBERS.remove(id);
        } catch (Throwable ignored) {
        }
    }

    // ---------------- 收发 ----------------

    public static void broadcast(MinecraftServer server, String json) {
        if (SUBSCRIBERS.isEmpty() || json == null) return;
        byte[] data;
        try {
            data = gzip(json);
        } catch (Throwable t) {
            return;
        }
        if (data.length > MAX_PAYLOAD) {
            if (OVERSIZE_WARNED.compareAndSet(false, true)) {
                RailwayAddon.LOGGER.warn("[dispatch] 调度快照压缩后 {} 字节，超过网络包上限，已跳过联机同步（本机调度台不受影响；"
                        + "可在网页设置里调低 maxTrackPoints / trackSampleSteps）", data.length);
            }
            return;
        }
        for (UUID id : SUBSCRIBERS) {
            ServerPlayer player = server.getPlayerList().getPlayer(id);
            if (player == null) continue;
            try {
                PacketDistributor.sendToPlayer(player, new StatePayload(data));
            } catch (Throwable t) {
                SUBSCRIBERS.remove(id);
            }
        }
    }

    public static boolean sendAction(JsonObject payload) {
        try {
            PacketDistributor.sendToServer(new ActionPayload(payload.toString()));
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    public static boolean sendSubscribe() {
        try {
            PacketDistributor.sendToServer(new SubscribePayload());
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    public static byte[] gzip(String text) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (GZIPOutputStream gz = new GZIPOutputStream(bos)) {
            gz.write(text.getBytes(StandardCharsets.UTF_8));
        }
        return bos.toByteArray();
    }

    public static String gunzip(byte[] data) throws IOException {
        try (GZIPInputStream gz = new GZIPInputStream(new ByteArrayInputStream(data))) {
            return new String(gz.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    public static boolean hasSubscribers() {
        return !SUBSCRIBERS.isEmpty();
    }
}
