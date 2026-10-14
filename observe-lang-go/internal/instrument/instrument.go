// Package instrument — Go 源码级自动插桩（PR 偏差2）。
//
// 用 go/ast 解析被测 Go 文件，在函数出入口 / return / IO 写盘 / (可选的 deep)
// 变量赋值处注入 camprobe.Capture 探针，直接改写源文件（git 兜底 + 备份还原）。
// 与 TS 侧 instrument.ts 的策略一致：全量无脑插桩、幂等标记、从后往前注入避免
// 偏移漂移、写盘前备份可一键还原。
//
// 事件分级（与 TS 对齐）：
//   - core  ：函数入口(enter)/出口(exit) 参数与返回值
//   - event ：IO 写盘（op）
//   - deep  ：函数内部变量赋值（默认关闭，enableDeep 放大）
//
// 依赖：被测项目须能 import 本探针包（默认 github.com/xr192172/agent-io/observe-lang-go/probe）。
package instrument

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
)

// ProbeKind 是探针点类型。
type ProbeKind string

// 探针点类型枚举。
const (
	ProbeEnter  ProbeKind = "enter"
	ProbeExit   ProbeKind = "exit"
	ProbeIO     ProbeKind = "io"
	ProbeDeep   ProbeKind = "deep"
	ProbeEffect ProbeKind = "effect"
)

// Site 是单个插桩点。
type Site struct {
	Kind      ProbeKind
	Level     string // core | event | deep
	Line      int    // 1-based
	Offset    int    // 注入字节偏移
	EndOffset int    // >0 时替换 [Offset, EndOffset) 区间（用于改写 return 语句）
	Code      string // 注入的探针源码
}

// Result 是单文件插桩结果。
type Result struct {
	File  string
	Sites []Site
	Error string
}

// Options 是插桩配置。
type Options struct {
	// ProbeImport 是被插桩代码 import 的探针包路径（默认 github.com/xr192172/agent-io/observe-lang-go/probe）。
	ProbeImport string
	// Write 是否实际写盘；false 只做 dry-run 报告（默认 true）。
	Write bool
	// EnableDeep 是否启用 deep 级插桩（变量赋值捕获，默认 false）。
	EnableDeep bool
	// EnableEffect 是否启用 effect 级插桩（Brick Harvest Phase 2c 动静对账：
	// 包级变量写/chan send/资源获取三类点，Capture 带 kind/target/op）。
	EnableEffect bool
	// BackupRoot 备份根：写盘前把原文件备份到 <backupRoot>/.agent-io/observe-backup/<rel>。
	BackupRoot string
	// ExcludeDirs 相对目录名列表（如 internal/probe），这些目录下的文件跳过插桩。
	// 用于避免把探针打进探针包自身/其依赖链造成 import cycle。
	ExcludeDirs []string
	// ContractProbes 契约模式探针列表：非 nil 时只注入其中声明的探针点（精确匹配
	// pkg.FuncName.suffix），并做文件级包过滤；nil 时全量无脑插桩（探索模式）。
	ContractProbes []ContractProbe
}

// 探针 import 别名（保持在此处，注入统一使用）。
const probeAlias = "camprobe"

// 幂等标记：已插桩文件含此标记则跳过。
const probeMarker = "observe:instrumented"

// deep 级插桩独立标记。
const deepMarker = "observe:deep"

// effect 级插桩独立标记（Phase 2c 动静对账）。
const effectMarker = "observe:effect"

// 备份目录名（相对被插桩项目根）。
const backupDir = ".agent-io/observe-backup"

// IO 写盘调用 → 探针 op 名（selector 选择器名）。
var ioOps = map[string]string{
	"WriteFile": "writefile", "WriteString": "writefile", "Write": "writefile",
	"MkdirAll": "mkdirall", "Mkdir": "mkdirall",
	"Remove": "remove", "RemoveAll": "remove", "Rename": "remove",
	"Create": "writefile", "OpenFile": "writefile",
	"AppendFile": "writefile", "Copy": "writefile",
}

// collectGoFiles 递归收集目录下所有 .go 源文件（跳过 node_modules/dist/.git/.agent-io 等）。
func collectGoFiles(root string, excludes []string) []string {
	var out []string
	// excludes 是相对根目录的路径（如 internal/probe），命中则跳过整目录
	excludeSet := map[string]bool{}
	for _, e := range excludes {
		excludeSet[filepath.ToSlash(strings.TrimPrefix(filepath.ToSlash(e), "./"))] = true
	}
	filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if d.Name() == "node_modules" || d.Name() == ".git" ||
				d.Name() == ".agent-io" || d.Name() == "coverage" {
				return filepath.SkipDir
			}
			// 相对 root 的目录路径（slash），命中 exclude 则跳过
			rel, rerr := filepath.Rel(root, path)
			if rerr == nil {
				relSlash := filepath.ToSlash(rel)
				if excludeSet[relSlash] {
					return filepath.SkipDir
				}
			}
			return nil
		}
		if strings.HasSuffix(d.Name(), ".go") && !strings.HasSuffix(d.Name(), "_test.go") {
			out = append(out, path)
		}
		return nil
	})
	return out
}

// backupPathFor 把文件相对 backupRoot 的路径映射为备份目录下的镜像路径。
func backupPathFor(backupRoot, file string) string {
	rel := filepath.ToSlash(relPath(backupRoot, file))
	return filepath.Join(backupRoot, backupDir, rel)
}

// relPath 计算 from 到 to 的相对路径。
func relPath(from, to string) string {
	r, err := filepath.Rel(from, to)
	if err != nil {
		return filepath.Base(to)
	}
	return r
}

// backupOriginal 写盘前备份原文件（幂等：已备份则保留最早原版）。
func backupOriginal(backupRoot, file, content string) {
	dest := backupPathFor(backupRoot, file)
	if _, err := os.Stat(dest); err == nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(dest), 0o755)
	_ = os.WriteFile(dest, []byte(content), 0o644)
}

// RestoreInstrumented 还原被插桩项目的所有文件（拷回备份并删除备份目录）。
func RestoreInstrumented(root string) []string {
	dir := filepath.Join(root, backupDir)
	var restored []string
	filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		// p 是备份文件，目标 = 相对 backupDir 的路径映射回 root
		rel := relPath(dir, p)
		if rel == "" || strings.HasPrefix(rel, "..") {
			return nil
		}
		target := filepath.Join(root, rel)
		if data, err := os.ReadFile(p); err == nil {
			if err := os.WriteFile(target, data, 0o644); err == nil {
				restored = append(restored, target)
			}
		}
		return nil
	})
	_ = os.RemoveAll(dir)
	return restored
}

