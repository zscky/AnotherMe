"""Classify Manim render and preflight failures into stable error codes."""

from __future__ import annotations


def classify_render_error(error_text: str) -> str:
    text = str(error_text or "").lower()
    if not text.strip():
        return "UNKNOWN"

    if "syntaxerror" in text or "invalid syntax" in text or "expected an indented block" in text:
        return "PY_SYNTAX"

    if (
        "run_time of 0 <= 0 seconds" in text
        or "must be a positive number" in text
        or "audio duration mismatch" in text
        or "timing budget mismatch" in text
    ):
        return "INVALID_TIMING"

    if (
        "latex error converting to dvi" in text
        or "tex_mobject" in text
        or "unicode character" in text
        or "mathtex" in text
    ):
        return "LATEX_TEXT_INVALID"

    if (
        "invalid data found when processing input" in text
        or ".mp3" in text
        or ".wav" in text
        or ".m4a" in text
        or "audio" in text and "invalid" in text
    ):
        return "AUDIO_ASSET_INVALID"

    if (
        "outside formula area" in text
        or "left/right layout violation" in text
        or "layout overflow" in text
        or "out of frame" in text
    ):
        return "LAYOUT_OVERFLOW"

    if (
        "cannot be converted to an animation" in text
        or "unexpected argument" in text
        or "nameerror" in text
        or "attributeerror" in text
        or "typeerror" in text
        or "point(" in text
        or "is not defined" in text
    ):
        return "MANIM_API"

    return "UNKNOWN"
