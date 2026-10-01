"""Local Julia-1 bridge. Configure a trusted OpenAI-compatible endpoint outside the browser."""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen


class Handler(BaseHTTPRequestHandler):
    def allowed_origin(self):
        origin = self.headers.get("Origin")
        allowed = os.environ.get(
            "JULIA_SHADOW_ALLOWED_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173",
        ).split(",")
        return origin if origin and origin in [item.strip() for item in allowed] else None

    def do_POST(self):
        if self.path != "/decide":
            self.send_error(404)
            return
        origin = self.allowed_origin()
        if self.headers.get("Origin") and not origin:
            self.send_error(403)
            return
        try:
            payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            candidates = payload["availableActions"]
            candidate_ids = [item["id"] for item in candidates]
            if not candidate_ids:
                raise ValueError("empty candidates")
            base = os.environ.get("JULIA_1_BASE_URL")
            if not base:
                self.send_json(503, {"error": "Julia-1 endpoint is not configured"})
                return
            prompt = {
                "model": os.environ.get("JULIA_1_MODEL", "Julia-1"),
                "temperature": 0,
                "messages": [
                    {"role": "system", "content": "Choose exactly one actionId from the supplied candidates. Return only JSON with actionId and optional confidence. Never invent commands."},
                    {"role": "user", "content": json.dumps({"snapshot": payload["snapshot"], "availableActions": candidates, "memory": payload.get("memory")})},
                ],
                "response_format": {"type": "json_object"},
            }
            headers = {"Content-Type": "application/json"}
            key = os.environ.get("JULIA_1_API_KEY")
            if key:
                headers["Authorization"] = "Bearer " + key
            request = Request(base.rstrip("/") + "/chat/completions", json.dumps(prompt).encode(), headers)
            with urlopen(request, timeout=float(os.environ.get("JULIA_1_TIMEOUT", "3"))) as response:
                answer = json.loads(response.read())
            content = answer["choices"][0]["message"]["content"]
            decision = json.loads(content)
            # Boundary check here too. Browser validator repeats it independently.
            if set(decision) - {"actionId", "confidence", "reason"} or decision.get("actionId") not in candidate_ids:
                self.send_json(200, {"actionId": "__invalid__"})
                return
            self.send_json(200, decision)
        except Exception as error:
            self.send_json(502, {"error": type(error).__name__})

    def do_OPTIONS(self):
        origin = self.allowed_origin()
        if not origin:
            self.send_error(403)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def send_json(self, status, value):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        origin = self.allowed_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("JULIA_SHADOW_PORT", "8765"))), Handler).serve_forever()
