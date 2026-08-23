#!/usr/bin/env python3
"""Run a blind Codex production pass, then a separate Codex quality judge."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

TEST_DIR = Path(__file__).resolve().parent
SKILL_DIR = TEST_DIR.parents[1]
CASE_DIR = TEST_DIR / "aige-14"
PROJECT_ROOT = SKILL_DIR.parents[2]


def execute(command: list[str], log: Path) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    log.write_text(result.stdout + "\n--- STDERR ---\n" + result.stderr, encoding="utf-8")
    return result


def copy_blind_skill(destination: Path) -> None:
    shutil.copytree(
        SKILL_DIR,
        destination,
        ignore=shutil.ignore_patterns("test", "__pycache__", "*.pyc"),
    )


def producer_prompt(skill_path: Path, input_path: Path, actual_dir: Path) -> str:
    return f"""使用 ${SKILL_DIR.name}（完整说明位于 {skill_path}）独立完成一次端到端处理。

输入文件：{input_path}
输出目录：{actual_dir}

要求：
1. 必须先完整读取 SKILL.md，并按其中的一键完整流程执行：DOCX 归一化、既定爱格标点订正、手机端语意分行、主题 HTML 渲染。
2. 不得查找或读取任何 checkpoint、expected、旧项目输出或历史答案；这是盲测。
3. 不得改写正文的措辞、语序、事实与风格。分行必须以完整语意为先，不能按字数、标点或原始物理行机械切割。
4. 章节序号与大标题都居中，两者之间保留一个完整视觉空行。
5. 在输出目录生成且只把测试产物写到那里：01-source.md、02-punctuation.md、03-layout.md、output.html、output_预览.html、run-report.md。
6. 自行运行 Skill 内的内容守恒与公众号 HTML 校验；遇到问题自行修正，不要向用户提问。
"""


def judge_prompt(input_path: Path, expected: Path, actual: Path) -> str:
    return f"""你是微信公众号文章排版回归测试的独立 AI 评审。请完整阅读以下原始输入、人工确认过的 checkpoint 和本次盲测输出：

- 原始 DOCX：{input_path}
- checkpoint：{expected}
- 本次输出：{actual}

不要因为两版不完全相同就判失败，也不要只做字符 diff。以 checkpoint 的已确认质量为基线，逐段判断本次结果是否发生实际退化：

1. 内容守恒：不得改写、漏字、增字、调整语序或虚构内容。
2. 标点：是否遵守爱格文章既定节奏；重点检查逗号、分号、句号、冒号和引语内外标点，不能另创规则。
3. 语意分行：是否保持完整语意组，是否出现按字数/标点机械硬切，排比、转折、问答和收束是否适合手机阅读。
4. 标题结构：章节序号与大标题均居中，中间必须有一个完整视觉空行。
5. HTML：主题可以变化，但正文层级、留白节奏、组件可读性和公众号兼容性不能退化。

