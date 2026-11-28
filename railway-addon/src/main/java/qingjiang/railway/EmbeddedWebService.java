package qingjiang.railway;

import net.neoforged.fml.loading.FMLPaths;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 启动模组 Jar 内捆绑的 Node 票务后端与后台静态服务。
 * 这不是 Java 重写后端：业务逻辑仍由 Node 脚本执行；脚本、静态页和后台产物随 Jar 解压，
 * Node 生产依赖首次启动时在配置目录自动安装，不打进 Jar。
 */
public final class EmbeddedWebService {
    private static Process ticketProcess;
    private static Process adminProcess;
    private static boolean started;

    private EmbeddedWebService() {}

    public static synchronized void startIfEnabled() {
        if (!RailwayConfig.embedWeb() || started) return;
        try {
            Path root = FMLPaths.CONFIGDIR.get().resolve("railway_plus/web");
            Path embedded = root.resolve("embedded");
            Files.createDirectories(root.resolve("data"));
            extractBundle(embedded);
            writeConfig(embedded);
            ensureDependencies(embedded);

            int ticketPort = RailwayConfig.ticketPort();
            int adminPort = RailwayConfig.adminPort();
            Map<String, String> env = environment(root, ticketPort, adminPort);

            ticketProcess = launch(embedded, Path.of("ticket", "server.js"), env);
            if (!waitHealthy("http://127.0.0.1:" + ticketPort + "/health", 5000L)) {
                throw new IllegalStateException("内嵌票务后端健康检查超时");
            }
            adminProcess = launch(embedded, Path.of("admin-server.js"), env);
            started = true;
            RailwayAddon.LOGGER.info("[railway-plus] 内嵌网页服务已启动：ticket={}, admin={}", ticketPort, adminPort);
        } catch (Exception e) {
            RailwayAddon.LOGGER.error("[railway-plus] 内嵌网页服务启动失败，将回退到配置的外部地址", e);
            stop();
        }
    }

    public static synchronized void stop() {
        destroy(adminProcess);
        adminProcess = null;
        destroy(ticketProcess);
        ticketProcess = null;
        started = false;
    }

    private static void extractBundle(Path embedded) throws IOException {
        clearDirectory(embedded);
        Files.createDirectories(embedded);
        try (InputStream bundle = EmbeddedWebService.class.getResourceAsStream("/embedded/embedded.zip")) {
            if (bundle == null) throw new IOException("Jar 内未找到 embedded/embedded.zip");
            try (ZipInputStream zip = new ZipInputStream(bundle, StandardCharsets.UTF_8)) {
                ZipEntry entry;
                while ((entry = zip.getNextEntry()) != null) {
                    Path target = embedded.resolve(entry.getName()).normalize();
                    if (!target.startsWith(embedded.normalize())) {
                        throw new IOException("内嵌压缩包包含越界路径：" + entry.getName());
                    }
                    if (entry.isDirectory()) {
                        Files.createDirectories(target);
                    } else {
                        Files.createDirectories(target.getParent());
                        Files.copy(zip, target, StandardCopyOption.REPLACE_EXISTING);
                    }
                }
            }
        }
    }

    private static void writeConfig(Path embedded) throws IOException {
        int ticketPort = RailwayConfig.ticketPort();
        int adminPort = RailwayConfig.adminPort();
        String config = "[ticket]\nport = " + ticketPort + "\n\n"
                + "[admin]\nport = " + adminPort + "\n\n"
                + "[shared]\nqr_secret = \"" + RailwayConfig.adminToken() + "\"\n";
        Files.writeString(embedded.resolve("config.toml"), config, StandardCharsets.UTF_8);
    }

