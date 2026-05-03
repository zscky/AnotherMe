"""
Rule-based retrieval over Manim example templates and helper snippets.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from .template_helpers import helper_catalog


PRIMITIVE_KEYWORDS = {
    "circle": "circle",
    "polygon": "polygon",
    "line": "segment",
    "dashedline": "segment",
    "arrow": "segment",
    "arc": "arc",
    "angle(": "angle",
    "rightangle": "right_angle",
    "dot(": "point",
}

MOTION_KEYWORDS = {
    "transformfromcopy": "transform",
    "transform(": "transform",
    "replacementtransform": "transform",
    "rotate(": "rotation",
    ".shift(": "translation",
    "apply_matrix": "reflection",
    "homothety": "homothety",
    "indicate(": "highlight",
    "fadein(": "highlight",
    "create(": "highlight",
}

TAG_ALIASES = {
    "angle": {"angle", "angles", "bisector"},
    "circle": {"circle", "inscribed", "cyclic", "chord", "diameter", "arc"},
    "tangent": {"tangent", "secant"},
    "fold": {"fold", "reflection", "reflect"},
    "rotation": {"rotation", "rotate"},
    "translation": {"translation", "translate"},
    "homothety": {"homothety", "scaling", "scale"},
    "parallel": {"parallel"},
    "triangle": {"triangle", "equilateral", "isosceles"},
    "quadrilateral": {"quadrilateral", "parallelogram", "rectangle", "square", "trapezoid", "rhombus"},
}


@dataclass
class TemplateReference:
    id: str
    file_path: str
    snippet_name: str
    summary: str
    matched_tags: List[str]
    reason: str
    excerpt: str
    tags: List[str] = field(default_factory=list)
    primitives: List[str] = field(default_factory=list)
    motions: List[str] = field(default_factory=list)
    helpers: List[str] = field(default_factory=list)
    applicable_when: str = ""
    avoid_copying: str = ""
    snippet_regions: List[Dict[str, Any]] = field(default_factory=list)
    score: float = 0.0
    source_type: str = "template"

    def to_payload(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "file_path": self.file_path,
            "snippet_name": self.snippet_name,
            "summary": self.summary,
            "matched_tags": list(self.matched_tags),
            "reason": self.reason,
            "excerpt": self.excerpt,
            "tags": list(self.tags),
            "primitives": list(self.primitives),
            "motions": list(self.motions),
            "helpers": list(self.helpers),
            "applicable_when": self.applicable_when,
            "avoid_copying": self.avoid_copying,
            "snippet_regions": list(self.snippet_regions),
            "score": float(self.score),
            "source_type": self.source_type,
        }


class TemplateRetriever:
    """Retrieve relevant Manim templates as style references, not direct answers."""

    def __init__(
        self,
        template_dir: Optional[Path] = None,
        *,
        allow_full_scene_fallback: bool = True,
    ) -> None:
        engine_root = Path(__file__).resolve().parents[1]
        self.template_dir = Path(template_dir or (engine_root / "template" / "manim_templates"))
        self.allow_full_scene_fallback = bool(allow_full_scene_fallback)
        self._index: Optional[List[Dict[str, Any]]] = None

    def retrieve(self, query: Any, top_k: int = 3) -> List[TemplateReference]:
        query_info = self._normalize_query(query)
        entries = self._load_index()
        ranked: List[Tuple[float, Dict[str, Any], Dict[str, Any]]] = []
        for entry in entries:
            score, match_info = self._score_entry(entry, query_info)
            if score <= 0:
                continue
            ranked.append((score, entry, match_info))
        ranked.sort(key=lambda item: (-item[0], item[1]["template_id"]))

        if not ranked and self.allow_full_scene_fallback:
            ranked = self._fallback_rank(entries, query_info)

        results: List[TemplateReference] = []
        for score, entry, match_info in ranked[: max(1, int(top_k or 1))]:
            results.append(
                TemplateReference(
                    id=str(entry["template_id"]),
                    file_path=str(entry["file_path"]),
                    snippet_name=str(entry["scene_name"]),
                    summary=str(entry["summary"]),
                    matched_tags=list(match_info.get("matched_tags", [])),
                    reason=str(match_info.get("reason", "")),
                    excerpt=str(entry["excerpt"]),
                    tags=list(entry.get("tags", [])),
                    primitives=list(entry.get("primitives", [])),
                    motions=list(entry.get("motions", [])),
                    helpers=list(entry.get("helpers", [])),
                    applicable_when=str(entry.get("applicable_when", "")),
                    avoid_copying=str(entry.get("avoid_copying", "")),
                    snippet_regions=list(entry.get("snippet_regions", [])),
                    score=float(score),
                    source_type=str(entry.get("source_type", "template")),
                )
            )
        return results

    def _load_index(self) -> List[Dict[str, Any]]:
        if self._index is not None:
            return self._index

        entries: List[Dict[str, Any]] = []
        if self.template_dir.exists():
            for path in sorted(self.template_dir.glob("*.py")):
                entries.append(self._build_template_entry(path))
        for helper_entry in helper_catalog():
            entry = dict(helper_entry)
            entry["source_type"] = "helper"
            entries.append(entry)
        self._index = entries
        return self._index

    def _build_template_entry(self, path: Path) -> Dict[str, Any]:
        text = path.read_text(encoding="utf-8")
        scene_name = self._extract_scene_name(text, path.stem)
        helpers = sorted(set(re.findall(r"^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", text, flags=re.MULTILINE)))
        primitives = self._extract_primitives(text)
        motions = self._extract_motions(text)
        tags = self._extract_tags(path, text, primitives, motions)
        summary = self._build_summary(path, scene_name, tags, primitives, motions, helpers)
        applicable_when = self._build_applicable_when(tags, motions, helpers)
        excerpt = self._build_excerpt(text)
        snippet_regions = self._extract_snippet_regions(text, scene_name, helpers)
        return {
            "template_id": path.stem,
            "file_path": str(path.resolve()),
            "scene_name": scene_name,
            "summary": summary,
            "tags": tags,
            "primitives": primitives,
            "motions": motions,
            "helpers": helpers,
            "applicable_when": applicable_when,
            "avoid_copying": (
                "Use this as a style reference only. Do not copy coordinates, point names, theorem setup, "
                "or the full scene flow into a different problem."
            ),
            "snippet_regions": snippet_regions,
            "excerpt": excerpt,
            "source_type": "template",
        }

    def _normalize_query(self, query: Any) -> Dict[str, Any]:
        if isinstance(query, str):
            payload: Dict[str, Any] = {"summary": query}
        elif isinstance(query, dict):
            payload = query
        else:
            payload = {"summary": str(query)}

        summary = str(payload.get("summary", "")).strip()
        text_parts = [summary]
        for key in ("problem_text", "step_title", "narration"):
            value = str(payload.get(key, "")).strip()
            if value:
                text_parts.append(value)

        tags = self._normalize_string_items(payload.get("tags"))
        primitives = self._normalize_string_items(payload.get("primitives"))
        motions = self._normalize_string_items(payload.get("motions"))
        helpers = self._normalize_string_items(payload.get("helpers"))
        template_hints = self._normalize_string_items(payload.get("template_hints"))
        text = " ".join(text_parts).strip()
        text_tokens = self._tokenize(text)

        inferred_tags = set(tags)
        for token in list(text_tokens) + list(template_hints):
            lowered = token.lower()
            for alias_tag, aliases in TAG_ALIASES.items():
                if lowered in aliases or alias_tag in lowered:
                    inferred_tags.add(alias_tag)

        return {
            "summary": summary,
            "text": text,
            "text_tokens": text_tokens,
            "tags": sorted(inferred_tags),
            "primitives": primitives,
            "motions": motions,
            "helpers": helpers,
            "template_hints": template_hints,
        }

    def _score_entry(self, entry: Dict[str, Any], query: Dict[str, Any]) -> Tuple[float, Dict[str, Any]]:
        score = 0.0
        matched_tags: List[str] = []

        for field_name, weight in (
            ("tags", 3.0),
            ("primitives", 2.5),
            ("motions", 2.5),
            ("helpers", 2.0),
        ):
            entry_items = set(entry.get(field_name, []))
            query_items = set(query.get(field_name, []))
            overlap = sorted(entry_items & query_items)
            if overlap:
                score += weight * len(overlap)
                matched_tags.extend(overlap)

        entry_text = " ".join(
            [
                str(entry.get("template_id", "")),
                str(entry.get("scene_name", "")),
                str(entry.get("summary", "")),
                str(entry.get("applicable_when", "")),
            ]
        ).lower()
        for token in query.get("text_tokens", []):
            if token and token in entry_text:
                score += 0.6
                matched_tags.append(token)

        for hint in query.get("template_hints", []):
            if hint in entry_text:
                score += 1.0
                matched_tags.append(hint)

        matched_tags = sorted({item for item in matched_tags if item})
        if score <= 0:
            return 0.0, {"matched_tags": [], "reason": ""}

        reason_parts = []
        if matched_tags:
            reason_parts.append("matched " + ", ".join(matched_tags[:6]))
        if entry.get("helpers"):
            helper_overlap = sorted(set(entry.get("helpers", [])) & set(query.get("helpers", [])))
            if helper_overlap:
                reason_parts.append("helper " + ", ".join(helper_overlap))
        reason = "; ".join(reason_parts) or "matched style signals"
        return score, {"matched_tags": matched_tags, "reason": reason}

    def _fallback_rank(
        self,
        entries: Sequence[Dict[str, Any]],
        query: Dict[str, Any],
    ) -> List[Tuple[float, Dict[str, Any], Dict[str, Any]]]:
        ranked: List[Tuple[float, Dict[str, Any], Dict[str, Any]]] = []
        query_tokens = set(query.get("text_tokens", []))
        for entry in entries:
            entry_tokens = self._tokenize(
                " ".join(
                    [
                        str(entry.get("template_id", "")),
                        str(entry.get("scene_name", "")),
                        str(entry.get("summary", "")),
                    ]
                )
            )
            overlap = sorted(entry_tokens & query_tokens)
            if not overlap:
                continue
            ranked.append(
                (
                    float(len(overlap)),
                    entry,
                    {"matched_tags": overlap, "reason": "fallback token overlap: " + ", ".join(overlap[:6])},
                )
            )
        ranked.sort(key=lambda item: (-item[0], item[1]["template_id"]))
        return ranked

    @staticmethod
    def _extract_scene_name(text: str, fallback: str) -> str:
        match = re.search(r"class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*Scene[^)]*\)", text)
        return match.group(1) if match else fallback

    @staticmethod
    def _extract_primitives(text: str) -> List[str]:
        lowered = text.lower()
        primitives = set()
        for needle, primitive_name in PRIMITIVE_KEYWORDS.items():
            if needle in lowered:
                primitives.add(primitive_name)
        return sorted(primitives)

    @staticmethod
    def _extract_motions(text: str) -> List[str]:
        lowered = text.lower()
        motions = set()
        for needle, motion_name in MOTION_KEYWORDS.items():
            if needle in lowered:
                motions.add(motion_name)
        return sorted(motions)

    def _extract_tags(
        self,
        path: Path,
        text: str,
        primitives: Sequence[str],
        motions: Sequence[str],
    ) -> List[str]:
        tokens = set(self._tokenize(path.stem.replace("_", " ") + " " + text[:1200]))
        tags = set(primitives) | set(motions)
        for tag, aliases in TAG_ALIASES.items():
            if tag in tokens or any(alias in tokens for alias in aliases):
                tags.add(tag)
        if "tangent" in path.stem:
            tags.add("tangent")
        if "chord" in path.stem:
            tags.add("circle")
        return sorted(tags)

    @staticmethod
    def _build_summary(
        path: Path,
        scene_name: str,
        tags: Sequence[str],
        primitives: Sequence[str],
        motions: Sequence[str],
        helpers: Sequence[str],
    ) -> str:
        parts = [f"{scene_name} in {path.name}"]
        if tags:
            parts.append("tags: " + ", ".join(tags[:6]))
        if primitives:
            parts.append("primitives: " + ", ".join(primitives[:6]))
        if motions:
            parts.append("motions: " + ", ".join(motions[:6]))
        if helpers:
            parts.append("helpers: " + ", ".join(helpers[:4]))
        return "; ".join(parts)

    @staticmethod
    def _build_applicable_when(tags: Sequence[str], motions: Sequence[str], helpers: Sequence[str]) -> str:
        descriptors = list(tags[:4]) + list(motions[:3]) + list(helpers[:2])
        if not descriptors:
            return "Use when the current problem needs a similar Manim object organization pattern."
        return "Use when the current problem needs: " + ", ".join(descriptors) + "."

    @staticmethod
    def _build_excerpt(text: str, max_lines: int = 28) -> str:
        lines = text.splitlines()
        trimmed = lines[:max_lines]
        return "\n".join(trimmed).strip()

    @staticmethod
    def _extract_snippet_regions(text: str, scene_name: str, helpers: Sequence[str]) -> List[Dict[str, Any]]:
        regions: List[Dict[str, Any]] = []
        lines = text.splitlines()
        for index, line in enumerate(lines, start=1):
            helper_match = re.match(r"def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", line.strip())
            if helper_match and helper_match.group(1) in helpers:
                regions.append({"name": helper_match.group(1), "kind": "helper", "line": index})
            class_match = re.match(r"class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", line.strip())
            if class_match and class_match.group(1) == scene_name:
                regions.append({"name": scene_name, "kind": "scene", "line": index})
        return regions or [{"name": scene_name, "kind": "scene", "line": 1}]

    @staticmethod
    def _normalize_string_items(value: Any) -> List[str]:
        if value is None:
            return []
        if isinstance(value, str):
            items = re.split(r"[\s,;/|]+", value)
            return sorted({item.strip().lower() for item in items if item.strip()})
        if isinstance(value, Iterable):
            results: List[str] = []
            for item in value:
                results.extend(TemplateRetriever._normalize_string_items(item))
            return sorted(set(results))
        return [str(value).strip().lower()]

    @staticmethod
    def _tokenize(text: str) -> List[str]:
        return [token.lower() for token in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", text or "")]
