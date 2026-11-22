package qingjiang.railway.client;

import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.RegisterMenuScreensEvent;
import qingjiang.railway.ModMenus;
import qingjiang.railway.RailwayAddon;

@EventBusSubscriber(modid = RailwayAddon.MOD_ID, bus = EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)
public final class ClientSetup {
    private ClientSetup() {}

    @SubscribeEvent
    public static void registerScreens(RegisterMenuScreensEvent event) {
        event.register(ModMenus.VENDOR.get(), RailwayVendorScreen::new);
        event.register(ModMenus.STAFF_COMPUTER.get(), StaffTerminalScreen::new);
        event.register(ModMenus.STAFF_POS.get(), StaffTerminalScreen::new);
        event.register(ModMenus.STAFF_CHECK.get(), StaffTerminalScreen::new);
    }
}
