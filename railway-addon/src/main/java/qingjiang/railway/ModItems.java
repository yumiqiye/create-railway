package qingjiang.railway;

import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;
import qingjiang.railway.item.IdCardItem;
import qingjiang.railway.item.ManualCheckItem;
import qingjiang.railway.item.PosItem;
import qingjiang.railway.item.RailwayTicketItem;
import qingjiang.railway.item.ReimbursementItem;

public final class ModItems {
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(RailwayAddon.MOD_ID);
    public static final DeferredRegister<CreativeModeTab> TABS =
            DeferredRegister.create(Registries.CREATIVE_MODE_TAB, RailwayAddon.MOD_ID);

    public static final DeferredItem<IdCardItem> ID_CARD = ITEMS.registerItem(
            "id_card", IdCardItem::new, new Item.Properties().stacksTo(1));
    public static final DeferredItem<ReimbursementItem> REIMBURSEMENT = ITEMS.registerItem(
            "reimbursement", ReimbursementItem::new, new Item.Properties().stacksTo(16));
    public static final DeferredItem<RailwayTicketItem> RAILWAY_TICKET = ITEMS.registerItem(
            "railway_ticket", RailwayTicketItem::new, new Item.Properties().stacksTo(16));
    public static final DeferredItem<BlockItem> COMPUTER = ITEMS.register(
            "computer", () -> new BlockItem(ModBlocks.COMPUTER.get(), new Item.Properties()));
    public static final DeferredItem<BlockItem> GUIDE_SCREEN = ITEMS.register(
            "guide_screen", () -> new BlockItem(ModBlocks.GUIDE_SCREEN.get(), new Item.Properties()));
    public static final DeferredItem<PosItem> POS = ITEMS.registerItem(
            "pos", PosItem::new, new Item.Properties().stacksTo(1));
    public static final DeferredItem<ManualCheckItem> MANUAL_CHECKER = ITEMS.registerItem(
            "manual_checker", ManualCheckItem::new, new Item.Properties().stacksTo(1));

    static {
        TABS.register("railway", () -> CreativeModeTab.builder()
                .title(Component.translatable("itemGroup.hexie_railway.railway"))
                .icon(() -> new ItemStack(ID_CARD.get()))
                .displayItems((parameters, output) -> {
                    output.accept(ID_CARD.get());
                    output.accept(REIMBURSEMENT.get());
                    output.accept(RAILWAY_TICKET.get());
                    output.accept(COMPUTER.get());
                    output.accept(GUIDE_SCREEN.get());
                    output.accept(POS.get());
                    output.accept(MANUAL_CHECKER.get());
                })
                .build());
    }

    private ModItems() {}
}
