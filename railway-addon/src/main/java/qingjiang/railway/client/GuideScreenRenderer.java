package qingjiang.railway.client;

import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.BufferBuilder;
import com.mojang.blaze3d.vertex.BufferUploader;
import com.mojang.blaze3d.vertex.DefaultVertexFormat;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.Tesselator;
import com.mojang.blaze3d.vertex.VertexFormat;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.GameRenderer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.SectionPos;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.chunk.status.ChunkStatus;
import net.minecraft.world.phys.Vec3;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent;
import net.neoforged.neoforge.client.event.RenderLevelStageEvent;
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
 * 车站引导屏的世界渲染。
 * 相邻、同朝向、同车站的屏自动拼成一条横屏；一台 Chromium 浏览器渲染整页，
 * 每个方块只取整页对应的横向切片，随墙面宽度自动缩放适配。
 */
@EventBusSubscriber(modid = RailwayAddon.MOD_ID, value = Dist.CLIENT)
public final class GuideScreenRenderer {
    private static final int MAX_CHAIN = 16;
    private static final int TILE_PIXELS = 480;
    private static final int MAX_TEXTURE_SIZE = 4096;
    private static final double VIEW_DISTANCE = 96.0D;
    private static final long BROWSER_IDLE_MS = 15_000L;

    private static ClientLevel activeLevel;
    private static final Map<BlockPos, ScreenBrowser> BROWSERS = new HashMap<>();

    private GuideScreenRenderer() {}

    @SubscribeEvent
    public static void onLogout(ClientPlayerNetworkEvent.LoggingOut event) {
        closeAll();
        activeLevel = null;
    }

    @SubscribeEvent
    public static void onRenderLevel(RenderLevelStageEvent event) {
        if (event.getStage() != RenderLevelStageEvent.Stage.AFTER_TRANSLUCENT_BLOCKS) return;
        Minecraft minecraft = Minecraft.getInstance();
        ClientLevel level = minecraft.level;
        if (level == null) {
            closeAll();
            return;
        }
        if (level != activeLevel) {
            closeAll();
            activeLevel = level;
        }

        long now = System.currentTimeMillis();
        Vec3 camera = event.getCamera().getPosition();
        PoseStack poseStack = event.getPoseStack();

        poseStack.pushPose();
        poseStack.translate(-camera.x, -camera.y, -camera.z);

        RenderSystem.enableBlend();
        RenderSystem.defaultBlendFunc();
        RenderSystem.disableCull();
        RenderSystem.setShader(GameRenderer::getPositionTexColorShader);
        RenderSystem.setShaderColor(1.0F, 1.0F, 1.0F, 1.0F);

        int minChunkX = SectionPos.blockToSectionCoord(camera.x - VIEW_DISTANCE);
        int maxChunkX = SectionPos.blockToSectionCoord(camera.x + VIEW_DISTANCE);
        int minChunkZ = SectionPos.blockToSectionCoord(camera.z - VIEW_DISTANCE);
        int maxChunkZ = SectionPos.blockToSectionCoord(camera.z + VIEW_DISTANCE);

        for (int cx = minChunkX; cx <= maxChunkX; cx++) {
            for (int cz = minChunkZ; cz <= maxChunkZ; cz++) {
                LevelChunk chunk = level.getChunkSource().getChunk(cx, cz, ChunkStatus.FULL, false);
                if (chunk == null) continue;
                for (BlockEntity blockEntity : chunk.getBlockEntities().values()) {
                    if (!(blockEntity instanceof GuideScreenBlockEntity screen)) continue;
                    BlockPos pos = screen.getBlockPos();
                    if (camera.distanceToSqr(pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5)
                            > VIEW_DISTANCE * VIEW_DISTANCE) continue;
                    BlockState state = level.getBlockState(pos);
                    if (!state.is(ModBlocks.GUIDE_SCREEN.get())) continue;
                    renderScreen(level, screen, state, poseStack, now);
                }
            }
        }

        RenderSystem.enableCull();
        RenderSystem.disableBlend();
        RenderSystem.setShaderColor(1.0F, 1.0F, 1.0F, 1.0F);
        poseStack.popPose();

        evictIdle(now);
    }

