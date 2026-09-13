#!/usr/bin/env python3
"""信頼済みSHAの評価器と保存JSONだけで再評価する。ネットワーク取得は行わない。"""

import argparse
import io
import json
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

from contracts import Assessment, sha


def replay(report: Assessment, evaluator_sha: str) -> Assessment:
    expected = sha(evaluator_sha)
    if report["observations"]["evaluator_sha"] != expected:
        raise ValueError("report evaluator SHA does not match the trusted SHA")
    # SHAはartifactから自動選択しない。依存モジュールも同じ信頼済みSHAから読む。
    prefix = ".github/autonomous-merge/"
    archive = subprocess.run(
        ["git", "archive", "--format=tar", expected, prefix],
        check=True, capture_output=True,
    ).stdout
    with tempfile.TemporaryDirectory(prefix="shadow-replay-") as directory:
        root = Path(directory)
        with tarfile.open(fileobj=io.BytesIO(archive)) as sources:
            for name in ("evaluate.py", "contracts.py", "report.py"):
                try:
                    member = sources.getmember(prefix + name)
                except KeyError:
                    # 分割前の評価器はevaluate.pyだけで動く。
                    continue
                if not member.isfile():
                    raise ValueError("evaluator module must be a regular file")
                (root / name).write_bytes(sources.extractfile(member).read())
        # -Iで現在のcheckoutやPYTHONPATHを除外する。古い/新しい評価器を
        # 同じプロセスで再評価しても、sys.modulesのキャッシュを共有しない。
        run = subprocess.run(
            [sys.executable, "-I", "-B", "-c", """
import json, sys
sys.path.insert(0, sys.argv[1])
from evaluate import assess
report = json.load(sys.stdin)
print(json.dumps(assess(report["observations"], report["policy"])))
""", str(root)],
            input=json.dumps(report), check=True, capture_output=True, text=True,
            cwd=root,
        )
    # 評価器内のtupleも、collectorが保存するJSONではarrayになる。
    # 同じ保存形式へ変換して比較し、評価ロジック自体は変更しない。
    return json.loads(run.stdout)


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
    except (OSError, KeyError, TypeError, ValueError, tarfile.TarError,
            subprocess.CalledProcessError) as error:
        print(json.dumps({"matches": False, "error": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
