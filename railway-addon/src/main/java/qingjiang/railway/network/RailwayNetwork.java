package qingjiang.railway.network;

import net.minecraft.server.level.ServerPlayer;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;
import qingjiang.railway.ManualService;
import qingjiang.railway.dispatch.DispatchSyncNet;

public final class RailwayNetwork {
    private RailwayNetwork() {}

    public static void register(RegisterPayloadHandlersEvent event) {
        PayloadRegistrar registrar = event.registrar("1");
        DispatchSyncNet.register(registrar);
        registrar.playToServer(StaffActionPayload.TYPE, StaffActionPayload.STREAM_CODEC,
                (payload, context) -> context.enqueueWork(() -> {
                    if (!(context.player() instanceof ServerPlayer player)) return;
                    ManualService.Result result = ManualService.handle(
                            player, payload.action(), payload.query(), payload.mode());
                    PacketDistributor.sendToPlayer(player, new StaffResultPayload(result.message(), result.success()));
                }));
        registrar.playToClient(StaffResultPayload.TYPE, StaffResultPayload.STREAM_CODEC,
                (payload, context) -> context.enqueueWork(
                        () -> qingjiang.railway.client.StaffTerminalScreen.accept(payload)));
        registrar.playToClient(UrlConfigPayload.TYPE, UrlConfigPayload.STREAM_CODEC,
                (payload, context) -> context.enqueueWork(
                        () -> qingjiang.railway.client.UrlInputScreen.open(payload)));
        registrar.playToServer(UrlSetPayload.TYPE, UrlSetPayload.STREAM_CODEC,
                (payload, context) -> context.enqueueWork(() -> {
                    if (!(context.player() instanceof ServerPlayer player)) return;
                    qingjiang.railway.UrlConfigService.apply(player, payload);
                }));
    }
}
