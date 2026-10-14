package instrument

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeGoFile 在 dir 下写一个 .go 文件，返回其绝对路径。
func writeGoFile(t *testing.T, dir, rel, content string) string {
	t.Helper()
	file := filepath.Join(dir, rel)
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return file
}

// containsAll 判断 s 是否包含全部子串。
func containsAll(s string, subs ...string) bool {
	for _, sub := range subs {
		if !strings.Contains(s, sub) {
			return false
		}
	}
	return true
}

// countOccurrences 统计子串出现次数。
func countOccurrences(s, sub string) int {
	return strings.Count(s, sub)
}

// lastStmtTerminates 解析一个函数体片段，返回其**末语句**的 terminatesFunction 判定。
func lastStmtTerminates(t *testing.T, body string) bool {
	t.Helper()
	src := "package p\nfunc _f() {\n" + body + "\n}\n"
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, "x.go", src, 0)
	if err != nil {
		t.Fatalf("parse 失败: %v\n片段:\n%s", err, src)
	}
	list := f.Decls[0].(*ast.FuncDecl).Body.List
	if len(list) == 0 {
		t.Fatal("空函数体")
	}
	return terminatesFunction(list[len(list)-1])
}

// TestTerminatesFunction 锁定「终止语句」判定的三种修复形态 + T293 精确化。
// 见 terminatesFunction 的注释（T289/T290/T291/T292/T293）。
func TestTerminatesFunction(t *testing.T) {
	cases := []struct {
		name string
		body string
		want bool
	}{
		// ── 修复前不认、修复后必须认（否则兜底探针插在不可达/非法位置） ──
		{"panic 调用（T289）", `panic("x")`, true},
		{"带标签的 return（T290）", "if false {\n\tgoto R\n}\nreturn n\nR:\nreturn 42", true},
		{"if/else if/else 全分支 return（T291）", "if a > 0 {\n\treturn 1\n} else if b > 0 {\n\treturn -1\n} else {\n\treturn 0\n}", true},
		// ── T293：可自然落出者必须判为「非终止」（否则末尾 exit 探针被跳过） ──
		{"带条件 for（T293）", `for i := 0; i < n; i++ { _ = i }`, false},
		{"range（T293）", `for _, x := range xs { _ = x }`, false},
		{"无 default 的 switch（T293）", "switch n {\ncase 0:\n\t_ = n\n}", false},
		{"无 default 的 select（T293）", "select {\ncase <-ch:\n}", false},
		// ── 真终止：仍须判 true（否则会插出 missing return） ──
		{"return", `return 1`, true},
		{"for {} 无 break", `for {}`, true},
		{"带 default 且各分支 return 的 switch", "switch n {\ncase 0:\n\treturn 0\ndefault:\n\treturn 1\n}", true},
		{"带 default 且各分支 return 的 select", "select {\ncase <-ch:\n\treturn 0\ndefault:\n\treturn 1\n}", true},
		// ── 非终止（可能落出） ──
		{"无 else 的 if", `if a > 0 { return 1 }`, false},
		{"for {} 里有 break", `for { break }`, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := lastStmtTerminates(t, c.body); got != c.want {
				t.Errorf("terminatesFunction(末语句) = %v, 期望 %v\n片段:\n%s", got, c.want, c.body)
			}
		})
	}
}

// TestInstrumentTerminalFormsCompile 端到端语法锁定：四类 P0/T293 末语句形态插桩后
// 产物必须仍能被 go/parser 解析（即无语法破坏）。编译级判据由 labs 夹具的 go build 覆盖。
func TestInstrumentTerminalFormsCompile(t *testing.T) {
	src := `package demo

func Boom() int {
	panic("unhandled")
}

func Labeled(n int) int {
	if n < 0 {
		goto R
	}
	return n
R:
	return 42
}

func IfElseChain(a, b int) int {
	if a > 0 {
		return 1
	} else if b > 0 {
		return -1
	} else {
		return 0
	}
}

func LoopOnly(n int) {
	for i := 0; i < n; i++ {
		_ = i
	}
}
`
	dir := t.TempDir()
	file := writeGoFile(t, dir, "main.go", src)
	res, err := InstrumentFile(file, Options{Write: true, BackupRoot: dir})
	if err != nil {
		t.Fatalf("InstrumentFile: %v", err)
	}
	content := readFile(t, dir, "main.go")
	fset := token.NewFileSet()
	if _, perr := parser.ParseFile(fset, file, content, parser.ParseComments); perr != nil {
		t.Fatalf("插桩产物语法解析失败: %v\n%s", perr, content)
	}
	// 每个函数都要有 enter（LoopOnly 还需 exit，T293）；Boom 不插 exit（panic 后不可达）。
	if !containsAll(content, "demo.Boom.enter", "demo.Labeled.enter", "demo.IfElseChain.enter", "demo.LoopOnly.enter") {
		t.Errorf("缺 enter 探针:\n%s", content)
	}
	if !containsAll(content, "demo.LoopOnly.exit") {
		t.Errorf("LoopOnly（末语句为可落出的 for）应有 exit 探针（T293）:\n%s", content)
	}
	if countOccurrences(content, "demo.Boom.exit") != 0 {
		t.Errorf("Boom 的 exit 探针不应插在 panic 之后（T289）:\n%s", content)
	}
	// else if 分支里的 return 必须有 exit（T292）。
	if n := countOccurrences(content, "demo.IfElseChain.exit"); n != 3 {
		t.Errorf("IfElseChain 三条 return 应各有一条 exit，实得 %d:\n%s", n, content)
	}
	_ = res
}
