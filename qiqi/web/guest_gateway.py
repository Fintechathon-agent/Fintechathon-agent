"""Loopback-only guest gateway. Each signed browser session owns one process.

This is not account login or cross-device synchronization. Cloud deployment and
trusted identity integration require a separate reviewed deployment profile.
"""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import hashlib
import hmac
from http.cookies import SimpleCookie, CookieError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import http.client
import json
import os
from pathlib import Path
import queue
import re
import secrets
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
SESSION_SECONDS = 24 * 60 * 60
MAX_BODY = 1024 * 1024


@contextmanager
def exclusive_directory(directory):
    """Prevent two gateways from concurrently opening the same ledger files."""
    directory.mkdir(parents=True, exist_ok=True)
    lock = (directory / "gateway.lock").open("a+b")
    lock.write(b"0")
    lock.flush()
    lock.seek(0)
    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        lock.close()


class GuestRegistry:
    def __init__(self, root, mode="demo", max_workers=8):
        if mode not in ("demo", "live"):
            raise ValueError("Unknown mode")
        self.root, self.mode, self.max_workers = Path(root).resolve(), mode, max_workers
        self.root.mkdir(parents=True, exist_ok=True)
        keyfile = self.root / "session-key.bin"
        try:
            with keyfile.open("xb") as output:
                output.write(secrets.token_bytes(32))
        except FileExistsError:
            pass
        self.secret = keyfile.read_bytes()
        if len(self.secret) != 32:
            raise ValueError("Invalid session signing key; no replacement was generated")
        self.lock = threading.RLock()
        self.workers = {}

    @property
    def cookie_name(self):
        return "fund_guest_" + self.mode

    def issue(self):
        identity = secrets.token_hex(16)
        payload = f"{identity}.{int(time.time())}"
        signature = hmac.new(self.secret, f"{self.mode}:{payload}".encode(), hashlib.sha256).hexdigest()
        return identity, payload + "." + signature

    def verify(self, cookie):
        try:
            jar = SimpleCookie()
            jar.load(cookie)
            value = jar[self.cookie_name].value
            if not re.fullmatch(r"[a-f0-9]{32}\.[0-9]{10}\.[a-f0-9]{64}", value):
                return None
            identity, issued, signature = value.split(".")
            age = time.time() - int(issued)
            expected = hmac.new(self.secret, f"{self.mode}:{identity}.{issued}".encode(), hashlib.sha256).hexdigest()
            return identity if 0 <= age <= SESSION_SECONDS and hmac.compare_digest(expected, signature) else None
        except (CookieError, KeyError, ValueError):
            return None

    @staticmethod
    def stop(worker):
        process = worker["process"]
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        process.stdout.close()

    def worker(self, identity):
        with self.lock:
            existing = self.workers.get(identity)
            if existing and existing["process"].poll() is None:
                existing["last_used"] = time.monotonic()
                return existing
            if existing:
                self.stop(self.workers.pop(identity))
            # Evict only idle workers; state remains durable and session identity
            # remains the same when it is next opened.
            for guest, worker in list(self.workers.items()):
                if time.monotonic() - worker["last_used"] > 1800:
                    self.stop(self.workers.pop(guest))
            if len(self.workers) >= self.max_workers:
                raise RuntimeError("本地演示访客容量已满，请稍后重试")
            token = secrets.token_urlsafe(48)
            env = dict(os.environ, FINANCE_GUEST_BACKEND_TOKEN=token, PYTHONUTF8="1")
            process = subprocess.Popen([sys.executable, "-u", str(ROOT / "web/guest_worker.py"),
                "--directory", str(self.root / self.mode / identity), "--guest", identity, "--mode", self.mode],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                text=True, encoding="utf-8", env=env,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            result = queue.Queue()
            threading.Thread(target=lambda: result.put(process.stdout.readline()), daemon=True).start()
            worker = {"process": process, "token": token, "last_used": time.monotonic()}
            try:
                first = json.loads(result.get(timeout=12))
                port = first["port"]
                if type(port) is not int or not 0 < port < 65536:
                    raise ValueError("Invalid worker port")
                worker["port"] = port
            except Exception:
                self.stop(worker)
                raise RuntimeError("访客服务启动失败；未恢复默认余额或切换他人数据") from None
            self.workers[identity] = worker
            return worker

    def close(self):
        with self.lock:
            for worker in self.workers.values():
                self.stop(worker)
            self.workers.clear()


class GatewayHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass  # Never log cookies, request bodies or query strings.

    def setup(self):
        super().setup()
        self.connection.settimeout(20)

    def respond(self, status, data, content_type="application/json; charset=utf-8", cookie=None):
        raw = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        if cookie:
            self.send_header("Set-Cookie", f"{self.server.registry.cookie_name}={cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_SECONDS}")
        self.end_headers()
        self.wfile.write(raw)

    def dispatch(self):
        self.close_connection = True
        path = urlsplit(self.path)
        expected = f"127.0.0.1:{self.server.server_port}"
        if self.headers.get("Host") != expected:
            return self.respond(403, {"error": "只允许配置的本机来源"})
        origin = self.headers.get("Origin")
        landing_navigation = (self.command == "GET" and path.path in ("/", "/index.html")
                              and self.headers.get("Sec-Fetch-Mode") == "navigate"
                              and self.headers.get("Sec-Fetch-Dest") == "document")
        if (origin and origin != "http://" + expected) or (self.headers.get("Sec-Fetch-Site") == "cross-site" and not landing_navigation):
            return self.respond(403, {"error": "跨站请求已拒绝"})
        if path.scheme or path.netloc or self.headers.get("Transfer-Encoding"):
            return self.respond(400, {"error": "不支持的请求格式"})
        registry = self.server.registry
        identity = registry.verify(self.headers.get("Cookie", ""))
        new_cookie = None
        if not identity:
            if self.command == "GET" and path.path in ("/", "/index.html"):
                identity, new_cookie = registry.issue()
            else:
                return self.respond(401, {"error": "请先打开首页建立独立访客会话"})
        body = None
        if self.command == "POST":
            lengths = self.headers.get_all("Content-Length", [])
            if len(lengths) != 1 or not lengths[0].isdigit():
                return self.respond(400, {"error": "Content-Length 无效"})
            length = int(lengths[0])
            if length > MAX_BODY:
                return self.respond(413, {"error": "请求超过 1 MiB，未截断处理"})
            body = self.rfile.read(length)
            try:
                payload = json.loads(body) if body else {}
                if not isinstance(payload, dict) or set(payload) & {"user_id", "session_id", "tenant_id", "owner", "mode"}:
                    raise ValueError()
            except (ValueError, UnicodeDecodeError):
                return self.respond(400, {"error": "请求格式无效，身份与模式只能由服务器确定"})
        connection = None
        try:
            worker = registry.worker(identity)
            connection = http.client.HTTPConnection("127.0.0.1", worker["port"], timeout=65)
            connection.request(self.command, self.path, body=body, headers={
                "Content-Type": "application/json", "X-Finance-Backend-Token": worker["token"]})
            response = connection.getresponse()
            raw = response.read(8 * MAX_BODY + 1)
            if len(raw) > 8 * MAX_BODY:
                raise ValueError("Response too large")
            return self.respond(response.status, raw, response.getheader("Content-Type", "application/json"), new_cookie)
        except Exception:
            return self.respond(503, {"error": "访客服务暂不可用；未自动重试或生成成功回执"})
        finally:
            if connection:
                connection.close()

    do_GET = dispatch
    do_POST = dispatch


class GuestServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, registry):
        if address[0] != "127.0.0.1":
            raise ValueError("This guest profile is loopback-only")
        super().__init__(address, GatewayHandler)
        self.registry = registry


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8877)
    parser.add_argument("--state-dir", type=Path)
    parser.add_argument("--mode", choices=("demo", "live"), default="demo")
    args = parser.parse_args()
    directory = args.state_dir.resolve() if args.state_dir else Path(tempfile.mkdtemp(prefix="fund-guests-"))
    with exclusive_directory(directory):
        registry = GuestRegistry(directory, args.mode)
        server = GuestServer(("127.0.0.1", args.port), registry)
        print(json.dumps({"url": f"http://127.0.0.1:{server.server_port}/", "state_directory": str(directory),
                          "mode": args.mode, "real_model_calls_enabled": False}), flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
            registry.close()


if __name__ == "__main__":
    main()
