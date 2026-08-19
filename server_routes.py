"""HTTP & WebSocket server routes for asset browsing, previews, models, and timeline export."""

from __future__ import annotations

import asyncio
import json
import os
import xml.etree.ElementTree as ET

from aiohttp import web
import folder_paths
from server import PromptServer

from . import lorameta, models, preview, settings

MAX_ASSETS = 20000
MAX_LORAS = 600


def _classify(filename: str) -> str | None:
    for kind in ("image", "video", "audio"):
        if folder_paths.filter_files_content_types([filename], [kind]):
            return kind
    return None


def _scan(root: str, annotation: str = ""):
    """Scans media directory for valid image/video/audio assets."""
    for directory, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        for filename in sorted(filenames):
            if filename.startswith("."):
                continue
            kind = _classify(filename)
            if kind is None:
                continue
            path = os.path.join(directory, filename)
            if os.path.islink(path) and not folder_paths.is_within_directory(root, path):
                continue
            subfolder = os.path.relpath(directory, root)
            subfolder = "" if subfolder == "." else subfolder.replace(os.sep, "/")
            try:
                mtime = os.path.getmtime(path)
                size = os.path.getsize(path)
            except OSError:
                continue
            relative = f"{subfolder}/{filename}" if subfolder else filename
            yield {
                "path": relative + annotation,
                "name": filename,
                "subfolder": subfolder,
                "kind": kind,
                "size": size,
                "mtime": mtime,
            }


def _input_path(request: web.Request) -> str | None:
    filename = request.query.get("filename", "")
    if not filename or not folder_paths.exists_annotated_filepath(filename):
        return None
    return folder_paths.get_annotated_filepath(filename)


def _read_header(path: str) -> dict:
    import av

    with av.open(path) as container:
        duration = float(container.duration / av.time_base) if container.duration else None
        has_audio = bool(container.streams.audio)
        return {
            "has_audio": has_audio,
            "duration": duration,
        }


@PromptServer.instance.routes.get("/minimax_creator/probe")
async def probe_asset(request: web.Request) -> web.Response:
    path = _input_path(request)
    if path is None:
        return web.json_response({"has_audio": None, "error": "not in the input folder"}, status=404)
    try:
        loop = asyncio.get_running_loop()
        return web.json_response(await loop.run_in_executor(None, _read_header, path))
    except Exception as exc:
        return web.json_response({"has_audio": None, "error": str(exc)})


@PromptServer.instance.routes.get("/minimax_creator/thumb")
async def asset_thumb(request: web.Request) -> web.Response:
    path = _input_path(request)
    if path is None:
        return web.Response(status=404)
    thumb = await preview.thumbnail(path)
    if thumb is None:
        return web.Response(status=404)
    return web.FileResponse(thumb, headers={
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
    })


@PromptServer.instance.routes.get("/minimax_creator/peaks")
async def asset_peaks(request: web.Request) -> web.Response:
    path = _input_path(request)
    if path is None:
        return web.json_response({"peaks": None, "duration": 0}, status=404)
    result = await preview.waveform(path)
    if result is None:
        return web.json_response({"peaks": None, "duration": 0})
    return web.json_response(result, headers={"Cache-Control": "no-cache"})


def _lora_names() -> list[str]:
    return [name.replace(os.sep, "/") for name in folder_paths.get_filename_list("loras")]


def _folder_counts(names: list[str]) -> list[dict]:
    counts = {"": len(names)}
    for name in names:
        parts = name.split("/")[:-1]
        for depth in range(len(parts)):
            counts["/".join(parts[:depth + 1])] = counts.get("/".join(parts[:depth + 1]), 0) + 1
    return [{"path": path, "count": counts[path]} for path in sorted(counts)]


def _in_folder(name: str, folder: str) -> bool:
    return not folder or name.startswith(folder + "/")


def _collect_loras(folder: str, refresh: bool = False) -> dict:
    if refresh:
        lorameta.forget()
    names = _lora_names()
    found = []
    for name in names:
        if not _in_folder(name, folder):
            continue
        path = folder_paths.get_full_path("loras", name)
        if path is None:
            continue
        try:
            found.append((os.path.getmtime(path), name, path))
        except OSError:
            continue
    found.sort(reverse=True)
    rows = [lorameta.row(name, path) for _, name, path in found[:MAX_LORAS]]
    return {
        "loras": rows,
        "folders": _folder_counts(names),
        "folder": folder,
        "matched": len(found),
        "truncated": len(found) > MAX_LORAS,
    }


