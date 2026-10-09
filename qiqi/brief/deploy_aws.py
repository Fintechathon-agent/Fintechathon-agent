# -*- coding: utf-8 -*-
"""Daily Market Brief · 网页版部署到 AWS S3（静态网站）

把 out/brief_YYYY-MM-DD.html 部署为可公网访问的静态网页。
零依赖之外的唯一要求：本机配好 AWS 凭证（三选一，见下）。

凭证配置（任选一种）：
  1) 环境变量：AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION
  2) 配置文件：~/.aws/credentials（[default] 段）+ ~/.aws/config
  3) SSO 登录：aws sso login --profile xxx，然后设 AWS_PROFILE

用法：
    python brief/deploy_aws.py --bucket my-brief-site            # 首次会自动建桶+配置静态托管
    python brief/deploy_aws.py --bucket my-brief-site --date 2026-10-08
    python brief/deploy_aws.py --bucket my-brief-site --all      # 上传 out/ 下所有 HTML
    python brief/deploy_aws.py --bucket my-brief-site --dry-run  # 只检查凭证与文件，不实际上传

输出：部署成功会打印公网地址（S3 静态网站端点）。
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"


def load_html(files_mode: str, date_str: str | None) -> list[Path]:
    if files_mode == "all":
        files = sorted(OUT.glob("brief_*.html"))
        if not files:
            raise SystemExit("out/ 下没有 brief_*.html")
        return files
    d = date_str or date.today().strftime("%Y-%m-%d")
    p = OUT / f"brief_{d}.html"
    if not p.exists():
        raise SystemExit(f"找不到 {p}")
    return [p]


def main() -> int:
    ap = argparse.ArgumentParser(description="把日报网页版部署到 AWS S3")
    ap.add_argument("--bucket", required=True, help="S3 桶名（全局唯一，如 market-brief-2026）")
    ap.add_argument("--date", help="指定日期 YYYY-MM-DD（默认今天）")
    ap.add_argument("--all", action="store_true", help="上传 out/ 下全部 HTML")
    ap.add_argument("--region", default=None, help="AWS 区域（默认取环境变量或 us-east-1）")
    ap.add_argument("--no-public", action="store_true", help="不自动应用公共读取策略（默认会应用）")
    ap.add_argument("--dry-run", action="store_true", help="只校验不部署")
    args = ap.parse_args()

    try:
        import boto3
        from botocore.exceptions import ClientError, NoCredentialsError
    except ImportError:
        print("[error] 缺少 boto3：python -m pip install boto3")
        return 2

    files = load_html("all" if args.all else "single", args.date)
    print(f"[1/4] 待上传 {len(files)} 个文件：")
    for f in files:
        print(f"      {f.name}  ({f.stat().st_size / 1024:.1f} KB)")

    region = args.region or "us-east-1"
    s3 = boto3.client("s3", region_name=region)

    # 凭证自检
    try:
        ident = boto3.client("sts", region_name=region).get_caller_identity()
        print(f"[2/4] 凭证 OK：账号 {ident.get('Account')}")
    except NoCredentialsError:
        print("[error] 未找到 AWS 凭证。三选一配置后重试：")
        print("        1) 环境变量 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_DEFAULT_REGION")
        print("        2) ~/.aws/credentials 文件")
        print("        3) aws sso login（然后设 AWS_PROFILE）")
        return 3
    except Exception as e:
        print(f"[error] 凭证校验失败：{type(e).__name__} {str(e)[:160]}")
        return 3

    if args.dry_run:
        print("[3/4] dry-run：跳过建桶与上传")
        print(f"[4/4] 预计公网地址：http://{args.bucket}.s3-website-{region}.amazonaws.com/")
        return 0

    # 建桶（如不存在）
    try:
        s3.head_bucket(Bucket=args.bucket)
        print(f"[3/4] 桶已存在：{args.bucket}")
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchBucket"):
            if region == "us-east-1":
                s3.create_bucket(Bucket=args.bucket)
            else:
                s3.create_bucket(Bucket=args.bucket,
                                 CreateBucketConfiguration={"LocationConstraint": region})
            print(f"[3/4] 已创建桶：{args.bucket}（{region}）")
        else:
            print(f"[error] 访问桶失败：{code} {e.response.get('Error', {}).get('Message', '')}")
            return 4

    # 静态网站托管配置
    s3.put_bucket_website(Bucket=args.bucket, WebsiteConfiguration={
        "IndexDocument": {"Suffix": "index.html"},
        "ErrorDocument": {"Key": "index.html"},
    })

    # 公共读取策略（静态网站必需；--no-public 可跳过）
    if not args.no_public:
        policy = {
            "Version": "2012-10-17",
            "Statement": [{
                "Sid": "PublicReadForBriefSite",
                "Effect": "Allow",
                "Principal": "*",
                "Action": "s3:GetObject",
                "Resource": f"arn:aws:s3:::{args.bucket}/*",
            }],
        }
        try:
            s3.put_bucket_policy(Bucket=args.bucket, Policy=json.dumps(policy))
            print("      公共读取策略已应用")
        except Exception as e:
            print(f"      [warn] 策略设置失败（可能被组织策略禁止，需手动处理）：{type(e).__name__} {str(e)[:100]}")

    # 上传
    uploaded = []
    for f in files:
        key = f.name
        s3.upload_file(str(f), args.bucket, key, ExtraArgs={"ContentType": "text/html; charset=utf-8"})
        uploaded.append(key)
        print(f"      上传 {key} 完成")

    # 最新一期同时发布为 index.html（方便直接访问根路径）
    latest = files[-1]
    s3.upload_file(str(latest), args.bucket, "index.html",
                   ExtraArgs={"ContentType": "text/html; charset=utf-8"})
    uploaded.append("index.html（指向最新一期）")
    print(f"      index.html ← {latest.name}")

    url = f"http://{args.bucket}.s3-website-{region}.amazonaws.com/"
    print(f"[4/4] 部署完成")
    print(f"      首页：{url}")
    for f in files:
        print(f"      {f.name}: {url}{f.name}")
    print()
    print("提示：S3 网站端点为 HTTP。如需 HTTPS/自定义域名，可再加 CloudFront（+ACM 证书）。")
    print("      桶策略需允许公共读取，见 README「AWS 部署」小节。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