    private static void renderScreen(ClientLevel level, GuideScreenBlockEntity screen, BlockState state,
                                     PoseStack poseStack, long now) {
        Direction facing = state.getValue(GuideScreenBlock.FACING);
        Group group = groupFor(level, screen, state, facing);
        ScreenBrowser browser = BROWSERS.get(group.origin);

        if (browser == null) {
            browser = new ScreenBrowser(group.stationId, -1, -1, now + 500L);
            BROWSERS.put(group.origin, browser);
        } else if (!browser.stationId.equals(group.stationId)) {
            browser.close();
            browser = new ScreenBrowser(group.stationId, -1, -1, now + 500L);
            BROWSERS.put(group.origin, browser);
        }

        browser.lastSeen = now;
        int pixelsPerBlock = Math.max(1, Math.min(TILE_PIXELS,
                MAX_TEXTURE_SIZE / Math.max(group.cols, group.rows)));
        int width = pixelsPerBlock * group.cols;
        int height = pixelsPerBlock * group.rows;
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
            if (browser.browser == null) return;
        } else if (browser.cols != group.cols || browser.rows != group.rows) {
            browser.cols = group.cols;
            browser.rows = group.rows;
            browser.width = width;
            browser.height = height;
            McefBridge.resize(browser.browser, width, height);
        }

        int texture = McefBridge.textureId(browser.browser);
        if (texture == 0) return;

        float u0 = group.col / (float) group.cols;
        float u1 = (group.col + 1) / (float) group.cols;
        float v0 = (group.rows - 1 - group.row) / (float) group.rows;
        float v1 = (group.rows - group.row) / (float) group.rows;
        RenderSystem.setShaderTexture(0, texture);
        drawTile(poseStack, screen.getBlockPos(), facing, u0, u1, v0, v1);
    }

    /** 找到这块拼屏的左下角、当前方块所在的行列和整屏列数/行数；最多 16×16。 */
    private static Group groupFor(ClientLevel level, GuideScreenBlockEntity screen, BlockState state, Direction facing) {
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

    private static boolean sameScreen(ClientLevel level, BlockPos pos, Direction facing, String stationId) {
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

    private static void drawTile(PoseStack poseStack, BlockPos pos, Direction facing,
                                 float u0, float u1, float v0, float v1) {
        Matrix4f matrix = poseStack.last().pose();
        BufferBuilder buffer = Tesselator.getInstance()
                .begin(VertexFormat.Mode.QUADS, DefaultVertexFormat.POSITION_TEX_COLOR);
        float eps = 0.003F;
        float x = pos.getX();
        float y = pos.getY();
        float z = pos.getZ();

        switch (facing) {
            case NORTH -> {
                vertex(buffer, matrix, x + 1, y, z - eps, u0, v1);
                vertex(buffer, matrix, x, y, z - eps, u1, v1);
                vertex(buffer, matrix, x, y + 1, z - eps, u1, v0);
                vertex(buffer, matrix, x + 1, y + 1, z - eps, u0, v0);
            }
            case SOUTH -> {
                vertex(buffer, matrix, x, y, z + 1 + eps, u0, v1);
                vertex(buffer, matrix, x + 1, y, z + 1 + eps, u1, v1);
                vertex(buffer, matrix, x + 1, y + 1, z + 1 + eps, u1, v0);
                vertex(buffer, matrix, x, y + 1, z + 1 + eps, u0, v0);
            }
            case EAST -> {
                vertex(buffer, matrix, x + 1 + eps, y, z + 1, u0, v1);
                vertex(buffer, matrix, x + 1 + eps, y, z, u1, v1);
                vertex(buffer, matrix, x + 1 + eps, y + 1, z, u1, v0);
                vertex(buffer, matrix, x + 1 + eps, y + 1, z + 1, u0, v0);
            }
            case WEST -> {
                vertex(buffer, matrix, x - eps, y, z, u0, v1);
                vertex(buffer, matrix, x - eps, y, z + 1, u1, v1);
                vertex(buffer, matrix, x - eps, y + 1, z + 1, u1, v0);
                vertex(buffer, matrix, x - eps, y + 1, z, u0, v0);
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
