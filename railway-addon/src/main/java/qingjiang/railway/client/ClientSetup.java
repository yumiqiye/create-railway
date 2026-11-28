package qingjiang.railway.client;

import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.EntityRenderersEvent;
import net.neoforged.neoforge.client.event.RegisterMenuScreensEvent;
import qingjiang.railway.ModBlockEntities;
import qingjiang.railway.ModMenus;
import qingjiang.railway.RailwayAddon;

@EventBusSubscriber(modid = RailwayAddon.MOD_ID, bus = EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)
public final class ClientSetup {
    private ClientSetup() {}

    @SubscribeEvent
    public static void registerScreens(RegisterMenuScreensEvent event) {
        event.register(ModMenus.VENDOR.get(), RailwayVendorScreen::new);
        event.register(ModMenus.STAFF_COMPUTER.get(), StaffTerminalScreen::new);
        event.register(ModMenus.STAFF_CHECK.get(), StaffTerminalScreen::new);
    }

    @SubscribeEvent
    public static void registerBlockEntityRenderers(EntityRenderersEvent.RegisterRenderers event) {
        event.registerBlockEntityRenderer(ModBlockEntities.GUIDE_SCREEN.get(), GuideScreenRenderer.PROVIDER);
        event.registerBlockEntityRenderer(ModBlockEntities.TV.get(), TvScreenRenderer.PROVIDER);
    }
}
