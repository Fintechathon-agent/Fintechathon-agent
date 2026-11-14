# -*- coding: utf-8 -*-
"""临时本地 CONNECT 通道：github.com 解析超时时，把连接直接指到可用 IP。

只监听 127.0.0.1，不做证书中间人（TLS 仍是客户端与 GitHub 直连），用完即关。
用法：python tools/gh_tunnel.py 8899
"""
from __future__ import annotations

import socket
import sys
import threading

HOST_MAP = {
    "github.com": ["140.82.112.3", "140.82.113.3", "140.82.114.3", "140.82.116.3"],
    "codeload.github.com": ["140.82.112.3", "140.82.113.3"],
}
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8899


def pump(a: socket.socket, b: socket.socket) -> None:
    try:
        while True:
            data = a.recv(65536)
            if not data:
                break
            b.sendall(data)
    except OSError:
        pass
    finally:
        for s in (a, b):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def connect_host(host: str, port: int) -> socket.socket:
    for ip in HOST_MAP.get(host, []):
        try:
            s = socket.create_connection((ip, port), timeout=8)
            print(f"[tunnel] {host}:{port} → {ip}", flush=True)
            return s
        except OSError as exc:
            print(f"[tunnel] {ip} 失败：{exc}", flush=True)
    return socket.create_connection((host, port), timeout=8)


def handle(client: socket.socket) -> None:
    try:
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = client.recv(4096)
            if not chunk:
                return
            head += chunk
        request_line = head.split(b"\r\n", 1)[0].decode("latin-1")
        method, target, _ = request_line.split(" ", 2)
        if method.upper() != "CONNECT":
            client.sendall(b"HTTP/1.1 405 Method Not Allowed\r\n\r\n")
            return
        host, _, port_s = target.partition(":")
        upstream = connect_host(host, int(port_s or 443))
        client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        threading.Thread(target=pump, args=(client, upstream), daemon=True).start()
        pump(upstream, client)
    except OSError as exc:
        print(f"[tunnel] 处理失败：{exc}", flush=True)
    finally:
        try:
            client.close()
        except OSError:
            pass


def main() -> None:
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", PORT))
    server.listen(16)
    print(f"[tunnel] 监听 127.0.0.1:{PORT}，映射 {list(HOST_MAP)}", flush=True)
    while True:
        client, _ = server.accept()
        threading.Thread(target=handle, args=(client,), daemon=True).start()


if __name__ == "__main__":
    main()
