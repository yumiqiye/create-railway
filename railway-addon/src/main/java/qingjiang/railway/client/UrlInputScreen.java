package qingjiang.railway.client;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.neoforged.neoforge.network.PacketDistributor;
import qingjiang.railway.network.UrlConfigPayload;
import qingjiang.railway.network.UrlSetPayload;

/** 电视 / 平板网页地址输入框。 */
public class UrlInputScreen extends Screen {
    private final int target;
    private final BlockPos pos;
    private final String currentUrl;
    private EditBox urlBox;

    public UrlInputScreen(UrlConfigPayload payload) {
        super(Component.literal("配置网页"));
        this.target = payload.target();
        this.pos = payload.pos();
        this.currentUrl = payload.currentUrl();
    }

    public static void open(UrlConfigPayload payload) {
        Minecraft.getInstance().setScreen(new UrlInputScreen(payload));
    }

    @Override
    protected void init() {
        super.init();
        int boxWidth = 300;
        int boxX = (this.width - boxWidth) / 2;
        int boxY = this.height / 2 - 30;

        urlBox = new EditBox(this.font, boxX, boxY, boxWidth, 20, Component.literal("网页地址"));
        urlBox.setValue(currentUrl == null ? "" : currentUrl);
        urlBox.setMaxLength(512);
        addRenderableWidget(urlBox);

        int buttonY = boxY + 34;
        addRenderableWidget(Button.builder(Component.literal("保存"), button -> save(false))
                .bounds(boxX, buttonY, 90, 20).build());
        addRenderableWidget(Button.builder(Component.literal("恢复默认"), button -> save(true))
                .bounds(boxX + 100, buttonY, 90, 20).build());
        addRenderableWidget(Button.builder(Component.literal("取消"), button -> onClose())
                .bounds(boxX + 200, buttonY, 90, 20).build());
    }

    private void save(boolean reset) {
        String url = urlBox == null ? "" : urlBox.getValue().trim();
        PacketDistributor.sendToServer(new UrlSetPayload(target, pos, url, reset));
        onClose();
    }

    @Override
    public void render(net.minecraft.client.gui.GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        renderBackground(graphics, mouseX, mouseY, partialTick);
        super.render(graphics, mouseX, mouseY, partialTick);
        graphics.drawString(this.font, "输入完整地址（https://…）或站内路径；留空打开百度",
                this.width / 2 - 150, this.height / 2 - 52, 0xFFB8C0CC, false);
    }
}
