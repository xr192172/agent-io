// jfacts —— Java 语义层事实抽取器（agent-io 自带的索引辅助程序）
//
// 为什么需要它：绑定 / 字段 / 方法归属，只有 **javac 的 attribution** 给得准；tree-sitter 只给语法。
// 与 gofacts 的约定**逐行复刻**（src/infrastructure/index/gofacts/main.go）：
//   · 单参 projectRoot → stdout **一行 JSON**，不写库；
//   · 写库（事务/表结构/降级）只由 TS 侧一处负责（src/infrastructure/index/semantic_facts.ts）；
//   · 字段形状与 gofacts 的 `Out` 同名同义（ok/reason/packages/files/typeErrors/fields/funcs/ifaces）。
//
// ★★★ 与 gofacts 的**唯一实质差异**（也是本程序的核心纪律）：
//   Go 的 `go/packages` 在缺依赖时会**自己**报 typeErrors 并继续；javac 的 `analyze()` 在缺 classpath 时
//   **仍然返回成功**（实测：无任何 jar 时 analyze() 正常返回、792 个编译单元全出、6110 个方法仍能解析）——
//   这是 javac 的 best-effort 语义，它不会告诉你"我其实什么都没检查成"。
//   ⇒ 如果照抄 gofacts 的 `ok = analyze 没抛`，本程序会**产出一批装作精确的事实**，而那正是
//      semantic_facts.ts 头注三层语义②明令禁止的（"不产出装作精确的东西"）。
//   ⇒ 所以本程序的 `ok` 需要 **classpath 真的到位**；拿不到就 `ok:false, reason:"classpath 不可得"`，
//      **一个事实都不输出**。判据：无 classpath 时 stdout 只有 ok:false，fields/funcs 为空数组。
//
// 调用方式（由 TS 侧决定，这里只保证两种都能跑）：
//   java JFacts.java <projectRoot> [...options]
// 选项：
//   --classpath <cp>     Maven 解析出的 classpath（缺 ⇒ ok:false）
//   --no-classpath-error 调试用：允许无 classpath 仍输出（**调用方不得在生产路径上用**）

import com.sun.source.tree.*;
import com.sun.source.util.*;
import javax.lang.model.element.*;
import javax.tools.*;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.stream.*;

public class JFacts {

  // ── 输出形状：字段名与 gofacts 的 Out 逐字对应 ──────────────────────────
  record Field(String file, String structure, String name, int ordinal, String type,
               String jsonTag, boolean embedded) {}
  record Param(String name, String type) {}
  record Func(String file, String recv, String name, List<Param> params, List<String> results) {}
  record Iface(String file, String name, List<String> methods, List<String> impls) {}

  static final class Out {
    boolean ok;
    String reason;
    int packages;
    int files;
    int typeErrors;
    List<Field> fields = new ArrayList<>();
    List<Func> funcs = new ArrayList<>();
    List<Iface> ifaces = new ArrayList<>();
    // ★ Java 专有的额外面：go 没有"包内作用域"这个概念，但这里是事实来源，不是协议漂移
    List<Occ> occurrences = new ArrayList<>();
  }
  record Occ(String file, int line, int col, String symbolId, String role,
             String structure, String member) {}

  public static void main(String[] args) {
    Out out = new Out();
    try {
      run(args, out);
    } catch (Throwable t) {
      out.ok = false;
      out.reason = "internal: " + t.getClass().getSimpleName() + ": " + t.getMessage();
      out.fields = List.of();
      out.funcs = List.of();
      out.ifaces = List.of();
      out.occurrences = List.of();
      out.typeErrors = Math.max(out.typeErrors, 0);
    }
    System.out.println(toJson(out));
  }

