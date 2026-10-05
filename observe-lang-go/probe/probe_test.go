package probe

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ── 以下 4 条回迁自历史分叉期（2026-08-16 防写爆重构）测试 ──

// TestSinkRateLimitDrops 验证每探针限速：瞬时灌入大量同探针事件时，
// token bucket 只放行 burst 个，其余丢弃（热路径写不爆）。
func TestSinkRateLimitDrops(t *testing.T) {
	dir := t.TempDir()
	evFile := filepath.Join(dir, "events.jsonl")
	sink, err := NewSink(evFile)
	if err != nil {
		t.Fatal(err)
	}
	sink.SetRateLimit(10) // 10 事件/秒/探针
	for i := 0; i < 1000; i++ {
		if err := sink.Emit("hot.path", "llm-design", map[string]any{"n": i}); err != nil {
			t.Fatal(err)
		}
	}
	sink.Close()

	data, err := os.ReadFile(evFile)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Count(string(data), "\n")
	if lines > 10 {
		t.Errorf("rate limit 未生效: %d 行 > burst 10", lines)
	}
	t.Logf("rate-limited to %d lines", lines)
}
