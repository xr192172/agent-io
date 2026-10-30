// gofacts —— 语义层事实抽取器（agent-io 自带的索引辅助程序）
//
// 为什么需要它：绑定 / 字段选择 / 类型 / 提升字段，只有 **type checker** 给得准；
// tree-sitter 只给语法。两者**并存**：本项目能 type-check ⇒ 本程序产出精确事实；
// 不能（缺依赖 / 无 go.mod）⇒ 索引内核标 syntax-only，本程序不产出任何"装作精确"的东西。
//
// 调用方：src/infrastructure/index/semantic_facts.ts（由 import_project 的索引内核触发）。
// 约定：**只输出 stdout 一行 JSON，不写库** —— 写库（事务/表结构/降级）只由 TS 侧一处负责。
package main

import (
	"encoding/json"
	"fmt"
	"go/types"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/tools/go/packages"
)

type Occurrence struct {
	File      string `json:"file"`
	Line      int    `json:"line"`
	Col       int    `json:"col"`
	SymbolID  string `json:"symbolId"`
	Role      string `json:"role"` // def | use | selection | type
	Structure string `json:"structure,omitempty"`
	Member    string `json:"member,omitempty"`
}

type Field struct {
	// ★ File：字段声明的**出处文件**（相对路径）。build tag 互斥变体里会有同名结构体
	// （如 LocalEmbedder 的 cgo / !cgo 两个文件），没有出处就只能按名字聚合 ⇒ 并集 ⇒ 假分叉。
	File      string `json:"file"`
	Structure string `json:"structure"`
	Name      string `json:"name"`
	Ordinal   int    `json:"ordinal"`
	Type      string `json:"type"`
	JSONTag   string `json:"jsonTag"`
	Embedded  bool   `json:"embedded"`
}

// Param / Func —— **函数签名账**（比字段账更强的对拍面：形参名/顺序/类型、返回值个数与类型）
type Param struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type Func struct {
	File    string   `json:"file"`
	Recv    string   `json:"recv"`    // 接收者类型名（"" = 普通函数）
	Name    string   `json:"name"`
	Params  []Param  `json:"params"`
	Results []string `json:"results"`
}

type Out struct {
	OK          bool         `json:"ok"`
	Reason      string       `json:"reason,omitempty"`
	Packages    int          `json:"packages"`
	Files       int          `json:"files"`
	TypeErrors  int          `json:"typeErrors"`
	Occurrences []Occurrence `json:"occurrences"`
	Fields      []Field      `json:"fields"`
	Funcs       []Func       `json:"funcs"`
}

// symID：稳定符号标识（不用行号）：<pkgpath>.<Name>；字段为 <Recv>.<Member>
func symID(pkg *types.Package, obj types.Object) string {
	p := ""
	if pkg != nil {
		p = pkg.Path()
	}
	if p == "" {
		return obj.Name()
	}
	return p + "." + obj.Name()
}