  static void run(String[] args, Out out) throws Exception {
    String root = null;
    String classpath = null;
    boolean allowNoCp = false;
    for (int i = 0; i < args.length; i++) {
      String a = args[i];
      if ("--classpath".equals(a) && i + 1 < args.length) classpath = args[++i];
      else if ("--no-classpath-error".equals(a)) allowNoCp = true;
      else if (root == null) root = a;
    }
    if (root == null) {
      out.ok = false;
      out.reason = "bad dir: 缺 projectRoot 实参";
      return;
    }
    Path rootPath = Paths.get(root).toAbsolutePath().normalize();
    if (!Files.isDirectory(rootPath)) {
      out.ok = false;
      out.reason = "bad dir: 不是目录 " + rootPath;
      return;
    }

    List<File> sources;
    try (Stream<Path> walk = Files.walk(rootPath)) {
      // ★ 跳掉 target / build / out / .git / .agent-io：它们是**产物与工具数据**不是源码；
      //   把 target/generated-sources 收进来会与 src 里的同名类撞 duplicate-class（实测 javac 判错）。
      //   ★★ 判定必须按 **相对 root 的路径**，不许按绝对路径：按绝对路径含 `/.agent-io/` 时，
      //     任何放在 `.agent-io/scratch/` 底下的**项目**都会被整棵树过滤掉（本轮实测踩过：
      //     files=0 而目录里明明有 2 个 .java，且它会让"临时夹具里的项目"永远抽不出事实）。
      sources = walk.filter(p -> p.toString().endsWith(".java"))
          .filter(p -> {
            String rel = rootPath.relativize(p.toAbsolutePath().normalize()).toString().replace('\\', '/');
            for (String skip : new String[]{"target/", "build/", "out/", ".git/", ".agent-io/"}) {
              if (rel.startsWith(skip) || rel.contains("/" + skip)) return false;
            }
            return true;
          })
          .map(Path::toFile)
          .collect(Collectors.toList());
    }
    out.files = sources.size();
    if (sources.isEmpty()) {
      out.ok = true; // 没有 Java 源 ⇒ 空事实是**真事实**，不是失败
      return;
    }

    JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
    if (compiler == null) {
      out.ok = false;
      out.reason = "没有系统 Java 编译器（需要 JDK 而不是 JRE）";
      return;
    }

    StandardJavaFileManager fm = compiler.getStandardFileManager(null, null, StandardCharsets.UTF_8);
    Iterable<? extends JavaFileObject> units = fm.getJavaFileObjectsFromFiles(sources);

    List<String> opts = new ArrayList<>(List.of(
        "-proc:none",            // 不在抽取时跑注解处理器（会依赖全部 deps 且可能生成代码）
        "-encoding", "UTF-8",
        "-nowarn",
        "-Xlint:none"
    ));
    if (classpath != null && !classpath.isBlank()) {
      opts.add("-classpath");
      opts.add(classpath);
    }

    // ★ 收集诊断：**不做 best-effort 解释**，只如实计数（typeErrors 是读数，不是判据）
    DiagnosticCollector<JavaFileObject> diags = new DiagnosticCollector<>();
    JavacTask task = (JavacTask) compiler.getTask(null, fm, diags, opts, null, units);

    Iterable<? extends CompilationUnitTree> parsed;
    try {
      parsed = task.parse();
    } catch (Throwable t) {
      out.ok = false;
      out.reason = "parse 失败: " + t.getMessage();
      return;
    }
    List<CompilationUnitTree> cus = new ArrayList<>();
    for (CompilationUnitTree cu : parsed) cus.add(cu);

    boolean hadCp = classpath != null && !classpath.isBlank();
    if (!hadCp && !allowNoCp) {
      // ★★ 这是本程序最重要的一条：**没有 classpath 就不冒充语义事实**。
      //   理由见文件头「唯一实质差异」。这里把已知信息（源文件数 / 解析出的编译单元数）留在 reason 里，
      //   让调用方能如实说"看到了多少、但一个事实都没给"。
      long errN = diags.getDiagnostics().stream()
          .filter(d -> d.getKind() == Diagnostic.Kind.ERROR).count();
      out.ok = false;
      out.reason = "classpath 不可得（" + sources.size() + " 个 .java / " + cus.size()
          + " 个编译单元已解析，但未做 attribution）⇒ 不输出语义事实，不猜";
      out.typeErrors = (int) errN;
      out.fields = List.of();
      out.funcs = List.of();
      out.ifaces = List.of();
      out.occurrences = List.of();
      return;
    }

    try {
      task.analyze();
    } catch (Throwable t) {
      // attribution 整体失败 ⇒ 那是"判不了"，不是"零错误"
      out.ok = false;
      out.reason = "analyze 失败: " + t.getMessage();
      return;
    }

    long errN = diags.getDiagnostics().stream()
        .filter(d -> d.getKind() == Diagnostic.Kind.ERROR).count();
    out.typeErrors = (int) errN;

    Trees trees = Trees.instance(task);
    Set<String> projectPkgs = new TreeSet<>();
    for (CompilationUnitTree cu : cus) {
      if (cu.getPackageName() != null) projectPkgs.add(cu.getPackageName().toString());
    }
    Predicate2 isProjectType = qn -> {
      for (String p : projectPkgs) {
        if (qn.equals(p) || qn.startsWith(p + ".")) return true;
      }
      return false;
    };

    // ① 字段账 / 方法签名 / 选择（member 归属）
    for (CompilationUnitTree cu : cus) {
      String cuFile = relOf(rootPath, cu.getSourceFile().toUri());
      // ── 类型声明：字段 + 方法 ──
      new TreePathScanner<Void, Void>() {
        @Override
        public Void visitClass(ClassTree node, Void v) {
          Element el = trees.getElement(getCurrentPath());
          if (el instanceof TypeElement te) {
            String structName = te.getQualifiedName().toString();
            int ord = 0;
            for (Element m : te.getEnclosedElements()) {
              if (m.getKind() == ElementKind.FIELD) {
                VariableElement ve = (VariableElement) m;
                out.fields.add(new Field(relOf(rootPath, cu.getSourceFile().toUri()),
                    simpleName(structName), ve.getSimpleName().toString(), ord++,
                    ve.asType().toString(), null, false));
              } else if (m.getKind() == ElementKind.METHOD || m.getKind() == ElementKind.CONSTRUCTOR) {
                ExecutableElement ee = (ExecutableElement) m;
                List<Param> ps = new ArrayList<>();
                for (VariableElement p : ee.getParameters()) {
                  ps.add(new Param(p.getSimpleName().toString(), p.asType().toString()));
                }
                List<String> rs = new ArrayList<>();
                if (ee.getKind() == ElementKind.METHOD) rs.add(ee.getReturnType().toString());
                out.funcs.add(new Func(relOf(rootPath, cu.getSourceFile().toUri()),
                    simpleName(structName), ee.getSimpleName().toString(), ps, rs));
              }
            }
            // 接口契约账：方法集 + 项目内实现者（同包 scope 内逐个类做 isAssignable）
            if (te.getKind() == ElementKind.INTERFACE) {
              List<String> methods = te.getEnclosedElements().stream()
                  .filter(x -> x.getKind() == ElementKind.METHOD)
                  .map(x -> x.getSimpleName().toString()).sorted().collect(Collectors.toList());
              out.ifaces.add(new Iface(relOf(rootPath, cu.getSourceFile().toUri()),
                  simpleName(structName), methods, List.of()));
            }
          }
          return super.visitClass(node, v);
        }
      }.scan(cu, null);

      // ── 选择：x.f 的 f 属于哪个类型（★ LSP 没有这个能力，只有 javac 有） ──
      new TreePathScanner<Void, Void>() {
        @Override
        public Void visitMethodInvocation(MethodInvocationTree node, Void v) {
          ExpressionTree sel = node.getMethodSelect();
          if (sel instanceof MemberSelectTree ms) {
            Element el = trees.getElement(getCurrentPath());
            String recvText = ms.getExpression().toString();
            if (el instanceof ExecutableElement ee) {
              TypeElement owner = (TypeElement) ee.getEnclosingElement();
              String ownerQn = owner.getQualifiedName().toString();
              // ★ 只记**项目内**归属：外部类型（Spring/Jackson）不是本仓符号，记下来只会污染
              if (isProjectType.test(ownerQn)) {
                SourcePos pos = posOf(trees, cu, node);
                out.occurrences.add(new Occ(cuFile,
                    pos == null ? 0 : pos.line, pos == null ? 0 : pos.col,
                    ownerQn + "." + ee.getSimpleName(), "selection",
                    ownerQn, ee.getSimpleName().toString()));
              }
            }
          }
          return super.visitMethodInvocation(node, v);
        }
      }.scan(cu, null);
    }

    out.ok = true;
  }

