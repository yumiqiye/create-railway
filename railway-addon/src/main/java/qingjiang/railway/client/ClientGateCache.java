package qingjiang.railway.client;

import qingjiang.railway.network.GateStatusPayload;

/** 闸机提示已改为动作栏/聊天栏显示，世界悬浮文字停用。 */
public final class ClientGateCache {
    private ClientGateCache() {}

    public static void accept(GateStatusPayload payload) {
        // 不再缓存、不再渲染世界空间文字。
    }
}
