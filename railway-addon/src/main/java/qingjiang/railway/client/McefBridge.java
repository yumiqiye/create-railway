package qingjiang.railway.client;

import java.lang.reflect.Method;

/** MCEF 反射桥：客户端可选依赖，不装 MCEF 时回退原生引导界面。 */
public final class McefBridge {
    private static boolean resolved;
    private static boolean present;
    private static Method isInitialized;
    private static Method createBrowser;
    private static Method resize;
    private static Method close;
    private static Method getRenderer;
    private static Method getTextureID;
    private static Method sendMouseMove;
    private static Method sendMousePress;
    private static Method sendMouseRelease;
    private static Method sendMouseWheel;
    private static Method sendKeyPress;
    private static Method sendKeyRelease;
    private static Method sendKeyTyped;
    private static Method getURL;

    private McefBridge() {}

    private static synchronized void resolve() {
        if (resolved) return;
        resolved = true;
        try {
            Class<?> mcef = Class.forName("com.cinemamod.mcef.MCEF");
            isInitialized = mcef.getMethod("isInitialized");
            createBrowser = mcef.getMethod("createBrowser", String.class, boolean.class, int.class, int.class);
            Class<?> browserClass = Class.forName("com.cinemamod.mcef.MCEFBrowser");
            resize = browserClass.getMethod("resize", int.class, int.class);
            close = browserClass.getMethod("close");
            getRenderer = browserClass.getMethod("getRenderer");
            getURL = browserClass.getMethod("getURL");
            sendMouseMove = browserClass.getMethod("sendMouseMove", int.class, int.class);
            sendMousePress = browserClass.getMethod("sendMousePress", int.class, int.class, int.class);
            sendMouseRelease = browserClass.getMethod("sendMouseRelease", int.class, int.class, int.class);
            sendMouseWheel = browserClass.getMethod("sendMouseWheel", int.class, int.class, double.class, int.class);
            sendKeyPress = browserClass.getMethod("sendKeyPress", int.class, long.class, int.class);
            sendKeyRelease = browserClass.getMethod("sendKeyRelease", int.class, long.class, int.class);
            sendKeyTyped = browserClass.getMethod("sendKeyTyped", char.class, int.class);
            Class<?> rendererClass = Class.forName("com.cinemamod.mcef.MCEFRenderer");
            getTextureID = rendererClass.getMethod("getTextureID");
            present = true;
        } catch (Throwable ignored) {
            present = false;
        }
    }

    public static boolean ready() {
        resolve();
        if (!present) return false;
        try {
            Object value = isInitialized.invoke(null);
            return value instanceof Boolean bool && bool;
        } catch (Throwable ignored) {
            return false;
        }
    }

    public static boolean installed() {
        resolve();
        return present;
    }

    public static Object create(String url, int width, int height) {
        if (!ready() || width <= 0 || height <= 0) return null;
        try {
            return createBrowser.invoke(null, url, false, width, height);
        } catch (Throwable ignored) {
            return null;
        }
    }

    public static void resize(Object browser, int width, int height) {
        invoke(resize, browser, width, height);
    }

    public static void close(Object browser) {
        invoke(close, browser);
    }

    public static String url(Object browser) {
        if (browser == null || getURL == null) return "";
        try {
            Object value = getURL.invoke(browser);
            return value instanceof String text ? text : "";
        } catch (Throwable ignored) {
            return "";
        }
    }

    public static int textureId(Object browser) {
        if (browser == null) return 0;
        try {
            Object renderer = getRenderer.invoke(browser);
            Object id = renderer == null ? null : getTextureID.invoke(renderer);
            return id instanceof Integer value ? value : 0;
        } catch (Throwable ignored) {
            return 0;
        }
    }

    public static void mouseMove(Object browser, int x, int y) {
        invoke(sendMouseMove, browser, x, y);
    }

    public static void mousePress(Object browser, int x, int y, int button) {
        invoke(sendMousePress, browser, x, y, button);
    }

    public static void mouseRelease(Object browser, int x, int y, int button) {
        invoke(sendMouseRelease, browser, x, y, button);
    }

    public static void mouseWheel(Object browser, int x, int y, double amount, int modifiers) {
        invoke(sendMouseWheel, browser, x, y, amount, modifiers);
    }

    public static void keyPress(Object browser, int keyCode, long scanCode, int modifiers) {
        invoke(sendKeyPress, browser, keyCode, scanCode, modifiers);
    }

    public static void keyRelease(Object browser, int keyCode, long scanCode, int modifiers) {
        invoke(sendKeyRelease, browser, keyCode, scanCode, modifiers);
    }

    public static void keyTyped(Object browser, char character, int modifiers) {
        invoke(sendKeyTyped, browser, character, modifiers);
    }

    private static void invoke(Method method, Object target, Object... args) {
        if (method == null || target == null) return;
        try {
            method.invoke(target, args);
        } catch (Throwable ignored) {
        }
    }
}
