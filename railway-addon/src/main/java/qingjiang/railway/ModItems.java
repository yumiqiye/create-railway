package qingjiang.railway;

import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;
import qingjiang.railway.item.AdminCardItem;
import qingjiang.railway.item.IdCardItem;
import qingjiang.railway.item.ManualCheckItem;
import qingjiang.railway.item.RailwayTicketItem;
import qingjiang.railway.item.TabletItem;
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
    public static final DeferredItem<BlockItem> COMPUTER = ITEMS.registerSimpleBlockItem(
            ModBlocks.COMPUTER, new Item.Properties());
    public static final DeferredItem<BlockItem> TICKET_VENDOR = ITEMS.registerSimpleBlockItem(
            ModBlocks.TICKET_VENDOR, new Item.Properties());
    public static final DeferredItem<BlockItem> GATE_A = ITEMS.registerSimpleBlockItem(
            ModBlocks.GATE_A, new Item.Properties());
    public static final DeferredItem<BlockItem> GATE_B = ITEMS.registerSimpleBlockItem(
            ModBlocks.GATE_B, new Item.Properties());
    public static final DeferredItem<BlockItem> GUIDE_SCREEN = ITEMS.registerSimpleBlockItem(
            ModBlocks.GUIDE_SCREEN, new Item.Properties());
    public static final DeferredItem<ManualCheckItem> MANUAL_CHECKER = ITEMS.registerItem(
            "manual_checker", ManualCheckItem::new, new Item.Properties().stacksTo(1));
    public static final DeferredItem<TabletItem> TABLET = ITEMS.registerItem(
            "tablet", TabletItem::new, new Item.Properties().stacksTo(1));
    public static final DeferredItem<BlockItem> TV = ITEMS.registerSimpleBlockItem(
            ModBlocks.TV, new Item.Properties());
    public static final DeferredItem<BlockItem> VEHICLE_DISPLAY = ITEMS.registerSimpleBlockItem(
            ModBlocks.VEHICLE_DISPLAY, new Item.Properties());
    public static final DeferredItem<BlockItem> DISPATCH_SCREEN = ITEMS.registerSimpleBlockItem(
            ModBlocks.DISPATCH_SCREEN, new Item.Properties());
    public static final DeferredItem<AdminCardItem> ADMIN_CARD = ITEMS.registerItem(
            "admin_card", AdminCardItem::new, new Item.Properties().stacksTo(1));
    public static final DeferredItem<Item> METRO_TICKET = ITEMS.registerItem(
            "metro_ticket", props -> new Item(props.stacksTo(16)));
    public static final DeferredItem<Item> METRO_CARD = ITEMS.registerItem(
            "metro_card", props -> new Item(props.stacksTo(1)));

    static {
        TABS.register("railway", () -> CreativeModeTab.builder()
                .title(Component.translatable("itemGroup.railway_plus.railway"))
                .icon(() -> new ItemStack(ID_CARD.get()))
                .displayItems((parameters, output) -> {
                    output.accept(ID_CARD.get());
                    output.accept(REIMBURSEMENT.get());
                    output.accept(RAILWAY_TICKET.get());
                    output.accept(COMPUTER.get());
                    output.accept(TICKET_VENDOR.get());
                    output.accept(GATE_A.get());
                    output.accept(GATE_B.get());
                    output.accept(GUIDE_SCREEN.get());
                    output.accept(MANUAL_CHECKER.get());
                    output.accept(TABLET.get());
                    output.accept(TV.get());
                    output.accept(VEHICLE_DISPLAY.get());
                    output.accept(DISPATCH_SCREEN.get());
                    output.accept(ADMIN_CARD.get());
                    output.accept(METRO_TICKET.get());
                    output.accept(METRO_CARD.get());
                })
                .build());
    }

    private ModItems() {}
}
