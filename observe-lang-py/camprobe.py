"""observe · Python 探针运行时（★ 每语言必需的最小件，与 TS 侧 `probe.ts` / Go 侧 `probe` 包同级）。

## 它是什么
`observe_instrument` 给 Python 源码注入的探针（`capture_probe(...)` / `cam_lambda(...)`）在运行时
调到这里。本文件**不被插桩**（它本身就是探针），随插桩语言包一起提供。

## 两个骨架不变量（与 TS/Go 两侧**同一条**纪律）
  ④ **sink 契约**：**探针就位 ≠ 有数据** —— 没接 sink 时 `capture_probe` 是 **no-op**（0 事件、不报错）；
     接上 `JsonlSink` 才出事件。
  ⑤ **错误传播**：**探针不许抛错**（跑在宿主热路径上）**但错误必须可见** —— sink 写不出去时
     写 stderr 且**限流**（首次完整说，之后每 100 次报累计），**绝不 rethrow**。
"""

import json
import os
import sys
import threading
from datetime import datetime, timezone

_GLOBAL_SINK = None
_LOCK = threading.Lock()
_ERR_COUNT = 0
_ERR_SEEN = False


def set_global_probe_sink(sink):
    """配置全局探针 sink（None 关闭）。返回前一个 sink，便于测试隔离/恢复。"""
    global _GLOBAL_SINK
    prev = _GLOBAL_SINK
    _GLOBAL_SINK = sink
    return prev


def has_global_probe_sink():
    """全局 sink 是否已配置（供 lazy 初始化方判断，避免覆盖已有 sink）。"""
    return _GLOBAL_SINK is not None


def capture_probe(probe, fields=None, source="static-rule"):
    """零侵入捕获：向全局 sink 追加一条事件（若已配置）。未配置时静默 no-op。"""
    sink = _GLOBAL_SINK
    if sink is None:
        return
    try:
        sink.emit(probe, fields or {}, source)
    except Exception as exc:  # noqa: BLE001 —— 探针绝不许抛错，但错误必须可见
        _report_probe_error(probe, exc)


def cam_lambda(name, args, value, emit_enter=True, emit_exit=True):
    """`lambda` 的插桩落点：lambda 体是**表达式**（Python 语法不允许语句）⇒ 只能包表达式。

    本函数求值 `value`（**调用方传入的已是 lambda 体求值结果**）并原样返回 ⇒ 语义不变。
    """
    if emit_enter:
        capture_probe(name + ".enter", {"args": args, "level": "core"})
    if emit_exit:
        capture_probe(name + ".exit", {"ret": value, "level": "core"})
    return value


def _report_probe_error(probe_name, err):
    """把探针的内部错误**说出去**，但**限流**（与 TS 侧 `reportProbeError` 同策略）。"""
    global _ERR_COUNT, _ERR_SEEN
    _ERR_COUNT += 1
    first = not _ERR_SEEN
    _ERR_SEEN = True
    if first:
        sys.stderr.write(
            "[probe] 探针事件**发不出去**（第 1 次）：%s\n"
            "  probe=%s\n"
            "  ★ 常见成因：events.jsonl 的路径不可写（目录不存在 / 权限 / 磁盘满）。\n"
            % (err, probe_name)
        )
        return
    if _ERR_COUNT % 100 == 0:
        sys.stderr.write("[probe] 探针事件发不出去：累计 %d 次（最近 probe=%s: %s）\n" % (_ERR_COUNT, probe_name, err))


def _scrub(value, depth=0):
    """有界容错清洗：不可 JSON 化的值降级，避免一条坏事件让整次落盘失败。"""
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    if depth >= 4:
        return _summarize(value)
    if isinstance(value, (bytes, bytearray)):
        return "<bytes:%d>" % len(value)
    if isinstance(value, (set, frozenset)):
        return [_scrub(v, depth + 1) for v in list(value)[:64]]
    if isinstance(value, dict):
        out = {}
        for k, v in list(value.items())[:128]:
            out[str(k)] = _scrub(v, depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        return [_scrub(v, depth + 1) for v in value[:128]]
    if isinstance(value, BaseException):
        return {"name": type(value).__name__, "message": str(value)}
    try:
        json.dumps(value)
        return value
    except Exception:  # noqa: BLE001 —— 任意对象降级为概要
        return _summarize(value)


def _summarize(value):
    if isinstance(value, (list, tuple, set, frozenset, dict, str, bytes, bytearray)):
        return {"$type": type(value).__name__, "$size": len(value)}
    return {"$type": type(value).__name__}


class JsonlSink:
    """探针端口：追加写 events.jsonl（append-only，与 TS 侧 `TSProbeCapture` 同语义）。"""

    def __init__(self, events_path):
        self.events_path = events_path

    def emit(self, probe, fields, source="static-rule"):
        event = {
            "probe": probe,
            "time": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "source": source,
            "fields": _scrub(fields),
        }
        directory = os.path.dirname(os.path.abspath(self.events_path))
        os.makedirs(directory, exist_ok=True)
        line = json.dumps(event, ensure_ascii=False, default=str)
        with _LOCK:
            with open(self.events_path, "a", encoding="utf-8") as handle:
                handle.write(line + "\n")
        return event


def load_events(events_path):
    """读 events.jsonl → (events, skipped)。坏行跳过（与 TS 侧 `loadTSEvents` 容错一致）。"""
    if not os.path.exists(events_path):
        return [], 0
    events, skipped = [], 0
    with open(events_path, "r", encoding="utf-8") as handle:
        for raw in handle:
            raw = raw.strip()
            if not raw:
                continue
            try:
                events.append(json.loads(raw))
            except Exception:  # noqa: BLE001
                skipped += 1
    return events, skipped
