package qingjiang.railway.client;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.Inventory;
import net.neoforged.neoforge.network.PacketDistributor;
import qingjiang.railway.menu.StaffTerminalMenu;
import qingjiang.railway.network.StaffActionPayload;
import qingjiang.railway.network.StaffResultPayload;

/** 人工终端界面：输入订单号/身份证号，执行查询、现金收款、出票、凭证、检票。 */
public class StaffTerminalScreen extends AbstractContainerScreen<StaffTerminalMenu> {
    private EditBox queryBox;
    private String status = "输入订单号、身份证号或乘客名后选择操作";
    private boolean success = true;

    public StaffTerminalScreen(StaffTerminalMenu menu, Inventory inventory, Component title) {
        super(menu, inventory, title);
        this.imageWidth = 360;
        this.imageHeight = 220;
    }

    public static void accept(StaffResultPayload payload) {
        if (net.minecraft.client.Minecraft.getInstance().screen instanceof StaffTerminalScreen screen) {
            screen.status = payload.message();
            screen.success = payload.success();
        }
    }

    @Override
    protected void init() {
        super.init();
        int x = this.leftPos;
        int y = this.topPos;
        this.queryBox = new EditBox(this.font, x + 16, y + 34, 328, 20, Component.literal("订单号 / 身份证号"));
        this.queryBox.setMaxLength(64);
        this.addRenderableWidget(this.queryBox);

        int by = y + 62;
        int w = 64;
        int gap = 6;
        if (menu.mode() != 2) {
            addRenderableWidget(Button.builder(Component.literal("查询"), b -> send("query"))
                    .bounds(x + 16, by, w, 20).build());
            addRenderableWidget(Button.builder(Component.literal("确认收款"), b -> send("pay"))
                    .bounds(x + 16 + (w + gap), by, w, 20).build());
            addRenderableWidget(Button.builder(Component.literal("打印车票"), b -> send("print"))
                    .bounds(x + 16 + (w + gap) * 2, by, w, 20).build());
            addRenderableWidget(Button.builder(Component.literal("报销凭证"), b -> send("voucher"))
                    .bounds(x + 16 + (w + gap) * 3, by, w, 20).build());
        }
        addRenderableWidget(Button.builder(Component.literal("人工检票"), b -> send("check"))
                .bounds(x + 16 + (w + gap) * 4, by, w, 20).build());
    }

    private void send(String action) {
        String value = this.queryBox == null ? "" : this.queryBox.getValue().trim();
        if (value.isEmpty()) {
            this.status = "请先输入订单号或身份证号";
            this.success = false;
            return;
        }
        this.status = "处理中...";
        PacketDistributor.sendToServer(new StaffActionPayload(action, value, menu.mode()));
    }

    @Override
    protected void renderBg(GuiGraphics graphics, float partialTick, int mouseX, int mouseY) {
        graphics.fill(this.leftPos, this.topPos, this.leftPos + this.imageWidth,
                this.topPos + this.imageHeight, 0xDD101418);
        graphics.fill(this.leftPos, this.topPos, this.leftPos + this.imageWidth,
                this.topPos + 1, 0xFF4FC3F7);
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        this.renderBackground(graphics, mouseX, mouseY, partialTick);
        super.render(graphics, mouseX, mouseY, partialTick);
        int x = this.leftPos;
        int y = this.topPos;
        graphics.drawString(this.font, this.title, x + 16, y + 10, 0xFFFFFF, false);
        String hint = menu.mode() == 1 ? "POS：现金收款 / 出票"
                : menu.mode() == 2 ? "人工检票：身份证号或订单号" : "电脑：查询 / 现金收款 / 出票 / 凭证";
        graphics.drawString(this.font, hint, x + 16, y + 21, 0xA0A0A0, false);

        graphics.fill(x + 12, y + 92, x + imageWidth - 12, y + imageHeight - 14, 0x66000000);
        int color = success ? 0x7CFF9A : 0xFF7A7A;
        int lineY = y + 98;
        for (var line : this.font.split(Component.literal(this.status), imageWidth - 32)) {
            graphics.drawString(this.font, line, x + 18, lineY, color, false);
            lineY += 11;
            if (lineY > y + imageHeight - 18) break;
        }
        this.renderTooltip(graphics, mouseX, mouseY);
    }
}