@PromptServer.instance.routes.get("/minimax_creator/loras")
async def list_loras(request: web.Request) -> web.Response:
    folder = request.query.get("folder", "").strip("/")
    refresh = request.query.get("refresh") == "1" or request.query.get("force") == "1"
    loop = asyncio.get_running_loop()
    return web.json_response(await loop.run_in_executor(None, _collect_loras, folder, refresh))


def _lora_path(request: web.Request) -> str | None:
    return folder_paths.get_full_path("loras", request.query.get("name", ""))


def _serve(path: str | None, data: tuple[bytes, str] | None) -> web.Response:
    if path is not None:
        return web.FileResponse(path)
    if data is not None:
        payload, mime = data
        return web.Response(body=payload, content_type=mime)
    return web.Response(status=404)


@PromptServer.instance.routes.get("/minimax_creator/lora_preview")
async def lora_preview(request: web.Request) -> web.Response:
    path = _lora_path(request)
    if path is None:
        return web.Response(status=404)
    loop = asyncio.get_running_loop()
    found, data = await loop.run_in_executor(None, lorameta.preview, path)
    return _serve(found, data)


@PromptServer.instance.routes.get("/minimax_creator/lora_detail")
async def lora_detail(request: web.Request) -> web.Response:
    name = request.query.get("name", "")
    path = folder_paths.get_full_path("loras", name)
    if path is None:
        return web.json_response({"error": "no such LoRA"}, status=404)
    loop = asyncio.get_running_loop()
    return web.json_response(await loop.run_in_executor(None, lorameta.detail, name, path))


@PromptServer.instance.routes.get("/minimax_creator/lora_showcase")
async def lora_showcase(request: web.Request) -> web.Response:
    path = _lora_path(request)
    if path is None:
        return web.Response(status=404)
    try:
        index = int(request.query.get("item", "0"))
    except ValueError:
        return web.Response(status=404)

    loop = asyncio.get_running_loop()
    entries = await loop.run_in_executor(None, lorameta.showcase, path)
    if not 0 <= index < len(entries):
        return web.Response(status=404)
    entry = entries[index]
    if request.query.get("thumb") == "1" and entry.get("thumb"):
        return web.FileResponse(entry["thumb"])
    data = None
    if entry.get("data") is not None:
        data = (entry["data"], entry.get("mime") or lorameta.sniff(entry["data"]))
    return _serve(entry.get("path"), data)


@PromptServer.instance.routes.get("/minimax_creator/models")
async def list_models(request: web.Request) -> web.Response:
    """Lists available models with dynamic cache invalidation on 'R' / force refresh."""
    refresh = request.query.get("refresh") == "1" or request.query.get("force") == "1"
    if refresh:
        lorameta.forget()
    loop = asyncio.get_running_loop()
    return web.json_response(await loop.run_in_executor(None, models.available, refresh))


@PromptServer.instance.routes.get("/minimax_creator/assets")
async def list_assets(request: web.Request) -> web.Response:
    if request.query.get("root") == "output":
        root, annotation = folder_paths.get_output_directory(), " [output]"
    else:
        root, annotation = folder_paths.get_input_directory(), ""
    if not os.path.isdir(root):
        return web.json_response({"assets": [], "truncated": False})

    loop = asyncio.get_running_loop()
    assets = await loop.run_in_executor(
        None, lambda: sorted(_scan(root, annotation), key=lambda a: a["mtime"], reverse=True))
    truncated = len(assets) > MAX_ASSETS
    return web.json_response({"assets": assets[:MAX_ASSETS], "truncated": truncated})


def _clean_subfolder(raw: Any) -> str | None:
    raw = str(raw or "").strip().strip("/")
    if not raw:
        return ""
    parts = raw.replace("\\", "/").split("/")
    if any(not p or p.startswith(".") for p in parts):
        return None
    return "/".join(parts)


