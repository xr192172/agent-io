package probe

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// 构造一条静默丢弃错误的写盘事件（应判为 deviation）与一条正常事件（应判为 ok）。
func sampleEvents() []Event {
	return []Event{
		{
			Probe:  "svc.save.writefile",
			Time:   time.Now(),
			Source: "llm-design",
			Fields: map[string]any{"file": "svc/save.go", "op": "writefile", "err": "permission denied"},
		},
		{
			Probe:  "svc.save.exit",
			Time:   time.Now(),
			Source: "llm-design",
			Fields: map[string]any{"file": "svc/save.go", "err": nil},
		},
	}
}

func TestJudgeClient_IsLocalByDefault(t *testing.T) {
	c := NewJudgeClient("")
	if c.IsRemote() {
		t.Error("未配置 endpoint 时不应走远程")
	}
}

// ★ 2026-10-05（P2）：本测试**原先断言的正是被删掉的行为**（未配 endpoint 时静默本地兜底）。
// 改造后契约反过来：默认客户端**必须响亮失败**，本地判定要**显式 opt-in**。
// 原测试名 LocalFallback 已名不副实 ⇒ 改为下面两条。
func TestJudgeClient_DefaultFailsLoudlyWithoutEndpoint(t *testing.T) {
	c := NewJudgeClient("")
	if c.IsRemote() {
		t.Fatal("未配置 endpoint 时不应走远程")
	}
	// 默认客户端不得填 Local（否则又会静默兜底）
	if c.Local != nil {
		t.Error("默认客户端不应装配本地谓词（那会让静默兜底复活）")
	}
	if _, err := c.JudgeEvents(context.Background(), sampleEvents()); !errors.Is(err, ErrNoJudgeEndpoint) {
		t.Fatalf("未配置判定服务时应返回 ErrNoJudgeEndpoint，实得 %v", err)
	}
	// 错误文案必须点明"漏判哪两条规则"，否则调用方无法判断严重性
	msg := ErrNoJudgeEndpoint.Error()
	for _, want := range []string{"OBSERVE_JUDGE_URL", "design:impact-blast-radius", "design:impact-unplanned-spread"} {
		if !strings.Contains(msg, want) {
			t.Errorf("错误文案缺少 %q —— 调用方看不到漏判范围", want)
		}
	}
}

func TestJudgeClient_LocalIsExplicitOptIn(t *testing.T) {
	c := NewLocalJudgeClient()
	if c.IsRemote() {
		t.Fatal("本地客户端不应走远程")
	}
	if !c.AllowLocal || c.Local == nil {
		t.Fatal("NewLocalJudgeClient 必须装配本地谓词并置 AllowLocal")
	}
	verdicts, err := c.JudgeEvents(context.Background(), sampleEvents())
	if err != nil {
		t.Fatalf("显式 opt-in 后本地判定不应报错: %v", err)
	}
	if len(verdicts) != 2 {
		t.Fatalf("期望 2 条判定，实得 %d", len(verdicts))
	}
	if verdicts[0].Result != "deviation" {
		t.Errorf("写盘错误事件应判 deviation，实得 %q", verdicts[0].Result)
	}
}

func TestJudgeClient_RemoteProxy(t *testing.T) {
	// 模拟 TS 判定服务：校验收到的请求形状，返回与 TS JudgeResult 对齐的响应。
	var gotPayload map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("期望 POST，实得 %s", r.Method)
		}
		_ = json.NewDecoder(r.Body).Decode(&gotPayload)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"total": 2, "ok": 1, "deviation": 1,
			"entries": [
				{"verdict": {"result": "deviation", "rule": "design:silent-error-discard", "reason": "非良性错误被静默丢弃"},
				 "event": {"probe": "svc.save.writefile", "source": "llm-design", "fields": {"op": "writefile"}}},
				{"verdict": {"result": "ok", "rule": "", "reason": "no contract violation"},
				 "event": {"probe": "svc.save.exit", "source": "llm-design", "fields": {"err": null}}}
			]
		}`))
	}))
	defer srv.Close()

	c := NewJudgeClient(srv.URL)
	if !c.IsRemote() {
		t.Error("配置了 endpoint 应走远程")
	}
	verdicts, err := c.JudgeEvents(context.Background(), sampleEvents())
	if err != nil {
		t.Fatalf("远程判定: %v", err)
	}
	if len(verdicts) != 2 {
		t.Fatalf("期望 2 条判定，实得 %d", len(verdicts))
	}
	if verdicts[0].Result != "deviation" || verdicts[0].Rule != "design:silent-error-discard" {
		t.Errorf("远程首条应判 deviation(design:silent-error-discard)，实得 %+v", verdicts[0])
	}
	if verdicts[1].Result != "ok" {
		t.Errorf("远程次条应判 ok，实得 %+v", verdicts[1])
	}
	// 校验请求体形状：events 数组 + 每条含 probe/time/source/fields
	evs, ok := gotPayload["events"].([]any)
	if !ok || len(evs) != 2 {
		t.Fatalf("请求体 events 形状异常: %v", gotPayload)
	}
	first := evs[0].(map[string]any)
	for _, k := range []string{"probe", "time", "source", "fields"} {
		if _, has := first[k]; !has {
			t.Errorf("请求事件缺字段 %s", k)
		}
	}
}

func TestJudgeClient_RemoteError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := NewJudgeClient(srv.URL)
	if _, err := c.JudgeEvents(context.Background(), sampleEvents()); err == nil {
		t.Error("远程返回 500 应报错")
	}
}
