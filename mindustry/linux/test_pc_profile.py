#!/usr/bin/env python3
"""Real Mindustry v160.7 Linux PC-profile benchmark; read-only and isolated.

Requires Python 3.10+ and JDK 17+ (java/javac/jar) in PATH.
Only writes to the chosen install directory; no admin/sudo needed after JDK setup.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import socket
import statistics
import subprocess
import sys
import time
from urllib.request import urlopen

SERVER_SHA256 = "f7b899a4038b95b14a824d5f8993984f79d73baa3254c385b6538327f9c0befd"
CLIENT_SHA256 = "36d94941a1639478ad1d9be25a9d802c6f77552f400c6da0338b7b019f63a0d1"
RELEASE = "https://github.com/Anuken/Mindustry/releases/download/v160.7/"
STATE_URL = "http://127.0.0.1:8766/v1/state"
MINDUSTRY_ROOT = Path(__file__).resolve().parents[1]


def get_json(url, timeout=3):
    with urlopen(url, timeout=timeout) as response:
        return json.load(response)


def download_verified(name, expected_sha256, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file() and hashlib.sha256(destination.read_bytes()).hexdigest() == expected_sha256:
        return
    temporary = destination.with_suffix(destination.suffix + ".part")
    try:
        digest = hashlib.sha256()
        with urlopen(RELEASE + name, timeout=60) as response, temporary.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
                output.write(chunk)
        if digest.hexdigest() != expected_sha256:
            raise RuntimeError("SHA-256 validation failed for " + name)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def find_java():
    for command in ("java", "javac", "jar"):
        if shutil.which(command) is None:
            raise RuntimeError("JDK 17+ required: missing " + command + " (e.g. sudo apt install openjdk-17-jdk)")
    result = subprocess.run(["javac", "-version"], capture_output=True, text=True, check=True)
    match = re.search(r"javac\s+(\d+)", result.stdout + result.stderr)
    if not match or int(match.group(1)) < 17:
        raise RuntimeError("JDK 17+ required, found: " + result.stdout + result.stderr)


def prepare_game(install, with_client):
    find_java()
    download_dir = install / "downloads"
    server_jar = download_dir / "server-release.jar"
    download_verified("server-release.jar", SERVER_SHA256, server_jar)
    if with_client:
        download_verified("Mindustry.jar", CLIENT_SHA256, download_dir / "Mindustry.jar")
    java_sources = sorted((MINDUSTRY_ROOT / "plugin/src/main/java").rglob("*.java"))
    if not java_sources:
        raise RuntimeError("No Java plugin sources found")
    classes = install / "build" / "classes"
    if classes.exists():
        shutil.rmtree(classes)
    classes.mkdir(parents=True)
    subprocess.run(["javac", "--release", "17", "-encoding", "UTF-8",
                    "-cp", str(server_jar), "-d", str(classes),
                    *map(str, java_sources)], check=True)
    plugin_jar = install / "build" / "mindustry-agent-lab-plugin.jar"
    subprocess.run(["jar", "--create", "--file", str(plugin_jar), "-C", str(classes),
                    ".", "-C", str(MINDUSTRY_ROOT / "plugin"), "plugin.json"], check=True)
    server_dir = install / "server"
    mods = server_dir / "config" / "mods"
    mods.mkdir(parents=True, exist_ok=True)
    shutil.copy2(server_jar, server_dir / "server-release.jar")
    shutil.copy2(plugin_jar, mods / plugin_jar.name)
    return server_dir


def hardware():
    cpu = "unknown"
    if Path("/proc/cpuinfo").exists():
        match = re.search(r"^model name\s*:\s*(.*)$", Path("/proc/cpuinfo").read_text(), re.M)
        if match:
            cpu = match.group(1).strip()
    ram_gb = None
    if Path("/proc/meminfo").exists():
        match = re.search(r"^MemTotal:\s+(\d+)\s+kB", Path("/proc/meminfo").read_text(), re.M)
        if match:
            ram_gb = round(int(match.group(1)) / 1024 / 1024, 2)
    gpu = "not available"
    if shutil.which("lspci"):
        result = subprocess.run(["lspci"], capture_output=True, text=True, check=False)
        devices = [line.strip() for line in result.stdout.splitlines()
                   if "VGA compatible controller" in line or "3D controller" in line]
        if devices:
            gpu = " | ".join(devices[:2])
    os_release = "unknown"
    if Path("/etc/os-release").exists():
        match = re.search(r'^PRETTY_NAME="?([^"\n]+)"?$', Path("/etc/os-release").read_text(), re.M)
        if match:
            os_release = match.group(1)
    return dict(cpuModel=cpu, ramGb=ram_gb, gpuModel=gpu, osName=os_release,
                logicalProcessors=os.cpu_count())


def rss_mb(pid):
    path = Path("/proc") / str(pid) / "status"
    try:
        match = re.search(r"^VmRSS:\s+(\d+)\s+kB", path.read_text(), re.M)
        return round(int(match.group(1)) / 1024, 2) if match else None
    except (OSError, ValueError):
        return None


def ensure_port_free():
    with socket.socket() as sock:
        sock.settimeout(1)
        if sock.connect_ex(("127.0.0.1", 8766)) == 0:
            raise RuntimeError("Port 8766 is already in use. Stop existing Mindustry before benchmark.")


def validate_state(state):
    if (state.get("schemaVersion") != 1 or not state.get("ready") or
            not state.get("playing") or state.get("gameOver") or state.get("won") or
            not isinstance(state.get("core"), dict) or
            state["core"].get("health", 0) <= 0):
        raise RuntimeError("Invalid/not playing Mindustry state")
    return dict(tick=int(state["tick"]), wave=int(state["wave"]),
                width=int(state["width"]), height=int(state["height"]))


def run(args):
    install = args.install_dir.expanduser().resolve()
    install.mkdir(parents=True, exist_ok=True)
    report_path = args.report.expanduser().resolve() if args.report else install / "reports" / "pc-validation-linux.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    ensure_port_free()
    server_dir = prepare_game(install, args.with_client)
    if args.with_client and not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        raise RuntimeError("Graphical client requires a local graphical session (DISPLAY/WAYLAND_DISPLAY)")
    logs = report_path.parent
    started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    server, client, failure = None, None, None
    samples, latencies, errors = [], [], []
    peak_rss = 0.0
    affinity_applied = False
    try:
        with (logs / "server-stdout-linux.log").open("w") as stdout, (
                logs / "server-stderr-linux.log").open("w") as stderr:
            server = subprocess.Popen(["java", "-Xms128m", f"-Xmx{args.heap_mb}m",
                                       f"-XX:ActiveProcessorCount={args.cores}",
                                       "-jar", "server-release.jar", "host"],
                                      cwd=server_dir, stdout=stdout, stderr=stderr)
            try:
                allowed = sorted(os.sched_getaffinity(0))
                os.sched_setaffinity(server.pid, set(allowed[:args.cores]))
                affinity_applied = True
            except (OSError, AttributeError, ValueError) as exc:
                errors.append("affinity_unavailable: " + str(exc))
            ready = False
            for _ in range(60):
                if server.poll() is not None:
                    raise RuntimeError("Server exited at startup: " + str(server.returncode))
                try:
                    health = get_json("http://127.0.0.1:8766/v1/health")
                    state = get_json(STATE_URL)
                    if health.get("readOnly") is True and state.get("ready") and state.get("core"):
                        ready = True
                        break
                except (OSError, ValueError, TimeoutError):
                    pass
                time.sleep(1)
            if not ready:
                raise RuntimeError("Real server did not become ready in 60 seconds")
            if args.with_client:
                client = subprocess.Popen(["java", "-Xmx768m", "-jar",
                                           str(install / "downloads" / "Mindustry.jar")])
                print("Client launched. Join 127.0.0.1:6567; GPU/FPS must be inspected manually.")
            start = time.monotonic()
            while time.monotonic() - start < args.duration:
                if server.poll() is not None:
                    raise RuntimeError("Server stopped during benchmark")
                begin = time.monotonic()
                try:
                    state = validate_state(get_json(STATE_URL))
                    latencies.append(round((time.monotonic() - begin) * 1000, 2))
                    samples.append(dict(second=round(time.monotonic() - start, 2), **state))
                except (OSError, ValueError, TimeoutError, RuntimeError) as exc:
                    errors.append("snapshot_failure: " + str(exc))
                rss = rss_mb(server.pid)
                if rss is not None:
                    peak_rss = max(rss, peak_rss)
                time.sleep(1)
            if len(samples) < max(2, math.floor(args.duration * 0.75)):
                raise RuntimeError("Too few valid game samples")
            if samples[-1]["tick"] <= samples[0]["tick"]:
                raise RuntimeError("Game ticks did not advance")
            if any(s["width"] != samples[0]["width"] or s["height"] != samples[0]["height"] for s in samples):
                raise RuntimeError("Map changed during benchmark")
            if any(s["tick"] < samples[i - 1]["tick"] or s["wave"] < samples[i - 1]["wave"]
                   for i, s in enumerate(samples) if i):
                raise RuntimeError("Simulation time moved backward")
            if any(e.startswith("snapshot_failure:") for e in errors):
                raise RuntimeError("State observations failed")
            if client and client.poll() is not None:
                raise RuntimeError("Graphical client exited unexpectedly")
    except (Exception, KeyboardInterrupt) as exc:
        failure = str(exc)
    finally:
        for proc in (client, server):
            if proc and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)
        ordered = sorted(latencies)
        result = {
            "schemaVersion": 1, "kind": "mindustry_pc_profile_validation",
            "status": "failed" if failure else "passed",
            "actualEnvironment": "github_ubuntu_runner" if os.environ.get("GITHUB_ACTIONS") == "true" else "local_linux",
            "referencePc": {"cpu": "Intel Core i5-7200U", "ramGb": 8, "gpu": "Intel HD Graphics 620"},
            "hostHardware": hardware(),
            "restrictions": {"javaMaxHeapMb": args.heap_mb, "javaActiveProcessorCount": args.cores,
                             "cpuAffinityApplied": affinity_applied,
                             "totalMachineRamLimitedTo8Gb": False, "gpuEmulated": False},
            "results": {"realServer": True, "readOnly": True, "commandsExecuted": 0,
                        "requestedDurationSeconds": args.duration, "successfulSamples": len(samples),
                        "errors": errors, "firstTick": samples[0]["tick"] if samples else None,
                        "lastTick": samples[-1]["tick"] if samples else None,
                        "tickDelta": samples[-1]["tick"] - samples[0]["tick"] if len(samples) > 1 else None,
                        "meanHttpLatencyMs": round(statistics.mean(latencies), 2) if latencies else None,
                        "p95HttpLatencyMs": ordered[math.ceil(0.95 * len(ordered)) - 1] if ordered else None,
                        "peakServerWorkingSetMb": round(peak_rss, 2),
                        "clientLaunched": client is not None, "gpuFpsValidated": False},
            "startedAt": started_at, "endedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "failure": failure, "observations": samples
        }
        report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[Mindustry Linux] {result['status']}: {len(samples)} samples; "
              f"{result['results']['tickDelta']} ticks; peak RSS {peak_rss:.1f} MB")
        print("Report: " + str(report_path))
    return 1 if failure else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install-dir", type=Path,
                        default=Path.home() / ".local/share/mindustry-agent-lab")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--duration", type=int, default=60)
    parser.add_argument("--cores", type=int, default=2)
    parser.add_argument("--heap-mb", type=int, default=640)
    parser.add_argument("--with-client", action="store_true")
    args = parser.parse_args()
    if not 15 <= args.duration <= 600 or not 1 <= args.cores <= 8 or not 384 <= args.heap_mb <= 2048:
        parser.error("duration: 15-600, cores: 1-8, heap-mb: 384-2048")
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