    private static Map<String, String> environment(Path root, int ticketPort, int adminPort) {
        Map<String, String> env = new HashMap<>();
        env.put("QJ_ROOT_DIR", root.resolve("embedded").toAbsolutePath().toString());
        env.put("QJ_CONFIG_DIR", root.resolve("embedded").toAbsolutePath().toString());
        env.put("QJ_DATA_DIR", root.resolve("data").toAbsolutePath().toString());
        env.put("PORT", String.valueOf(ticketPort));
        env.put("ADMIN_PORT", String.valueOf(adminPort));
        env.put("TICKET_PORT", String.valueOf(ticketPort));
        env.put("NODE_PATH", root.resolve("embedded").resolve("ticket").resolve("node_modules").toAbsolutePath().toString());
        return env;
    }

    private static Process launch(Path embedded, Path script, Map<String, String> env) throws IOException {
        Path scriptPath = embedded.resolve(script);
        if (!Files.isRegularFile(scriptPath)) throw new IOException("内嵌脚本不存在：" + script);

        ProcessBuilder builder = new ProcessBuilder(RailwayConfig.nodeCommand(), scriptPath.toAbsolutePath().toString());
        builder.directory(embedded.toFile());
        builder.inheritIO();
        builder.environment().putAll(env);
        return builder.start();
    }

    private static boolean waitHealthy(String url, long timeoutMillis) {
        long deadline = System.currentTimeMillis() + timeoutMillis;
        while (System.currentTimeMillis() < deadline) {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(300);
                connection.setReadTimeout(300);
                connection.connect();
                int status = connection.getResponseCode();
                if (status >= 200 && status < 300) return true;
            } catch (Exception ignored) {
                // 后端仍在启动，继续轮询。
            } finally {
                if (connection != null) connection.disconnect();
            }
            try {
                Thread.sleep(250L);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return false;
    }

    private static void ensureDependencies(Path embedded) throws IOException, InterruptedException {
        Path ticketDir = embedded.resolve("ticket");
        Path nodeModules = ticketDir.resolve("node_modules");
        boolean installed = Files.isDirectory(nodeModules) && Files.isDirectory(nodeModules.resolve("qrcode"));
        if (!installed) {
            runNpm(ticketDir, List.of("install", "--omit=dev", "--no-audit", "--no-fund"));
        }
        runNpm(ticketDir, List.of("prune", "--omit=dev", "--no-audit", "--no-fund"));
    }

    private static void runNpm(Path ticketDir, List<String> args) throws IOException, InterruptedException {
        List<String> command = new java.util.ArrayList<>();
        command.add(npmCommand());
        command.addAll(args);
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.directory(ticketDir.toFile());
        builder.inheritIO();
        builder.environment().put("npm_config_audit", "false");
        builder.environment().put("npm_config_fund", "false");
        Process process = builder.start();
        int exitCode = process.waitFor();
        if (exitCode != 0) throw new IOException("npm 命令失败，退出码 " + exitCode + "：" + String.join(" ", args));
    }

    private static String npmCommand() {
        boolean windows = System.getProperty("os.name", "").toLowerCase().startsWith("windows");
        String npm = windows ? "npm.cmd" : "npm";
        String nodeCommand = RailwayConfig.nodeCommand();
        if (!nodeCommand.equals("node") && !nodeCommand.equals("node.exe")) {
            Path sibling = Path.of(nodeCommand).resolveSibling(windows ? "npm.cmd" : "npm");
            if (Files.exists(sibling)) npm = sibling.toString();
        }
        return npm;
    }

    private static void destroy(Process process) {
        if (process == null || !process.isAlive()) return;
        process.destroy();
        try {
            if (!process.waitFor(2, java.util.concurrent.TimeUnit.SECONDS)) {
                process.destroyForcibly();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
        }
    }

    private static void clearDirectory(Path directory) throws IOException {
        if (!Files.isDirectory(directory)) return;
        Path preserved = directory.resolve(Path.of("ticket", "node_modules"));
        try (var stream = Files.walk(directory)) {
            stream.sorted((a, b) -> b.compareTo(a)).forEach(path -> {
                if (path.startsWith(preserved)) return;
                try {
                    Files.deleteIfExists(path);
                } catch (IOException ignored) {
                    // 保留占用文件并交给后续覆盖写入处理。
                }
            });
        }
    }
}
