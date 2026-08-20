"""Built-in MiniMax-H3 VRAM Protection Nodes & Attention/FFN Chunking Modifiers.

Provides native implementations of:
- MiniMaxLowVRAMAttention (Attention head chunking)
- MiniMaxChunkFeedForward (FFN sequence chunking)
"""

from __future__ import annotations

from typing import Any
import torch
import comfy.patcher_extension
from comfy_api.latest import io


def _clean_call(executor: Any, args: tuple, kwargs: dict, updates: dict) -> Any:
    """Safely updates transformer_options whether passed positionally or by keyword to prevent duplicate argument errors."""
    args_list = list(args)
    if len(args_list) >= 4:
        t_opts = args_list[3]
        t_opts = dict(t_opts) if isinstance(t_opts, dict) else {}
        t_opts.update(updates)
        args_list[3] = t_opts
        kwargs.pop("transformer_options", None)
    elif "transformer_options" in kwargs:
        t_opts = kwargs["transformer_options"]
        t_opts = dict(t_opts) if isinstance(t_opts, dict) else {}
        t_opts.update(updates)
        kwargs["transformer_options"] = t_opts
    else:
        kwargs["transformer_options"] = dict(updates)
    return executor(*args_list, **kwargs)


# ---------------------------------------------------------------------------
# 1. MiniMax Low VRAM Attention Head Chunking
# ---------------------------------------------------------------------------

def patch_minimax_attention_heads(model_patcher: Any, head_chunks: int = 4) -> Any:
    """Patches model attention computation to chunk multi-head attention into smaller groups, drastically reducing peak VRAM."""
    head_chunks = max(1, int(head_chunks))
    if head_chunks <= 1:
        return model_patcher

    patcher = model_patcher.clone()

    def custom_attention_wrapper(executor: Any, *args: Any, **kwargs: Any) -> Any:
        return _clean_call(executor, args, kwargs, {"minimax_h3_attn_head_chunks": head_chunks})

    patcher.add_wrapper_with_key(
        comfy.patcher_extension.WrappersMP.DIFFUSION_MODEL,
        f"minimax_creator_low_vram_attn_{head_chunks}",
        custom_attention_wrapper,
    )
    return patcher


class MiniMaxLowVRAMAttention(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxLowVRAMAttention",
            display_name="MiniMax H3 Low VRAM Attention",
            category="MiniMax/acceleration",
            description="Chunks multi-head attention execution into smaller groups to prevent VRAM spikes during high-resolution generation.",
            inputs=[
                io.Model.Input("model"),
                io.Int.Input("head_chunks", default=4, min=1, max=16, step=1,
                             tooltip="Number of chunks to split attention heads into (4 is recommended for 12GB/16GB VRAM GPUs)."),
            ],
            outputs=[
                io.Model.Output("model", display_name="MODEL"),
            ],
        )

    @classmethod
    def execute(cls, model: Any, head_chunks: int = 4) -> io.NodeOutput:
        patched = patch_minimax_attention_heads(model, head_chunks)
        return io.NodeOutput(patched)


# ---------------------------------------------------------------------------
# 2. MiniMax Chunk Feed-Forward (FFN Sequence Chunking)
# ---------------------------------------------------------------------------

def patch_minimax_chunk_ffn(model_patcher: Any, chunks: int = 2, seq_threshold: int = 4096) -> Any:
    """Patches FFN (SwiGLU/MLP) layers to evaluate long sequences in chunks, preventing OOM spikes."""
    chunks = max(1, int(chunks))
    if chunks <= 1:
        return model_patcher

    patcher = model_patcher.clone()

    def custom_ffn_wrapper(executor: Any, *args: Any, **kwargs: Any) -> Any:
        return _clean_call(executor, args, kwargs, {
            "minimax_h3_ffn_chunks": chunks,
            "minimax_h3_ffn_threshold": int(seq_threshold),
        })

    patcher.add_wrapper_with_key(
        comfy.patcher_extension.WrappersMP.DIFFUSION_MODEL,
        f"minimax_creator_chunk_ffn_{chunks}_{seq_threshold}",
        custom_ffn_wrapper,
    )
    return patcher


class MiniMaxChunkFeedForward(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MiniMaxChunkFeedForward",
            display_name="MiniMax H3 Chunk FeedForward",
            category="MiniMax/acceleration",
            description="Chunks Feed-Forward Network (FFN) activations along the sequence length dimension to prevent peak memory allocation crashes.",
            inputs=[
                io.Model.Input("model"),
                io.Int.Input("chunks", default=2, min=1, max=8, step=1,
                             tooltip="Number of sequential chunks to evaluate FFN projections in."),
                io.Int.Input("seq_threshold", default=4096, min=256, max=65536, step=256,
                             tooltip="Sequence token threshold above which FFN chunking activates."),
            ],
            outputs=[
                io.Model.Output("model", display_name="MODEL"),
            ],
        )

    @classmethod
    def execute(cls, model: Any, chunks: int = 2, seq_threshold: int = 4096) -> io.NodeOutput:
        patched = patch_minimax_chunk_ffn(model, chunks, seq_threshold)
        return io.NodeOutput(patched)


NODES = [MiniMaxLowVRAMAttention, MiniMaxChunkFeedForward]