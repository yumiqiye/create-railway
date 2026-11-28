package qingjiang.railway.block;

import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import qingjiang.railway.ModBlockEntities;

/** 车辆走字屏持久化文本：线路、终到站、下一站。 */
public class VehicleDisplayBlockEntity extends BlockEntity {
    private String line = "";
    private String destination = "";
    private String nextStation = "";

    public VehicleDisplayBlockEntity(BlockPos pos, BlockState state) {
        super(ModBlockEntities.VEHICLE_DISPLAY.get(), pos, state);
    }

    public String line() {
        return line;
    }

    public String destination() {
        return destination;
    }

    public String nextStation() {
        return nextStation;
    }

    public void setText(String line, String destination, String nextStation) {
        this.line = line == null ? "" : line;
        this.destination = destination == null ? "" : destination;
        this.nextStation = nextStation == null ? "" : nextStation;
        setChanged();
        if (level != null) level.sendBlockUpdated(worldPosition, getBlockState(), getBlockState(), 3);
    }

    @Override
    protected void saveAdditional(CompoundTag tag, HolderLookup.Provider registries) {
        super.saveAdditional(tag, registries);
        tag.putString("line", line);
        tag.putString("destination", destination);
        tag.putString("nextStation", nextStation);
    }

    @Override
    protected void loadAdditional(CompoundTag tag, HolderLookup.Provider registries) {
        super.loadAdditional(tag, registries);
        line = tag.getString("line");
        destination = tag.getString("destination");
        nextStation = tag.getString("nextStation");
    }
}
