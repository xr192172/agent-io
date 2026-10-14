// instrument — 插桩器统一 CLI（observe-conformance 契约入口）。
//
// 契约见 agent-io/observe-conformance/SPEC.md §2：
//
//	instrument <file|dir> [--probes '<json数组>'] [--deep] [--dry-run] [--restore]
//
// stdout 输出统一 JSON 报告 {files:[{file,sites:[{line,kind,level,probe}]}], restored:N}，
// exit 0 成功 / 1 失败。probe 名从注入源码 camprobe.Capture("...",...) 提取，
// 与运行时事件自报名一致。
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/xr192172/agent-io/observe-lang-go/internal/instrument"
)

// cliSite / cliFile / cliReport 是 CLI 契约 JSON 结构（SPEC §2）。
type cliSite struct {
	Line  int    `json:"line"`
	Kind  string `json:"kind"`
	Level string `json:"level"`
	Probe string `json:"probe"`
}

type cliFile struct {
	File  string    `json:"file"`
	Sites []cliSite `json:"sites"`
	Error *string   `json:"error"`
}

type cliReport struct {
	Files    []cliFile `json:"files"`
	Restored int       `json:"restored"`
}

// probeFromCode 从注入的探针源码提取探针名：camprobe.Capture("<name>",...) → <name>。
func probeFromCode(code string) string {
	const quote = `camprobe.Capture("`
	i := strings.Index(code, quote)
	if i < 0 {
		return ""
	}
	rest := code[i+len(quote):]
	if j := strings.IndexByte(rest, '"'); j >= 0 {
		return rest[:j]
	}
	return ""
}

func fail(err error) {
	fmt.Fprintf(os.Stderr, "instrument: %v\n", err)
	os.Exit(1)
}

func main() {
	// 手动解析：flags 与位置参数顺序无关（Go flag 包遇首个位置参数即停止，
	// 与 SPEC §2 的 "<cmd> <file> [--flags...]" 契约冲突）。
	var probesJSON, target string
	// ★ T268（2026-10-14）：`--probe-import` / `--exclude-dirs` —— 让**调用方**决定探针包住在哪。
	//   为什么需要：默认探针路径 `github.com/xr192172/agent-io/observe-lang-go/probe` 要求被测工程
	//   在 **go.mod 里写一条指向 agent-io 本机路径的 `replace`** ⇒ 换机器即失效、且会被提交进被测仓库。
	//   ⇒ 现在调用方可以把 probe 包**拷进被测工程**（如 `<module>/internal/camprobe`），
	//     并用这两个 flag 告诉插桩器："import 这个路径" + "别把探针打进它自己"。
	var probeImport, excludeDirsRaw string
	dryRun, deep, effects, restore := false, false, false, false
	for i := 0; i < len(os.Args)-1; i++ {
		a := os.Args[i+1]
		switch {
		case a == "--dry-run":
			dryRun = true
		case a == "--deep":
			deep = true
		case a == "--effects":
			effects = true
		case a == "--restore":
			restore = true
		case a == "--probe-import":
			i++
			if i >= len(os.Args)-1 {
				fail(fmt.Errorf("--probe-import 缺少参数"))
			}
			probeImport = os.Args[i+1]
		case a == "--exclude-dirs":
			i++
			if i >= len(os.Args)-1 {
				fail(fmt.Errorf("--exclude-dirs 缺少参数"))
			}
			excludeDirsRaw = os.Args[i+1]
		case a == "--probes":
			i++
			if i >= len(os.Args)-1 {
				fail(fmt.Errorf("--probes 缺少参数"))
			}
			probesJSON = os.Args[i+1]
		case strings.HasPrefix(a, "--"):
			fail(fmt.Errorf("未知参数 %s", a))
		default:
			if target == "" {
				target = a
			}
		}
	}

	if target == "" {
		fail(fmt.Errorf("用法: instrument <file|dir> [--probes ...] [--deep] [--dry-run] [--restore]"))
	}
	abs, err := filepath.Abs(target)
	if err != nil {
		fail(err)
	}

	// --restore：从 <target>/.agent-io/observe-backup 恢复。
	if restore {
		root := abs
		if fi, err := os.Stat(abs); err == nil && !fi.IsDir() {
			root = filepath.Dir(abs)
		}
		restored := instrument.RestoreInstrumented(root)
		_ = json.NewEncoder(os.Stdout).Encode(cliReport{Files: []cliFile{}, Restored: len(restored)})
		return
	}

	// 契约探针解析。
	var contract []instrument.ContractProbe
	if s := strings.TrimSpace(probesJSON); s != "" {
		var names []string
		if err := json.Unmarshal([]byte(s), &names); err != nil {
			fail(fmt.Errorf("--probes 不是合法 JSON 数组: %w", err))
		}
		for _, n := range names {
			contract = append(contract, instrument.ContractProbe{Probe: n})
		}
	}

	var excludeDirs []string
	for _, d := range strings.Split(excludeDirsRaw, ",") {
		if t := strings.TrimSpace(d); t != "" {
			excludeDirs = append(excludeDirs, t)
		}
	}

	opts := instrument.Options{
		Write:          !dryRun,
		EnableDeep:     deep,
		EnableEffect:   effects,
		ContractProbes: contract,
		BackupRoot:     filepath.Dir(abs),
		// ★ T268：调用方给的探针 import 路径与排除目录（缺省 = 旧行为，一字不改）
		ProbeImport: probeImport,
		ExcludeDirs: excludeDirs,
	}

	var results []instrument.Result
	if fi, err := os.Stat(abs); err == nil && fi.IsDir() {
		results = instrument.InstrumentDir(abs, opts)
	} else {
		r, err := instrument.InstrumentFile(abs, opts)
		if err != nil {
			fail(err)
		}
		results = append(results, r)
	}

	report := cliReport{Files: []cliFile{}}
	for _, r := range results {
		cf := cliFile{File: r.File, Sites: []cliSite{}}
		if r.Error != "" {
			cf.Error = &r.Error
		}
		for _, s := range r.Sites {
			cf.Sites = append(cf.Sites, cliSite{
				Line:  s.Line,
				Kind:  string(s.Kind),
				Level: s.Level,
				Probe: probeFromCode(s.Code),
			})
		}
		report.Files = append(report.Files, cf)
	}
	_ = json.NewEncoder(os.Stdout).Encode(report)
}
