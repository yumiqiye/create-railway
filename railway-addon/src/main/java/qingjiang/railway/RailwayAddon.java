package qingjiang.railway;

import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import qingjiang.railway.network.RailwayNetwork;
import qingjiang.railway.dispatch.DispatchService;

@Mod(RailwayAddon.MOD_ID)
public class RailwayAddon {
    public static final String MOD_ID = "railway_plus";
    public static final Logger LOGGER = LoggerFactory.getLogger("RailwayPlus");

    public RailwayAddon(IEventBus modBus, ModContainer container) {
        try {
            DispatchService.VERSION = container.getModInfo().getVersion().toString();
        } catch (Throwable ignored) {
        }
        container.registerConfig(net.neoforged.fml.config.ModConfig.Type.COMMON, RailwayConfig.SPEC);
        ModBlocks.BLOCKS.register(modBus);
        ModItems.ITEMS.register(modBus);
        ModItems.TABS.register(modBus);
        ModBlockEntities.BLOCK_ENTITIES.register(modBus);
        ModMenus.MENUS.register(modBus);
        modBus.addListener(RailwayNetwork::register);

        NeoForge.EVENT_BUS.register(RailwayEvents.class);
        NeoForge.EVENT_BUS.addListener(RailwayAddon::onRegisterCommands);
    }

    private static void onRegisterCommands(RegisterCommandsEvent event) {
        RailwayCommands.register(event.getDispatcher());
    }
}
