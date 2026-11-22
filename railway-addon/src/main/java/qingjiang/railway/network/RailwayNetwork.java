package qingjiang.railway.network;

import net.minecraft.server.level.ServerPlayer;
import net.neoforged.neoforge.network.PacketDistributor;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.registration.PayloadRegistrar;
import qingjiang.railway.ManualService;

public final class RailwayNetwork {
    private RailwayNetwork() {}

    public static void register(RegisterPayloadHandlersEvent event) {
        PayloadRegistrar registrar = event.registrar("1");
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
    }
}
