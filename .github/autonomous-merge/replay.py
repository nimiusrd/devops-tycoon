#!/usr/bin/env python3
"""信頼済みSHAの評価器と保存JSONだけで再評価する。ネットワーク取得は行わない。"""

import argparse
import json
import subprocess
from pathlib import Path

from evaluate import sha


def replay(report: dict, evaluator_sha: str) -> dict:
    expected = sha(evaluator_sha)
    if report["observations"]["evaluator_sha"] != expected:
        raise ValueError("report evaluator SHA does not match the trusted SHA")
    source = subprocess.run(
        ["git", "show", f"{expected}:.github/autonomous-merge/evaluate.py"],
        check=True, capture_output=True, text=True,
    ).stdout
    namespace = {"__name__": "shadow_replay_evaluator"}
    # SHAはartifactから自動選択しない。実行者が確認した信頼済みコミットに限る。
    exec(compile(source, "recorded-evaluate.py", "exec"), namespace)
    result = namespace["assess"](report["observations"], report["policy"])
    # 評価器内のtupleも、collectorが保存するJSONではarrayになる。
    # 同じ保存形式へ変換して比較し、評価ロジック自体は変更しない。
    return json.loads(json.dumps(result))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--evaluator-sha", required=True,
                        help="Actionsのtrusted checkoutで確認した40桁のSHA")
    args = parser.parse_args()
    try:
        report = json.loads(args.report.read_text())
        result = replay(report, args.evaluator_sha)
        same = result == report
        print(json.dumps({"matches": same, "decision": result["decision"],
                          "policy_sha256": result["policy_sha256"]}))
        return int(not same)
    except (OSError, KeyError, TypeError, ValueError, subprocess.CalledProcessError) as error:
        print(json.dumps({"matches": False, "error": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