// InstrumentFile 对单个 Go 文件插桩。返回注入的探针点（dry-run 不写盘）。
func InstrumentFile(file string, opts Options) (Result, error) {
	res := Result{File: file}
	applyWrite := opts.Write
	enableDeep := opts.EnableDeep
	enableEffect := opts.EnableEffect

	content, err := os.ReadFile(file)
	if err != nil {
		res.Error = err.Error()
		return res, err
	}
	src := string(content)

	// 幂等：核心探针已注入且未请求 deep/effect → 跳过；已请求的级都已注入 → 跳过
	hasCore := strings.Contains(src, probeMarker)
	hasDeep := strings.Contains(src, deepMarker)
	hasEffect := strings.Contains(src, effectMarker)
	wantDeep := enableDeep && !hasDeep
	wantEffect := opts.EnableEffect && !hasEffect
	if hasCore && !wantDeep && !wantEffect {
		return res, nil
	}

	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, file, src, parser.ParseComments)
	if err != nil {
		res.Error = err.Error()
		return res, err
	}

	backupRoot := opts.BackupRoot
	if backupRoot == "" {
		// findProjectRoot 已返回含 go.mod 的项目根，不要再包 filepath.Dir（否则备份写到父目录，还原时找不到）
		backupRoot = findProjectRoot(file, f.Name.Name)
	}

	probeImport := opts.ProbeImport
	if probeImport == "" {
		probeImport = "github.com/xr192172/agent-io/observe-lang-go/probe"
	}

	fileRel := filepath.ToSlash(relPath(backupRoot, file))
	pkg := f.Name.Name

	// 契约模式文件级包过滤：契约探针声明的包不包含当前文件包名则整文件跳过。
	// 探索模式（probes==nil）不做此过滤，全量扫描。
	if probes := opts.ContractProbes; probes != nil {
		if pkgs := PackageFilter(probes); len(pkgs) > 0 {
			if !pkgs[pkg] {
				return res, nil
			}
		}
	}

	var sites []Site
	pkgVars := collectPkgVars(f)
	collectFuncSites(fset, f, pkg, fileRel, enableDeep, enableEffect, pkgVars, opts.ContractProbes, &sites)

	if len(sites) == 0 {
		return res, nil
	}

	// 按 Offset 从大到小排序，从后往前注入避免偏移漂移
	sortSites(sites)

	// 探针 import 注入：在 package 声明行后补一行。
	// 已 import 探针包的文件（如初始化 sink 的 main.go）跳过——重复 import 同一路径
	// 是编译错（camprobe redeclared）。约定：自引探针包须用 camprobe 别名。
	importLine := ""
	if !importsProbePkg(f, probeImport) {
		importLine = "\nimport " + probeAlias + " \"" + probeImport + "\"\n"
	}
	insertOffset := packageLineEnd(src, fset, f)

	out := src
	// 按 Offset 降序遍历（sites[0]=文件末尾），从后往前注入避免偏移漂移。
	// 注：sortSites 已按 Offset 降序排列，此处正向遍历 = 从最大Offset（文件末尾）开始。
	for i := 0; i < len(sites); i++ {
		s := sites[i]
		if s.EndOffset > 0 {
			// 区间替换（改写 return 语句为：临时变量声明 + 探针 + 新 return）。
			out = out[:s.Offset] + s.Code + out[s.EndOffset:]
		} else {
			out = out[:s.Offset] + s.Code + out[s.Offset:]
		}
	}
	// 头部标记 + import（避免重复补 import）
	if !hasCore && importLine != "" {
		out = out[:insertOffset] + importLine + out[insertOffset:]
	}
	if wantDeep {
		out = "// " + deepMarker + "\n" + out
	}
	if wantEffect {
		out = "// " + effectMarker + "\n" + out
	}
	if !hasCore {
		out = "// " + probeMarker + "\n" + out
	}

	res.Sites = sites
	// 防御性清理：块末探针破坏终止性（missing return）时删除多余探针。
	// 触发场景：switch case / comm 分支 / 函数体等块，原最后一条是终止语句
	// （return/for/switch...），但探针被插到它之后使块不再终止。
	if cleaned := cleanupTrailingProbes(file, []byte(out)); cleaned != nil {
		out = string(cleaned)
	}
	if applyWrite {
		backupOriginal(backupRoot, file, src)
		if err := os.WriteFile(file, []byte(out), 0o644); err != nil {
			res.Error = err.Error()
			return res, err
		}
	}
	return res, nil
}

