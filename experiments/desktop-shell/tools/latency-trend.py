#!/usr/bin/env python3
"""Shows whether a shell's latency stays put over a long burst run.

python3 -I tools/latency-trend.py <bursts.jsonl> <shell.jsonl> [bursts-per-row]
"""
import json
import statistics
import sys

bursts_path, shell_path = sys.argv[1:3]
per_row = int(sys.argv[3]) if len(sys.argv) > 3 else 40


def rows(path):
    with open(path) as handle:
        return [json.loads(line) for line in handle if line.strip()]


bursts = [row for row in rows(bursts_path) if row.get("kind") == "burst"]
start = bursts[0]["presentedAt"] - 200
end = bursts[-1]["presentedAt"] + 1500
events = [
    event
    for tick in rows(shell_path)
    if tick.get("kind") == "tick" and start <= tick["t"] <= end + 3000
    for event in tick["events"]
]


def first(kind, at):
    for event in events:
        if event["kind"] == kind and at - 60 <= event["t"] <= at + 900:
            return event
    return None


def median(values):
    return f"{statistics.median(values):6.1f}" if values else "   n/a"


print("  seconds   stream analysis  raf-from-speaker  reached")
for offset in range(0, len(bursts), per_row):
    group = bursts[offset : offset + per_row]
    stream, analysis, raf = [], [], []
    for burst in group:
        at = burst["presentedAt"]
        hit = first("stream", at)
        if hit:
            stream.append(hit["t"] - at)
        hit = first("analysis", at)
        if hit:
            analysis.append(hit["t"] - at)
            if hit.get("raf"):
                raf.append(hit["raf"] - burst["speakerAt"])
    seconds = (group[0]["presentedAt"] - bursts[0]["presentedAt"]) / 1000
    print(
        f"{seconds:9.0f} {median(stream)} {median(analysis)}  {median(raf):>16}  {len(analysis)}/{len(group)}"
    )
