package qingjiang.railway.client;

import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.BufferBuilder;
import com.mojang.blaze3d.vertex.BufferUploader;
import com.mojang.blaze3d.vertex.DefaultVertexFormat;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.Tesselator;
import com.mojang.blaze3d.vertex.VertexFormat;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.GameRenderer;
import net.minecraft.client.renderer.blockentity.BlockEntityRenderer;
import net.minecraft.client.renderer.blockentity.BlockEntityRendererProvider;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent;
import org.joml.Matrix4f;
import qingjiang.railway.ModBlocks;
import qingjiang.railway.RailwayAddon;
import qingjiang.railway.RailwayConfig;
import qingjiang.railway.block.GuideScreenBlock;
import qingjiang.railway.block.GuideScreenBlockEntity;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * 车站引导屏的方块实体渲染。
 * 相邻、同朝向、同车站的屏自动拼成一条横屏；一台 Chromium 浏览器渲染整页，
 * 每个方块只取整页对应的横向切片。坐标直接落在方块局部模型内，避免世界事件里二次相机平移导致悬空。
 */
@EventBusSubscriber(modid = RailwayAddon.MOD_ID, value = Dist.CLIENT)
public final class GuideScreenRenderer implements BlockEntityRenderer<GuideScreenBlockEntity> {
    private static final int MAX_CHAIN = 16;
    private static final int TILE_PIXELS = 480;
    private static final int MAX_TEXTURE_SIZE = 4096;
    private static final double VIEW_DISTANCE = 96.0D;
    private static final long BROWSER_IDLE_MS = 15_000L;

    public static final BlockEntityRendererProvider<GuideScreenBlockEntity> PROVIDER =
            context -> new GuideScreenRenderer();

    private static final Map<BlockPos, ScreenBrowser> BROWSERS = new HashMap<>();

    private GuideScreenRenderer() {}

    @SubscribeEvent
    public static void onLogout(ClientPlayerNetworkEvent.LoggingOut event) {
        closeAll();
    }

    @Override
    public void render(GuideScreenBlockEntity screen, float partialTick, PoseStack poseStack,
                       net.minecraft.client.renderer.MultiBufferSource buffers, int packedLight, int packedOverlay) {
        Level level = screen.getLevel();
        if (level == null) return;

        BlockPos pos = screen.getBlockPos();
        Minecraft minecraft = Minecraft.getInstance();
        Vec3 camera = minecraft.getCameraEntity() != null ? minecraft.getCameraEntity().position() : Vec3.ZERO;
        if (camera.distanceToSqr(pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5)
                > VIEW_DISTANCE * VIEW_DISTANCE) return;

        BlockState state = level.getBlockState(pos);
        if (!state.is(ModBlocks.GUIDE_SCREEN.get())) return;

        long now = System.currentTimeMillis();
        Direction facing = state.getValue(GuideScreenBlock.FACING);
        Group group = groupFor(level, screen, facing);
        ScreenBrowser browser = browserFor(group, now);
        if (browser == null) return;

        int pixelsPerBlock = Math.max(1, Math.min(TILE_PIXELS,
                MAX_TEXTURE_SIZE / Math.max(group.cols, group.rows)));
        int width = pixelsPerBlock * group.cols;
        int height = pixelsPerBlock * group.rows;
        ensureBrowser(browser, group, width, height, now);
        if (browser.browser == null) return;

        int texture = McefBridge.textureId(browser.browser);
        if (texture == 0) return;

        float u0 = group.col / (float) group.cols;
        float u1 = (group.col + 1) / (float) group.cols;
        float v0 = (group.rows - 1 - group.row) / (float) group.rows;
        float v1 = (group.rows - group.row) / (float) group.rows;

        RenderSystem.enableDepthTest();
        RenderSystem.depthMask(true);
        RenderSystem.enableBlend();
        RenderSystem.defaultBlendFunc();
        RenderSystem.disableCull();
        RenderSystem.setShader(GameRenderer::getPositionTexColorShader);
        RenderSystem.setShaderColor(1.0F, 1.0F, 1.0F, 1.0F);
        RenderSystem.setShaderTexture(0, texture);
        drawTile(poseStack, facing, screenScale(screen), u0, u1, v0, v1);

        evictIdle(now);
    }

