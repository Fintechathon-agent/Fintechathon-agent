"""配置加载：读取 config.yaml，处理路径与 API key 回退。"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = PROJECT_ROOT / "config.yaml"


@dataclass
class LLMConfig:
    provider: str = "deepseek"
    api_key: str = ""
    base_url: str = "https://api.deepseek.com"
    model: str = "deepseek-chat"
    temperature: float = 0.4
    timeout: int = 180
    max_retries: int = 3


@dataclass
class Config:
    llm: LLMConfig = field(default_factory=LLMConfig)
    output_dir: Path = PROJECT_ROOT / "data" / "output"
    history_dir: Path = PROJECT_ROOT / "data" / "history"
    contest_file: Path = PROJECT_ROOT / "data" / "contest" / "赛题要求.txt"
    make_pdf: bool = True
    make_markdown: bool = True
    make_brief: bool = True
    make_ai_report: bool = True
    browser_path: str = ""
    members: list[str] = field(default_factory=list)

    @property
    def has_api_key(self) -> bool:
        return bool(self.llm.api_key.strip())

    def load_contest(self) -> str:
        """读取赛题要求原文，作为 AI 反馈的锚点。"""
        if self.contest_file.exists():
            return self.contest_file.read_text(encoding="utf-8", errors="ignore")
        return ""


def _resolve(p: str) -> Path:
    """相对路径按项目根目录解析，绝对路径原样返回。"""
    path = Path(p).expanduser()
    return path if path.is_absolute() else (PROJECT_ROOT / path)


def load_config(path: str | Path | None = None) -> Config:
    cfg_file = Path(path) if path else DEFAULT_CONFIG
    raw: dict = {}
    if cfg_file.exists():
        raw = yaml.safe_load(cfg_file.read_text(encoding="utf-8")) or {}

    llm_raw = raw.get("llm") or {}
    llm = LLMConfig(
        provider=llm_raw.get("provider", "deepseek"),
        # 环境变量优先于配置文件中的空值
        api_key=(llm_raw.get("api_key") or os.environ.get("DEEPSEEK_API_KEY", "")),
        base_url=llm_raw.get("base_url", "https://api.deepseek.com"),
        model=llm_raw.get("model", "deepseek-chat"),
        temperature=float(llm_raw.get("temperature", 0.4)),
        timeout=int(llm_raw.get("timeout", 180)),
        max_retries=int(llm_raw.get("max_retries", 3)),
    )

    paths = raw.get("paths") or {}
    out = raw.get("output") or {}
    team = raw.get("team") or {}

    return Config(
        llm=llm,
        output_dir=_resolve(paths.get("output_dir", "data/output")),
        history_dir=_resolve(paths.get("history_dir", "data/history")),
        contest_file=_resolve(paths.get("contest_file", "data/contest/赛题要求.txt")),
        make_pdf=bool(out.get("make_pdf", True)),
        make_markdown=bool(out.get("make_markdown", True)),
        make_brief=bool(out.get("make_brief", True)),
        make_ai_report=bool(out.get("make_ai_report", True)),
        browser_path=str(out.get("browser_path", "") or ""),
        members=list(team.get("members") or []),
    )
