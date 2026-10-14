package probe

import (
	"fmt"
	"os"
	"sync"
	"time"
)

// reportProbeError 把探针的内部错误**说出去**（★ T286），但**限流**。
//
// ★ 为什么不能静默：实测参数里一个函数值就让 `enter` 事件消失 ——
//   观测者会得出「这个函数根本没被调到」的**错误结论**（缺失伪装成事实）。
// ★ 为什么不能每次都喊：探针跑在宿主热路径上，刷屏会淹没宿主的日志。
// ⇒ 策略：**首次**完整说（含成因），之后每 100 次报一次累计数。
var (
	probeErrMu    sync.Mutex
	probeErrCount int
	probeErrSeen  bool
)

func reportProbeError(probeName string, err error) {
	probeErrMu.Lock()
	probeErrCount++
	first := !probeErrSeen
	probeErrSeen = true
	n := probeErrCount
	probeErrMu.Unlock()
	if first {
		fmt.Fprintf(os.Stderr,
			"[camprobe] 探针事件**发不出去**（第 1 次）：%v\n"+
				"  probe=%s\n"+
				"  ★ 常见成因：参数里含**函数值 / chan** 等不可 JSON 序列化的东西。\n"+
				"    （不可序列化的值现在会降级成 `<unserializable: T>` 占位符，事件本身**不会**因此消失；\n"+
				"     若仍看到本行，说明是写盘/权限问题，不是序列化问题。）\n", err, probeName)
		return
	}
	if n%100 == 0 {
		fmt.Fprintf(os.Stderr, "[camprobe] 探针事件发不出去：累计 %d 次（最近 probe=%s: %v）\n", n, probeName, err)
	}
}

// Package-level globals for zero-dependency instrumentation.
// Probes check these before emitting; if nil, the call is a no-op.
// This avoids importing probe into every package for compile-time coupling.
//
// v2 路由优先级：Tiered（分级采集）→ legacy Sink（JSONL 全量）→ no-op。
// 旧插桩代码（Capture/CaptureErr）零改动自动进入 v2 runtime。
var (
	globalMu   sync.RWMutex
	globalSink *Sink
	globalTier *Tiered

	globalLLMMu sync.RWMutex
)

// SetGlobalSink configures the legacy JSONL sink. Pass nil to disable.
// （兼容保留：v1 全量落盘模式，conformance/调试用。）
func SetGlobalSink(s *Sink) {
	globalMu.Lock()
	globalSink = s
	globalMu.Unlock()
}

// SetGlobalTiered 配置 v2 分级采集 runtime。设置后 Capture 全部路由到它。
func SetGlobalTiered(t *Tiered) {
	globalMu.Lock()
	globalTier = t
	globalMu.Unlock()
}

// globalTieredFor 返回全局 Tiered（trace.go 的 Enter 使用）。
func globalTieredFor() *Tiered {
	globalMu.RLock()
	defer globalMu.RUnlock()
	return globalTier
}

// Capture emits an event to the global runtime (if set).
// A no-op when no sink is configured — safe to call unconditionally.
// v2：优先走 Tiered（计数器+环形缓冲+可选开箱导出）。
func Capture(probeName, source string, fields map[string]any) {
	globalMu.RLock()
	t := globalTier
	s := globalSink
	globalMu.RUnlock()
	if t != nil {
		t.Emit(Event{Probe: probeName, Time: time.Now(), Source: source, Fields: fields})
		return
	}
	if s == nil {
		return
	}
	if err := s.Emit(probeName, source, fields); err != nil {
		// ★★★ T286（2026-10-14）：**不再静默吞** —— 原先这里是 `_ = s.Emit(...)`
		//   ⇒ 序列化失败（如参数含函数值）与写盘失败**都无声无息**
		//   ⇒ 实测：一个 `fn func()` 参数就让 `main.Safe.enter` **彻底消失**，而没人知道。
		//   ★ 探针**不许抛错**（它跑在宿主代码里）⇒ 只写 stderr，且**限流**（避免刷屏）。
		reportProbeError(probeName, err)
	}
}

// CaptureErr is a convenience: captures err as a string, nil error becomes "".
func CaptureErr(probeName, source string, err error, extra map[string]any) {
	m := make(map[string]any, len(extra)+2)
	for k, v := range extra {
		m[k] = v
	}
	if err != nil {
		m["err"] = err.Error()
	} else {
		m["err"] = nil
	}
	Capture(probeName, source, m)
}
