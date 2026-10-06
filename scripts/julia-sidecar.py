"""Resident, pinned Julia-1 inference. This service has no Micropolis executor."""
import hashlib
import json
import math
import os
import platform
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL = json.loads((ROOT / "overlay/agent/julia-model.json").read_text())
TOOLS = {"res": (3, 100, "residential zone"), "com": (3, 100, "commercial zone"),
         "ind": (3, 100, "industrial zone"), "road": (1, 10, "road"),
         "wire": (1, 5, "power line"), "coal": (4, 3000, "coal power plant"),
         "police": (3, 500, "police station"), "fire": (3, 500, "fire station")}
QUESTION = "Which available action best supports sustainable city growth, considering funds, electricity, road access, demand, and public services?"


class InvalidRequest(ValueError):
    pass


def prepare_request(payload, spatial_encoding="distances-v1"):
    if spatial_encoding not in ("distances-v1", "semantics-v2"):
        raise InvalidRequest("invalid_spatial_encoding")
    if not isinstance(payload, dict) or set(payload) - {"snapshot", "availableActions", "memory"}:
        raise InvalidRequest("invalid_payload")
    snapshot = payload.get("snapshot")
    candidates = payload.get("availableActions")
    memory = payload.get("memory", {})
    if not isinstance(snapshot, dict) or not isinstance(memory, dict):
        raise InvalidRequest("invalid_snapshot_or_memory")
    if not isinstance(candidates, list) or not 2 <= len(candidates) <= 20:
        raise InvalidRequest("candidate_count")
    if len(snapshot.get("lastActions", [])) > 8 or len(snapshot.get("recentFailures", [])) > 5 or len(memory.get("recentSuggestions", [])) > 10:
        raise InvalidRequest("context_excessive")
    features = snapshot.get("candidateFeatures", [])
    if not isinstance(features, list) or len(features) > 20:
        raise InvalidRequest("invalid_spatial_features")
    spatial = {}
    for f in features:
        allowed = {"actionId", "legal", "roadDistance", "powerDistance", "zoneDistance", "roadCount", "plantCount"}
        if not isinstance(f, dict) or set(f) != allowed or not isinstance(f["actionId"], str) or f["actionId"] in spatial:
            raise InvalidRequest("invalid_spatial_features")
        if type(f["legal"]) is not bool:
            raise InvalidRequest("invalid_spatial_features")
        for key in ("roadDistance", "powerDistance", "zoneDistance"):
            if f[key] is not None and (type(f[key]) is not int or not 0 <= f[key] <= 220):
                raise InvalidRequest("invalid_spatial_features")
        for key in ("roadCount", "plantCount"):
            if type(f[key]) is not int or not 0 <= f[key] <= 12000:
                raise InvalidRequest("invalid_spatial_features")
        spatial[f["actionId"]] = f
    criteria = {}
    for candidate in candidates:
        if not isinstance(candidate, dict) or not isinstance(candidate.get("action"), dict):
            raise InvalidRequest("invalid_candidate")
        action = candidate["action"]
        kind = action.get("kind")
        if kind == "build":
            tool, x, y = action.get("tool"), action.get("x"), action.get("y")
            if tool not in TOOLS or type(x) is not int or type(y) is not int:
                raise InvalidRequest("invalid_coordinates")
            size, cost, label = TOOLS[tool]
            offset = 1 if size > 1 else 0
            if x - offset < 0 or y - offset < 0 or x - offset + size > 120 or y - offset + size > 100:
                raise InvalidRequest("invalid_coordinates")
            if snapshot.get("totalFunds", 0) < cost:
                raise InvalidRequest("insufficient_funds")
            action_id = f"build:{tool}:{x}:{y}"
            description = f"Build {label} at ({x}, {y}), costing ${cost}."
        elif kind == "tax":
            value = action.get("value")
            if type(value) is not int or not 0 <= value <= 20:
                raise InvalidRequest("invalid_tax")
            action_id, description = f"tax:{value}", f"Set city tax to {value} percent."
        elif kind == "wait":
            action_id, description = "wait", "Wait for the existing city to develop without construction or tax changes."
        else:
            raise InvalidRequest("illegal_action")
        if candidate.get("id") != action_id or action_id in criteria:
            raise InvalidRequest("invalid_candidate_id")
        f = spatial.get(action_id)
        if f and kind == "build":
            road = f["roadDistance"] if f["roadDistance"] is not None else "none"
            power = f["powerDistance"] if f["powerDistance"] is not None else "none"
            if spatial_encoding == "distances-v1":
                description += f" Road distance {road}; connected power distance {power}."
            else:
                road_text = "No road exists" if road == "none" else f"Nearest road is {road} tiles from the footprint"
                power_text = "No plant-connected electricity network exists" if power == "none" else f"Plant-connected electricity network is {power} tiles from the footprint"
                zone = f["zoneDistance"]
                zone_text = "No existing zone" if zone is None else f"Nearest existing zone is {zone} tiles from the footprint"
                description += f" {road_text}; {power_text}; {zone_text}."
                description += f" Existing road tiles: {f['roadCount']}; power plant tiles: {f['plantCount']}."
                description += " Network proximity does not guarantee this new building is energized."
        criteria[action_id] = description
    if spatial and set(spatial) != set(criteria):
        raise InvalidRequest("spatial_candidate_mismatch")
    state_snapshot = {k: v for k, v in snapshot.items() if k != "candidateFeatures"}
    state = json.dumps({"snapshot": state_snapshot, "memory": memory}, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if len(state.encode()) > 16000:
        raise InvalidRequest("context_excessive")
    return state, criteria


class JuliaRuntime:
    def __init__(self, checkpoint):
        import torch
        import transformers
        from julia import load_model
        checkpoint = Path(checkpoint)
        if (checkpoint / ".julia-revision").read_text().strip() != MODEL["revision"]:
            raise ValueError("Checkpoint revision does not match pinned Julia-1")
        with (checkpoint / "model.safetensors").open("rb") as weights:
            digest = hashlib.file_digest(weights, "sha256").hexdigest()
        if digest != MODEL["weightsSha256"]:
            raise ValueError("Checkpoint SHA-256 does not match Julia-1")
        self.spatial_encoding = os.environ.get("JULIA_SPATIAL_ENCODING", "distances-v1")
        if self.spatial_encoding not in ("distances-v1", "semantics-v2"):
            raise ValueError("invalid_spatial_encoding")
        self.engine = load_model(str(checkpoint), device="cpu", strict_encoding=True,
                                 marker_only_head=False, max_length=MODEL["maxLength"], head_length=MODEL["headLength"])
        self.identity = {key: MODEL[key] for key in ("modelId", "revision", "weightsSha256", "provider")}
        self.identity.update(device="cpu", instanceId=str(uuid.uuid4()),
                             hardware=platform.processor() or platform.machine(),
                             torch=torch.__version__, transformers=transformers.__version__,
                             spatialEncoding=self.spatial_encoding)
        self.lock = threading.Lock()
        self.count = 0

    def decide(self, payload):
        state, criteria = prepare_request(payload, self.spatial_encoding)
        if not self.lock.acquire(blocking=False):
            raise RuntimeError("service_busy")
        try:
            started = time.perf_counter()
            result = self.engine.predict(state=state, questions={"action": {
                "type": "choice", "instructions": QUESTION, "criteria": criteria}})
            self.count += 1
            answer = result["answers"]["action"]
            confidence = answer["max_probability"]
            if answer["choice"] not in criteria or not math.isfinite(confidence) or not 0 <= confidence <= 1:
                raise ValueError("invalid_model_output")
            if os.environ.get("JULIA_DEBUG") == "1":
                print(json.dumps({"requestId": self.count, "rawModelOutput": result}), flush=True)
            return {"decision": {"actionId": answer["choice"], "confidence": confidence},
                    "provenance": {**self.identity, "inference": True, "requestId": self.count},
                    "modelLatencyMs": (time.perf_counter() - started) * 1000}
        finally:
            self.lock.release()


class Handler(BaseHTTPRequestHandler):
    def allowed_origin(self):
        origin = self.headers.get("Origin")
        allowed = os.environ.get("JULIA_SHADOW_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
        return origin if origin and origin in [item.strip() for item in allowed] else None

    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        self.send_json(200, {"status": "ready", **self.server.runtime.identity})

    def do_POST(self):
        if self.path != "/decide":
            self.send_error(404)
            return
        if self.headers.get("Origin") and not self.allowed_origin():
            self.send_error(403)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MODEL["maxRequestBytes"]:
                raise InvalidRequest("context_excessive")
            payload = json.loads(self.rfile.read(length))
            self.send_json(200, self.server.runtime.decide(payload))
        except (InvalidRequest, ValueError, TypeError, KeyError) as error:
            self.send_json(422, {"error": {"code": str(error)[:180]}})
        except RuntimeError as error:
            self.send_json(503, {"error": {"code": str(error)[:180]}})
        except Exception as error:
            self.send_json(500, {"error": {"code": type(error).__name__}})

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
        body = json.dumps(value, allow_nan=False).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            origin = self.allowed_origin()
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    venv = ROOT / "artifacts/julia-venv"
    python = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if python.exists() and Path(sys.prefix).resolve() != venv.resolve():
        os.execv(str(python), [str(python), str(Path(__file__)), *sys.argv[1:]])
    runtime = JuliaRuntime(os.environ.get("JULIA_1_CHECKPOINT", str(ROOT / "artifacts/Julia-1")))
    server = ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("JULIA_SHADOW_PORT", "8765"))), Handler)
    server.runtime = runtime
    print(json.dumps({"status": "ready", "endpoint": "http://127.0.0.1:8765/decide", **runtime.identity}), flush=True)
    server.serve_forever()