    private static ScreenBrowser browserFor(Group group, long now) {
        ScreenBrowser browser = BROWSERS.get(group.origin);
        if (browser != null && !browser.stationId.equals(group.stationId)) {
            browser.close();
            BROWSERS.remove(group.origin);
            browser = null;
        }
        if (browser == null) {
            browser = new ScreenBrowser(group.stationId, -1, -1, now + 500L);
            BROWSERS.put(group.origin, browser);
        }
        browser.lastSeen = now;
        return browser;
    }

    private static void ensureBrowser(ScreenBrowser browser, Group group, int width, int height, long now) {
        if (browser.browser == null) {
            if (now < browser.nextAttempt) return;
            String url = RailwayConfig.baseUrl() + "/guide.html?embed=1&screen=1"
                    + "&cols=" + group.cols + "&rows=" + group.rows;
            if (!group.stationId.isBlank()) {
                url += "&stationId=" + URLEncoder.encode(group.stationId, StandardCharsets.UTF_8);
            }
            browser.browser = McefBridge.create(url, width, height);
            browser.cols = group.cols;
            browser.rows = group.rows;
            browser.width = width;
            browser.height = height;
            browser.nextAttempt = now + 1_000L;
            return;
        }
        if (browser.cols != group.cols || browser.rows != group.rows || browser.width != width || browser.height != height) {
            browser.cols = group.cols;
            browser.rows = group.rows;
            browser.width = width;
            browser.height = height;
            McefBridge.resize(browser.browser, width, height);
        }
    }

    /** 读取方块实体上保存的屏幕缩放系数；缺失时按整屏 1.0 渲染。 */
    private static float screenScale(GuideScreenBlockEntity screen) {
        float scale = screen.scale();
        return Math.max(0.5F, Math.min(1.5F, Float.isFinite(scale) ? scale : 1.0F));
    }

    /** 找到这块拼屏的左下角、当前方块所在的行列和整屏列数/行数；最多 16×16。 */
    private static Group groupFor(Level level, GuideScreenBlockEntity screen, Direction facing) {
        Direction right = rightward(facing);
        BlockPos pos = screen.getBlockPos();
        BlockPos left = pos;
        int col = 0;
        for (int i = 0; i < MAX_CHAIN - 1; i++) {
            BlockPos next = left.relative(right.getOpposite());
            if (!sameScreen(level, next, facing, screen.stationId())) break;
            left = next;
            col++;
        }
        BlockPos bottom = left;
        int row = 0;
        for (int i = 0; i < MAX_CHAIN - 1; i++) {
            BlockPos next = bottom.below();
            if (!sameScreen(level, next, facing, screen.stationId())) break;
            bottom = next;
            row++;
        }

        int cols = 1;
        BlockPos cursor = left;
        while (cols < MAX_CHAIN && sameScreen(level, cursor.relative(right), facing, screen.stationId())) {
            cursor = cursor.relative(right);
            cols++;
        }
        int rows = 1;
        cursor = bottom;
        while (rows < MAX_CHAIN && sameScreen(level, cursor.above(), facing, screen.stationId())) {
            cursor = cursor.above();
            rows++;
        }
        return new Group(bottom.immutable(), col, row, cols, rows, screen.stationId());
    }

    private static boolean sameScreen(Level level, BlockPos pos, Direction facing, String stationId) {
        BlockState state = level.getBlockState(pos);
        if (!state.is(ModBlocks.GUIDE_SCREEN.get())) return false;
        if (state.getValue(GuideScreenBlock.FACING) != facing) return false;
        return level.getBlockEntity(pos) instanceof GuideScreenBlockEntity other
                && other.stationId().equals(stationId);
    }

