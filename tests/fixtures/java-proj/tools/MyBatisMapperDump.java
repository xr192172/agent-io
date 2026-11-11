package tools;

import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * MyBatisMapperDump —— mapper XML 的语义级解析工具。
 * 用 MyBatis 官方 XMLMapperBuilder 解析（语义权威 —— **语句 id 集合与合法性**都由它给），
 * 每语句的 ${}/#{} 计数按 **DOM 里该语句元素自己的文本**数（含本文件 <include> 展开）——
 * 官方 API 不给原始 SQL 串（含 ${} 的语句是 DynamicSqlSource），见 `DomText` 的注释。
 * 输出一行 JSON：{namespace, statements:[{id,kind,dollarBrace,hashBrace}], interfaces:[方法名], warnings?}
 */
public class MyBatisMapperDump {

    private static final Pattern DOLLAR = Pattern.compile("\\$\\{[^}]*\\}");
    private static final Pattern HASH = Pattern.compile("#\\{[^}]*\\}");

    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.err.println("用法: MyBatisMapperDump <mapper.xml> [接口类全限定名]");
            System.exit(2);
        }
        Path xml = Paths.get(args[0]);
        String content = new String(Files.readAllBytes(xml), StandardCharsets.UTF_8);

        Configuration cfg = new Configuration();
        XMLMapperBuilder builder = new XMLMapperBuilder(
                new ByteArrayInputStream(content.getBytes(StandardCharsets.UTF_8)), cfg, xml.toString(), cfg.getSqlFragments());
        builder.parse();

        // namespace 无公开 getter ⇒ 从 XML 头正则抓
        String namespace = "";
        Matcher ns = Pattern.compile("namespace\\s*=\\s*\"([^\"]+)\"").matcher(content);
        if (ns.find()) namespace = ns.group(1);

        // MappedStatement 名单：getMappedStatementNames() 返回 Collection<String>（namespace.id 全集）
        // ★★ 2026-11-12（审计 D4-1/D4-2 重写测试时实测抓到）：**每语句的 ${}/#{} 必须按语句自己的 SQL 文本数**。
        //   原实现 `sqlTextOf` 靠反射 `getSql()` —— MappedStatement 上**没有**这个方法（只有 getSqlSource()），
        //   于是反射必然抛 ⇒ catch 里 **return content**（整个 XML 文件）⇒ 每个语句都数到全文件的 ${}
        //   ⇒ "注入面定位到具体语句 id" 这条契约实际是**假的**（实测：无 ${} 的 findByName 也被判注入）。
        //   现在：id 集合仍走官方解析器（语义权威 + 校验），文本按 DOM 取**该语句元素自己的**文本
        //   （同名 <include refid> 从本文件 <sql> 片段递归展开；展开不了的进 warnings，不静默少算）。
        DomText dom = DomText.of(content);
        List<Map<String, Object>> statements = new ArrayList<>();
        TreeMap<String, Object> sorted = new TreeMap<>();
        for (Object keyObj : cfg.getMappedStatementNames()) {
            String key = String.valueOf(keyObj);
            if (!key.startsWith(namespace + ".")) continue;
            sorted.put(key, cfg.getMappedStatement(key));
        }
        for (Map.Entry<String, Object> e : sorted.entrySet()) {
            String id = e.getKey().substring(namespace.length() + 1);
            Object ms = e.getValue();
            String kind = ms.getClass().getSimpleName().toLowerCase();
            if (kind.contains("select")) kind = "select";
            else if (kind.contains("insert")) kind = "insert";
            else if (kind.contains("update")) kind = "update";
            else if (kind.contains("delete")) kind = "delete";
            else kind = "statement";
            String sqlText = dom.statementText(id);
            if (sqlText == null) {
                // 官方解析器认这条语句、DOM 里却没有同 id 的元素 ⇒ 工具自身说不清 ⇒ 如实失败（不当 0 处注入）
                System.err.println("无法定位语句 " + id + " 的 XML 元素（DOM 与官方解析器不一致）⇒ 拒绝输出半真结果");
                System.exit(3);
            }
            Map<String, Object> st = new LinkedHashMap<>();
            st.put("id", id);
            st.put("kind", kind);
            st.put("dollarBrace", count(sqlText, DOLLAR));
            st.put("hashBrace", count(sqlText, HASH));
            statements.add(st);
        }

        // 接口反射（给了接口类名且 classpath 上有 ⇒ 方法名清单；否则降级）
        List<String> interfaces = new ArrayList<>();
        if (args.length >= 2 && !args[1].isBlank()) {
            try {
                Class<?> itf = Class.forName(args[1]);
                for (Method m : itf.getDeclaredMethods()) interfaces.add(m.getName());
            } catch (ClassNotFoundException ex) {
                interfaces.add("__CLASS_NOT_FOUND__");
            }
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("namespace", namespace);
        out.put("statements", statements);
        out.put("interfaces", interfaces);
        if (!dom.warnings.isEmpty()) {
            // ★ 不静默：展开不了的 <include> 会让那段 SQL 不计入统计 ⇒ 必须让消费方看见
            for (String w : dom.warnings) System.err.println("⚠ " + w);
            out.put("warnings", dom.warnings);
        }
        System.out.println(toJson(out));
    }

    /**
     * 按语句 id 取该语句元素的 SQL 文本（本文件 <sql> 片段可递归展开）。
     * 为什么不用官方 API：`MappedStatement.getSqlSource()` 对含 `${}` 的语句返回 DynamicSqlSource，
     * **没有任何 getter 能拿到原始 SQL 串**；硬反射 `getSql()` 在 MappedStatement 上不存在（这就是本文件
     * 曾经"每条语句都数全文件"的根因）。官方解析器仍负责 id 集合与合法性，文本按 DOM 取。
     */
    private static final class DomText {
        private final Map<String, Element> statements = new LinkedHashMap<>();
        private final Map<String, Element> fragments = new LinkedHashMap<>();
        private final List<String> warnings = new ArrayList<>();

        static DomText of(String content) throws Exception {
            DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
            f.setNamespaceAware(false);
            // 不联网取 DTD（mybatis 的 mapper DTD 在公网）——校验交给官方解析器，这里只读结构
            f.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
            f.setFeature("http://xml.org/sax/features/external-general-entities", false);
            DocumentBuilder b = f.newDocumentBuilder();
            b.setEntityResolver((publicId, systemId) -> new InputSource(new java.io.StringReader("")));
            Document doc = b.parse(new ByteArrayInputStream(content.getBytes(StandardCharsets.UTF_8)));
            DomText t = new DomText();
            NodeList all = doc.getElementsByTagName("*");
            for (int i = 0; i < all.getLength(); i++) {
                Element e = (Element) all.item(i);
                String id = e.getAttribute("id");
                if (id.isEmpty()) continue;
                String tag = e.getTagName();
                if (tag.equals("sql")) t.fragments.put(id, e);
                else if (tag.equals("select") || tag.equals("insert") || tag.equals("update") || tag.equals("delete")) t.statements.put(id, e);
            }
            return t;
        }

        String statementText(String id) {
            Element e = statements.get(id);
            return e == null ? null : textOf(e, 0);
        }

        private String textOf(Element e, int depth) {
            StringBuilder sb = new StringBuilder();
            NodeList kids = e.getChildNodes();
            for (int i = 0; i < kids.getLength(); i++) {
                Node n = kids.item(i);
                if (n.getNodeType() == Node.TEXT_NODE || n.getNodeType() == Node.CDATA_SECTION_NODE) {
                    sb.append(n.getNodeValue());
                } else if (n.getNodeType() == Node.ELEMENT_NODE) {
                    Element c = (Element) n;
                    String tag = c.getTagName();
                    if (tag.equals("include")) {
                        String refid = c.getAttribute("refid");
                        Element frag = refid.contains(".") ? null : fragments.get(refid);
                        if (frag != null && depth < 8) sb.append(textOf(frag, depth + 1));
                        else warnings.add("include refid='" + refid + "' 在本文件内展开不了 ⇒ 该段 SQL 未计入注入面统计（人工核）");
                    } else if (!tag.equals("selectKey")) {
                        // if / where / foreach / trim 等动态标签里的文本仍是 SQL 片段 ⇒ 计入
                        sb.append(textOf(c, depth));
                    }
                }
            }
            return sb.toString();
        }
    }


    /** 极简 JSON 序列化（Map/List/String/Number——工具输出专用，避免引依赖） */
    private static String esc(String v) {
        return v.replace("\\", "\\\\").replace("\"", "\\\"");
    }
    private static String toJson(Object o) {
        if (o == null) return "null";
        if (o instanceof String) return "\"" + esc((String) o) + "\"";
        if (o instanceof Number || o instanceof Boolean) return String.valueOf(o);
        if (o instanceof Map) {
            StringBuilder sb = new StringBuilder("{");
            boolean first = true;
            for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
                if (!first) sb.append(",");
                first = false;
                sb.append(toJson(String.valueOf(e.getKey()))).append(":").append(toJson(e.getValue()));
            }
            return sb.append("}").toString();
        }
        if (o instanceof Iterable) {
            StringBuilder sb = new StringBuilder("[");
            boolean first = true;
            for (Object v : (Iterable<?>) o) {
                if (!first) sb.append(",");
                first = false;
                sb.append(toJson(v));
            }
            return sb.append("]").toString();
        }
        return "\"" + esc(String.valueOf(o)) + "\"";
    }

    private static int count(String text, Pattern p) {
        int n = 0;
        Matcher m = p.matcher(text);
        while (m.find()) n++;
        return n;
    }
}
