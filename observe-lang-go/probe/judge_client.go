package probe

// Package probe — JudgeClient: Go 侧统一判定入口（2026-10-05 改造：静默降级 → 响亮失败）。
//
// 目的：把「偏差判定」收敛到 TS 判定服务（judge_service.ts，挂 /api/observe/judge），
// 避免 Go 侧复刻判定规则造成语义漂移。Go 侧只负责把采集到的 Event 批量 POST 过去，
// 复用同一份判定实现。
//
// ★★ 2026-10-05 改造（P2 步骤 1）：**未配置服务地址时不再静默降级为本地判定**。
//
//	改造前（`:75-77`）：if !c.IsRemote() { return judgeLocal(c, events), nil }
//	  —— 未设 OBSERVE_JUDGE_URL 时静默走本地规则，**不报错、不降级标记、结果照常产出**。
//	  —— 实测这不是"优雅降级"，而是**假绿灯 + 漏判**：
//	     本地只注册 **1 条**规则（`NewJudgeClient` 原 :52-53 只 AddRule 了
//	     `design:silent-error-discard`），而 TS 的 `OBSERVE_RULE_TABLE` 有 **3 条**。
//	     同三条事件实测（Endpoint=""）：
//	       impact.report  (爆炸半径 100 / 阈值 50) → Go: ok, rule=""   TS: deviation
//	       impact.spread  (计划外扩散)              → Go: ok, rule=""   TS: deviation
//	       fs.cleanup     (err 丢弃)               → Go: deviation    TS: deviation
//	     ⇒ **整个 impact 域的规则在未设 env 时全部失效**，而输出看不出任何异常
//	       （`rule` 字段是空串，没有"未覆盖"的提示）。
//	  —— 且 `watch_project_tool.ts:507-526` 正在产出 `impact.*` 事件喂这条链路，
//	     即"最需要判定的那批事件"恰好是 Go 漏判的那批。
//
//	改造后：Endpoint 为空 ⇒ **返回错误**，调用方必须显式选择：
//	  · 配 `OBSERVE_JUDGE_URL` 走远端（唯一权威路径）
//	  · 或调 `NewLocalJudgeClient()` 显式要本地判定（**显式选择，不是默认兜底**）
//	          —— 它的存在只为让"本地只有 1 条规则"这件事在调用点可见，
//	             且调用方要自己承担漏判后果。
//
// 判定入口（与 TS JudgeResult 对齐）：
//
//	POST {judge_endpoint}   body: { events: TSEvent[] } → { total, ok, deviation, entries:[{verdict,event}] }
//
// 地址来源：环境变量 OBSERVE_JUDGE_URL（如 http://localhost:8080/api/observe/judge）。
// 未设置 ⇒ JudgeURL() 返回 "" ⇒ IsRemote() 为 false ⇒ 判定**报错**（不再静默走本地）。

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

// EnvJudgeURL 是 TS 判定服务地址的环境变量名。
const EnvJudgeURL = "OBSERVE_JUDGE_URL"

// JudgeURL 返回当前配置的判定服务地址；未配置返回 ""。
func JudgeURL() string { return os.Getenv(EnvJudgeURL) }

// ErrNoJudgeEndpoint 未配置判定服务地址，且调用方未显式选择本地判定。
//
// ★ 刻意做成"必须处理"的错误而不是"自动降级"：本地判定只覆盖 3 条规则里的 1 条
//
//	（见文件头实测），自动兜底等于**静默丢掉 impact 域的全部判定**。
var ErrNoJudgeEndpoint = fmt.Errorf(
	"未配置判定服务地址（环境变量 %s）—— 判定必须收敛到唯一权威（TS judge_service），"+
		"不再静默退回本地规则：本地只注册了 1 条规则（design:silent-error-discard），"+
		"会漏判 design:impact-blast-radius 与 design:impact-unplanned-spread。"+
		"请设置 %s；若确实要在离线环境用本地判定，请显式调用 NewLocalJudgeClient() 并自行承担漏判后果",
	EnvJudgeURL, EnvJudgeURL)

// JudgeClient 是 Go 侧统一判定入口。**Endpoint 为空时判定会报错**（见文件头）。
type JudgeClient struct {
	Endpoint string
	Timeout  time.Duration
	Client   *http.Client

	// Local 本地判定（仅 NewLocalJudgeClient 会填）。外部可替换为装配好的 Judge。
	Local func(ev Event) Verdict
	// AllowLocal 为 true 时允许 Endpoint 为空（只有 NewLocalJudgeClient 会置真）。
	AllowLocal bool
}

// NewJudgeClient 创建**远端**判定客户端。Endpoint 取 JudgeURL()（可覆盖）。
// ★ Endpoint 为空时**不填 Local** ⇒ 判定会返回 ErrNoJudgeEndpoint（响亮失败）。
func NewJudgeClient(endpoint string) *JudgeClient {
	c := &JudgeClient{
		Endpoint: endpoint,
		Timeout:  10 * time.Second,
	}
	if c.Endpoint == "" {
		c.Endpoint = JudgeURL()
	}
	return c
}

// NewLocalJudgeClient 创建**本地**判定客户端（**显式选择，不是默认兜底**）。
//
// ★ 只注册 1 条规则（`design:silent-error-discard`），漏判 impact 域的两条。
//
//	保留它只为让"本地能力弱于远端"这件事在调用点可见（文件名/构造函数名都写着 Local），
//	以及让不依赖判定服务的单测仍能跑。
func NewLocalJudgeClient() *JudgeClient {
	c := &JudgeClient{Timeout: 10 * time.Second, AllowLocal: true}
	local := new(Judge).AddRule("design:silent-error-discard", SilentErrorDiscard)
	c.Local = local.JudgeEvent
	return c
}