// findProjectRoot 向上找含 go.mod 的目录作为项目根（用于备份根/相对路径）。
func findProjectRoot(file, _ string) string {
	dir := filepath.Dir(file)
	for depth := 0; depth < 12; depth++ {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return filepath.Dir(file)
}

// packageLineEnd 返回 package 声明行结束（换行）的字节偏移，用于插入 import。
// 用 AST 的 f.Package（package 关键字）与 f.Name.End()（包名结尾）定位真实声明行，
// 避免文件头注释里出现 "// Package xxx" 时字符串匹配误判（如 ws_brain.go）。
func packageLineEnd(src string, fset *token.FileSet, f *ast.File) int {
	if f == nil || f.Package == token.NoPos {
		return 0
	}
	tf := fset.File(f.Package)
	if tf == nil {
		return 0
	}
	// 包名结尾的字节偏移
	endOff := tf.Offset(f.Name.End())
	if endOff < 0 || endOff >= len(src) {
		return len(src)
	}
	// 从包名结尾跳到该行行尾
	rest := src[endOff:]
	if nl := strings.IndexByte(rest, '\n'); nl >= 0 {
		return endOff + nl + 1
	}
	return len(src)
}

// terminatesFunction 判断语句是否使控制流**不落出**其所在块（return / panic /
// 无限循环 / 全分支返回）。用于决定是否在函数体（或块）末尾补出口探针——在这些
// 语句之后插任何语句都是不可达代码，Go 编译器会报 "missing return"。
//
// ★★★ 2026-10-14（T289/T290/T291/T292/T293）修三类「判定本身不认的终止形态」：
//   · panic(...)：内置 panic 调用同样不返回（T289，旧版不认 ⇒ 末尾探针插在 panic 之后）。
//   · 带标签语句 LabeledStmt：标签下的 return/goto 仍是终止语句（T290，旧版不认）。
//   · else if 链：Else 是 *ast.IfStmt（不是 BlockStmt）时也要递归判定（T291/T292）。
//   · for/range/switch/select：旧版**无条件**当作终止 ⇒ 会**跳过**函数末尾的兜底
//     exit 探针，使「可自然落出」的循环/分支函数**只有 enter 没有 exit**（T293）。
//     现按 Go 规范的「终止语句」定义精确判定：range 可正常结束；for 仅 `for {}`（无条件）
//     且体内无 break 才终止；switch/type switch/select 须含 default 且各分支均终止
//     （含 fallthrough）才终止。
func terminatesFunction(stmt ast.Stmt) bool {
	switch t := stmt.(type) {
	case *ast.ReturnStmt:
		return true
	case *ast.ExprStmt:
		// panic(...) 调用是终止语句（Go 规范）。
		return isPanicCall(t)
	case *ast.BlockStmt:
		if len(t.List) == 0 {
			return false
		}
		return terminatesFunction(t.List[len(t.List)-1])
	case *ast.LabeledStmt:
		// 标签下的语句仍是终止语句时，整条带标签语句终止（Go 规范）。
		return terminatesFunction(t.Stmt)
	case *ast.IfStmt:
		if t.Else == nil {
			return false // 无 else，可能不返回
		}
		// 两分支都须以终止语句收尾；Else 是 else if（*ast.IfStmt）时递归判定整条链。
		return terminatesFunction(t.Body) && terminatesFunction(t.Else)
	case *ast.ForStmt:
		// 仅 `for {}`（无循环条件）且体内无 break 才是 Go 终止语句；
		// 带条件的 for 可能正常结束 ⇒ 需保留兜底出口探针（T293）。
		if t.Cond != nil {
			return false
		}
		return !hasUnnestedBreak(t.Body)
	case *ast.RangeStmt:
		return false // range 总是可能正常结束
	case *ast.SwitchStmt:
		return terminatesSwitchBody(t.Body, true) // 表达式 switch：要求 default
	case *ast.TypeSwitchStmt:
		return terminatesSwitchBody(t.Body, true) // type switch：同上
	case *ast.SelectStmt:
		return terminatesSwitchBody(t.Body, false) // ★ select：不要求 default（它本身就是终止语句）
	default:
		return false
	}
}

// isPanicCall 判断语句是否为内置 panic 调用（`panic(...)`）。
func isPanicCall(s *ast.ExprStmt) bool {
	call, ok := s.X.(*ast.CallExpr)
	if !ok {
		return false
	}
	id, ok := call.Fun.(*ast.Ident)
	return ok && id.Name == "panic"
}

// hasUnnestedBreak 判断块内是否存在**不属于内层可 break 语句**的 break。
// 用于判定 `for {}` 是否真的是终止语句（有 break 跳出即非终止）。
func hasUnnestedBreak(body *ast.BlockStmt) bool {
	if body == nil {
		return false
	}
	found := false
	ast.Inspect(body, func(n ast.Node) bool {
		if found {
			return false
		}
		switch t := n.(type) {
		case *ast.ForStmt, *ast.RangeStmt, *ast.SwitchStmt, *ast.TypeSwitchStmt, *ast.SelectStmt:
			return false // 内层可 break 语句：其 break 属于内层，不下钻
		case *ast.BranchStmt:
			if t.Tok == token.BREAK {
				found = true
			}
			return false
		}
		return true
	})
	return found
}

// terminatesSwitchBody 判断 switch / type switch / select 体是否整体终止：
// 须含 default 分支，且每个分支体都以终止语句（或 fallthrough）收尾。
// ★★★ 2026-10-14（第 3 轮 Go 实测的 P0）：requireDefault 区分 switch 与 select ——
//   Go 规范：表达式 switch 的终止要求有 default；而 select 本身就是终止语句
//   （只要各 case 体都以终止语句收尾）⇒ 不要求 default。
//   病（实测）：原先 select 也走这条、被要求 hasDefault ⇒ 误判为非终止 ⇒ 兜底 exit 探针
//   被插在 select 之后 ⇒ missing return（main.go:26:1，最小复现夹具 gp1-r3v-mini）。
func terminatesSwitchBody(body *ast.BlockStmt, requireDefault bool) bool {
	if body == nil || len(body.List) == 0 {
		return false
	}
	hasDefault := false
	for _, c := range body.List {
		var list []ast.Stmt
		switch cc := c.(type) {
		case *ast.CaseClause:
			if cc.List == nil {
				hasDefault = true
			}
			list = cc.Body
		case *ast.CommClause:
			if cc.Comm == nil {
				hasDefault = true
			}
			list = cc.Body
		default:
			return false
		}
		if len(list) == 0 {
			return false
		}
		if bs, ok := list[len(list)-1].(*ast.BranchStmt); ok && bs.Tok == token.FALLTHROUGH {
			continue // fallthrough 计入终止（Go 规范）
		}
		if !terminatesFunction(list[len(list)-1]) {
			return false
		}
	}
	// ★ select 不要求 default ⇒ requireDefault=false 时直接算终止（各 case 体已在上面逐个检查过）
	return !requireDefault || hasDefault
}

// sortSites 按 Offset 降序排列（注入时从文件末尾往前）。
func sortSites(sites []Site) {
	for i := 1; i < len(sites); i++ {
		for j := i; j > 0 && sites[j].Offset > sites[j-1].Offset; j-- {
			sites[j], sites[j-1] = sites[j-1], sites[j]
		}
	}
}

// collectFuncSites 遍历文件 AST，收集所有插桩点。probes 非 nil 时按契约过滤。
func collectFuncSites(fset *token.FileSet, f *ast.File, pkg, fileRel string, enableDeep, enableEffect bool, pkgVars map[string]bool, probes []ContractProbe, sites *[]Site) {
	ast.Inspect(f, func(n ast.Node) bool {
		switch t := n.(type) {
		case *ast.FuncDecl:
			if t.Body != nil {
				processFunction(fset, funcDeclName(t, fileRel), t.Type.Params, t.Type.Results, t.Body, pkg, fileRel, enableDeep, enableEffect, pkgVars, probes, sites)
			}
		case *ast.FuncLit:
			if t.Body != nil {
				processFunction(fset, "", t.Type.Params, t.Type.Results, t.Body, pkg, fileRel, enableDeep, enableEffect, pkgVars, probes, sites)
			}
		}
		return true
	})
}

// funcDeclName 计算一个 FuncDecl 的探针名（探针名空间 = pkg + fn + suffix）。
//
// ★★★ T297（2026-10-14）：**带接收者的方法必须把接收者类型拼进名字**。
//
//	原先调用处只传 `t.Name.Name`（**丢掉了 `t.Recv`**）⇒ 不同类型上的**同名方法**
//	共用同一探针名。String/Error/Close/Read/Write 这类**极常见**的方法名一撞就是一片。
//	实测（夹具 gp1-go2-collide）：类型 A 与 B 各有 `String()` ⇒ 两处事件**都叫** `main.String`
//	（enter×2/exit×2）⇒ 调用树与契约匹配分不清是谁。
//	⇒ 形态 `A.String`（接收者类型名 + `.` + 方法名）。指针/泛型实参的处理见 recvTypeName。
//	★ 不会与顶层函数撞：顶层函数名**不能含 `.`**，而方法名恒含一个 `.`。
//
// ★★★ T295（2026-10-14）：**`init` 每个文件可有一个**（Go 允许同包多文件各写一个 `init()`）
//
//	⇒ 同包两个 init 原先都叫 `pkg.init` ⇒ 实测事件 enter×1/exit×2，只能靠 fields.file 区分。
//	⇒ 名字里带**文件**（basename 不带扩展）区分：`init@<basename>`。
//	★ 只对**顶层** `init`（无接收者）做 —— 方法名 `init` 有接收者前缀（`T.init`），天然不撞。
//	★ 残余（如实）：两个**不同目录**、包名又相同的包各有一个同名文件（如两个 `main` 命令
//	  都叫 `main.go`）时，`init@main` 仍会撞。这属"包名空间只有 pkg 名"的既有局限，不在本笔范围。
func funcDeclName(t *ast.FuncDecl, fileRel string) string {
	name := t.Name.Name
	if t.Recv != nil && len(t.Recv.List) > 0 {
		if recv := recvTypeName(t.Recv.List[0].Type); recv != "" {
			return recv + "." + name
		}
		return name
	}
	if name == "init" {
		base := filepath.Base(fileRel)
		base = strings.TrimSuffix(base, filepath.Ext(base))
		if base != "" {
			return "init@" + base
		}
	}
	return name
}

// recvTypeName 从接收者类型表达式取**类型名**：去指针（`*A`→`A`）、去泛型实参（`A[T]`→`A`）。
//
// ★ 为什么去指针：Go **禁止**同一类型同时声明值接收者与指针接收者的**同名方法**
//
//	（编译错 `method A.String already declared`）⇒ `A.String` 对值/指针接收者都唯一；
//	带 `*` 只会让名字更难看、无收益。
//
// ★ 为什么去泛型实参：泛型 `A[T]` 与其具名 `A` 同名（源码里只有一个方法声明），实例化
//
//	`A[int]`/`A[string]` 共用同一个方法 ⇒ 去实参不引入撞名。
//
// ★ 覆盖 ast 的基本形态（`*ast.Ident` / `*ast.StarExpr`）以及泛型 `IndexExpr`/`IndexListExpr`、
//
//	括号包裹；无法识别的形态退回 exprString，仍为 `"nil"` 时返回空串（调用方退回裸方法名）。
func recvTypeName(e ast.Expr) string {
	switch t := e.(type) {
	case *ast.Ident:
		return t.Name
	case *ast.StarExpr:
		return recvTypeName(t.X)
	case *ast.ParenExpr:
		return recvTypeName(t.X)
	case *ast.IndexExpr: // 泛型 A[T]
		return recvTypeName(t.X)
	case *ast.IndexListExpr: // 泛型 A[T, U]
		return recvTypeName(t.X)
	default:
		if s := exprString(e); s != "nil" {
			return s
		}
		return ""
	}
}

// processFunction 处理一个函数体（FuncDecl 或 FuncLit）：入口/出口/return/IO/deep。
// probes 非 nil（契约模式）时，每条探针注入前用 MatchProbe 精确门控——只注入
// DSL 声明的 pkg.FuncName.suffix。
func processFunction(fset *token.FileSet, fn string, params, results *ast.FieldList, body *ast.BlockStmt, pkg, fileRel string, enableDeep, enableEffect bool, pkgVars map[string]bool, probes []ContractProbe, sites *[]Site) {
	if fn == "" {
		// ★★★ T280（2026-10-14）：**匿名函数要有唯一名** —— 原先恒为 `"closure"`
		//   ⇒ 实测 4 个不同闭包（`MakeAdder` 内 / `Safe` 的 `defer` / `SumAsync` 的 goroutine /
		//     `main` 的回调）的事件**全叫** `main.closure.enter/exit`
		//   ⇒ 调用树与**契约匹配**分不清是谁（契约里写 `main.closure.exit` 会命中所有闭包）。
		//   ★ 对齐 TS 侧（那边是 T277 的 `anon@L<行>C<列>`）；这里用 Go 自己的位置信息合成。
		//   ★ **必须带列号**：同一行可以有多个闭包（`f(func(){…}, func(){…})`）。
		pos := fset.Position(body.Pos())
		fn = fmt.Sprintf("closure@L%dC%d", pos.Line, pos.Column)
	}
	offsetOf := func(pos token.Pos) int {
		return fset.Position(pos).Offset
	}
	lineOf := func(pos token.Pos) int {
		return fset.Position(pos).Line
	}
	probeName := func(suffix string) string {
		return fmt.Sprintf("%s.%s.%s", pkg, fn, suffix)
	}

	openOffset := offsetOf(body.Lbrace)
	insertAt := openOffset + 1

	// ── 入口（core）：在函数体 '{' 后注入参数捕获 ──
	if MatchProbe(probeName("enter"), probes) {
		argsMap := paramCapture(params)
		code := fmt.Sprintf(`camprobe.Capture(%q, "llm-design", map[string]any{"file": %q, "level": "core", "args": map[string]any{%s}});`,
			probeName("enter"), fileRel, argsMap)
		*sites = append(*sites, Site{Kind: ProbeEnter, Level: "core", Line: lineOf(body.Lbrace), Offset: insertAt, Code: "\n" + code})
	}

	// ── 出口（core）· 命名返回值路径（T279）──
	//
	// 病：命名返回值 + defer 改结果时，挂在 `return` 语句处的 exit 探针取的是
	// **return 语句那一刻**的值；而 Go 的 defer 在 return **之后**才跑（LIFO）⇒
	// 探针记的是"改之前"的值（例：Safe 的 caught 被 defer 改成 "boom"，探针却报 ""）。
	//
	// 修：利用 defer 的 LIFO —— 在**函数体第一条语句**处注册一条 exit 探针的 defer，
	// 它天然在**所有用户 defer 之后**执行，且**覆盖所有 return 路径**（含 panic 展开），
	// 读的是命名返回值变量**最终**的值。
	//
	// ★ 必须是闭包 `defer func(){...}()`：`defer f(expr)` 的**实参在注册时即求值**
	//   （Go 规范），直接把 `map[string]any{"ret": caught}` 写在 defer 调用里会捕获
	//   注册那一刻的空值 —— 正是本 bug 本身。闭包把读取推迟到真正执行时。
	//
	// 非命名返回值的函数保持原路径（在 `return` 处插），因为没有名字可在 defer 里读。
	namedRet := namedResultNames(results)
	useDeferExit := len(namedRet) > 0 && MatchProbe(probeName("exit"), probes)
	if useDeferExit {
		retParts := make([]string, len(namedRet))
		for i, n := range namedRet {
			retParts[i] = fmt.Sprintf("%q: %s", fmt.Sprintf("%d", i), n)
		}
		code := fmt.Sprintf(`defer func() { camprobe.Capture(%q, "llm-design", map[string]any{"file": %q, "level": "core", "ret": map[string]any{%s}}) }();`,
			probeName("exit"), fileRel, strings.Join(retParts, ", "))
		*sites = append(*sites, Site{Kind: ProbeExit, Level: "core", Line: lineOf(body.Lbrace), Offset: insertAt, Code: "\n" + code})
	}

	// 遍历函数体语句：return / IO / deep / effect 由语句级处理
	// useDeferExit=true 时 return 处不再插 exit（否则一条出口会出两条事件）。
	walkStmts(fset, body.List, probeName, fileRel, enableDeep, enableEffect, pkgVars, offsetOf, lineOf, probes, sites, useDeferExit)

	// 函数体末尾出口探针：仅当最后一条语句不是 return 时注入（named-return 尾部自然落出等）。
	// 若最后一条是 return，return 前已有 exit 探针捕获出口；在 return 后插任何语句
	// （探针/调用）都会成为不可达代码，Go 编译器报 "missing return"（已实验证实）。
	// 注入位置用最后一条语句的 End()，避免与 Rbrace 前位置冲突。
	// ★ 命名返回值路径已在函数体首注册了 defer 出口探针（覆盖所有路径，含自然落出）
	//   ⇒ 这里跳过，避免同一条出口出两条事件。
	if !useDeferExit && MatchProbe(probeName("exit"), probes) && len(body.List) > 0 {
		last := body.List[len(body.List)-1]
		// 末尾是「可能不落出函数」的控制流时不插末尾探针：
		// return（已有 return 前探针）、for/select/switch（可能无限或全分支返回）、
		// if-else（两分支均以 return 收尾）。在这些语句后插任何语句都有
		// "missing return" 风险（Go 对不可达代码的规则）。
		if !terminatesFunction(last) {
			lastEnd := offsetOf(last.End())
			code := fmt.Sprintf(`camprobe.Capture(%q, "llm-design", map[string]any{"file": %q, "level": "core"});`,
				probeName("exit"), fileRel)
			*sites = append(*sites, Site{Kind: ProbeExit, Level: "core", Line: lineOf(body.Rbrace), Offset: lastEnd, Code: "\n" + code})
		}
	}
}

// namedResultNames 返回函数命名返回值中**可读**的变量名（跳过空标识符 `_`）。
// 结果列表不是「全命名」（含无名字段）、无命名返回值、或命名结果全为 `_` 时返回 nil
// —— 这些情况无法在 defer 里按名字读取，调用方应走旧的 return 处插桩路径。
func namedResultNames(results *ast.FieldList) []string {
	if results == nil || len(results.List) == 0 {
		return nil
	}
	var names []string
	for _, f := range results.List {
		if len(f.Names) == 0 {
			return nil // 结果列表非全命名（Go 语法上要么全命名要么全无名，防御性兜底）
		}
		for _, n := range f.Names {
			if n.Name == "_" {
				continue // 空标识符不可引用
			}
			names = append(names, n.Name)
		}
	}
	if len(names) == 0 {
		return nil // 命名结果全为 `_`：无变量可读
	}
	return names
}

// paramCapture 构造入口探针的参数捕获字段（仅命名简单标识符参数，且为单个名字）。
func paramCapture(params *ast.FieldList) string {
	if params == nil {
		return ""
	}
	var fields []string
	add := func(names []*ast.Ident) {
		for _, n := range names {
			if n.Name == "_" {
				continue // 空标识符 _ 不能作 map key 也不能作值，跳过
			}
			fields = append(fields, fmt.Sprintf("%q: %s", n.Name, n.Name))
		}
	}
	for _, f := range params.List {
		if len(f.Names) == 0 {
			continue // 无名字的参数（如 func(int, string)）不可引用，跳过
		}
		add(f.Names)
	}
	return strings.Join(fields, ", ")
}

// walkStmts 递归遍历语句列表，收集 return / IO / deep / effect 探针。
// probes 非 nil（契约模式）时，每条探针注入前用 MatchProbe 精确门控。
// skipReturnExit=true 时不在 `return` 处插 exit（该函数已走命名返回值 defer 路径，T279）。
func walkStmts(fset *token.FileSet, stmts []ast.Stmt, probeName func(string) string, fileRel string, enableDeep, enableEffect bool, pkgVars map[string]bool, offsetOf func(token.Pos) int, lineOf func(token.Pos) int, probes []ContractProbe, sites *[]Site, skipReturnExit bool) {
	for _, stmt := range stmts {
		switch s := stmt.(type) {
		case *ast.ReturnStmt:
			// return 出口（core）：在 return 前注入。取值捕获仅当无副作用。
			if !skipReturnExit && MatchProbe(probeName("exit"), probes) {
				// 含 <-ch（阻塞 + 消费，二次求值死锁）→ 临时变量替换路径。
				if tmpCode, ok := blockingReturnCapture(s, lineOf(s.Pos()), probeName("exit"), fileRel); ok {
					*sites = append(*sites, Site{Kind: ProbeExit, Level: "core", Line: lineOf(s.Pos()), Offset: offsetOf(s.Pos()), EndOffset: offsetOf(s.End()), Code: tmpCode})
					break
				}
				fields := returnCapture(s)
				// fields 可能为空（return 无值或有副作用表达式），此时不拼 "ret:" 字段，
				// 否则会出现 map 字面量里的 "level": "core", 空字段 trailing comma，Go 语法错误。
				suffix := ""
				if fields != "" {
					suffix = ", " + fields
				}
				code := fmt.Sprintf(`camprobe.Capture(%q, "llm-design", map[string]any{"file": %q, "level": "core"%s});`,
					probeName("exit"), fileRel, suffix)
				*sites = append(*sites, Site{Kind: ProbeExit, Level: "core", Line: lineOf(s.Pos()), Offset: offsetOf(s.Pos()), Code: code + "\n"})
			}
		case *ast.BlockStmt:
			walkStmts(fset, s.List, probeName, fileRel, enableDeep, enableEffect, pkgVars, offsetOf, lineOf, probes, sites, skipReturnExit)
		case *ast.LabeledStmt:
			// 带标签语句：递归其内部语句。
			// ★ T290：旧版无此 case ⇒ `R: return 42` 里的 return 拿不到 exit 探针，
			//   而末尾兜底探针又插在整条标签语句之后 ⇒ `missing return`。
			walkStmts(fset, []ast.Stmt{s.Stmt}, probeName, fileRel, enableDeep, enableEffect, pkgVars, offsetOf, lineOf, probes, sites, skipReturnExit)
		case *ast.IfStmt:
			// 遍历 if / else if / else 链的各分支体：分支内的 return 都要拿到 exit 探针。
			// ★ T291/T292：旧版只递归 s.Body 与「BlockStmt 形态的」Else ⇒ else if 分支里的
			//   return 拿不到 exit（实测 elseIfPartial 的 n<0 分支只有 enter、没有 exit）。
			// 仅对**分支体内的语句列表**调 walkStmts（与既有形态一致），不对内层 if 语句本身
			// 做语句级 IO/deep/effect 处理（那由最外层 if 的语句级扫描覆盖）。
			for cur := s; cur != nil; {
				if cur.Body != nil {
					walkStmts(fset, cur.Body.List, probeName, fileRel, enableDeep, enableEffect, pkgVars, offsetOf, lineOf, probes, sites, skipReturnExit)
				}
				switch el := cur.Else.(type) {
				case *ast.BlockStmt:
					walkStmts(fset, el.List, probeName, fileRel, enableDeep, enableEffect, pkgVars, offsetOf, lineOf, probes, sites, skipReturnExit)
					cur = nil
				case *ast.IfStmt:
					cur = el
				default:
					cur = nil
				}
			}
		case *ast.ForStmt:
			if s.Body != nil {
				walkStmts(fset, s.Body.List, probeName, fileRel, enableDeep, enableEffect, pkgVars, offsetOf, lineOf, probes, sites, skipReturnExit)
			}
		case *ast.RangeStmt:
			if s.Body != nil {
				walkStmts(fset, s.Body.List, probeName, fileRel, enableDeep, enableEffect, pkgVars, offsetOf, lineOf, probes, sites, skipReturnExit)
			}
		case *ast.SwitchStmt:
			if s.Body != nil {
				walkStmts(fset, s.Body.List, probeName, fileRel, enableDeep, enableEffect, pkgVars, offsetOf, lineOf, probes, sites, skipReturnExit)
			}
		case *ast.TypeSwitchStmt:
			if s.Body != nil {
				walkStmts(fset, s.Body.List, probeName, fileRel, enableDeep, enableEffect, pkgVars, offsetOf, lineOf, probes, sites, skipReturnExit)
			}
		case *ast.SelectStmt:
			if s.Body != nil {
				walkStmts(fset, s.Body.List, probeName, fileRel, enableDeep, enableEffect, pkgVars, offsetOf, lineOf, probes, sites, skipReturnExit)
			}
		case *ast.CaseClause:
			walkStmts(fset, s.Body, probeName, fileRel, enableDeep, enableEffect, pkgVars, offsetOf, lineOf, probes, sites, skipReturnExit)
		case *ast.CommClause:
			walkStmts(fset, s.Body, probeName, fileRel, enableDeep, enableEffect, pkgVars, offsetOf, lineOf, probes, sites, skipReturnExit)
		case *ast.DeferStmt:
			// defer/recover（event）：捕获 defer 调用中的错误场景（Op）
			if MatchProbe(probeName("defer"), probes) {
				if op := deferOp(s); op != "" {
					code := fmt.Sprintf(`camprobe.Capture(%q, "llm-design", map[string]any{"file": %q, "level": "event", "op": %q});`,
						probeName("defer"), fileRel, op)
					// Bug5 修复：不能注入到 s.Call.Lparen+1（参数括号内部=语法错误），
					// 改为在 defer 语句末尾之后注入，并前缀换行与原 token 分隔。
					*sites = append(*sites, Site{Kind: ProbeIO, Level: "event", Line: lineOf(s.Pos()), Offset: offsetOf(s.End()), Code: "\n" + code + "\n"})
				}
			}
		}

		// ── IO 写盘（event）：语句内含 IO 调用 → 语句后注入 ──
		// 跳过 ReturnStmt：return 表达式里的 IO 调用（如 return os.Rename(...)）
		// 已由 return 前的 exit 探针覆盖；在 return 后插任何语句都是不可达代码，
		// Go 编译器报 "missing return"。
		if _, isRetStmt := stmt.(*ast.ReturnStmt); isRetStmt {
			continue // 仅跳过当前语句的 IO 探针，不能 return（会退出整个 walkStmts，丢掉后续兄弟语句）
		}
		if op := ioOpInStmt(stmt); op != "" && MatchProbe(probeName(op), probes) {
			code := fmt.Sprintf(`camprobe.Capture(%q, "llm-design", map[string]any{"file": %q, "level": "event", "op": %q});`,
				probeName(op), fileRel, op)
			// Bug4 修复：前置换行避免与前一个 token（如 `}`）粘连成 `}camprobe` 语法错误
			*sites = append(*sites, Site{Kind: ProbeIO, Level: "event", Line: lineOf(stmt.Pos()), Offset: offsetOf(stmt.End()), Code: "\n" + code + "\n"})
		}

		// ── deep（可选）：变量赋值捕获 ──
		if enableDeep && MatchProbe(probeName("deep"), probes) {
			if code, ok := deepCapture(stmt, probeName, fileRel); ok {
				// 同 Bug4：前置换行避免粘连
				*sites = append(*sites, Site{Kind: ProbeDeep, Level: "deep", Line: lineOf(stmt.Pos()), Offset: offsetOf(stmt.End()), Code: "\n" + code + "\n"})
			}
		}

		// ── effect（可选，Phase 2c 动静对账）：外部作用点观测 ──
		// 包级变量写 / chan send / go 语句 / 资源获取调用，语句末注入，
		// Capture 带 kind/target/op，与 agent-io 静态候选（origin='ast'）同构。
		if enableEffect && MatchProbe(probeName("effect"), probes) {
			if hit, ok := effectInStmt(stmt, pkgVars); ok {
				code := fmt.Sprintf(`camprobe.Capture(%q, "llm-design", map[string]any{"file": %q, "level": "effect", "kind": %q, "target": %q, "op": %q});`,
					probeName("effect"), fileRel, hit.Kind, hit.Target, hit.Op)
				*sites = append(*sites, Site{Kind: ProbeEffect, Level: "effect", Line: lineOf(stmt.Pos()), Offset: offsetOf(stmt.End()), Code: "\n" + code + "\n"})
			}
		}
	}
}

// returnCapture 构造 return 出口探针的字段。仅当返回值表达式无副作用时捕获值。
func returnCapture(s *ast.ReturnStmt) string {
	if len(s.Results) == 0 {
		return ""
	}
	allSimple := true
	for _, r := range s.Results {
		if !isSideEffectFree(r) {
			allSimple = false
			break
		}
	}
	if !allSimple {
		return ""
	}
	parts := make([]string, 0, len(s.Results))
	for i, r := range s.Results {
		parts = append(parts, fmt.Sprintf("%q: %s", fmt.Sprintf("%d", i), exprString(r)))
	}
	return "\"ret\": map[string]any{" + strings.Join(parts, ", ") + "}"
}

// isSideEffectFree 判断表达式是否无副作用（可安全地再次求值）。
// 注意：<-ch（channel 接收）不算无副作用——它阻塞且消费一个值，二次求值
// 会死锁/取错值（graph_writer.SubmitSync 案例）。含 <-ch 的 return 走
// blockingReturnCapture 的临时变量路径，不走内联捕获。
func isSideEffectFree(e ast.Expr) bool {
	switch t := e.(type) {
	case *ast.Ident, *ast.BasicLit:
		return true
	case *ast.ParenExpr:
		return isSideEffectFree(t.X)
	case *ast.UnaryExpr:
		if t.Op == token.ARROW {
			return false // <-ch：阻塞 + 消费，不可重复求值
		}
		return isSideEffectFree(t.X)
	case *ast.BinaryExpr:
		return isSideEffectFree(t.X) && isSideEffectFree(t.Y)
	case *ast.SelectorExpr:
		return isSideEffectFree(t.X)
	case *ast.IndexExpr:
		return isSideEffectFree(t.X) && isSideEffectFree(t.Index)
	case *ast.CompositeLit:
		for _, el := range t.Elts {
			if !isSideEffectFree(el) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

// isSideEffectFreeOrRecv 同 isSideEffectFree，但允许 <-ch（channel 接收）。
// 用于 blockingReturnCapture：接收表达式可先落临时变量（单次求值）再捕获。
func isSideEffectFreeOrRecv(e ast.Expr) bool {
	switch t := e.(type) {
	case *ast.Ident, *ast.BasicLit:
		return true
	case *ast.ParenExpr:
		return isSideEffectFreeOrRecv(t.X)
	case *ast.UnaryExpr:
		return isSideEffectFreeOrRecv(t.X) // 含 ARROW（<-ch 允许）
	case *ast.BinaryExpr:
		return isSideEffectFreeOrRecv(t.X) && isSideEffectFreeOrRecv(t.Y)
	case *ast.SelectorExpr:
		return isSideEffectFreeOrRecv(t.X)
	case *ast.IndexExpr:
		return isSideEffectFreeOrRecv(t.X) && isSideEffectFreeOrRecv(t.Index)
	case *ast.CompositeLit:
		for _, el := range t.Elts {
			if !isSideEffectFreeOrRecv(el) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

// hasBlockingRecv 检测表达式树内是否含 <-ch（channel 接收）。
func hasBlockingRecv(e ast.Expr) bool {
	switch t := e.(type) {
	case *ast.ParenExpr:
		return hasBlockingRecv(t.X)
	case *ast.UnaryExpr:
		if t.Op == token.ARROW {
			return true
		}
		return hasBlockingRecv(t.X)
	case *ast.BinaryExpr:
		return hasBlockingRecv(t.X) || hasBlockingRecv(t.Y)
	case *ast.SelectorExpr:
		return hasBlockingRecv(t.X)
	case *ast.IndexExpr:
		return hasBlockingRecv(t.X) || hasBlockingRecv(t.Index)
	default:
		return false
	}
}

// blockingReturnCapture 处理返回值含 <-ch 的 return：改写为
//
//	__camRetL{line}_{i}... := 原表达式...   // 单次求值落变量
//	camprobe.Capture(..., "ret": {...变量}) // 捕获变量
//	return __camRetL{line}_0, ...           // 返回变量
//
// 调用方须用 Site{EndOffset: offsetOf(s.End())} 替换原 return 语句。
// 返回 ok=false 表示不适用（无接收表达式，或有接收之外的副作用）。
func blockingReturnCapture(s *ast.ReturnStmt, line int, probeExit, fileRel string) (string, bool) {
	if len(s.Results) == 0 {
		return "", false
	}
	hasRecv := false
	for _, r := range s.Results {
		if !isSideEffectFreeOrRecv(r) {
			return "", false // 有 <-ch 之外的副作用（函数调用等）→ 走放弃捕获路径
		}
		if hasBlockingRecv(r) {
			hasRecv = true
		}
	}
	if !hasRecv {
		return "", false // 无阻塞表达式 → 走内联路径
	}
	names := make([]string, len(s.Results))
	exprs := make([]string, len(s.Results))
	for i, r := range s.Results {
		names[i] = fmt.Sprintf("__camRet%d_%d", line, i)
		exprs[i] = exprString(r)
	}
	retParts := make([]string, len(names))
	for i, n := range names {
		retParts[i] = fmt.Sprintf("%q: %s", fmt.Sprintf("%d", i), n)
	}
	capture := fmt.Sprintf(`camprobe.Capture(%q, "llm-design", map[string]any{"file": %q, "level": "core", "ret": map[string]any{%s}});`,
		probeExit, fileRel, strings.Join(retParts, ", "))
	return strings.Join(names, ", ") + " := " + strings.Join(exprs, ", ") + "\n" +
		capture + "\nreturn " + strings.Join(names, ", ") + "\n", true
}

// exprString 渲染表达式源码（用于注入；不接受错误，仅简单表达式可渲染）。
func exprString(e ast.Expr) string {
	switch t := e.(type) {
	case *ast.Ident:
		return t.Name
	case *ast.BasicLit:
		return t.Value
	case *ast.ParenExpr:
		return "(" + exprString(t.X) + ")"
	case *ast.UnaryExpr:
		return t.Op.String() + exprString(t.X)
	case *ast.BinaryExpr:
		return exprString(t.X) + " " + t.Op.String() + " " + exprString(t.Y)
	case *ast.SelectorExpr:
		return exprString(t.X) + "." + t.Sel.Name
	case *ast.IndexExpr:
		return exprString(t.X) + "[" + exprString(t.Index) + "]"
	case *ast.StarExpr:
		return "*" + exprString(t.X)
	case *ast.ArrayType:
		if t.Len == nil {
			return "[]" + exprString(t.Elt)
		}
		return "[" + exprString(t.Len) + "]" + exprString(t.Elt)
	case *ast.CompositeLit:
		// 复合字面量：&T{...} 或 T{...}。元素递归渲染（仅简单字面量，前面已有 isSideEffectFree 把关）
		typeName := exprString(t.Type)
		if typeName == "nil" {
			return "nil" // 类型无法渲染 → 整体降级为 nil，调用方会因值含 "nil" 表达式而跳过
		}
		elts := make([]string, 0, len(t.Elts))
		for _, el := range t.Elts {
			switch kv := el.(type) {
			case *ast.KeyValueExpr:
				elts = append(elts, exprString(kv.Key)+": "+exprString(kv.Value))
			default:
				elts = append(elts, exprString(el))
			}
		}
		return typeName + "{" + strings.Join(elts, ", ") + "}"
	default:
		return "nil"
	}
}

// ioOpInStmt 检测语句内是否含 IO 写盘调用，返回探针 op 名（无则空串）。
func ioOpInStmt(stmt ast.Stmt) string {
	op := ""
	ast.Inspect(stmt, func(n ast.Node) bool {
		if op != "" {
			return false
		}
		if c, ok := n.(*ast.CallExpr); ok {
			if sel, ok := c.Fun.(*ast.SelectorExpr); ok {
				if o, found := ioOps[sel.Sel.Name]; found {
					op = o
					return false
				}
			}
		}
		return true
	})
	return op
}

// deferOp 检测 defer 调用是否含 recover（Go 的错误捕获场景），返回 op 名。
func deferOp(s *ast.DeferStmt) string {
	if s.Call == nil {
		return ""
	}
	// defer func(){ ... recover() ... }() 视为 error-捕获点
	if lit, ok := s.Call.Fun.(*ast.FuncLit); ok {
		hasRecover := false
		ast.Inspect(lit.Body, func(n ast.Node) bool {
			if c, ok := n.(*ast.CallExpr); ok {
				if id, ok2 := c.Fun.(*ast.Ident); ok2 && id.Name == "recover" {
					hasRecover = true
					return false
				}
			}
			return true
		})
		if hasRecover {
			return "recover"
		}
	}
	return ""
}

// deepCapture 捕获变量赋值（deep 级）。仅当语句是「单标识符赋值 + 初值」时。
func deepCapture(stmt ast.Stmt, probeName func(string) string, fileRel string) (string, bool) {
	as, ok := stmt.(*ast.AssignStmt)
	if !ok {
		return "", false
	}
	if len(as.Lhs) != 1 || len(as.Rhs) != 1 {
		return "", false
	}
	id, ok := as.Lhs[0].(*ast.Ident)
	if !ok {
		return "", false
	}
	code := fmt.Sprintf(`camprobe.Capture(%q, "llm-design", map[string]any{"file": %q, "level": "deep", "name": %q, "value": %s});`,
		probeName("deep"), fileRel, id.Name, exprString(as.Rhs[0]))
	return code, true
}

// InstrumentDir 对目录下所有 .go 文件插桩。返回每个文件的插桩结果。
func InstrumentDir(root string, opts Options) []Result {
	files := collectGoFiles(root, opts.ExcludeDirs)
	var results []Result
	for _, f := range files {
		o := opts
		o.BackupRoot = root
		r, _ := InstrumentFile(f, o)
		results = append(results, r)
	}
	return results
}

// isProbeCall 判断语句是否为 camprobe.Capture(...) 探针调用（插桩器生成的探针）。
func isProbeCall(stmt ast.Stmt) bool {
	es, ok := stmt.(*ast.ExprStmt)
	if !ok {
		return false
	}
	ce, ok := es.X.(*ast.CallExpr)
	if !ok || len(ce.Args) == 0 {
		return false
	}
	sel, ok := ce.Fun.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	return sel.Sel.Name == "Capture"
}

// cleanupTrailingProbes 删除「块末探针破坏终止性」的探针语句。
// 场景：块（函数体/if/for/case/comm 体）的最后一条原本是终止语句，
// 但探针（IO/deep/错位 Site）被插到它之后 → 块不再以终止语句结尾 → Go 报
// "missing return"。这类探针是多余的：出口信息已由 return 前的 exit 探针覆盖。
// 返回清理后的源码；无改动时返回 nil。
func cleanupTrailingProbes(file string, src []byte) []byte {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, file, src, parser.ParseComments)
	if err != nil {
		return nil
	}
	var removes []ast.Stmt
	ast.Inspect(f, func(n ast.Node) bool {
		var list []ast.Stmt
		switch blk := n.(type) {
		case *ast.BlockStmt:
			list = blk.List
		case *ast.CaseClause:
			list = blk.Body
		case *ast.CommClause:
			list = blk.Body
		default:
			return true
		}
		if len(list) >= 2 && isProbeCall(list[len(list)-1]) && terminatesFunction(list[len(list)-2]) {
			removes = append(removes, list[len(list)-1])
		}
		return true
	})
	if len(removes) == 0 {
		return nil
	}
	// 按 Pos 降序删除，避免偏移漂移；顺带吃掉语句后随的空白/换行。
	for i := 1; i < len(removes); i++ {
		for j := i; j > 0 && removes[j].Pos() > removes[j-1].Pos(); j-- {
			removes[j], removes[j-1] = removes[j-1], removes[j]
		}
	}
	out := append([]byte(nil), src...)
	for _, r := range removes {
		start := fset.Position(r.Pos()).Offset
		end := fset.Position(r.End()).Offset
		for end < len(out) && (out[end] == '\n' || out[end] == '\r' || out[end] == '\t' || out[end] == ' ') {
			end++
		}
		out = append(out[:start], out[end:]...)
	}
	return out
}