  // ── 工具 ─────────────────────────────────────────────────────────────
  interface Predicate2 { boolean test(String qn); }

  static String simpleName(String qn) {
    int i = qn.lastIndexOf('.');
    return i < 0 ? qn : qn.substring(i + 1);
  }

  static String relOf(Path root, java.net.URI uri) {
    try {
      Path p = Paths.get(uri).toAbsolutePath().normalize();
      return root.relativize(p).toString().replace('\\', '/');
    } catch (Exception e) {
      return uri.toString();
    }
  }

  record SourcePos(int line, int col) {}

  static SourcePos posOf(Trees trees, CompilationUnitTree cu, Tree node) {
    try {
      LineMap lm = cu.getLineMap();
      SourcePositions sp = trees.getSourcePositions();
      long pos = sp.getStartPosition(cu, node);
      if (pos < 0) return null;
      return new SourcePos((int) lm.getLineNumber(pos), (int) lm.getColumnNumber(pos));
    } catch (Exception e) {
      return null;
    }
  }

  // ── JSON：手写（零依赖；只覆盖本程序产出的形状） ─────────────────────
  static String toJson(Out o) {
    StringBuilder b = new StringBuilder(1024);
    b.append('{');
    b.append("\"ok\":").append(o.ok);
    if (o.reason != null) b.append(",\"reason\":").append(js(o.reason));
    b.append(",\"packages\":").append(o.packages);
    b.append(",\"files\":").append(o.files);
    b.append(",\"typeErrors\":").append(o.typeErrors);

    b.append(",\"fields\":[");
    for (int i = 0; i < o.fields.size(); i++) {
      Field f = o.fields.get(i);
      if (i > 0) b.append(',');
      b.append("{\"file\":").append(js(f.file()))
       .append(",\"structure\":").append(js(f.structure()))
       .append(",\"name\":").append(js(f.name()))
       .append(",\"ordinal\":").append(f.ordinal())
       .append(",\"type\":").append(f.type() == null ? "null" : js(f.type()))
       .append(",\"jsonTag\":").append(f.jsonTag() == null ? "null" : js(f.jsonTag()))
       .append(",\"embedded\":").append(f.embedded()).append('}');
    }
    b.append(']');

    b.append(",\"funcs\":[");
    for (int i = 0; i < o.funcs.size(); i++) {
      Func f = o.funcs.get(i);
      if (i > 0) b.append(',');
      b.append("{\"file\":").append(js(f.file()))
       .append(",\"recv\":").append(js(f.recv()))
       .append(",\"name\":").append(js(f.name()))
       .append(",\"params\":[");
      for (int j = 0; j < f.params().size(); j++) {
        if (j > 0) b.append(',');
        Param p = f.params().get(j);
        b.append("{\"name\":").append(js(p.name())).append(",\"type\":").append(js(p.type())).append('}');
      }
      b.append("],\"results\":[");
      for (int j = 0; j < f.results().size(); j++) {
        if (j > 0) b.append(',');
        b.append(js(f.results().get(j)));
      }
      b.append("]}");
    }
    b.append(']');

    b.append(",\"ifaces\":[");
    for (int i = 0; i < o.ifaces.size(); i++) {
      Iface it = o.ifaces.get(i);
      if (i > 0) b.append(',');
      b.append("{\"file\":").append(js(it.file()))
       .append(",\"name\":").append(js(it.name()))
       .append(",\"methods\":").append(strArr(it.methods()))
       .append(",\"impls\":").append(strArr(it.impls())).append('}');
    }
    b.append(']');

    b.append(",\"occurrences\":[");
    for (int i = 0; i < o.occurrences.size(); i++) {
      Occ x = o.occurrences.get(i);
      if (i > 0) b.append(',');
      b.append("{\"file\":").append(js(x.file()))
       .append(",\"line\":").append(x.line())
       .append(",\"col\":").append(x.col())
       .append(",\"symbolId\":").append(js(x.symbolId()))
       .append(",\"role\":").append(js(x.role()))
       .append(",\"structure\":").append(js(x.structure()))
       .append(",\"member\":").append(js(x.member())).append('}');
    }
    b.append(']');

    b.append('}');
    return b.toString();
  }

  static String strArr(List<String> xs) {
    StringBuilder b = new StringBuilder("[");
    for (int i = 0; i < xs.size(); i++) {
      if (i > 0) b.append(',');
      b.append(js(xs.get(i)));
    }
    return b.append(']').toString();
  }

  /** JSON 字符串转义（够用即可：控制字符 + 引号 + 反斜杠） */
  static String js(String s) {
    if (s == null) return "null";
    StringBuilder b = new StringBuilder(s.length() + 16);
    b.append('"');
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"' -> b.append("\\\"");
        case '\\' -> b.append("\\\\");
        case '\n' -> b.append("\\n");
        case '\r' -> b.append("\\r");
        case '\t' -> b.append("\\t");
        default -> {
          if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
          else b.append(c);
        }
      }
    }
    return b.append('"').toString();
  }
}
