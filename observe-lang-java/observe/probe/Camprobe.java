package observe.probe;

import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Camprobe —— observe 的 **Java 探针运行时**（骨架六格里的 ④ sink 契约 + ⑤ 错误传播）。
 *
 * ## 为什么长这样（与 TS `probe.ts` / Python `camprobe.py` / Go `probe/` 同源）
 *   ④ **探针就位 ≠ 有数据**：没接 sink 时 {@link #capture} 是 **no-op**（0 事件、不抛错）。
 *      接上 sink（{@link #setGlobalSink}）才出事件。
 *   ⑤ **探针不许抛错，但错误必须可见**：探针跑在宿主的热路径上 ⇒ 不能抛；
 *      而"事件发不出去"这件事**必须说到 stderr**，且**限流**（首次完整说，之后每 100 次一次）
 *      —— 否则一次失败会被读成"这个函数根本没被调到"（缺失伪装成事实）。
 *
 * ## 两处必须注意的语言差异
 *   · **flat key/value varargs** 而不是 `Map.of(...)`：`Map.of` 不收 null 且最多 10 对，
 *     而方法的参数本来就可以是 null。⇒ 由本类在入口处拼 map。
 *   · **住在真实包 `observe.probe`**（2026-10-15 v2；v1 是 default package、靠"同包零 import"）：
 *     v1 的代价是**打包文件（`package com.foo;`）永远解析不了** —— Java 禁止从默认包 import（T321）。
 *     v2 每个被插桩文件统一 `import observe.probe.Camprobe;`（Java 允许从命名包 import 进默认包）
 *     ⇒ 默认包与打包文件一视同仁；import 落在 package 声明之后（见 instrument_java.ts 的 ⑦ 格）。
 *     ⇒ 调用方需把 `observe-lang-java/` 拷进被测工程，且编译时把该目录加进
 *       sourcepath/classpath（或把本文件一并传给 javac）。
 */
public final class Camprobe {

    private static volatile Sink sink;
    private static long errCount = 0;
    private static boolean errSeen = false;

    private Camprobe() {}

    /** sink 契约：接上才出事件。 */
    public interface Sink {
        void emit(String probe, long timeMs, String source, Map<String, Object> fields) throws Exception;
    }

    /** JSONL sink：一行一个事件。 */
    public static final class JsonlSink implements Sink {
        private final Path path;
        public JsonlSink(String path) { this.path = Paths.get(path); }
        @Override public void emit(String probe, long timeMs, String source, Map<String, Object> fields) throws IOException {
            StringBuilder sb = new StringBuilder(256);
            sb.append("{\"probe\":").append(q(probe)).append(",\"time\":").append(timeMs);
            sb.append(",\"source\":").append(q(source));
            sb.append(",\"fields\":");
            if (fields == null || fields.isEmpty()) sb.append("{}");
            else {
                sb.append('{');
                boolean first = true;
                for (Map.Entry<String, Object> e : fields.entrySet()) {
                    if (!first) sb.append(',');
                    first = false;
                    sb.append(q(e.getKey())).append(':').append(v(e.getValue()));
                }
                sb.append('}');
            }
            sb.append("}\n");
            Files.write(path, sb.toString().getBytes(StandardCharsets.UTF_8),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        }
    }

    /** 配置全局 sink。传 null = 断开（回到 no-op）。 */
    public static void setGlobalSink(Sink s) { sink = s; }

    /** 是否已接 sink。 */
    public static boolean hasGlobalSink() { return sink != null; }

    /**
     * 一条探针。flat key/value pairs；**没接 sink ⇒ 直接返回**（④：探针就位 ≠ 有数据）。
     * ★ 不许抛错：探针跑在别人代码里，抛出去就是**打断宿主**。
     */
    public static void capture(String probe, Object... kv) {
        Sink s = sink;
        if (s == null) return;
        Map<String, Object> fields = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) fields.put(String.valueOf(kv[i]), kv[i + 1]);
        try {
            s.emit(probe, System.currentTimeMillis(), "static-rule", fields);
        } catch (Throwable t) {
            reportProbeError(probe, t); // ★ T286：**不静默吞**
        }
    }

    /** 把错误**说出去**，但限流：首次完整说（含成因），之后每 100 次一次。 */
    private static synchronized void reportProbeError(String probe, Throwable t) {
        errCount++;
        boolean first = !errSeen;
        errSeen = true;
        if (first) {
            System.err.println("[camprobe] 探针事件**发不出去**（第 1 次）：" + t);
            System.err.println("  probe=" + probe);
            System.err.println("  ★ 常见成因：写盘/权限问题（路径不存在、磁盘满、文件被独占）。");
            return;
        }
        if (errCount % 100 == 0) {
            System.err.println("[camprobe] 探针事件发不出去：累计 " + errCount + " 次（最近 probe=" + probe + ": " + t + "）");
        }
    }

    private static String q(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder(s.length() + 16).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }

    private static String v(Object o) {
        if (o == null) return "null";
        if (o instanceof Number || o instanceof Boolean) return String.valueOf(o);
        return q(String.valueOf(o));
    }
}
