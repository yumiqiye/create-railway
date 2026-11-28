package qingjiang.railway;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.jetbrains.annotations.Nullable;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/** 与独立网页端通信；不保存业务数据，全部以网页端数据库为准。 */
public final class RailwayWeb {
    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(1500))
            .version(HttpClient.Version.HTTP_1_1)
            .executor(Executors.newFixedThreadPool(2, runnable -> {
                Thread thread = new Thread(runnable, "railway-plus-web");
                thread.setDaemon(true);
                return thread;
            }))
            .build();

    private static final ExecutorService ASYNC = Executors.newCachedThreadPool(runnable -> {
        Thread thread = new Thread(runnable, "railway-plus-async");
        thread.setDaemon(true);
        return thread;
    });

    private RailwayWeb() {}

    public static void getAsync(String path, Consumer<JsonObject> onSuccess, Consumer<String> onError) {
        ASYNC.execute(() -> {
            try {
                onSuccess.accept(blockingGet(path, 2500));
            } catch (Exception e) {
                onError.accept(e.getMessage() == null ? "无法连接票务系统" : e.getMessage());
            }
        });
    }

    public static void postAsync(String path, JsonObject body, Consumer<JsonObject> onSuccess, Consumer<String> onError) {
        ASYNC.execute(() -> {
            try {
                onSuccess.accept(blockingPost(path, body, 4000));
            } catch (Exception e) {
                onError.accept(e.getMessage() == null ? "无法连接票务系统" : e.getMessage());
            }
        });
    }

    public static JsonObject blockingGet(String path, long timeoutMillis) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(uri(path))
                .timeout(Duration.ofMillis(timeoutMillis))
                .header("Accept", "application/json")
                .header("X-Railway-Token", RailwayConfig.adminToken())
                .GET()
                .build();
        return parseResponse(CLIENT.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)));
    }

    public static JsonObject blockingPost(String path, @Nullable JsonObject body, long timeoutMillis) throws Exception {
        String payload = body == null ? "{}" : body.toString();
        HttpRequest request = HttpRequest.newBuilder(uri(path))
                .timeout(Duration.ofMillis(timeoutMillis))
                .header("Content-Type", "application/json; charset=utf-8")
                .header("Accept", "application/json")
                .header("X-Railway-Token", RailwayConfig.adminToken())
                .POST(HttpRequest.BodyPublishers.ofString(payload, StandardCharsets.UTF_8))
                .build();
        return parseResponse(CLIENT.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)));
    }

    private static URI uri(String path) {
        String base = RailwayConfig.baseUrl();
        if (!path.startsWith("/")) path = "/" + path;
        return URI.create(base + path);
    }

    private static JsonObject parseResponse(HttpResponse<String> response) throws Exception {
        String body = response.body();
        JsonElement element;
        try {
            element = new JsonParser().parse(body == null || body.isBlank() ? "{}" : body);
        } catch (Exception e) {
            throw new IllegalStateException("票务系统返回了无法解析的数据（HTTP " + response.statusCode() + "）");
        }
        if (!element.isJsonObject()) throw new IllegalStateException("票务系统返回格式错误");
        JsonObject object = element.getAsJsonObject();
        int code = object.has("code") ? object.get("code").getAsInt() : response.statusCode();
        if (code != 200) {
            String message = object.has("message") ? object.get("message").getAsString() : "票务系统返回错误";
            throw new IllegalStateException(message);
        }
        return object;
    }

    public static JsonObject data(JsonObject envelope) {
        JsonElement result = envelope.get("result");
        return result != null && result.isJsonObject() ? result.getAsJsonObject() : new JsonObject();
    }

    public static String str(JsonObject object, String key, String fallback) {
        return object != null && object.has(key) && !object.get(key).isJsonNull()
                ? object.get(key).getAsString() : fallback;
    }

    public static int i(JsonObject object, String key, int fallback) {
        try {
            return object != null && object.has(key) ? object.get(key).getAsInt() : fallback;
        } catch (Exception e) {
            return fallback;
        }
    }

    public static boolean b(JsonObject object, String key, boolean fallback) {
        try {
            return object != null && object.has(key) ? object.get(key).getAsBoolean() : fallback;
        } catch (Exception e) {
            return fallback;
        }
    }
}
