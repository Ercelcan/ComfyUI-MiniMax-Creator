"""MiniMax H3 AI Director / Copilot Node."""

from __future__ import annotations

import json
from comfy_api.latest import io

DEFAULT_DIRECTOR_DATA = json.dumps({
    "version": 1,
    "target_peer": None,
    "model_config": {
        "provider": "comfy",
        "model": "",
        "temperature": 0.4,
        "language": "English",
        "ollamaUrl": "http://localhost:11434",
        "openaiUrl": "http://localhost:1234/v1",
        "openrouterUrl": "https://openrouter.ai/api/v1",
        "openrouterKey": "",
    },
    "history": [],
    "last_timeline_payload": None,
    "last_single_prompt": "",
}, indent=2)


class MiniMaxH3Director(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxH3Director",
            display_name="MiniMax H3 AI Director",
            category="MiniMax",
            description=(
                "Interactive AI Director & Writers' Room: brainstorm shots, compose "
                "Context-IR storyboards, and stream live reasoning. Pushes directly to "
                "Timeline/Creator nodes and frees VRAM before sampling."
            ),
            enable_expand=True,
            is_output_node=True,
            inputs=[
                io.String.Input("director_data", multiline=True, default=DEFAULT_DIRECTOR_DATA),
                io.String.Input("context_timeline", optional=True),
            ],
            outputs=[
                io.String.Output("timeline_data", display_name="timeline_data"),
                io.String.Output("shot_prompt", display_name="shot_prompt"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, director_data, context_timeline=None) -> io.NodeOutput:
        try:
            data = json.loads(director_data)
        except Exception:
            data = {}

        timeline_out = ""
        payload = data.get("last_timeline_payload")
        if isinstance(payload, dict):
            timeline_out = json.dumps(payload, indent=2)
        elif isinstance(context_timeline, str) and context_timeline.strip():
            timeline_out = context_timeline.strip()

        shot_prompt = str(data.get("last_single_prompt") or "")

        return io.NodeOutput(timeline_out, shot_prompt)


NODES = [MiniMaxH3Director]