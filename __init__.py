"""MiniMax H3 Creator Custom Node Extension."""

from . import server_routes
from . import refine_routes
from . import director_routes
from .creator_node import comfy_entrypoint, MiniMaxH3Creator
from .timeline import (
    MiniMaxH3Timeline,
    MiniMaxH3TimelineSegment,
    MiniMaxH3StreamedAssembly,
    MiniMaxH3LastFrame,
    MiniMaxH3SeamTrim,
    MiniMaxH3AudioTail,
    MiniMaxH3TimelineJoin,
    MiniMaxH3Save,
    MiniMaxH3SaveSegment,
    MiniMaxH3LoadSegment,
)
from .prestage import MiniMaxH3PreStage, MiniMaxH3SaveImage, MiniMaxH3StillLatent
from .hires import MiniMaxH3RefinePass, MiniMaxH3RTXUpscale
from .director_node import MiniMaxH3Director

NODE_CLASS_MAPPINGS = {
    "MiniMaxH3Creator": MiniMaxH3Creator,
    "MiniMaxH3Timeline": MiniMaxH3Timeline,
    "MiniMaxH3TimelineSegment": MiniMaxH3TimelineSegment,
    "MiniMaxH3StreamedAssembly": MiniMaxH3StreamedAssembly,
    "MiniMaxH3LastFrame": MiniMaxH3LastFrame,
    "MiniMaxH3SeamTrim": MiniMaxH3SeamTrim,
    "MiniMaxH3AudioTail": MiniMaxH3AudioTail,
    "MiniMaxH3TimelineJoin": MiniMaxH3TimelineJoin,
    "MiniMaxH3Save": MiniMaxH3Save,
    "MiniMaxH3SaveSegment": MiniMaxH3SaveSegment,
    "MiniMaxH3LoadSegment": MiniMaxH3LoadSegment,
    "MiniMaxH3PreStage": MiniMaxH3PreStage,
    "MiniMaxH3SaveImage": MiniMaxH3SaveImage,
    "MiniMaxH3StillLatent": MiniMaxH3StillLatent,
    "MiniMaxH3RefinePass": MiniMaxH3RefinePass,
    "MiniMaxH3RTXUpscale": MiniMaxH3RTXUpscale,
    "MiniMaxH3Director": MiniMaxH3Director,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MiniMaxH3Creator": "MiniMax H3 Creator",
    "MiniMaxH3Timeline": "MiniMax H3 Timeline",
    "MiniMaxH3TimelineSegment": "MiniMax H3 Timeline Segment",
    "MiniMaxH3StreamedAssembly": "MiniMax H3 Streamed Assembly",
    "MiniMaxH3PreStage": "MiniMax H3 PreStage",
    "MiniMaxH3RTXUpscale": "MiniMax H3 RTX VSR Upscale",
    "MiniMaxH3Director": "MiniMax H3 AI Director",
}

WEB_DIRECTORY = "./js"

__all__ = [
    "comfy_entrypoint",
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]