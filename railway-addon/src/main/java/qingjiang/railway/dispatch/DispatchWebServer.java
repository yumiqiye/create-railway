package qingjiang.railway.dispatch;

import qingjiang.railway.RailwayAddon;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * 极简 HTTP/1.1 服务端：只监听 127.0.0.1，不依赖任何第三方库。
 * 由原 PyRailDispatch 的 WebServer 内置迁入。
 */
public final class DispatchWebServer implements AutoCloseable {

    public interface Router {
        Response route(String method, String path, String query, String body) throws Exception;
    }

    public static final class Response {
        public final int status;
        public final String contentType;
        public final byte[] body;

        public Response(int status, String contentType, byte[] body) {
            this.status = status;
            this.contentType = contentType;
            this.body = body;
        }

        public static Response json(String text) {
            return new Response(200, "application/json; charset=utf-8", text.getBytes(StandardCharsets.UTF_8));
        }

        public static Response json(int status, String text) {
            return new Response(status, "application/json; charset=utf-8", text.getBytes(StandardCharsets.UTF_8));
        }

        public static Response html(String text) {
            return new Response(200, "text/html; charset=utf-8", text.getBytes(StandardCharsets.UTF_8));
        }

        public static Response asset(String type, byte[] data) {
            return new Response(200, type, data);
        }

        public static Response text(int status, String message) {
            return new Response(status, "text/plain; charset=utf-8", message.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static final Map<String, byte[]> ASSETS = new ConcurrentHashMap<>();
    private static final String ASSET_ROOT = "/dispatch-web/";

    private final int port;
    private final Router router;
    private ServerSocket socket;
    private Thread acceptThread;
    private ExecutorService workers;
    private volatile boolean running;

    private int actualPort;

    public DispatchWebServer(int port, Router router) {
        this.port = port;
        this.router = router;
    }

    /**
     * 绑定 127.0.0.1。刻意不开 SO_REUSEADDR：Windows 下它允许多个进程绑同一端口，
     * 两个游戏实例同时跑时会共用一个端口，网页请求随机落到另一个存档。
     * 端口被占时自动顺延，把真正可用的端口暴露给调用方。
     */
    public synchronized void start() throws IOException {
        if (running) return;
        IOException last = null;
        for (int p = port; p < port + 16; p++) {
            ServerSocket s = new ServerSocket();
            try {
                s.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), p), 64);
            } catch (IOException e) {
                last = e;
                try {
                    s.close();
                } catch (IOException ignored) {
                }
                continue;
            }
            socket = s;
            actualPort = p;
            running = true;
            workers = Executors.newFixedThreadPool(8, r -> {
                Thread t = new Thread(r, "Dispatch-Web-Worker");
                t.setDaemon(true);
                return t;
            });
            acceptThread = new Thread(this::acceptLoop, "Dispatch-Web-Accept");
            acceptThread.setDaemon(true);
            acceptThread.start();
            return;
        }
        throw new IOException("127.0.0.1:" + port + "~" + (port + 15) + " 全部被占用", last);
    }

    /** 实际绑上的端口（端口被占时会顺延）。 */
    public int port() {
        return running ? actualPort : port;
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket client = socket.accept();
                client.setSoTimeout(5000);
                workers.execute(() -> handle(client));
            } catch (IOException e) {
                if (running) {
                    RailwayAddon.LOGGER.warn("[dispatch] 调度台接受连接失败: {}", e.toString());
                    try {
                        Thread.sleep(200);
                    } catch (InterruptedException ignored) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                }
            } catch (Throwable t) {
                RailwayAddon.LOGGER.warn("[dispatch] 调度台连接处理异常: {}", t.toString());
            }
        }
    }

    private void handle(Socket client) {
        try (Socket c = client) {
            InputStream in = new BufferedInputStream(c.getInputStream());
            OutputStream out = c.getOutputStream();
            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 3) {
                write(out, Response.text(400, "bad request"));
                return;
            }
            String method = parts[0].toUpperCase();
            String target = parts[1];
            String body = "";
            int length = 0;
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int idx = line.indexOf(':');
                if (idx > 0) {
                    String name = line.substring(0, idx).trim().toLowerCase();
                    if ("content-length".equals(name)) {
                        try {
                            length = Integer.parseInt(line.substring(idx + 1).trim());
                        } catch (NumberFormatException ignored) {
                        }
                    }
                }
            }
            if (length > 0) {
                byte[] buf = new byte[Math.min(length, 1 << 20)];
                int read = 0;
                while (read < buf.length) {
                    int r = in.read(buf, read, buf.length - read);
                    if (r < 0) break;
                    read += r;
                }
                body = new String(buf, 0, read, StandardCharsets.UTF_8);
            }

            String path = target;
            String query = "";
            int q = target.indexOf('?');
            if (q >= 0) {
                path = target.substring(0, q);
                query = target.substring(q + 1);
            }
            Response response;
            try {
                if (path.startsWith("/api/")) {
                    response = router.route(method, path, query, body);
                } else {
                    response = serveAsset(path);
                }
            } catch (Throwable t) {
                RailwayAddon.LOGGER.warn("[dispatch] 调度台接口异常 {} {}: {}", method, path, t.toString());
                response = Response.json(500, "{\"ok\":false,\"message\":\"内部错误\"}");
            }
            if (response == null) response = Response.text(404, "not found");
            write(out, response);
        } catch (IOException ignored) {
            // 浏览器轮询断开，忽略
        } catch (Throwable t) {
            RailwayAddon.LOGGER.warn("[dispatch] 调度台连接异常: {}", t.toString());
        }
    }

    private static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder(128);
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') sb.append((char) c);
            if (sb.length() > 4096) break;
        }
        if (c == -1 && sb.length() == 0) return null;
        return sb.toString();
    }

    private static void write(OutputStream out, Response r) throws IOException {
        String head = "HTTP/1.1 " + r.status + " " + statusText(r.status) + "\r\n"
                + "Content-Type: " + r.contentType + "\r\n"
                + "Content-Length: " + r.body.length + "\r\n"
                + "Cache-Control: no-store\r\n"
                + "Connection: close\r\n"
                + "\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(r.body);
        out.flush();
    }

    private static String statusText(int status) {
        switch (status) {
            case 200: return "OK";
            case 400: return "Bad Request";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            default: return "Error";
        }
    }

    private Response serveAsset(String path) {
        if (path.equals("/")) path = "/index.html";
        if (path.equals("/favicon.ico")) return new Response(204, "image/x-icon", new byte[0]);
        String name = path.startsWith("/") ? path.substring(1) : path;
        if (name.contains("..")) return Response.text(404, "not found");
        byte[] data = ASSETS.get(name);
        if (data == null) {
            String resource = ASSET_ROOT + name;
            try (InputStream is = getClass().getResourceAsStream(resource)) {
                if (is == null) return Response.text(404, "not found");
                data = is.readAllBytes();
                ASSETS.put(name, data);
            } catch (IOException e) {
                return Response.text(404, "not found");
            }
        }
        return Response.asset(contentType(name), data);
    }

    private static String contentType(String name) {
        if (name.endsWith(".html")) return "text/html; charset=utf-8";
        if (name.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (name.endsWith(".css")) return "text/css; charset=utf-8";
        if (name.endsWith(".json")) return "application/json; charset=utf-8";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    @Override
    public synchronized void close() {
        running = false;
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
        }
        if (workers != null) {
            workers.shutdownNow();
            try {
                workers.awaitTermination(2, TimeUnit.SECONDS);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }
    }

    public boolean isRunning() {
        return running;
    }
}
