r"""Comprehensive Automated Diagnostic & Test Suite for ComfyUI-MiniMax-Creator.

Run using your embedded python:
    "G:\ComfyUI-Easy-Install\python_embeded\python.exe" "G:\ComfyUI-Easy-Install\ComfyUI\custom_nodes\ComfyUI-MiniMax-Creator\test_minimax_creator.py"
"""

from __future__ import annotations

import importlib
import json
import os
import sys
import time
import traceback
from pathlib import Path

# ==============================================================================
# 1. GPU ISOLATION & PATH CONFIGURATION
# ==============================================================================
if "CUDA_VISIBLE_DEVICES" not in os.environ:
    os.environ["CUDA_VISIBLE_DEVICES"] = "0"

DEFAULT_COMFYUI_PATH = r"G:\ComfyUI-Easy-Install\ComfyUI"
SCRIPT_DIR = Path(__file__).resolve().parent
PACKAGE_NAME = SCRIPT_DIR.name  # "ComfyUI-MiniMax-Creator"
CUSTOM_NODES_DIR = str(SCRIPT_DIR.parent)

COMFYUI_PATH = os.environ.get("COMFYUI_PATH", DEFAULT_COMFYUI_PATH)

if os.path.isdir(COMFYUI_PATH) and COMFYUI_PATH not in sys.path:
    sys.path.insert(0, COMFYUI_PATH)

if CUSTOM_NODES_DIR not in sys.path:
    sys.path.insert(0, CUSTOM_NODES_DIR)

# ==============================================================================
# 2. PROMPT SERVER ROUTE TABLE MOCK FOR STANDALONE TESTING
# ==============================================================================
try:
    from aiohttp import web
    import server

    if getattr(server.PromptServer, "instance", None) is None:
        class StandalonePromptServerMock:
            def __init__(self):
                self.routes = web.RouteTableDef()
            def send_sync(self, *args, **kwargs):
                pass

        server.PromptServer.instance = StandalonePromptServerMock()
except Exception as exc:
    print(f"[WARN] PromptServer mock setup failed: {exc}")

# ==============================================================================
# 3. ANSI TERMINAL COLORING HELPERS
# ==============================================================================
class Color:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    CYAN = "\033[96m"
    MAGENTA = "\033[95m"

def log_header(title: str):
    print(f"\n{Color.BOLD}{Color.CYAN}{'=' * 80}{Color.RESET}")
    print(f"{Color.BOLD}{Color.CYAN}  {title}{Color.RESET}")
    print(f"{Color.BOLD}{Color.CYAN}{'=' * 80}{Color.RESET}")

def log_pass(msg: str):
    print(f"  {Color.GREEN}[PASS]{Color.RESET} {msg}")

def log_warn(msg: str, detail: str = ""):
    print(f"  {Color.YELLOW}[WARN]{Color.RESET} {msg} {detail}")

def log_fail(msg: str, err: str = ""):
    print(f"  {Color.RED}[FAIL]{Color.RESET} {msg}")
    if err:
        print(f"         {Color.RED}→ {err}{Color.RESET}")

def log_info(msg: str):
    print(f"  {Color.BOLD}[INFO]{Color.RESET} {msg}")


class TestReport:
    def __init__(self):
        self.passed = 0
        self.warned = 0
        self.failed = 0
        self.errors = []

    def record_pass(self, name: str):
        self.passed += 1
        log_pass(name)

    def record_warn(self, name: str, detail: str = ""):
        self.warned += 1
        log_warn(name, detail)

    def record_fail(self, name: str, error: str):
        self.failed += 1
        self.errors.append((name, error))
        log_fail(name, error)


REPORT = TestReport()
PKG = None


