#!/usr/bin/env python3
"""M1 real-Mindustry integration, opt-in CI builder fixture, no mocked engine."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from sys import path as sys_path
sys_path.insert(0, str(Path(__file__).resolve().parents[1] / "linux"))
from test_pc_profile import prepare_game

TOKEN = "M1_ci_token_0123456789_abcdefghijklmnopqrstuvwxyz"
BASE = "http://127.0.0.1:8766"


def call(method, path, body=None, authorized=True):
    headers = {"Accept": "application/json"}
    if authorized:
        headers["Authorization"] = "Bearer " + TOKEN
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                  headers=headers, method=method)
    try:
        with urlopen(req, timeout=3) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


def wait_command(identifier, deadline=30):
    until = time.monotonic() + deadline
    while time.monotonic() < until:
        code, data = call("GET", "/v1/commands/" + identifier)
        assert code == 200, (code, data)
        if data["status"] in ("completed", "rejected", "failed", "canceled"):
            return data
        time.sleep(0.25)
    raise TimeoutError("Game construction never returned a terminal result for " + identifier)


def exercise():
    code, health = call("GET", "/v1/health", authorized=False)
    assert code == 200 and health["readOnly"] is False and health["ciFixture"] is True, health
    code, untrusted = call("GET", "/v1/commands/test")
    assert code == 404, (code, untrusted)
    code, denied = call("GET", "/v1/commands/test", authorized=False)
    assert code == 401 and denied["error"] == "unauthorized", denied

    illegal = {"id": "outside-map", "block": "conveyor", "x": 999, "y": 999, "rotation": 0}
    code, accepted = call("POST", "/v1/build", illegal)
    assert code == 202 and accepted["status"] == "queued", (code, accepted)
    invalid = wait_command(illegal["id"])
    assert invalid["status"] == "rejected" and invalid["reason"] == "invalid_placement", invalid
    code, replay = call("POST", "/v1/build", illegal)
    assert code == 200 and replay["status"] == "rejected", (code, replay)
    code, conflict = call("POST", "/v1/build", {**illegal, "x": 1})
    assert code == 409 and conflict["error"] == "idempotency_conflict", (code, conflict)
    code, denied = call("POST", "/v1/build", illegal, authorized=False)
    assert code == 401 and denied["error"] == "unauthorized", (code, denied)
    code, malformed = call("POST", "/v1/build", {**illegal, "id": 123})
    assert code == 422 and malformed["error"] == "invalid_command", (code, malformed)

    until = time.monotonic() + 25
    site = None
    while time.monotonic() < until:
        code, snapshot = call("GET", "/v1/state", authorized=False)
        site = snapshot.get("suggestedBuild")
        if snapshot.get("ready") and site and snapshot.get("core", {}).get("copper", 0) >= 1:
            break
        time.sleep(0.3)
    else:
        raise AssertionError("No legal conveyor site with game resources observed")

    requested = {"id": "real-poly-build", **site}
    code, first = call("POST", "/v1/build", requested)
    assert code == 202, (code, first)
    status = wait_command(requested["id"], deadline=80)
    assert status["status"] == "completed", "Engine build not completed: " + json.dumps(status)
    assert status["builderId"] > 0, "No genuine unit assigned: " + json.dumps(status)
    code, replay = call("POST", "/v1/build", requested)
    assert code == 200 and replay["status"] == "completed", replay
    print(json.dumps({"source": "real_mindustry_v160.7",
                      "fixture": "real_poly_spawned_in_game_copper_seeded",
                      "build": requested, "status": status,
                      "negativePlacement": invalid, "authRequired": True,
                      "idempotent": True, "completedByGenuineBuilder": True},
                     indent=2))


def main():
    with tempfile.TemporaryDirectory(prefix="mindustry-m1-ci-") as temp:
        root = Path(temp)
        server_dir = prepare_game(root, False)
        log_out = (root / "server.log").open("w")
        log_err = (root / "errors.log").open("w")
        env = dict(os.environ, MINDUSTRY_AGENT_TOKEN=TOKEN, GITHUB_ACTIONS="true")
        command = ["java", "-Dmindustry.agentlab.ciFixture=true",
                   "-Xms128m", "-Xmx640m", "-XX:ActiveProcessorCount=2",
                   "-jar", "server-release.jar", "host"]
        proc = subprocess.Popen(command, cwd=server_dir, env=env, stdout=log_out, stderr=log_err)
        try:
            until = time.monotonic() + 60
            while time.monotonic() < until:
                if proc.poll() is not None:
                    raise RuntimeError("Mindustry terminated before startup")
                try:
                    code, health = call("GET", "/v1/health", authorized=False)
                    code2, state = call("GET", "/v1/state", authorized=False)
                    if code == 200 and code2 == 200 and state.get("ready"):
                        break
                except (OSError, ValueError):
                    pass
                time.sleep(0.5)
            else:
                raise TimeoutError("Mindustry M1 real plugin failed to start")
            exercise()
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
            log_out.close()
            log_err.close()
            print("Mindustry server tail:", (root / "server.log").read_text(errors="replace")[-3500:])
            print("Mindustry stderr tail:", (root / "errors.log").read_text(errors="replace")[-1500:])


if __name__ == "__main__":
    main()
