package probe

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 骨架出生证（Go 侧）—— 对应 T311。
//
// ## 为什么 Go 侧用 `go test` 而不是 `certs/*.mjs`
// TS 侧没有测试框架（26 条 npm script 里没有 `test`）⇒ 那边只能写 `certs/*.mjs` 可执行验收；
// 而 Go 侧**本来就有** `go test` 基建（本目录已有 `probe_test.go` / `tiered_test.go`）
// ⇒ **用语言自带的量具**，不为了"形式统一"去借壳。
//
// ## 验的是骨架六格里的哪两格（与 TS 侧 `certs/observe-skeleton-cert.mjs` 同源）
//   ④ **接 sink 契约**：**探针就位 ≠ 有数据** —— 没接 sink 时 `Capture` 是 **no-op**（0 事件、不报错）；
//      接上 sink 才出事件。
//   ⑤ **错误传播**：**探针不许打断宿主，但错误必须可见** —— sink 写不出去时
//      宿主**不能崩**（探针跑在别人的热路径上），而"发不出去"这件事**必须说到 stderr**（不许静默吞）。
//
// ## 判据（全部看事实）
//   · 无 sink ⇒ events 文件**不存在**；
//   · 有 sink ⇒ events 文件**存在且行数 > 0**；
//   · sink 不可写 ⇒ **不 panic** 且 **stderr 有话说**。

// setGlobalSinkForTest 装/卸全局 sink，并在测试结束时还原成"都没有"。
// ★ 必须同时清 `globalTier`：`Capture` 的路由优先级是 **Tiered → Sink → no-op**，
//   只清 Sink 而留着 Tiered 的话，本文件的用例会被同包别的测试留下的 Tiered 悄悄接管。
func setGlobalSinkForTest(t *testing.T, s *Sink) {
	t.Helper()
	SetGlobalTiered(nil)
	SetGlobalSink(s)
	t.Cleanup(func() {
		SetGlobalTiered(nil)
		SetGlobalSink(nil)
	})
}

// TestSkeletonNoSinkIsNoOp —— ④-1：**探针就位 ≠ 有数据**。
func TestSkeletonNoSinkIsNoOp(t *testing.T) {
	dir := t.TempDir()
	evFile := filepath.Join(dir, "events.jsonl")
	setGlobalSinkForTest(t, nil)

	// 不该 panic，也不该凭空产生事件文件
	Capture("t311.nosink", "static-rule", map[string]any{"a": 1})
	CaptureErr("t311.nosink.err", "static-rule", io.EOF, nil)

	if _, err := os.Stat(evFile); !os.IsNotExist(err) {
		t.Fatalf("④-1 失败：无 sink 时不该产生事件文件，实得 err=%v", err)
	}
	// 目录里也应当什么都没有（没接 sink ⇒ 连目录都不该被创建）
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("④-1 失败：无 sink 时目录应为空，实得 %d 项", len(entries))
	}
}

// TestSkeletonSinkEmitsEvents —— ④-2：接上 sink 才出事件。
func TestSkeletonSinkEmitsEvents(t *testing.T) {
	dir := t.TempDir()
	evFile := filepath.Join(dir, "events.jsonl")

	sink, err := NewSink(evFile)
	if err != nil {
		t.Fatal(err)
	}
	setGlobalSinkForTest(t, sink)

	Capture("t311.withsink", "static-rule", map[string]any{"a": 1})
	CaptureErr("t311.withsink.err", "static-rule", io.EOF, map[string]any{"op": "read"})
	if err := sink.Close(); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(evFile)
	if err != nil {
		t.Fatalf("④-2 失败：接 sink 后应产生事件文件，实得 err=%v", err)
	}
	lines := strings.Count(string(data), "\n")
	if lines == 0 {
		t.Fatal("④-2 失败：事件文件为空（探针就位 ≠ 有数据）")
	}
	if !strings.Contains(string(data), "t311.withsink") {
		t.Fatalf("④-2 失败：事件里找不到探针名，实得:\n%s", string(data))
	}
	t.Logf("④-2 通过：%d 行事件", lines)
}

// TestSkeletonSinkFailureIsLoud —— ⑤：sink 写不出去时**不崩**且**有话说**。
//
// ★ "sink 不可写"的取法：`Close()` 之后再 `Emit` —— `os.File` 已被置 nil，
//   Go 的 `(*os.File).Write` 对 nil 接收者返回 `ErrInvalid`（**不 panic**）。
//   这对应真实场景：**进程在收尾时探针还在热路径上跑**。
func TestSkeletonSinkFailureIsLoud(t *testing.T) {
	dir := t.TempDir()
	evFile := filepath.Join(dir, "events.jsonl")

	sink, err := NewSink(evFile)
	if err != nil {
		t.Fatal(err)
	}
	if err := sink.Close(); err != nil {
		t.Fatal(err)
	}
	setGlobalSinkForTest(t, sink)

	// ★ 把 os.Stderr 换成管道，才能**看事实**（而不是靠"我觉得它该打"）
	oldStderr := os.Stderr
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stderr = w

	// ★ 限流是**设计**（首次完整说、之后每 100 次一次）⇒ 想让"第 1 次"必打，得把计数归零。
	//   这是同包白盒，不改产品行为。
	resetProbeErrStateForTest()

	// 走到这里没崩 ⇒ ⑤ 的"宿主不崩"成立（Go 里 panic 会让整个测试失败）
	Capture("t311.badsink", "static-rule", map[string]any{"a": 1})

	_ = w.Close()
	os.Stderr = oldStderr
	out, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}

	msg := string(out)
	if msg == "" {
		t.Fatal("⑤ 失败：sink 写不出去却**一声不吭**（错误被静默吞掉 —— 本仓 ARC-7 点名要禁）")
	}
	if !strings.Contains(msg, "发不出去") {
		t.Fatalf("⑤ 失败：stderr 有输出但不像在说这件事，实得:\n%s", msg)
	}
	if !strings.Contains(msg, "t311.badsink") {
		t.Fatalf("⑤ 失败：stderr 没带上是哪个探针发的，实得:\n%s", msg)
	}
	t.Logf("⑤ 通过：宿主没崩，且 stderr 说清楚了（%d 字节）", len(msg))
}

// resetProbeErrStateForTest 把 reportProbeError 的限流计数归零（同包白盒，只用于测试）。
func resetProbeErrStateForTest() {
	probeErrMu.Lock()
	probeErrCount = 0
	probeErrSeen = false
	probeErrMu.Unlock()
}