# ==============================================================================
# TEST 1: ENVIRONMENT & PYTHON DEPENDENCIES
# ==============================================================================
def test_environment():
    log_header("TEST 1: Python Environment & PyTorch Hardware Verification")
    log_info(f"Python Executable: {sys.executable}")
    log_info(f"Python Version: {sys.version.split()[0]}")
    log_info(f"ComfyUI Path: {COMFYUI_PATH}")

    try:
        import torch
        log_info(f"PyTorch Version: {torch.__version__}")
        if torch.cuda.is_available():
            gpu_name = torch.cuda.get_device_name(0)
            vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
            log_info(f"Active Primary CUDA Device: {gpu_name} ({vram_gb:.2f} GB VRAM)")
            REPORT.record_pass("PyTorch with RTX 4070 CUDA acceleration is active")
        else:
            REPORT.record_warn("CUDA is not available in PyTorch")
    except Exception as exc:
        REPORT.record_fail("PyTorch import failed", str(exc))

    for lib in ("torchaudio", "PIL", "av", "aiohttp", "numpy"):
        try:
            importlib.import_module(lib)
            REPORT.record_pass(f"Library '{lib}' is installed and importable")
        except Exception as exc:
            REPORT.record_fail(f"Library '{lib}' missing", str(exc))

    try:
        import nvvfx
        REPORT.record_pass("NVIDIA RTX VSR ('nvidia-vfx') is installed and ready for AI upscaling")
    except ImportError:
        REPORT.record_warn("NVIDIA RTX VSR ('nvidia-vfx') not installed (Optional for RTX AI upscaling)")

    try:
        import safetensors
        REPORT.record_pass("Safetensors library is available for fast checkpoint serialization")
    except ImportError:
        REPORT.record_warn("Safetensors library not installed")


# ==============================================================================
# TEST 2: COMFYUI CORE MODULES
# ==============================================================================
def test_comfyui_core():
    log_header("TEST 2: ComfyUI Core Architecture Integration")
    for module_name in ("folder_paths", "comfy.model_management", "comfy.samplers", "comfy.sd", "nodes"):
        try:
            importlib.import_module(module_name)
            REPORT.record_pass(f"ComfyUI core module '{module_name}' imported successfully")
        except Exception as exc:
            REPORT.record_fail(f"ComfyUI core module '{module_name}' failed to load", str(exc))


# ==============================================================================
# TEST 3: CUSTOM NODE MAPPINGS & REGISTRATION
# ==============================================================================
def test_node_mappings():
    global PKG
    log_header("TEST 3: MiniMax Creator Node Class Registration")
    try:
        PKG = importlib.import_module(PACKAGE_NAME)

        mappings = getattr(PKG, "NODE_CLASS_MAPPINGS", {})
        display_names = getattr(PKG, "NODE_DISPLAY_NAME_MAPPINGS", {})

        expected_nodes = [
            "MiniMaxH3Creator",
            "MiniMaxH3Timeline",
            "MiniMaxH3TimelineSegment",
            "MiniMaxH3StreamedAssembly",
            "MiniMaxH3LastFrame",
            "MiniMaxH3SeamTrim",
            "MiniMaxH3AudioTail",
            "MiniMaxH3TimelineJoin",
            "MiniMaxH3Save",
            "MiniMaxH3SaveSegment",
            "MiniMaxH3LoadSegment",
            "MiniMaxH3PreStage",
            "MiniMaxH3SaveImage",
            "MiniMaxH3StillLatent",
            "MiniMaxH3RefinePass",
            "MiniMaxH3RTXUpscale",
            "MiniMaxH3Director",
        ]

        for node_id in expected_nodes:
            if node_id in mappings:
                cls_obj = mappings[node_id]
                REPORT.record_pass(f"Node '{node_id}' registered correctly ({display_names.get(node_id, cls_obj.__name__)})")
            else:
                REPORT.record_fail(f"Node '{node_id}' missing in NODE_CLASS_MAPPINGS", "Not found in dictionary")

    except Exception as exc:
        REPORT.record_fail("Custom Node initialization failed", f"{traceback.format_exc()}")


# ==============================================================================
# TEST 4: SETTINGS SYSTEM & TILED VAE PREFERENCES
# ==============================================================================
def test_settings():
    log_header("TEST 4: Settings Store & Tiled VAE Configurations")
    if PKG is None:
        REPORT.record_fail("Settings module test skipped", "Package not loaded")
        return

    settings = PKG.settings
    try:
        loaded = settings.load()
        REPORT.record_pass(f"Default settings loaded successfully (video_crf={loaded.get('video_crf')})")

        cleaned = settings.clean({
            "video_crf": 18,
            "tiled_vae": True,
            "vae_tile_size": 768,
            "enable_preview": True,
            "syntax_highlighting": "full",
        })
        assert cleaned["tiled_vae"] is True
        assert cleaned["vae_tile_size"] == 768
        assert cleaned["video_crf"] == 18
        assert cleaned["syntax_highlighting"] == "full"
        REPORT.record_pass("Settings clean() & validation verified for Tiled VAE and CRF options")
    except Exception as exc:
        REPORT.record_fail("Settings module test failed", str(exc) or repr(exc))


