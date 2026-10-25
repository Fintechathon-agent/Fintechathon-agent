"""Exercise the adapter's HTTP boundary against a local credentialed server."""
import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from web import core_agent


class CoreHttpTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        owner = self

        class Upstream(BaseHTTPRequestHandler):
            def do_GET(self):
                owner.requests.append((self.path, self.headers.get("X-Core-Agent-Key")))
                if self.path == "/health":
                    data, status = {"ok": True}, 200
                elif self.path == "/api/review/capabilities":
                    status = 200 if self.headers.get("X-Core-Agent-Key") == "fixture-service-key" else 401
                    data = {"authenticated": status == 200}
                else:
                    data, status = {}, 404
                self.send_response(status)
                self.end_headers()
                self.wfile.write(json.dumps(data).encode())

            def do_POST(self):
                owner.requests.append((self.path, self.headers.get("X-Core-Agent-Key")))
                self.rfile.read(int(self.headers.get("Content-Length", "0")))
                self.send_response(307)
                self.send_header("Location", "/credential-leak")
                self.end_headers()

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.env = patch.dict(os.environ, {
            "CORE_AGENT_BASE_URL": f"http://127.0.0.1:{self.server.server_port}",
            "CORE_AGENT_API_KEY": "fixture-service-key", "CORE_AGENT_PROXY": "",
        })
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def test_capabilities_use_server_credential_without_exposing_it(self):
        result = core_agent.status()
        self.assertEqual(result["capabilities_http_status"], 200)
        self.assertTrue(result["capabilities"]["authenticated"])
        self.assertEqual(self.requests[-1], ("/api/review/capabilities", "fixture-service-key"))
        self.assertNotIn("fixture-service-key", json.dumps(result))

    def test_redirect_never_forwards_key_or_retries_model_request(self):
        with self.assertRaisesRegex(core_agent.CoreAgentError, "CORE_REDIRECT_REJECTED"):
            core_agent.post_review(core_agent.build_request("虚构持仓分析"))
        self.assertEqual(self.requests, [("/api/review", "fixture-service-key")])

    def test_input_is_not_truncated_and_request_id_survives(self):
        with self.assertRaisesRegex(ValueError, "未截断"):
            core_agent.build_request("问" * 6001)
        with self.assertRaises(ValueError):
            core_agent.build_request("问题", idempotency_key="bad id")
        payload = core_agent.build_request("问题", idempotency_key="fixed-request-123")
        self.assertEqual(payload["idempotency_key"], "fixed-request-123")
        self.assertEqual(payload["capability"], "REVIEW_ONLY")
        self.assertEqual(self.requests, [])

    def test_invalid_origin_is_rejected_before_transmission(self):
        for url in ("http://remote.invalid", "https://name:password@team.invalid", "https://team.invalid/path"):
            with self.subTest(url=url), patch.dict(os.environ, {"CORE_AGENT_BASE_URL": url}):
                with self.assertRaisesRegex(core_agent.CoreAgentError, "CORE_CONFIGURATION_INVALID"):
                    core_agent.base_url()
        self.assertEqual(self.requests, [])
