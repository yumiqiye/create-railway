package qingjiang.railway;

import net.neoforged.fml.ModList;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Create / CRN / Simurail 兼容探测。
 * 这里只记录已加载状态与 Mod ID，不直接引用第三方模组类；具体时刻表、车站、列车显示联动通过后端兼容桥和反射/注册名完成。
 */
public final class RailwayCompat {
    public static final String CREATE = "create";
    public static final String CRN = "createrailwaysnavigator";
    public static final String SIMURAIL = "simurail";

    private RailwayCompat() {}

    public static boolean loaded(String modId) {
        return ModList.get() != null && ModList.get().isLoaded(modId);
    }

    public static Map<String, Boolean> status() {
        Map<String, Boolean> result = new LinkedHashMap<>();
        result.put(CREATE, loaded(CREATE));
        result.put(CRN, loaded(CRN));
        result.put(SIMURAIL, loaded(SIMURAIL));
        return result;
    }
}