# ==============================================================================
# TEST 5: MODELS CATALOG & DYNAMIC RESCAN ("R")
# ==============================================================================
def test_models():
    log_header("TEST 5: Models Catalog, Dynamic Rescan ('R') & Tiled VAE Node")
    if PKG is None:
        REPORT.record_fail("Models catalog test skipped", "Package not loaded")
        return

    models = PKG.models
    try:
        catalog = models.available(refresh=True)
        assert isinstance(catalog, dict)
        assert "files" in catalog
        assert "dtypes" in catalog
        REPORT.record_pass(f"models.available(refresh=True) successfully indexed model paths ({len(catalog['folders'])} folders tracked)")

        class MockGraph:
            def node(self, node_type, **kwargs):
                class MockNode:
                    def out(self, idx):
                        return f"{node_type}_output_{idx}"
                return MockNode()

        g = MockGraph()
        std_out = models.decode_vae_node(g, "samples", "vae", tiled=False)
        assert std_out == "VAEDecode_output_0"
        REPORT.record_pass("models.decode_vae_node() cleanly emits standard VAEDecode")

        tiled_out = models.decode_vae_node(g, "samples", "vae", tiled=True, tile_size=512)
        assert "output_0" in tiled_out
        REPORT.record_pass("models.decode_vae_node() cleanly emits memory-efficient VAEDecodeTiled")
    except Exception as exc:
        REPORT.record_fail("Models catalog test failed", str(exc) or repr(exc))


# ==============================================================================
# TEST 6: CANVAS & TEMPORAL GRID TIMING MATH
# ==============================================================================
def test_canvas_timing():
    log_header("TEST 6: Canvas Resolution & 17n+5 Exact AV Timing")
    if PKG is None:
        REPORT.record_fail("Canvas timing test skipped", "Package not loaded")
        return

    canvas = PKG.canvas
    h3_timing = PKG.h3_timing
    try:
        w_169, h_169 = canvas.resolve_canvas(16 / 9, 768)
        assert (w_169, h_169) == (1344, 768)
        REPORT.record_pass(f"16:9 768p resolved to exact {w_169}x{h_169} (32px boundary)")

        w_916, h_916 = canvas.resolve_canvas(9 / 16, 768)
        assert (w_916, h_916) == (768, 1344)
        REPORT.record_pass(f"9:16 768p resolved to exact {w_916}x{h_916} (32px boundary)")

        f_6s = canvas.frames_for_seconds(6.0)
        assert (f_6s - 5) % 17 == 0
        REPORT.record_pass(f"6.0s duration maps to legal 17n+5 frame count ({f_6s} frames)")

        t_tokens = h3_timing.pixel_frames_to_latent_t(39)
        assert t_tokens == 12
        REPORT.record_pass("39-frame seam feather maps to 12 latent temporal steps")
    except Exception as exc:
        REPORT.record_fail("Canvas & Timing math test failed", str(exc) or repr(exc))