给出 pass、warn 或 fail。发现问题必须引用具体位置和两版证据；没有证据不要推测。总分为五个维度分数之和。
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--codex", default=shutil.which("codex") or "codex")
    parser.add_argument(
        "--model",
        default="gpt-5.5",
        help="Codex model for producer and judge (default: gpt-5.5)",
    )
    parser.add_argument("--run-dir", type=Path)
    parser.add_argument("--fail-on-warn", action="store_true")
    args = parser.parse_args()

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = (args.run_dir or TEST_DIR / "runs" / stamp).resolve()
    producer_root = run_dir / "producer"
    judge_root = run_dir / "judge"
    actual_dir = producer_root / "actual"
    blind_skill = producer_root / "skill"
    input_dir = producer_root / "input"
    for directory in (actual_dir, judge_root, input_dir):
        directory.mkdir(parents=True, exist_ok=True)

    copy_blind_skill(blind_skill)
    source_docx = CASE_DIR / "input/Aige 14 - 原稿.docx"
    blind_input = input_dir / source_docx.name
    shutil.copy2(source_docx, blind_input)

    producer_last = producer_root / "last-message.md"
    producer_command = [
        args.codex,
        "-a",
        "never",
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "-C",
        str(producer_root),
        "-s",
        "workspace-write",
        "-o",
        str(producer_last),
    ]
    if args.model:
        producer_command.extend(["--model", args.model])
    producer_command.append(producer_prompt(blind_skill / "SKILL.md", blind_input, actual_dir))
    print(f"[1/3] 启动独立 Codex 生成：{run_dir}", flush=True)
    producer = execute(producer_command, producer_root / "codex-producer.log")
    if producer.returncode:
        print((producer_root / "codex-producer.log").read_text(encoding="utf-8")[-6000:])
        return producer.returncode

    required = ["01-source.md", "02-punctuation.md", "03-layout.md", "output.html"]
    missing = [name for name in required if not (actual_dir / name).is_file()]
    if missing:
        print("生成进程缺少产物：" + ", ".join(missing))
        return 2

    print("[2/3] 运行确定性底线校验", flush=True)
    hard_commands = [
        [
            sys.executable,
            str(blind_skill / "scripts/validate_content.py"),
            "--mode",
            "punctuation",
            str(actual_dir / "01-source.md"),
            str(actual_dir / "02-punctuation.md"),
        ],
        [
            sys.executable,
            str(blind_skill / "scripts/validate_content.py"),
            "--mode",
            "layout",
            str(actual_dir / "02-punctuation.md"),
            str(actual_dir / "03-layout.md"),
        ],
        [
            sys.executable,
            str(TEST_DIR / "run_checkpoint.py"),
            "--candidate-layout",
            str(actual_dir / "03-layout.md"),
            "--candidate-html",
            str(actual_dir / "output.html"),
            "--allow-layout-variation",
        ],
    ]
    hard_results = []
    hard_log = run_dir / "hard-guard.log"
    hard_log.write_text("", encoding="utf-8")
    for index, command in enumerate(hard_commands, start=1):
        result = execute(command, run_dir / f"hard-guard-{index}.log")
        hard_results.append(result)
        with hard_log.open("a", encoding="utf-8") as handle:
            handle.write((run_dir / f"hard-guard-{index}.log").read_text(encoding="utf-8"))
            handle.write("\n")
    hard_guard_failed = any(result.returncode for result in hard_results)

    shutil.copytree(CASE_DIR / "expected", judge_root / "expected")
    shutil.copytree(actual_dir, judge_root / "actual")
    shutil.copy2(source_docx, judge_root / source_docx.name)
    judge_result = judge_root / "result.json"
    judge_command = [
        args.codex,
        "-a",
        "never",
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "-C",
        str(judge_root),
        "-s",
        "read-only",
        "--output-schema",
        str(TEST_DIR / "judge-schema.json"),
        "-o",
        str(judge_result),
    ]
    if args.model:
        judge_command.extend(["--model", args.model])
    judge_command.append(
        judge_prompt(
            judge_root / source_docx.name,
            judge_root / "expected",
            judge_root / "actual",
        )
    )
    print("[3/3] 启动第二个独立 Codex 进行 AI 评审", flush=True)
    judge = execute(judge_command, judge_root / "codex-judge.log")
    if judge.returncode or not judge_result.is_file():
        print((judge_root / "codex-judge.log").read_text(encoding="utf-8")[-6000:])
        return judge.returncode or 3

    result = json.loads(judge_result.read_text(encoding="utf-8"))
    result["hard_guard"] = "fail" if hard_guard_failed else "pass"
    result["run_dir"] = str(run_dir)
    report = run_dir / "report.json"
    report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))

    if hard_guard_failed:
        print("确定性底线校验失败，详见 hard-guard.log")
        return 4
    if result["verdict"] == "fail" or (args.fail_on_warn and result["verdict"] == "warn"):
        return 5
    return 0


if __name__ == "__main__":
    sys.exit(main())