// IsRemote 报告是否走远程 TS 判定服务。
func (c *JudgeClient) IsRemote() bool { return c.Endpoint != "" }

// JudgeEvents 判定一批事件（远端）。调用方必须先确保 IsRemote()，否则返回
// ErrNoJudgeEndpoint。远程调用失败时返回错误（由调用方决定是否降级）。
func (c *JudgeClient) JudgeEvents(ctx context.Context, events []Event) ([]Verdict, error) {
	return c.judgeWithLLM(ctx, events, false)
}

// JudgeEventsLLM 判定一批事件，并对规则秒判为「deviation」的事件做 LLM 行为级复核
// （POST 时带 use_llm=1，由 TS 判定服务调 LLM）。远端不可用/调用失败时返回错误。
func (c *JudgeClient) JudgeEventsLLM(ctx context.Context, events []Event) ([]Verdict, error) {
	return c.judgeWithLLM(ctx, events, true)
}

// judgeWithLLM 统一判定入口。useLLM 控制是否请求 TS 侧做 LLM 行为级复核。
// ★ Endpoint 为空且未显式选择本地 ⇒ **返回 ErrNoJudgeEndpoint**（2026-10-05 改造）。
func (c *JudgeClient) judgeWithLLM(ctx context.Context, events []Event, useLLM bool) ([]Verdict, error) {
	if !c.IsRemote() {
		if !c.AllowLocal || c.Local == nil {
			return nil, ErrNoJudgeEndpoint
		}
		return judgeLocal(c, events), nil
	}
	return c.judgeRemote(ctx, events, useLLM)
}

// judgeLocal 本地判定：逐事件跑注册的本地谓词。
// ⚠ 调用方必须通过 NewLocalJudgeClient 显式选择本地判定，并自行承担漏判后果。
func judgeLocal(c *JudgeClient, events []Event) []Verdict {
	out := make([]Verdict, 0, len(events))
	for _, ev := range events {
		out = append(out, c.Local(ev))
	}
	return out
}

// tsEvent 是 TS 侧 TSEvent 的 JSON 形状（time 为字符串）。
type tsEvent struct {
	Probe  string         `json:"probe"`
	Time   string         `json:"time"`
	Source string         `json:"source"`
	Fields map[string]any `json:"fields"`
}

// tsEntry 是 TS JudgeResult.entries 的一项。
type tsEntry struct {
	Verdict struct {
		Result string `json:"result"`
		Rule   string `json:"rule"`
		Reason string `json:"reason"`
	} `json:"verdict"`
	Event tsEvent       `json:"event"`
	LLM   *tsLLMVerdict `json:"llm"` // use_llm 时返回的 LLM 行为级复核（可为空）
}

// tsLLMVerdict 是判定服务返回的 LLM 复核结果（与 LLMVerdict 对齐）。
type tsLLMVerdict struct {
	Result string `json:"result"`
	Rule   string `json:"rule"`
	Reason string `json:"reason"`
}

// tsResult 是 TS JudgeResult 的 JSON 形状。
type tsResult struct {
	Total     int       `json:"total"`
	Ok        int       `json:"ok"`
	Deviation int       `json:"deviation"`
	Entries   []tsEntry `json:"entries"`
}

// judgeRemote 把事件 POST 到 TS 判定服务，解析回 Verdict。useLLM 为 true 时
// 在 URL 上附加 use_llm=1，请求 TS 侧对可疑事件做 LLM 行为级复核。
func (c *JudgeClient) judgeRemote(ctx context.Context, events []Event, useLLM bool) ([]Verdict, error) {
	payload := map[string]any{"events": toTSEvents(events)}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("judge_client: marshal events: %w", err)
	}

	endpoint := c.Endpoint
	if useLLM {
		sep := "?"
		if strings.Contains(endpoint, "?") {
			sep = "&"
		}
		endpoint += sep + "use_llm=1"
	}

	ctx, cancel := context.WithTimeout(ctx, c.Timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("judge_client: new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := c.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("judge_client: post %s: %w", c.Endpoint, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("judge_client: %s returned %d", c.Endpoint, resp.StatusCode)
	}

	var res tsResult
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, fmt.Errorf("judge_client: decode response: %w", err)
	}

	out := make([]Verdict, 0, len(res.Entries))
	for _, e := range res.Entries {
		v := Verdict{
			Event: Event{
				Probe:  e.Event.Probe,
				Source: e.Event.Source,
				Fields: e.Event.Fields,
			},
			Rule:   e.Verdict.Rule,
			Result: e.Verdict.Result,
			Reason: e.Verdict.Reason,
		}
		if e.LLM != nil {
			v.LLM = &LLMVerdict{
				Result: e.LLM.Result,
				Rule:   e.LLM.Rule,
				Reason: e.LLM.Reason,
			}
		}
		out = append(out, v)
	}
	return out, nil
}

// toTSEvents 把 Go Event 转成 TS TSEvent 形状（time 渲染为 RFC3339 字符串）。
func toTSEvents(events []Event) []tsEvent {
	out := make([]tsEvent, 0, len(events))
	for _, ev := range events {
		out = append(out, tsEvent{
			Probe:  ev.Probe,
			Time:   ev.Time.Format(time.RFC3339Nano),
			Source: ev.Source,
			Fields: ev.Fields,
		})
	}
	return out
}
