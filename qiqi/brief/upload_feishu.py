# -*- coding: utf-8 -*-
"""Daily Market Brief · 飞书发布脚本

两种模式，可单用也可同用：

1) 文档模式（--doc）：把简报 Markdown 追加为飞书文档的新章节
   需要：飞书自建应用（App ID / App Secret），并把目标文档共享给该应用（可编辑）
2) 群机器模式（--webhook）：把群聊版文本发到飞书群
   需要：群自定义机器人 webhook（可带签名密钥）

凭证获取方式（二选一）：
  环境变量：FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_WEBHOOK / FEISHU_WEBHOOK_SECRET
  本地文件：同目录 feishu.local.json，格式：
      {"app_id": "...", "app_secret": "...", "webhook": "...", "webhook_secret": "..."}

用法：
    python upload_feishu.py --doc "https://xxx.feishu.cn/docx/XXXX" --file out/brief_2026-10-08.md
    python upload_feishu.py --webhook-file out/group_2026-10-08.txt
    python upload_feishu.py --doc "$DOC" --file out/brief_2026-10-08.md --webhook-file out/group_2026-10-08.txt

注意：文档 API 需应用具备 docx 读写权限并发布生效；未配置凭证时脚本会给出明确提示而不是报错退出。
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import re
import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
CONF_FILE = HERE / "feishu.local.json"
BASE = "https://open.feishu.cn/open-apis"
CHUNK = 40  # 单次追加 block 上限（官方限制 50，留余量）


# ---------- 凭证 ----------

def load_conf() -> dict:
    import os
    conf = {
        "app_id": os.environ.get("FEISHU_APP_ID", ""),
        "app_secret": os.environ.get("FEISHU_APP_SECRET", ""),
        "webhook": os.environ.get("FEISHU_WEBHOOK", ""),
        "webhook_secret": os.environ.get("FEISHU_WEBHOOK_SECRET", ""),
        "doc_url": os.environ.get("FEISHU_DOC_URL", ""),
    }
    if CONF_FILE.exists():
        try:
            local = json.loads(CONF_FILE.read_text(encoding="utf-8"))
            for k, v in local.items():
                if v and not conf.get(k):
                    conf[k] = v
        except Exception as e:
            print(f"[warn] 读取 {CONF_FILE.name} 失败：{e}")
    return conf


def get_tenant_token(app_id: str, app_secret: str) -> str:
    resp = requests.post(f"{BASE}/auth/v3/tenant_access_token/internal",
                         json={"app_id": app_id, "app_secret": app_secret}, timeout=15)
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"获取 tenant_access_token 失败：{data.get('code')} {data.get('msg')}")
    return data["tenant_access_token"]


# ---------- Markdown -> 飞书 block ----------

def _elements(text: str) -> list[dict]:
    """支持 **加粗** 的行内解析。"""
    els = []
    for i, part in enumerate(re.split(r"\*\*(.+?)\*\*", text)):
        if not part:
            continue
        els.append({
            "text_run": {
                "content": part,
                "text_element_style": {"bold": i % 2 == 1},
            }
        })
    return els or [{"text_run": {"content": text or " "}}]


def markdown_to_blocks(md: str) -> list[dict]:
    blocks: list[dict] = []
    for raw in md.splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue
        if line.strip() in ("---", "***", "___"):
            blocks.append({"block_type": 22, "divider": {}})
        elif line.startswith("#### "):
            blocks.append({"block_type": 5, "heading3": {"elements": _elements(line[5:]), "style": {}}})
        elif line.startswith("### "):
            blocks.append({"block_type": 5, "heading3": {"elements": _elements(line[4:]), "style": {}}})
        elif line.startswith("## "):
            blocks.append({"block_type": 4, "heading2": {"elements": _elements(line[3:]), "style": {}}})
        elif line.startswith("# "):
            blocks.append({"block_type": 3, "heading1": {"elements": _elements(line[2:]), "style": {}}})
        elif line.startswith(">"):
            blocks.append({"block_type": 15, "quote": {"elements": _elements(line.lstrip("> ").strip()), "style": {}}})
        elif re.match(r"^\s*[-*] ", line):
            blocks.append({"block_type": 12, "bullet": {"elements": _elements(re.sub(r"^\s*[-*] ", "", line)), "style": {}}})
        elif re.match(r"^\s*\d+\.\s", line):
            # 有序列表降级为 bullet（避免 sequence 字段兼容问题）
            blocks.append({"block_type": 12, "bullet": {"elements": _elements(re.sub(r"^\s*\d+\.\s", "", line)), "style": {}}})
        elif line.lstrip().startswith("|"):
            # Markdown 表格降级为「列1 ｜ 列2 ｜ 列3」单行文本
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
                continue  # 分隔行
            blocks.append({"block_type": 2, "text": {"elements": _elements(" ｜ ".join(cells)), "style": {}}})
        else:
            blocks.append({"block_type": 2, "text": {"elements": _elements(line), "style": {}}})
    return blocks


# ---------- 文档追加 ----------

def parse_doc_token(url_or_token: str) -> str:
    m = re.search(r"/(?:docx|docs)/([A-Za-z0-9]+)", url_or_token)
    return m.group(1) if m else url_or_token.strip()


def parse_wiki_token(url_or_token: str) -> str | None:
    m = re.search(r"/wiki/([A-Za-z0-9]+)", url_or_token)
    return m.group(1) if m else None


def resolve_wiki(token: str, headers: dict) -> str:
    resp = requests.get(f"{BASE}/wiki/v2/spaces/get_node", params={"token": token}, headers=headers, timeout=15)
    data = resp.json()
    if data.get("code") != 0:
        raise RuntimeError(f"解析 wiki 节点失败：{data.get('code')} {data.get('msg')}")
    node = data["data"]["node"]
    if node.get("obj_type") != "docx":
        raise RuntimeError(f"wiki 节点类型是 {node.get('obj_type')}，本脚本只支持 docx")
    return node["obj_token"]


def append_markdown(doc_url: str, md: str, token: str, title: str | None = None) -> None:
    """把 Markdown 追加到文档末尾；返回最后一个可用作父块的 block id。"""
    headers = {"Authorization": f"Bearer {token}"}
    doc_id = parse_doc_token(doc_url)
    wiki = parse_wiki_token(doc_url)
    if wiki:
        doc_id = resolve_wiki(wiki, headers)
    root = doc_id  # 文档根块 id 与 document_id 相同

    blocks = markdown_to_blocks(md)
    if title:
        blocks.insert(0, {"block_type": 3, "heading1": {"elements": _elements(title), "style": {}}})
    if not blocks:
        print("[warn] 没有可上传的内容")
        return

    url = f"{BASE}/docx/v1/documents/{doc_id}/blocks/{root}/children"
    for i in range(0, len(blocks), CHUNK):
        chunk = blocks[i:i + CHUNK]
        resp = requests.post(url, headers=headers, params={"document_revision_id": -1},
                             json={"index": -1, "children": chunk}, timeout=30)
        data = resp.json()
        if data.get("code") != 0:
            raise RuntimeError(f"追加 block 失败（第 {i // CHUNK + 1} 批）：{data.get('code')} {data.get('msg')}")
        print(f"[ok] 已追加 {len(chunk)} 个 block（第 {i // CHUNK + 1} 批）")
    print(f"[ok] 文档已更新：https://feishu.cn/docx/{doc_id}")


# ---------- 群机器人 ----------

def send_webhook(webhook: str, text: str, secret: str = "") -> None:
    payload: dict = {"msg_type": "text", "content": {"text": text}}
    if secret:
        ts = str(int(time.time()))
        string_to_sign = f"{ts}\n{secret}"
        hmac_code = hmac.new(string_to_sign.encode("utf-8"), digestmod=hashlib.sha256).digest()
        payload["timestamp"] = ts
        payload["sign"] = base64.b64encode(hmac_code).decode("utf-8")
    resp = requests.post(webhook, json=payload, timeout=15)
    data = resp.json()
    if data.get("code", data.get("StatusCode", 0)) != 0:
        raise RuntimeError(f"群消息发送失败：{data}")
    print("[ok] 群消息已发送")


# ---------- 主流程 ----------

def main() -> int:
    p = argparse.ArgumentParser(description="Daily Market Brief 飞书发布")
    p.add_argument("--doc", help="目标飞书文档 URL 或 document_id（docx/wiki 均可）")
    p.add_argument("--file", help="要上传的 Markdown 文件")
    p.add_argument("--title", help="追加时的章节标题（默认用文件名日期）")
    p.add_argument("--from-heading", help="只上传命中的第一个标题行及其之后内容（如 '### 2026-10-07'）")
    p.add_argument("--webhook", help="群机器人 webhook 地址（可覆盖本地配置）")
    p.add_argument("--webhook-file", help="要发送到群的纯文本文件")
    p.add_argument("--webhook-text", help="要发送到群的文本（与 --webhook-file 二选一）")
    args = p.parse_args()

    conf = load_conf()
    did_something = False

    # 模式 1：文档（--doc 未给时可从 feishu.local.json 的 doc_url 读取）
    # 仅在显式给出 --doc 或 --file 时进入文档模式；只发群时不误报错
    doc_target = args.doc or conf.get("doc_url", "")
    if args.doc or args.file:
        if not args.file:
            print("[error] 文档模式需要 --file 指定要上传的 Markdown")
            return 2
        md = Path(args.file).read_text(encoding="utf-8")
        if args.from_heading:
            idx = md.find(args.from_heading)
            if idx == -1:
                print(f"[error] 未找到标题：{args.from_heading}")
                return 2
            md = md[idx:]
        if not doc_target:
            print("[skip] 未配置文档链接（--doc 或 feishu.local.json 的 doc_url），文档模式跳过。")
        elif not conf["app_id"] or not conf["app_secret"]:
            print("[skip] 未配置 FEISHU_APP_ID / FEISHU_APP_SECRET（或 feishu.local.json），文档模式跳过。")
            print("       配置步骤见 brief/README.md 第 2 节。")
        else:
            token = get_tenant_token(conf["app_id"], conf["app_secret"])
            append_markdown(doc_target, md, token, args.title)
            did_something = True

    # 模式 2：群
    if args.webhook_file or args.webhook_text or args.webhook:
        webhook = args.webhook or conf["webhook"]
        if not webhook:
            print("[skip] 未配置群机器人 webhook（FEISHU_WEBHOOK 或 --webhook），群模式跳过。")
            print("       配置步骤见 brief/README.md 第 3 节。")
        else:
            text = args.webhook_text
            if args.webhook_file:
                text = Path(args.webhook_file).read_text(encoding="utf-8")
            if not text:
                print("[error] 群模式需要 --webhook-file 或 --webhook-text")
                return 2
            send_webhook(webhook, text, conf.get("webhook_secret", ""))
            did_something = True

    if not did_something:
        print("\n未执行任何发布（凭证缺失或参数不足）。以上 [skip] 提示里给出了补齐方法。")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