def _rooted(filename: str) -> tuple[str, str, str] | None:
    name, base = folder_paths.annotated_filepath(str(filename))
    if base is None:
        base, annotation = folder_paths.get_input_directory(), ""
    else:
        if os.path.realpath(base) != os.path.realpath(folder_paths.get_output_directory()):
            return None
        annotation = " [output]"
    return os.path.realpath(base), name, annotation


@PromptServer.instance.routes.post("/minimax_creator/move")
async def move_asset(request: web.Request) -> web.Response:
    body = await request.json()
    subfolder = _clean_subfolder(body.get("subfolder", ""))
    if subfolder is None:
        return web.json_response({"error": "bad folder name"}, status=400)
    rooted = _rooted(body.get("filename", ""))
    if rooted is None:
        return web.json_response({"error": "that file is not in a folder the picker browses"}, status=400)
    root, filename, annotation = rooted

    source = os.path.realpath(os.path.join(root, filename))
    if not folder_paths.is_within_directory(root, source) or not os.path.isfile(source):
        return web.json_response({"error": "no such file"}, status=404)

    target_dir = os.path.realpath(os.path.join(root, subfolder)) if subfolder else root
    if target_dir != root and not folder_paths.is_within_directory(root, target_dir):
        return web.json_response({"error": "bad folder name"}, status=400)
    target = os.path.join(target_dir, os.path.basename(source))
    if os.path.realpath(target) == source:
        return web.json_response({"path": filename + annotation})
    if os.path.exists(target):
        return web.json_response({"error": "a file with that name is already there"}, status=409)

    os.makedirs(target_dir, exist_ok=True)
    os.rename(source, target)

    base_src, _ = os.path.splitext(source)
    comp_src = f"{base_src}.safetensors"
    if os.path.isfile(comp_src):
        base_tgt, _ = os.path.splitext(target)
        comp_tgt = f"{base_tgt}.safetensors"
        try:
            os.rename(comp_src, comp_tgt)
        except OSError:
            pass

    relative = os.path.relpath(target, root).replace(os.sep, "/")
    return web.json_response({"path": relative + annotation})


@PromptServer.instance.routes.post("/minimax_creator/delete")
async def delete_asset(request: web.Request) -> web.Response:
    body = await request.json()
    rooted = _rooted(body.get("filename", ""))
    if rooted is None:
        return web.json_response({"error": "that file is not in a folder the picker browses"}, status=400)
    root, filename, _ = rooted
    path = os.path.realpath(os.path.join(root, filename))
    if not folder_paths.is_within_directory(root, path) or not os.path.isfile(path):
        return web.json_response({"error": "no such file"}, status=404)
    try:
        os.remove(path)
        base_no_ext, _ = os.path.splitext(path)
        companion_st = f"{base_no_ext}.safetensors"
        if os.path.isfile(companion_st):
            try:
                os.remove(companion_st)
            except OSError:
                pass
    except OSError as exc:
        return web.json_response({"error": str(exc)}, status=500)
    return web.json_response({"ok": True})


@PromptServer.instance.routes.post("/minimax_creator/clear_cache")
async def clear_timeline_cache(request: web.Request) -> web.Response:
    """Purge all intermediate rendered segment videos and .safetensors latent checkpoints from disk."""
    output_dir = folder_paths.get_output_directory()
    deleted_files = 0
    errors = []

    def _purge_sync():
        nonlocal deleted_files
        for root, _, filenames in os.walk(output_dir):
            for fname in filenames:
                if "_seg" in fname and (fname.endswith(".mp4") or fname.endswith(".safetensors")):
                    fpath = os.path.join(root, fname)
                    try:
                        os.remove(fpath)
                        deleted_files += 1
                    except OSError as e:
                        errors.append(f"{fname}: {e}")

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _purge_sync)

    return web.json_response({"ok": True, "deleted": deleted_files, "errors": errors})


@PromptServer.instance.routes.get("/minimax_creator/settings")
async def read_settings(request: web.Request) -> web.Response:
    return web.json_response({"settings": settings.load()})


