package qingjiang.railway.block;

import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.protocol.game.ClientboundBlockEntityDataPacket;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import qingjiang.railway.ModBlockEntities;
import qingjiang.railway.UrlConfigService;

/** 世界内电视：保存显示网页路径；客户端据此创建 Chromium 浏览器。 */
public class RailwayTvBlockEntity extends BlockEntity {
    private String url = "";

    public RailwayTvBlockEntity(BlockPos pos, BlockState state) {
        super(ModBlockEntities.TV.get(), pos, state);
    }

    public String url() {
        return url == null || url.isBlank() ? UrlConfigService.DEFAULT_URL : url;
    }

    public boolean isConfigured() {
        return url != null && !url.isBlank();
    }

    public void setUrl(String value) {
        this.url = value == null ? "" : value;
        setChanged();
    }

    @Override
    protected void saveAdditional(CompoundTag tag, HolderLookup.Provider registries) {
        super.saveAdditional(tag, registries);
        tag.putString("Url", url);
    }

    @Override
    protected void loadAdditional(CompoundTag tag, HolderLookup.Provider registries) {
        super.loadAdditional(tag, registries);
        url = tag.getString("Url");
    }

    @Override
    public CompoundTag getUpdateTag(HolderLookup.Provider registries) {
        return saveWithoutMetadata(registries);
    }

    @Override
    public ClientboundBlockEntityDataPacket getUpdatePacket() {
        return ClientboundBlockEntityDataPacket.create(this);
    }
}
