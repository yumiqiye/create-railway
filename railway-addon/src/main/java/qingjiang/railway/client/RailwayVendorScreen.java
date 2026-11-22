package qingjiang.railway.client;

import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.BufferBuilder;
import com.mojang.blaze3d.vertex.BufferUploader;
import com.mojang.blaze3d.vertex.DefaultVertexFormat;
import com.mojang.blaze3d.vertex.Tesselator;
import com.mojang.blaze3d.vertex.VertexFormat;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.client.renderer.GameRenderer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.Inventory;
import org.joml.Matrix4f;
import qingjiang.railway.RailwayConfig;
import qingjiang.railway.RailwaySettings;
import qingjiang.railway.menu.RailwayVendorMenu;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * 售票机界面：安装 MCEF 时把 web/tvm.html 真嵌进游戏；
 * 没有 MCEF 时显示引导面板（网页仍可独立访问）。
 */
public class RailwayVendorScreen extends AbstractContainerScreen<RailwayVendorMenu> {
    private String stationName = "";
    private String passengerName = "";
    private String idNo = "";
    private int px;
    private int py;
    private int pw;
    private int ph;

    private Object browser;
    private int browserWidth;
    private int browserHeight;
    private int lastMouseX = -1;
    private int lastMouseY = -1;
    private String lastAction = "";

    public RailwayVendorScreen(RailwayVendorMenu menu, Inventory inventory, Component title) {
        super(menu, inventory, title);
    }

    @Override
    protected void init() {
        super.init();
        pw = Math.min(this.width - 24, 720);
        ph = Math.min(this.height - 24, (int) (pw * 0.64));
        px = (this.width - pw) / 2;
        py = (this.height - ph) / 2;
        String[] parts = this.title.getString().split("\u0001", -1);
        stationName = parts.length > 1 ? parts[1] : "";
        passengerName = parts.length > 2 ? parts[2] : "";
        idNo = parts.length > 3 ? parts[3] : "";
        openBrowser();
        RailwaySettings.refreshAsync();
    }

    private String pageUrl() {
        return RailwayConfig.baseUrl() + "/tvm.html?station="
                + URLEncoder.encode(stationName, StandardCharsets.UTF_8)
                + "&name=" + URLEncoder.encode(passengerName, StandardCharsets.UTF_8)
                + "&idNo=" + URLEncoder.encode(idNo, StandardCharsets.UTF_8)
                + "&embed=1";
    }

    private void openBrowser() {
        int scale = (int) Math.max(1.0D, Minecraft.getInstance().getWindow().getGuiScale());
        int nextWidth = Math.min(2560, pw * scale);
        int nextHeight = Math.min(1600, ph * scale);
        if (browser != null) {
            if (nextWidth != browserWidth || nextHeight != browserHeight) {
                browserWidth = nextWidth;
                browserHeight = nextHeight;
                McefBridge.resize(browser, browserWidth, browserHeight);
            }
            return;
        }
        browserWidth = nextWidth;
        browserHeight = nextHeight;
        browser = McefBridge.create(pageUrl(), browserWidth, browserHeight);
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        if (browser != null) {
            graphics.fill(0, 0, this.width, this.height, 0xC0101014);
            graphics.fill(px - 3, py - 3, px + pw + 3, py + ph + 3, 0xFF2F6FB5);
            int texture = McefBridge.textureId(browser);
            if (texture != 0) {
                drawTexture(graphics, texture, px, py, pw, ph);
            } else {
                graphics.drawString(this.font, "网页渲染中…", px + 16, py + 16, 0xFFFFFFFF, false);
            }
            pollBrowserAction();
            graphics.fill(px, py + ph, px + pw, py + ph + 18, 0xCC0D1015);
            graphics.drawString(this.font, "售票机 · " + stationName + "　Esc 退出", px + 8, py + ph + 5, 0xFFB8C0CC, false);
            int bx = toBrowserX(mouseX);
            int by = toBrowserY(mouseY);
            if (bx >= 0 && by >= 0 && (bx != lastMouseX || by != lastMouseY)) {
                lastMouseX = bx;
                lastMouseY = by;
                McefBridge.mouseMove(browser, bx, by);
            }
            return;
        }
        renderFallback(graphics);
    }

    @Override
    protected void renderBg(GuiGraphics graphics, float partialTick, int mouseX, int mouseY) {
        // 售票机界面完全自绘，不需要箱子背景。
    }

    /** 直接把 MCEF 的 GL 纹理画到界面上（GuiGraphics 没有裸纹理 ID 的重载）。 */
    private static void drawTexture(GuiGraphics graphics, int texture, int x, int y, int width, int height) {
        graphics.flush();
        RenderSystem.setShader(GameRenderer::getPositionTexShader);
        RenderSystem.setShaderTexture(0, texture);
        RenderSystem.enableBlend();
        Matrix4f matrix = graphics.pose().last().pose();
        BufferBuilder buffer = Tesselator.getInstance().begin(VertexFormat.Mode.QUADS, DefaultVertexFormat.POSITION_TEX);
        buffer.addVertex(matrix, x, y + height, 0).setUv(0.0F, 1.0F);
        buffer.addVertex(matrix, x + width, y + height, 0).setUv(1.0F, 1.0F);
        buffer.addVertex(matrix, x + width, y, 0).setUv(1.0F, 0.0F);
        buffer.addVertex(matrix, x, y, 0).setUv(0.0F, 0.0F);
        BufferUploader.drawWithShader(buffer.buildOrThrow());
        RenderSystem.disableBlend();
    }

