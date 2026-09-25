"""Owner-gated, fixture-only Modal candidate. Importing this file does not deploy it."""

from pathlib import Path
import subprocess
import time

import modal


APP_NAME = "itops-legal-fixture-poc"
MODEL_REPO = "iapp/openthai2.0-legal-thaillm-nemotron-3-nano-30b-a3b-NVFP4"
MODEL_REVISION = "6e55ee86c91a863e984bc4697c34637ab6e64327"
MODEL_DIR = Path("/models/openthai-legal-nvfp4")
MODEL_VOLUME_NAME = "itops-legal-fixture-nvfp4"
PORT = 8000

app = modal.App(APP_NAME)
model_volume = modal.Volume.from_name(MODEL_VOLUME_NAME, create_if_missing=True)

download_image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install("huggingface_hub==0.36.0")
    .env({"HF_XET_HIGH_PERFORMANCE": "1"})
)

vllm_image = (
    modal.Image.from_registry("nvidia/cuda:12.9.0-devel-ubuntu22.04", add_python="3.12")
    .entrypoint([])
    .uv_pip_install("vllm==0.20.2")
)


@app.function(
    image=download_image,
    volumes={"/models": model_volume},
    cpu=2,
    memory=4096,
    timeout=1800,
    max_containers=1,
)
def preload_model():
    """Paid CPU/network/storage step; run only after the owner approves the gate."""
    from huggingface_hub import snapshot_download

    started = time.monotonic()
    snapshot_download(repo_id=MODEL_REPO, revision=MODEL_REVISION, local_dir=MODEL_DIR)
    model_volume.commit()
    if not (MODEL_DIR / "config.json").is_file():
        raise RuntimeError("Model cache lacks config.json")
    print(f"preload_seconds={time.monotonic() - started:.2f} revision={MODEL_REVISION}")


@app.server(
    image=vllm_image,
    gpu="L40S",
    cpu=2,
    memory=16384,
    volumes={"/models": model_volume.with_mount_options(read_only=True)},
    port=PORT,
    min_containers=0,
    max_containers=1,
    scaledown_window=5,
    startup_timeout=900,
    unauthenticated=False,
)
class LegalServer:
    @modal.enter()
    def start(self):
        """Modal routes requests only after vLLM listens; log the startup clock."""
        if not (MODEL_DIR / "config.json").is_file():
            raise RuntimeError("Preload the pinned model before starting the GPU server")
        started = time.monotonic()
        command = [
            "vllm", "serve", str(MODEL_DIR),
            "--served-model-name", MODEL_REPO,
            "--tensor-parallel-size", "1",
            "--trust-remote-code",
            "--max-model-len", "8192",
            "--gpu-memory-utilization", "0.90",
            "--enforce-eager",
            "--host", "0.0.0.0",
            "--port", str(PORT),
        ]
        print(f"vllm_start_at={time.time():.3f} model_revision={MODEL_REVISION}", flush=True)
        self.process = subprocess.Popen(command)
        print(f"vllm_spawn_seconds={time.monotonic() - started:.2f}", flush=True)

    @modal.exit()
    def stop(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.process.kill()
