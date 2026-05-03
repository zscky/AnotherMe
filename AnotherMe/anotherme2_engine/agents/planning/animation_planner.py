"""
动画规划器 - 将脚本步骤转换为结构化动画计划，供代码生成器使用
"""
import re
from typing import Any, Dict, List


class AnimationPlanner:
    """把脚本步骤转换为结构化动画计划，供 codegen 使用。"""

    def plan_step(
        self,
        step: Any,
        step_scene: Dict[str, Any],
        time_offset: float,
    ) -> Dict[str, Any]:
        
        duration = float(step.audio_duration) if step.audio_duration else float(step.duration) # 以音频时长为准，若无则用默认时长
        formula_items = self._extract_formula_items(step) # 公式区可显示公式与描述文本
        reset_formula_area = self._should_reset_formula_area(step)

        actions: List[Dict[str, Any]] = [
            {
                "type": "add_sound",
                "audio_file": step.audio_file,
                "time_offset": 0.0,
                "global_time_offset": round(time_offset, 2),
            }
        ]
        actions.extend(step_scene.get("operations", []))

        if formula_items:
            actions.append({
                "type": "show_formula",
                "items": formula_items,
                "reset_formula_area": reset_formula_area,
            })

        if step_scene.get("focus_entities"):
            actions.append({
                "type": "focus_entities",
                "targets": step_scene["focus_entities"],
            })

        actions.append({
            "type": "align_audio_duration",
            "duration": duration,
        })

        return {
            "step_id": step.id,
            "title": step.title,
            "duration": duration,
            "time_offset": 0.0,
            "global_time_offset": round(time_offset, 2),
            "focus_entities": step_scene.get("focus_entities", []),
            "formula_items": formula_items,
            "reset_formula_area": reset_formula_area,
            "actions": actions,
            "codegen_notes": self._build_codegen_notes(step, step_scene, formula_items),
        }

    def _extract_formula_items(self, step: Any) -> List[str]:
        max_items = 6

        spoken_formulas = self._extract_from_spoken_formulas(getattr(step, "spoken_formulas", []) or [])

        # 优先使用脚本侧结构化屏幕文案（允许描述性文字进入公式区）
        on_screen_items = getattr(step, "on_screen_texts", []) or []
        prioritized = self._extract_from_on_screen_texts(on_screen_items)

        if spoken_formulas:
            merged = list(spoken_formulas)
            seen = {item for item in merged}
            for item in prioritized:
                if item not in seen:
                    seen.add(item)
                    merged.append(item)

            # spoken_formulas 不足时补充旁白/视觉中可识别的公式片段。
            extras: List[str] = []
            texts = [step.title, *step.visual_cues, step.narration]
            for text in texts:
                if not text:
                    continue
                for match in self._extract_formula_fragments(str(text)):
                    cleaned = self._normalize_formula_candidate(match)
                    if not cleaned or cleaned in seen:
                        continue
                    seen.add(cleaned)
                    extras.append(cleaned)
            return (merged + extras)[:max_items]

        if prioritized:
            # 若结构化文案较少，补充从旁白/视觉中抽取到的公式片段，避免单幕信息过少。
            seen = {item for item in prioritized}
            extras: List[str] = []
            texts = [step.title, *step.visual_cues, step.narration]
            for text in texts:
                if not text:
                    continue
                for match in self._extract_formula_fragments(str(text)):
                    cleaned = self._normalize_formula_candidate(match)
                    if not cleaned or cleaned in seen:
                        continue
                    seen.add(cleaned)
                    extras.append(cleaned)
            return (prioritized + extras)[:max_items]

        # 兜底：兼容旧脚本，仅从标题/视觉/旁白中提取公式样式文本
        candidates: List[str] = []
        seen = set()
        texts = [step.title, *step.visual_cues, step.narration]

        for text in texts:
            if not text:
                continue
            for match in self._extract_formula_fragments(str(text)):
                cleaned = self._normalize_formula_candidate(match)
                if not cleaned or cleaned in seen:
                    continue
                seen.add(cleaned)
                candidates.append(cleaned)

        return candidates[:max_items]

    def _extract_from_spoken_formulas(self, items: Any) -> List[str]:
        if not isinstance(items, list):
            return []
        result: List[str] = []
        seen = set()
        for item in items:
            if isinstance(item, dict):
                text = str(item.get("latex") or item.get("text") or "").strip()
            else:
                text = str(item).strip()
            cleaned = self._normalize_display_text(text)
            if not cleaned or cleaned in seen:
                continue
            seen.add(cleaned)
            result.append(cleaned)
        return result

    def _extract_from_on_screen_texts(self, items: List[Dict[str, Any]]) -> List[str]:
        scored: List[tuple] = []
        for idx, item in enumerate(items):
            if not isinstance(item, dict):
                continue

            target_area = str(item.get("target_area", "formula_area")).strip() or "formula_area"
            if target_area != "formula_area":
                continue

            text = str(item.get("text", "")).strip()
            if not text:
                continue

            kind = str(item.get("kind", "description")).strip().lower() or "description"
            # 右侧区展示优先级：标题/结论 > 公式 > 描述 > 其他
            if kind in {"title", "conclusion"}:
                priority = 0
            elif kind == "formula":
                priority = 1
            elif kind == "description":
                priority = 2
            else:
                priority = 3

            scored.append((priority, idx, self._normalize_display_text(text)))

        scored.sort(key=lambda x: (x[0], x[1]))
        result: List[str] = []
        seen = set()
        for _, _, text in scored:
            if not text or text in seen:
                continue
            seen.add(text)
            result.append(text)
        return result

    def _normalize_display_text(self, text: str) -> str:
        cleaned = re.sub(r"\s+", " ", text.strip(" ，。；：,."))
        if not cleaned:
            return ""
        if len(cleaned) > 64:
            return cleaned[:64]
        return cleaned

    def _extract_formula_fragments(self, text: str) -> List[str]:
        patterns = [
            re.compile(r"[A-Za-z0-9'()\^²√+\-=/×·<>]{3,}\s*=\s*[A-Za-z0-9'()\^²√+\-=/×·<>]+(?:\s*[A-Za-z0-9'()\^²√+\-=/×·<>]+)*"),
            re.compile(r"\([A-Za-z0-9'()\^²√+\-=/×·<> ]+\)\s*=\s*[A-Za-z0-9'()\^²√+\-=/×·<> ]+"),
            re.compile(r"\b\d+(?:\.\d+)?\s*[-+]\s*[A-Za-z]\b"),
            re.compile(r"\b[A-Za-z]{1,3}'?\s*=\s*\d+(?:\.\d+)?\s*cm(?:²)?\b", re.IGNORECASE),
        ]

        matches: List[str] = []
        for pattern in patterns:
            matches.extend(pattern.findall(text))
        return matches

    def _normalize_formula_candidate(self, text: str) -> str:
        cleaned = re.sub(r"\s+", " ", text.strip(" ，。；：,."))
        if not cleaned:
            return ""
        if re.search(r"[\u4e00-\u9fff]", cleaned):
            return ""
        if re.fullmatch(r"\d+(?:\.\d+)?\s*cm(?:²)?", cleaned, flags=re.IGNORECASE):
            return ""
        if len(cleaned) < 3 or len(cleaned) > 48:
            return ""
        if not any(token in cleaned for token in ["=", "+", "-", "√", "²", "×", "/", "cm"]):
            return ""
        if re.fullmatch(r"[A-Za-z]+'?", cleaned):
            return ""
        return cleaned

    def _should_reset_formula_area(self, step: Any) -> bool:
        text = " ".join([step.title, step.narration, " ".join(step.visual_cues)])
        return any(keyword in text for keyword in ["接下来", "重新整理", "总结", "最终", "因此"])

    def _build_codegen_notes(
        self,
        step: Any,
        step_scene: Dict[str, Any],
        formula_items: List[str],
    ) -> List[str]:
        notes = ["优先复用已有几何对象，不要重新创建整张题图"]
        if step_scene.get("focus_entities"):
            notes.append(f"本步骤重点对象：{', '.join(step_scene['focus_entities'])}")
        if formula_items:
            notes.append("右侧文字区只显示当前步骤所需内容（可含公式与描述文字），并遵守布局器返回的位置")
        if any(op.get("type") == "transform" for op in step_scene.get("operations", [])):
            notes.append("若涉及折叠/旋转，使用同一对象做变换，不新建重复图元")
        return notes
