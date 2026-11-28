package qingjiang.railway;

import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.CustomData;
import net.minecraft.world.level.block.state.BlockState;
import qingjiang.railway.block.RailwayTvBlock;
import qingjiang.railway.block.RailwayTvBlockEntity;
import qingjiang.railway.network.UrlSetPayload;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashSet;
import java.util.Set;

/** 保存电视 / 平板自定义网页到方块实体或物品 NBT。 */
public final class UrlConfigService {
    public static final int TARGET_TV = 0;
    public static final int TARGET_TABLET = 1;
    public static final String URL_TAG = "Url";
    public static final String DEFAULT_URL = "https://www.baidu.com";

    private UrlConfigService() {}

    public static void apply(ServerPlayer player, UrlSetPayload payload) {
        if (!player.hasPermissions(2)) {
            player.displayClientMessage(Component.literal("仅限工作人员配置网页")
                    .withStyle(net.minecraft.ChatFormatting.RED), true);
            return;
        }

        if (payload.target() == TARGET_TV) {
            ServerLevel level = player.serverLevel();
            BlockPos pos = payload.pos();
            if (!(level.getBlockEntity(pos) instanceof RailwayTvBlockEntity tv)) {
                player.displayClientMessage(Component.literal("该位置不是电视方块")
                        .withStyle(net.minecraft.ChatFormatting.RED), true);
                return;
            }
            int count = applyToGroup(level, pos, payload.reset() ? "" : payload.url().trim(), payload.reset());
            player.displayClientMessage(Component.literal(
                            (payload.reset() ? "电视网页已恢复默认" : "电视网页已更新") + "，已同步整组 " + count + " 台")
                    .withStyle(net.minecraft.ChatFormatting.GREEN), true);
            return;
        }

        ItemStack stack = player.getMainHandItem();
        if (stack.isEmpty()) stack = player.getOffhandItem();
        if (stack.isEmpty()) {
            player.displayClientMessage(Component.literal("请手持平板")
                    .withStyle(net.minecraft.ChatFormatting.RED), true);
            return;
        }
        CompoundTag tag = stack.getOrDefault(DataComponents.CUSTOM_DATA, CustomData.EMPTY).copyTag();
        if (payload.reset()) {
            tag.remove(URL_TAG);
            player.displayClientMessage(Component.literal("平板网页已恢复默认")
                    .withStyle(net.minecraft.ChatFormatting.GREEN), true);
        } else {
            tag.putString(URL_TAG, payload.url().trim());
            player.displayClientMessage(Component.literal("平板网页已更新")
                    .withStyle(net.minecraft.ChatFormatting.GREEN), true);
        }
        stack.set(DataComponents.CUSTOM_DATA, CustomData.of(tag));
    }

    /**
     * 按物理连通组同步网址：与起点相邻、同方块、同朝向的电视视为同一面拼屏，
     * 整组一并写入新网址并刷新客户端。返回本次改写的电视台数。
     */
    public static int applyToGroup(ServerLevel level, BlockPos origin, String url, boolean reset) {
        Set<BlockPos> visited = new HashSet<>();
        Deque<BlockPos> queue = new ArrayDeque<>();
        queue.add(origin);
        visited.add(origin);
        int count = 0;

        while (!queue.isEmpty()) {
            BlockPos pos = queue.poll();
            if (!(level.getBlockEntity(pos) instanceof RailwayTvBlockEntity tv)) continue;
            tv.setUrl(reset ? "" : url);
            level.sendBlockUpdated(pos, level.getBlockState(pos), level.getBlockState(pos), 3);
            count++;

            Direction facing = level.getBlockState(pos).getValue(RailwayTvBlock.FACING);
            for (Direction dir : Direction.values()) {
                // 朝向正反两面不相邻；拼屏只在墙面平面内左右、上下相连。
                if (dir == facing || dir == facing.getOpposite()) continue;
                BlockPos next = pos.relative(dir);
                if (visited.contains(next)) continue;
                BlockState state = level.getBlockState(next);
                if (!state.is(ModBlocks.TV.get())) continue;
                if (state.getValue(RailwayTvBlock.FACING) != facing) continue;
                visited.add(next);
                queue.add(next);
            }
        }
        return count;
    }
}
