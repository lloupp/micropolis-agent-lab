"""Install the pinned official Julia-1 CPU runtime and weights into ignored artifacts."""
import hashlib
import json
import os
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL = json.loads((ROOT / "overlay/agent/julia-model.json").read_text())
environment = ROOT / "artifacts/julia-venv"
checkpoint = ROOT / "artifacts/Julia-1"
venv.EnvBuilder(with_pip=True).create(environment)
binary = environment / ("Scripts" if os.name == "nt" else "bin")
python = binary / ("python.exe" if os.name == "nt" else "python")


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True, cwd=ROOT)


run(python, "-m", "pip", "install", "huggingface_hub==1.33.0", "socksio==1.0.0")
run(python, "-m", "pip", "install", "torch==2.14.1", "--index-url", "https://download.pytorch.org/whl/cpu")
run(binary / ("hf.exe" if os.name == "nt" else "hf"), "download", MODEL["modelId"],
    "--revision", MODEL["revision"], "--local-dir", checkpoint)
with (checkpoint / "model.safetensors").open("rb") as weights:
    if hashlib.file_digest(weights, "sha256").hexdigest() != MODEL["weightsSha256"]:
        sys.exit("Julia-1 checkpoint hash mismatch")
(checkpoint / ".julia-revision").write_text(MODEL["revision"] + "\n")
run(python, "-m", "pip", "install", "-e", checkpoint)
print("Julia-1 CPU ready. Start with: npm run julia:sidecar")