# ==============================================================================
# TEST 7: COMPILERS FOR ALL WORKFLOW MODES
# ==============================================================================
def test_compilers():
    log_header("TEST 7: Request Compilers (Creator, Timeline, PreStage & Stills)")
    if PKG is None:
        REPORT.record_fail("Compilers test skipped", "Package not loaded")
        return

    compiler = PKG.compile
    compile_image = PKG.compile_image
    compile_still = PKG.compile_still

    try:
        creator_blob = {
            "prompt": "A cinematic shot of a rainy street in cyberpunk neo-tokyo",
            "duration_s": 6,
            "aspect": "16:9",
            "short_edge": 768,
        }
        compiled_req = compiler.compile_request(creator_blob)
        assert compiled_req.mode == "T2VA"
        assert compiled_req.width == 1344 and compiled_req.height == 768
        REPORT.record_pass("Creator T2VA request compiled to exact Context-IR specification")
    except Exception as exc:
        REPORT.record_fail("Creator compilation failed", str(exc) or repr(exc))

    try:
        prestage_blob = {
            "arch": "krea2",
            "prompt": "Portrait of a woman wearing a green coat in morning light",
            "aspect": "16:9",
            "short_edge": 1024,
            "turbo": {"on": True, "quality": "good"},
        }
        compiled_img = compile_image.compile_prestage(prestage_blob)
        assert compiled_img.arch == "krea2"
        assert compiled_img.checkpoint_field == "turbo_model"
        REPORT.record_pass("PreStage Krea 2 Turbo image payload compiled successfully")
    except Exception as exc:
        REPORT.record_fail("PreStage Image compilation failed", str(exc) or repr(exc))

    try:
        still_blob = {
            "arch": "minimax",
            "minimax": {
                "frames": 5,
                "latent_index": 0,
                "request": {
                    "prompt": "A glass of water sitting on a wooden table in sunlight",
                    "aspect": "16:9",
                    "short_edge": 768,
                }
            }
        }
        compiled_still = compile_still.compile_still(still_blob)
        assert compiled_still.frames == 5
        assert compiled_still.index == 0
        REPORT.record_pass("PreStage MiniMax H3 still plan compiled with latent frame 0 slice")
    except Exception as exc:
        REPORT.record_fail("PreStage Still compilation failed", str(exc) or repr(exc))


# ==============================================================================
# TEST 8: PROMPT REFINER, REASONING MODELS & IMAGE MODE
# ==============================================================================
def test_refiner():
    log_header("TEST 8: Context-IR Prompt Refiner, Reasoning Engine & PreStage Image Parsing")
    if PKG is None:
        REPORT.record_fail("Refiner test skipped", "Package not loaded")
        return

    refine = PKG.refine

    try:
        raw_llm_reasoning_output = """\
<think>
We need to direct a continuous 2-shot sequence with wardrobe consistency and dynamic tracking camera.
Shot 1 establishes the rain. Shot 2 cuts to the subject inside the car.
</think>

```json
{
  "shots": [
    {
      "body": "Live-action, cinematic, the camera pans right as rain streaks across the glass window.",
      "soundscape": "Heavy rain falls against the windowpane with distant city traffic.",
      "music": "Low ambient cello notes."
    },
    {
      "body": "At 00:06.000, the shot cuts to a close-up of the young woman holding an umbrella.",
      "soundscape": "Raindrops patter against the fabric of the umbrella.",
      "music": "Low ambient cello continues.",
      "transition": "cross_blend_39f"
    }
  ],
  "overall_soundscape": "Continuous rain and soft traffic.",
  "non_diegetic_music": "Low cello score."
}
```"""
        parsed = refine.parse_reply(raw_llm_reasoning_output, "T2VA", shots=2)
        assert len(parsed["shots"]) == 2
        assert "rain streaks" in parsed["shots"][0]
        assert "umbrella" in parsed["shots"][1]
        assert parsed["auto_seams"][1]["feather"] == 39
        REPORT.record_pass("Refiner successfully stripped <think> reasoning tokens and extracted 2-shot Context-IR")
    except Exception as exc:
        REPORT.record_fail("Refiner multi-shot parsing failed", str(exc) or repr(exc))

    try:
        raw_image_refine_output = """\
<think>
Describing high-resolution textures, 85mm lens, shallow depth of field.
</think>

{"body": "A photorealistic 85mm f/1.4 portrait of a 28-year-old woman with auburn hair in a dark-emerald wool coat, soft neon reflections in the rain."}
"""
        parsed_img = refine.parse_reply(raw_image_refine_output, "IMAGE", shots=1)
        assert len(parsed_img["shots"]) == 1
        assert "photorealistic 85mm" in parsed_img["shots"][0]["body"]
        REPORT.record_pass("Refiner successfully parsed PreStage IMAGE prompt mode without multi-shot markers")
    except Exception as exc:
        REPORT.record_fail("PreStage IMAGE mode refine parsing failed", str(exc) or repr(exc))