func main() {
	dir := "."
	if len(os.Args) > 1 {
		dir = os.Args[1]
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		emit(Out{OK: false, Reason: "bad dir: " + err.Error()})
		return
	}
	cfg := &packages.Config{
		Mode: packages.NeedName | packages.NeedFiles | packages.NeedSyntax |
			packages.NeedTypes | packages.NeedTypesInfo | packages.NeedDeps | packages.NeedImports,
		Dir: abs,
	}
	pkgs, err := packages.Load(cfg, "./...")
	if err != nil {
		emit(Out{OK: false, Reason: "load: " + err.Error()})
		return
	}

	out := Out{OK: true, Packages: len(pkgs)}

	for _, p := range pkgs {
		if len(p.Errors) > 0 {
			out.TypeErrors += len(p.Errors)
		}
		if p.TypesInfo == nil {
			continue
		}
		out.Files += len(p.Syntax)
		info := p.TypesInfo

		// ① def / use（绑定）
		for id, obj := range info.Defs {
			if obj == nil || id == nil {
				continue
			}
			pos := p.Fset.Position(id.Pos())
			out.Occurrences = append(out.Occurrences, Occurrence{
				File: relPath(abs, pos.Filename), Line: pos.Line, Col: pos.Column,
				SymbolID: symID(obj.Pkg(), obj), Role: "def",
			})
		}
		for id, obj := range info.Uses {
			if obj == nil || id == nil {
				continue
			}
			pos := p.Fset.Position(id.Pos())
			out.Occurrences = append(out.Occurrences, Occurrence{
				File: relPath(abs, pos.Filename), Line: pos.Line, Col: pos.Column,
				SymbolID: symID(obj.Pkg(), obj), Role: "use",
			})
		}
		// ② selection（x.f 的 f 属于哪个类型；★ LSP 协议没有这个能力，只有库有）
		for sel, s := range info.Selections {
			obj := s.Obj()
			if obj == nil || sel == nil {
				continue
			}
			pos := p.Fset.Position(sel.Pos())
			structure := ""
			if recv := s.Recv(); recv != nil {
				structure = recv.String()
			}
			out.Occurrences = append(out.Occurrences, Occurrence{
				File: relPath(abs, pos.Filename), Line: pos.Line, Col: pos.Column,
				SymbolID: structure + "." + obj.Name(), Role: "selection",
				Structure: structure, Member: obj.Name(),
			})
		}
		// ③ 结构体字段账（声明顺序 + tag + 是否嵌入）
		scope := p.Types.Scope()
		for _, n := range scope.Names() {
			obj := scope.Lookup(n)
			if obj == nil {
				continue
			}
			st, ok := obj.Type().Underlying().(*types.Struct)
			if !ok {
				continue
			}
			for i := 0; i < st.NumFields(); i++ {
				f := st.Field(i)
				out.Fields = append(out.Fields, Field{
					File:      relPath(abs, p.Fset.Position(obj.Pos()).Filename),
					Structure: n,
					Name:      f.Name(),
					Ordinal:   i,
					Type:      f.Type().String(),
					JSONTag:   st.Tag(i),
					Embedded:  f.Embedded(),
				})
			}
		}
	}

	// ④ 函数/方法签名（含接收者）：签名由 type checker 给。
	//   ★ 这段接在主循环**之后**，拿不到主循环的 p/info（踩过 undefined: info / p）⇒ 自带包循环。
	for _, fp := range pkgs {
		finfo := fp.TypesInfo
		if finfo == nil {
			continue
		}
		for id, obj := range finfo.Defs {
			if obj == nil || id == nil || id.Name == "" { // ★ id 是 *ast.Ident：Name 是**字段**（obj.Name() 才是方法）
				continue
			}
			fn, ok := obj.(*types.Func)
			if !ok {
				continue
			}
			sig, ok := fn.Type().(*types.Signature)
			if !ok {
				continue
			}
			recv := ""
			if r := sig.Recv(); r != nil {
				recv = strings.TrimPrefix(r.Type().String(), "*")
				if i := strings.LastIndex(recv, "."); i >= 0 {
					recv = recv[i+1:]
				}
			}
			pos := fp.Fset.Position(id.Pos())
			f := Func{File: relPath(abs, pos.Filename), Recv: recv, Name: fn.Name()}
			for i := 0; i < sig.Params().Len(); i++ {
				v := sig.Params().At(i)
				f.Params = append(f.Params, Param{Name: v.Name(), Type: v.Type().String()})
			}
			for i := 0; i < sig.Results().Len(); i++ {
				f.Results = append(f.Results, sig.Results().At(i).Type().String())
			}
			out.Funcs = append(out.Funcs, f)
		}
	}
	emit(out)
}

func relPath(base, p string) string {
	r, err := filepath.Rel(base, p)
	if err != nil {
		return p
	}
	return filepath.ToSlash(r)
}

func emit(o Out) {
	b, _ := json.Marshal(o)
	fmt.Println(string(b))
}
