package qingjiang.railway.client;

import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.BufferBuilder;
import com.mojang.blaze3d.vertex.BufferUploader;
import com.mojang.blaze3d.vertex.DefaultVertexFormat;
import com.mojang.blaze3d.vertex.Tesselator;
import com.mojang.blaze3d.vertex.VertexFormat;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.MenuAccess;
import net.minecraft.client.renderer.GameRenderer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.Inventory;
import org.joml.Matrix4f;
import org.lwjgl.glfw.GLFW;
import qingjiang.railway.RailwayConfig;
import qingjiang.railway.UrlConfigService;
import qingjiang.railway.menu.StaffTerminalMenu;
import qingjiang.railway.network.StaffResultPayload;

/**
 * 人工终端：电脑/检票机直接内嵌 8001 后台网页。
 * 刻意使用普通 {@link Screen}，不使用 AbstractContainerScreen，避免 JEI 把它识别成容器界面并在右侧弹出配方面板。
 */
public class StaffTerminalScreen extends Screen implements MenuAccess<StaffTerminalMenu> {
    private final StaffTerminalMenu menu;
    private final String customUrl;
    private int px;
    private int py;
    private int pw;
    private int ph;

    private Object browser;
    private int browserWidth;
    private int browserHeight;
    private int lastMouseX = -1;
    private int lastMouseY = -1;

    public StaffTerminalScreen(StaffTerminalMenu menu, Inventory inventory, Component title) {
        super(title);
        this.menu = menu;
        String raw = title.getString();
        String[] parts = raw.split("\u0001", -1);
        this.customUrl = parts.length >= 4 ? parts[3] : "";
    }

    @Override
    public StaffTerminalMenu getMenu() {
        return menu;
    }

    @Override
    public void onClose() {
        if (this.minecraft != null && this.minecraft.player != null) {
            this.minecraft.player.closeContainer();
        } else {
            super.onClose();
        }
    }

    /** 兼容旧的人工服务返回包；网页模式不再在客户端显示状态文字。 */
    public static void accept(StaffResultPayload payload) {
    }

    @Override
    protected void init() {
        super.init();
        pw = Math.max(160, this.width - 24);
        ph = Math.max(120, this.height - 44);
        px = (this.width - pw) / 2;
        py = 12;
        openBrowser();
    }

    private String pageUrl() {
        if (!customUrl.isBlank()) return resolveUrl(customUrl, isCustomPage());
        if (isCustomPage()) return UrlConfigService.DEFAULT_URL;
        String base = RailwayConfig.adminBaseUrl();
        return switch (menu.mode()) {
            case 2 -> base + "/checkin/index";
            case 3 -> base + "/";
            default -> base + "/";
        };
    }

    /** 平板 / 电视：展示玩家配置的自定义网页；电脑 / 检票机：绑定后台终端页。 */
    private boolean isCustomPage() {
        int m = menu.mode();
        return m == 4 || m == 5;
    }

    private static String resolveUrl(String url, boolean custom) {
        if (url.startsWith("http://") || url.startsWith("https://")) return url;
        String base = custom ? RailwayConfig.baseUrl() : RailwayConfig.adminBaseUrl();
        return url.startsWith("/") ? base + url : base + "/" + url;
    }

    private String pageTitle() {
        return switch (menu.mode()) {
            case 2 -> "人工检票机 · 8001 后台";
            case 3 -> "车载调度屏 · 8001 后台";
            case 4 -> "手持平板 · 自定义网页";
            case 5 -> "世界电视 · 自定义网页";
            default -> "铁路电脑 · 8001 后台";
        };
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
            graphics.fill(px - 2, py - 2, px + pw + 2, py + ph + 2, 0xFF2F6FB5);
            int texture = McefBridge.textureId(browser);
            if (texture != 0) {
                drawTexture(graphics, texture, px, py, pw, ph);
            } else {
                graphics.drawString(this.font, "8001 后台网页渲染中…", px + 16, py + 16, 0xFFFFFFFF, false);
            }
            graphics.fill(px, py + ph, px + pw, py + ph + 20, 0xCC0D1015);
            graphics.drawString(this.font, pageTitle() + "　Esc 退出", px + 8, py + ph + 6, 0xFFB8C0CC, false);
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
        graphics.drawString(this.font, pageTitle(), px + 16, py + 12, 0xFFF5C542, false);
        graphics.drawString(this.font, "未检测到 MCEF，无法内嵌 8001 后台网页", px + 16, py + 28, 0xFFB8C0CC, false);
        graphics.drawString(this.font, "安装 mcef-neoforge 1.21.1 后重新进入即可。", px + 16, py + 66, 0xFFB8C0CC, false);
        graphics.drawString(this.font, "也可在浏览器打开：", px + 16, py + 92, 0xFF9AA3B2, false);
        graphics.drawString(this.font, pageUrl(), px + 16, py + 108, 0xFF8ED1FC, false);
        graphics.drawString(this.font, "Esc 退出", px + 16, py + ph - 20, 0xFF7B8798, false);
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
                McefBridge.setFocus(browser, true);
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
            McefBridge.setFocus(browser, true);
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
            if (keyCode == GLFW.GLFW_KEY_ESCAPE) return super.keyPressed(keyCode, scanCode, modifiers);
            McefBridge.keyPress(browser, keyCode, scanCode, modifiers);
            McefBridge.setFocus(browser, true);
            return true;
        }
        return super.keyPressed(keyCode, scanCode, modifiers);
    }

    @Override
    public boolean keyReleased(int keyCode, int scanCode, int modifiers) {
        if (browser != null) {
            McefBridge.keyRelease(browser, keyCode, scanCode, modifiers);
            McefBridge.setFocus(browser, true);
            return true;
        }
        return super.keyReleased(keyCode, scanCode, modifiers);
    }

    @Override
    public boolean charTyped(char codePoint, int modifiers) {
        if (browser != null) {
            McefBridge.keyTyped(browser, codePoint, modifiers);
            McefBridge.setFocus(browser, true);
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