    private void renderFallback(GuiGraphics graphics) {
        graphics.fill(0, 0, this.width, this.height, 0xC0101014);
        graphics.fill(px, py, px + pw, py + ph, 0xFF14181F);
        graphics.fill(px, py, px + pw, py + 44, 0xFF1D232C);
        graphics.drawString(this.font, RailwaySettings.systemName(), px + 16, py + 12, 0xFFF5C542, false);
        graphics.drawString(this.font, "售票机 · " + (stationName.isBlank() ? "未登记车站" : stationName), px + 16, py + 28, 0xFFB8C0CC, false);

        int line = py + 66;
        graphics.drawString(this.font, "持证人：" + (passengerName.isBlank() ? "未登记" : passengerName), px + 16, line, 0xFF8ED1FC, false);
        line += 18;
        if (!idNo.isBlank()) {
            String masked = idNo.length() > 8 ? idNo.substring(0, 4) + "**********" + idNo.substring(idNo.length() - 4) : idNo;
            graphics.drawString(this.font, "证件号：" + masked, px + 16, line, 0xFF9AA3B2, false);
            line += 18;
        }
        graphics.drawString(this.font, "公告：" + (RailwaySettings.announcement().isBlank() ? "暂无公告" : RailwaySettings.announcement()),
                px + 16, line, 0xFFE6E6E6, false);
        line += 28;
        graphics.drawString(this.font, "未检测到 MCEF，无法在游戏内嵌入购票网页。", px + 16, line, 0xFFFFC542, false);
        line += 18;
        graphics.drawString(this.font, "安装 MCEF（NeoForge 1.21.1）后重新进入即可。", px + 16, line, 0xFFB8C0CC, false);
        line += 26;
        graphics.drawString(this.font, "也可在浏览器打开：", px + 16, line, 0xFF9AA3B2, false);
        line += 16;
        graphics.drawString(this.font, pageUrl(), px + 16, line, 0xFF8ED1FC, false);
        graphics.drawString(this.font, "Esc 退出（身份证仍留在售票机内）", px + 16, py + ph - 20, 0xFF7B8798, false);
    }

    private void pollBrowserAction() {
        String url = McefBridge.url(browser);
        int hash = url.indexOf('#');
        if (hash < 0) return;
        String fragment = url.substring(hash + 1);
        String action = fragment.startsWith("print=") ? "print"
                : fragment.startsWith("pay=") ? "pay"
                : fragment.startsWith("voucher=") ? "voucher" : "";
        if (action.isBlank()) return;
        String orderNo = fragment.substring(action.length() + 1).replaceAll("[^A-Za-z0-9-]", "");
        if (orderNo.isBlank()) return;
        String key = action + ":" + orderNo;
        if (key.equals(lastAction)) return;
        lastAction = key;
        var player = Minecraft.getInstance().player;
        if (player != null) player.connection.sendCommand("railway " + action + " " + orderNo);
    }

    private int toBrowserX(double mouseX) {
        if (mouseX < px || mouseX > px + pw || pw <= 0) return -1;
        return (int) Math.max(0, Math.min(browserWidth - 1, (mouseX - px) * browserWidth / pw));
    }

    private int toBrowserY(double mouseY) {
        if (mouseY < py || mouseY > py + ph || ph <= 0) return -1;
        return (int) Math.max(0, Math.min(browserHeight - 1, (mouseY - py) * browserHeight / ph));
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (browser != null) {
            int bx = toBrowserX(mouseX);
            int by = toBrowserY(mouseY);
            if (bx >= 0 && by >= 0) {
                McefBridge.mouseMove(browser, bx, by);
                McefBridge.mousePress(browser, bx, by, button);
                return true;
            }
        }
        return super.mouseClicked(mouseX, mouseY, button);
    }

    @Override
    public boolean mouseReleased(double mouseX, double mouseY, int button) {
        if (browser != null) {
            int bx = toBrowserX(mouseX);
            int by = toBrowserY(mouseY);
            McefBridge.mouseRelease(browser, bx < 0 ? 0 : bx, by < 0 ? 0 : by, button);
            return true;
        }
        return super.mouseReleased(mouseX, mouseY, button);
    }

    @Override
    public boolean mouseDragged(double mouseX, double mouseY, int button, double dragX, double dragY) {
        if (browser != null) {
            int bx = toBrowserX(mouseX);
            int by = toBrowserY(mouseY);
            if (bx >= 0 && by >= 0) McefBridge.mouseMove(browser, bx, by);
            return true;
        }
        return super.mouseDragged(mouseX, mouseY, button, dragX, dragY);
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double deltaX, double deltaY) {
        if (browser != null) {
            int bx = toBrowserX(mouseX);
            int by = toBrowserY(mouseY);
            if (bx >= 0 && by >= 0) McefBridge.mouseWheel(browser, bx, by, deltaY, 0);
            return true;
        }
        return super.mouseScrolled(mouseX, mouseY, deltaX, deltaY);
    }

    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if (browser != null) {
            if (keyCode == org.lwjgl.glfw.GLFW.GLFW_KEY_ESCAPE) return super.keyPressed(keyCode, scanCode, modifiers);
            McefBridge.keyPress(browser, keyCode, scanCode, modifiers);
            return true;
        }
        return super.keyPressed(keyCode, scanCode, modifiers);
    }

    @Override
    public boolean keyReleased(int keyCode, int scanCode, int modifiers) {
        if (browser != null) {
            McefBridge.keyRelease(browser, keyCode, scanCode, modifiers);
            return true;
        }
        return super.keyReleased(keyCode, scanCode, modifiers);
    }

    @Override
    public boolean charTyped(char codePoint, int modifiers) {
        if (browser != null) {
            McefBridge.keyTyped(browser, codePoint, modifiers);
            return true;
        }
        return super.charTyped(codePoint, modifiers);
    }

    @Override
    public void removed() {
        if (browser != null) {
            McefBridge.close(browser);
            browser = null;
        }
        super.removed();
    }
}