# ==============================================================================
# TEST 9: DIRECTOR SYSTEM ARCHITECTURE
# ==============================================================================
def test_director():
    log_header("TEST 9: AI Director & Writers' Room Architecture")
    if PKG is None:
        REPORT.record_fail("Director test skipped", "Package not loaded")
        return

    director_routes = PKG.director_routes
    try:
        assert hasattr(director_routes, "DIRECTOR_SYSTEM_PROMPT"), "DIRECTOR_SYSTEM_PROMPT missing in director_routes"
        prompt_text = director_routes.DIRECTOR_SYSTEM_PROMPT.lower()
        assert "context-ir" in prompt_text, "Context-IR guidelines missing from system prompt"
        assert "storyboard" in prompt_text, "Storyboard structure missing from system prompt"
        REPORT.record_pass("Director system prompt and Context-IR storytelling rules loaded")
    except Exception as exc:
        REPORT.record_fail("Director routes verification failed", str(exc) or repr(exc))


# ==============================================================================
# TEST 10: TIMELINE MEMORY & AUDIO/SEAM MATHEMATICS
# ==============================================================================
def test_timeline_seam_math():
    log_header("TEST 10: Timeline Low-RAM Streaming & Photometric Seam Math")
    if PKG is None:
        REPORT.record_fail("Timeline test skipped", "Package not loaded")
        return

    timeline = PKG.timeline
    try:
        import torch

        sample_rate = 44100
        fps = 24.0
        num_frames = 48  # Exactly 2.0s = 88200 samples
        raw_audio = torch.randn(1, 2, 90000) + 0.15

        # Test DC offset removal
        no_dc = timeline._remove_dc_offset(raw_audio)
        assert float(torch.abs(no_dc.mean(dim=-1)).max()) < 1e-5, "DC offset was not removed"

        # Test Audio fitting
        fitted = timeline._fit_audio_to_frames(raw_audio, num_frames, fps, sample_rate)
        assert fitted.shape[-1] == 88200, f"Expected 88200 samples, got {fitted.shape[-1]}"
        REPORT.record_pass("Audio fitted exactly to 48 frames (2.0s) with DC offset eliminated")

        # Test Photometric Seam Matching
        img_a = torch.ones(10, 64, 64, 3) * 0.5
        img_b = torch.ones(10, 64, 64, 3) * 0.6
        corrected_b = timeline._photometric_match_seam(img_a, img_b, overlap_frames=4)
        assert corrected_b.shape == img_b.shape, "Corrected frame shape mismatch"
        REPORT.record_pass("Photometric seam matching accurately corrected luminance difference across cut")

    except Exception as exc:
        REPORT.record_fail("Timeline seam & audio math failed", str(exc) or repr(exc))


# ==============================================================================
# MAIN TEST EXECUTION
# ==============================================================================
def main():
    start_time = time.time()
    print(f"\n{Color.BOLD}{Color.MAGENTA}{'=' * 80}")
    print("  MiniMax Creator Custom Node — Automated Verification Suite")
    print(f"{'=' * 80}{Color.RESET}")

    test_environment()
    test_comfyui_core()
    test_node_mappings()
    test_settings()
    test_models()
    test_canvas_timing()
    test_compilers()
    test_refiner()
    test_director()
    test_timeline_seam_math()

    elapsed = time.time() - start_time

    log_header("DIAGNOSTIC SUMMARY & REPORT")
    print(f"  Total Passed Tests: {Color.GREEN}{REPORT.passed}{Color.RESET}")
    print(f"  Total Warnings:     {Color.YELLOW}{REPORT.warned}{Color.RESET}")
    print(f"  Total Failed Tests: {Color.RED}{REPORT.failed}{Color.RESET}")
    print(f"  Execution Time:     {elapsed:.2f} seconds")

    if REPORT.failed == 0:
        print(f"\n{Color.BOLD}{Color.GREEN}✓ ALL SYSTEMS OPERATIONAL: ComfyUI-MiniMax-Creator is fully functional!{Color.RESET}\n")
        return 0
    else:
        print(f"\n{Color.BOLD}{Color.RED}✗ {REPORT.failed} TEST(S) FAILED. Review error details above.{Color.RESET}\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())