    /** 屏幕朝外侧观看时，“向右”对应的水平方向。 */
    private static Direction rightward(Direction facing) {
        return switch (facing) {
            case NORTH -> Direction.WEST;
            case SOUTH -> Direction.EAST;
            case EAST -> Direction.NORTH;
            case WEST -> Direction.SOUTH;
            default -> Direction.EAST;
        };
    }

    private static void drawTile(PoseStack poseStack, Direction facing, float scale,
                                 float u0, float u1, float v0, float v1) {
        Matrix4f matrix = poseStack.last().pose();
        BufferBuilder buffer = Tesselator.getInstance()
                .begin(VertexFormat.Mode.QUADS, DefaultVertexFormat.POSITION_TEX_COLOR);
        float eps = 0.003F;
        float cx = 0.5F;
        float cy = 0.5F;
        float cz = 0.5F;
        float half = 0.5F * Math.max(0.5F, Math.min(1.5F, scale));

        switch (facing) {
            case NORTH -> {
                vertex(buffer, matrix, cx + half, cy - half, cz - 0.5F - eps, u0, v1);
                vertex(buffer, matrix, cx - half, cy - half, cz - 0.5F - eps, u1, v1);
                vertex(buffer, matrix, cx - half, cy + half, cz - 0.5F - eps, u1, v0);
                vertex(buffer, matrix, cx + half, cy + half, cz - 0.5F - eps, u0, v0);
            }
            case SOUTH -> {
                vertex(buffer, matrix, cx - half, cy - half, cz + 0.5F + eps, u0, v1);
                vertex(buffer, matrix, cx + half, cy - half, cz + 0.5F + eps, u1, v1);
                vertex(buffer, matrix, cx + half, cy + half, cz + 0.5F + eps, u1, v0);
                vertex(buffer, matrix, cx - half, cy + half, cz + 0.5F + eps, u0, v0);
            }
            case EAST -> {
                vertex(buffer, matrix, cx + 0.5F + eps, cy - half, cz + half, u0, v1);
                vertex(buffer, matrix, cx + 0.5F + eps, cy - half, cz - half, u1, v1);
                vertex(buffer, matrix, cx + 0.5F + eps, cy + half, cz - half, u1, v0);
                vertex(buffer, matrix, cx + 0.5F + eps, cy + half, cz + half, u0, v0);
            }
            case WEST -> {
                vertex(buffer, matrix, cx - 0.5F - eps, cy - half, cz - half, u0, v1);
                vertex(buffer, matrix, cx - 0.5F - eps, cy - half, cz + half, u1, v1);
                vertex(buffer, matrix, cx - 0.5F - eps, cy + half, cz + half, u1, v0);
                vertex(buffer, matrix, cx - 0.5F - eps, cy + half, cz - half, u0, v0);
            }
            default -> {
            }
        }
        BufferUploader.drawWithShader(buffer.buildOrThrow());
    }

    private static void vertex(BufferBuilder buffer, Matrix4f matrix, float x, float y, float z, float u, float v) {
        buffer.addVertex(matrix, x, y, z).setUv(u, v).setColor(255, 255, 255, 255);
    }

    private static void evictIdle(long now) {
        BROWSERS.entrySet().removeIf(entry -> {
            ScreenBrowser browser = entry.getValue();
            if (now - browser.lastSeen > BROWSER_IDLE_MS) {
                browser.close();
                return true;
            }
            return false;
        });
    }

    private static void closeAll() {
        for (ScreenBrowser browser : BROWSERS.values()) browser.close();
        BROWSERS.clear();
    }

    private static final class ScreenBrowser {
        private final String stationId;
        private Object browser;
        private int cols;
        private int rows;
        private int width;
        private int height;
        private long lastSeen;
        private long nextAttempt;

        private ScreenBrowser(String stationId, int cols, int rows, long nextAttempt) {
            this.stationId = stationId;
            this.cols = cols;
            this.rows = rows;
            this.nextAttempt = nextAttempt;
        }

        private void close() {
            if (browser != null) {
                McefBridge.close(browser);
                browser = null;
            }
        }
    }

    private record Group(BlockPos origin, int col, int row, int cols, int rows, String stationId) {}
}
