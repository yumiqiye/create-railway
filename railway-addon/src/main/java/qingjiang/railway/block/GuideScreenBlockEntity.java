package qingjiang.railway.block;

import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.protocol.game.ClientboundBlockEntityDataPacket;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import qingjiang.railway.ModBlockEntities;

/** 车站引导屏：保存该屏显示的车站，客户端据此创建 Chromium 浏览器。 */
public class GuideScreenBlockEntity extends BlockEntity {
    private String stationId = "";
    private String stationName = "";

    public GuideScreenBlockEntity(BlockPos pos, BlockState state) {
        super(ModBlockEntities.GUIDE_SCREEN.get(), pos, state);
    }

    public String stationId() {
        return stationId;
    }

    public String stationName() {
        return stationName;
    }

    public void setStation(String id, String name) {
        String safeId = id == null ? "" : id;
        String safeName = name == null ? "" : name;
        if (safeId.equals(stationId) && safeName.equals(stationName)) return;
        stationId = safeId;
        stationName = safeName;
        setChanged();
    }

    @Override
    protected void saveAdditional(CompoundTag tag, HolderLookup.Provider registries) {
        super.saveAdditional(tag, registries);
        tag.putString("StationId", stationId);
        tag.putString("StationName", stationName);
    }

    @Override
    protected void loadAdditional(CompoundTag tag, HolderLookup.Provider registries) {
        super.loadAdditional(tag, registries);
        stationId = tag.getString("StationId");
        stationName = tag.getString("StationName");
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