@PromptServer.instance.routes.post("/minimax_creator/settings")
async def write_settings(request: web.Request) -> web.Response:
    try:
        stored = settings.save(await request.json())
    except ValueError as problem:
        return web.json_response({"error": str(problem)}, status=400)
    except OSError as problem:
        return web.json_response({"error": f"could not write the settings file: {problem}"}, status=500)
    return web.json_response({"settings": stored})


# ---- EDL & Final Cut Pro XML Export -----------------------------------------
def _frames_to_tc(frames: int, fps: int = 24) -> str:
    total_seconds = int(frames // fps)
    rem_frames = int(frames % fps)
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}:{rem_frames:02d}"


def _build_cmx3600_edl(timeline_data: dict, fps: int = 24) -> str:
    segments = timeline_data.get("segments", [])
    lines = ["TITLE: MINIMAX_TIMELINE_EXPORT", "FCM: NON-DROP FRAME", ""]
    current_rec_frame = 0

    for idx, seg in enumerate(segments, start=1):
        dur_s = float(seg.get("duration_s", 6.0))
        feather = int(seg.get("feather", 39)) if (idx > 1 and seg.get("continue")) else 0
        effective_frames = max(1, int(round(dur_s * fps)) - feather)

        src_in = feather
        src_out = src_in + effective_frames
        rec_in = current_rec_frame
        rec_out = rec_in + effective_frames

        reel = f"AX_{idx:03d}"
        lines.append(
            f"{idx:03d}  {reel:<8} V     C        "
            f"{_frames_to_tc(src_in, fps)} {_frames_to_tc(src_out, fps)} "
            f"{_frames_to_tc(rec_in, fps)} {_frames_to_tc(rec_out, fps)}"
        )
        clip_name = seg.get("cached_video") or f"Shot_{idx}.mp4"
        lines.append(f"* FROM CLIP NAME: {os.path.basename(clip_name)}")
        lines.append("")

        current_rec_frame = rec_out

    return "\n".join(lines)


def _build_fcpxml(timeline_data: dict, fps: int = 24) -> str:
    root = ET.Element("xmeml", version="4")
    seq = ET.SubElement(root, "sequence")
    ET.SubElement(seq, "name").text = "MiniMax_Timeline_Sequence"
    ET.SubElement(seq, "duration").text = str(int(round(float(timeline_data.get("duration_s", 6.0)) * fps)))

    rate = ET.SubElement(seq, "rate")
    ET.SubElement(rate, "timebase").text = str(int(fps))
    ET.SubElement(rate, "ntsc").text = "FALSE"

    media_el = ET.SubElement(seq, "media")
    video = ET.SubElement(media_el, "video")
    track = ET.SubElement(video, "track")

    segments = timeline_data.get("segments", [])
    current_frame = 0

    for idx, seg in enumerate(segments, start=1):
        dur_s = float(seg.get("duration_s", 6.0))
        feather = int(seg.get("feather", 39)) if (idx > 1 and seg.get("continue")) else 0
        effective_frames = max(1, int(round(dur_s * fps)) - feather)

        clipitem = ET.SubElement(track, "clipitem", id=f"clipitem-{idx}")
        ET.SubElement(clipitem, "name").text = f"Shot_{idx}"
        ET.SubElement(clipitem, "duration").text = str(int(round(dur_s * fps)))
        ET.SubElement(clipitem, "start").text = str(current_frame)
        ET.SubElement(clipitem, "end").text = str(current_frame + effective_frames)
        ET.SubElement(clipitem, "in").text = str(feather)
        ET.SubElement(clipitem, "out").text = str(feather + effective_frames)

        current_frame += effective_frames

    return ET.tostring(root, encoding="utf-8", xml_declaration=True).decode("utf-8")


@PromptServer.instance.routes.post("/minimax_creator/export_timeline")
async def export_timeline_file(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        export_format = str(body.get("format", "edl")).lower()
        timeline_data = body.get("timeline", {})

        fps = 24
        if export_format == "xml":
            content = _build_fcpxml(timeline_data, fps)
            filename = "minimax_sequence.xml"
        else:
            content = _build_cmx3600_edl(timeline_data, fps)
            filename = "minimax_sequence.edl"

        return web.json_response({
            "ok": True,
            "filename": filename,
            "content": content,
            "format": export_format,
        })
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)