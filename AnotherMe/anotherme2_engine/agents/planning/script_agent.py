"""
脚本智能体 - 负责生成解题视频的脚本
直接使用视觉工具分析图片，无需中间层
"""
import json
import re
from typing import Dict, Any, Optional, List
from langchain_core.messages import HumanMessage, SystemMessage

from ..foundation.base_agent import BaseAgent
from ..foundation.state import ScriptStep, VideoProject
from ..perception.vision_tool import VisionTool


class ScriptAgent(BaseAgent):
    """脚本智能体"""

    SYSTEM_PROMPT = """你是一个专业的教育视频脚本作家，专门制作数学解题视频。

你的任务是根据数学题目（文字 + 图片分析），生成详细的视频脚本。

输出格式必须是严格的 JSON：
{
    "steps": [
        {
            "id": 1,
            "title": "步骤标题",
            "duration": 5.0,
            "narration": "旁白文案",
            "visual_cues": ["视觉元素 1", "视觉元素 2"],
            "on_screen_texts": [
                {
                    "text": "屏幕上展示的文字（可为描述性文字或公式）",
                    "kind": "description",
                    "target_area": "formula_area"
                }
            ],
            "spoken_formulas": ["AB=BC"],
            "visible_segments": ["AB", "BC", "DE"],
            "required_actions": [
                {"type": "show_segment", "target": "DE"},
                {"type": "highlight_segment", "target": "DE"}
            ],
            "auxiliary_line_actions": [
                {
                    "action": "draw_perpendicular_auxiliary",
                    "from": "P",
                    "to_line": "seg_AB",
                    "foot": "H",
                    "reason": "point_to_line_distance",
                    "persist": "until_step_end"
                }
            ],
            "animation_policy": "auto"
        }
    ],
    "total_duration": 30.0
}

【辅助线动作规范 - 重要】：
当解题需要添加辅助线时，必须在 auxiliary_line_actions 中明确指定，不要只写在 visual_cues 里。

支持的辅助线类型：
1. draw_perpendicular_auxiliary - 作垂线
   必填字段：from（起点）, to_line（目标线段）, foot（垂足）, reason
   适用场景：求点到直线距离、构造高线、证明垂直关系

2. draw_connection_auxiliary - 连接两点
   必填字段：from（起点）, to（终点）, reason
   适用场景：构造三角形、连接关键点、证明全等/相似

3. connect_center_tangent - 连接圆心与切点
   必填字段：from（圆心）, to（切点）, reason
   适用场景：切线问题、证明半径垂直切线

4. draw_parallel_auxiliary - 作平行线
   必填字段：from（经过的点）, to_line（平行于哪条线）, reason
   适用场景：平行线分线段成比例、相似三角形

5. extend_segment - 延长线段
   必填字段：segment（线段ID）, from_endpoint（从哪个端点延长）, length_factor（延长倍数）, reason
   适用场景：构造全等三角形、补全图形

persist 字段说明：
- "until_step_end"：辅助线在本步骤结束后淡出（临时辅助线）
- "until_video_end"：辅助线持续到视频结束（重要构造线）

reason 字段示例：
- "point_to_line_distance"：点到直线距离
- "construct_altitude"：构造高线
- "prove_congruent"：证明全等
- "prove_similar"：证明相似
- "tangent_radius"：切线半径关系
- "fold_image_distance"：折叠问题像点距离"""

    def __init__(self, config: Dict[str, Any], llm: Optional[Any] = None,
                 vision_tool: Optional[VisionTool] = None):
        super().__init__(config, llm)
        self.system_prompt = config.get("system_prompt", self.SYSTEM_PROMPT)
        self.vision_tool = vision_tool

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """
        处理状态，生成脚本
        直接使用视觉工具分析图片
        """
        print("\n[ScriptAgent] 开始生成脚本...")

        project = state["project"]
        if getattr(project, "status", "") == "failed":
            return state
        problem_text = project.problem_text
        image_path = project.problem_image

        print(f"[ScriptAgent] 题目文字：{problem_text[:50] if problem_text else '无'}...")
        print(f"[ScriptAgent] 图片路径：{image_path}")

        # 构建提示词：优先使用 VisionAgent 产出的结构化图信息
        metadata = state.get("metadata", {})
        semantic_graph = metadata.get("semantic_graph") or metadata.get("scene_graph")
        drawable_scene = metadata.get("drawable_scene")
        geometry_graph = metadata.get("geometry_graph")
        adaptive_plan = metadata.get("adaptive_plan") if isinstance(metadata.get("adaptive_plan"), dict) else {}
        learner_profile = metadata.get("learner_profile") if isinstance(metadata.get("learner_profile"), dict) else {}

        semantic_graph_text = self._format_structured_geometry_for_prompt(semantic_graph)
        drawable_scene_text = self._format_structured_geometry_for_prompt(drawable_scene)
        geometry_graph_text = self._format_structured_geometry_for_prompt(geometry_graph)
        known_entities_text = ", ".join(self._collect_known_entities(semantic_graph, drawable_scene))
        adaptive_prompt = self._build_adaptive_prompt(adaptive_plan, learner_profile)

        # 回退路径：若结构化信息缺失，再调用视觉描述
        geometry_info = ""
        if not semantic_graph_text and image_path and self.vision_tool:
            geometry_info = self.vision_tool.describe_geometry(image_path)

        if semantic_graph_text or drawable_scene_text or geometry_graph_text or geometry_info:
            user_prompt = f"""请为以下数学题目生成视频脚本：

题目文字：{problem_text}

Semantic Graph（语义层，只表示实体和关系，不表示坐标真值）：
{semantic_graph_text}

Drawable Scene（绘图层；如果 layout_mode=schematic_fallback，则它只是示意布局）：
{drawable_scene_text}

Geometry Graph（节点/边关系图，辅助约束）：
{geometry_graph_text}

图形文字描述（仅兜底参考）：
{geometry_info}

请生成详细的视频脚本，包括解题步骤、旁白文案、视觉描述和屏幕展示文字。
要求：步骤中的视觉变化应围绕同一题图对象逐步推进，不要每一步都把整图重画。
当前已知可引用实体：{known_entities_text}"""
        else:
            user_prompt = f"""请为以下数学题目生成视频脚本：

题目：{problem_text}

请生成详细的视频脚本。"""

        if adaptive_prompt:
            user_prompt += f"""

    学情自适应策略（必须执行）：
    {adaptive_prompt}"""

        user_prompt += """

额外强约束：
1) 输出必须是严格 JSON，不要附加解释。
2) 每个步骤都要同时提供 narration（音频讲解）和 on_screen_texts（动画展示文字）。
3) on_screen_texts 中允许描述性文字，不仅是公式。
4) target_area 可用值：formula_area、geometry_area；默认使用 formula_area。
5) on_screen_texts 每步建议 1-3 条，单条尽量简洁。
6) 不要发明题图中不存在的新点、新线、新圆或新辅助对象；若确实需要构造新对象，必须在 narration 和 visual_cues 中明确写出"作.../构造..."。
7) spoken_formulas 要覆盖本步音频里提到且应上屏的公式（可为空数组）。
8) visible_segments 只写当前步骤允许显示的线段（如 AB、DE；可为空数组）。
9) required_actions 是本步必须执行的几何动作（可为空数组）；animation_policy 可选 auto/required/none。
10) 【辅助线规范】当解题需要添加辅助线时，必须在 auxiliary_line_actions 中明确指定：
    - 必填字段：action, reason
    - 垂线：from, to_line, foot
    - 连线：from, to
    - 圆心切点：from（圆心）, to（切点）
    - persist 可选值：until_step_end（临时）, until_video_end（持久）
    - 不要只把辅助线写在 visual_cues 里，必须结构化声明"""

        # 调用 LLM
        messages = self._format_messages(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt
        )

        response_content = self._invoke_llm(messages)

        # 解析 JSON 响应
        script_data = self._parse_json_response(response_content)

        # 转换为 ScriptStep 对象
        script_steps = []
        for step_data in script_data.get("steps", []):
            on_screen_texts = self._normalize_on_screen_texts(step_data.get("on_screen_texts", []))
            spoken_formulas = self._normalize_spoken_formulas(
                step_data.get("spoken_formulas", []),
                on_screen_texts=on_screen_texts,
                narration=step_data.get("narration", ""),
                visual_cues=step_data.get("visual_cues", []),
                title=step_data.get("title", ""),
            )
            visible_segments = self._normalize_visible_segments(
                step_data.get("visible_segments", []),
                narration=step_data.get("narration", ""),
                visual_cues=step_data.get("visual_cues", []),
                title=step_data.get("title", ""),
            )
            required_actions = self._normalize_required_actions(step_data.get("required_actions", []))
            animation_policy = self._normalize_animation_policy(step_data.get("animation_policy", "auto"))
            auxiliary_line_actions = self._normalize_auxiliary_line_actions(step_data.get("auxiliary_line_actions", []))
            step = ScriptStep(
                id=step_data["id"],
                title=step_data["title"],
                duration=step_data["duration"],
                narration=step_data["narration"],
                visual_cues=step_data.get("visual_cues", []),
                on_screen_texts=on_screen_texts,
                spoken_formulas=spoken_formulas,
                visible_segments=visible_segments,
                required_actions=required_actions,
                auxiliary_line_actions=auxiliary_line_actions,
                animation_policy=animation_policy,
            )
            script_steps.append(step)

        # 更新项目状态
        project.script_steps = script_steps
        project.total_duration = script_data.get("total_duration", 0.0)

        state["project"] = project
        state["current_step"] = "script_completed"
        state["messages"].append({
            "role": "assistant",
            "content": f"脚本生成完成，共 {len(script_steps)} 个步骤"
        })

        return state

    def _build_adaptive_prompt(self, adaptive_plan: Dict[str, Any], learner_profile: Dict[str, Any]) -> str:
        if not adaptive_plan:
            return ""

        mode = str(adaptive_plan.get("mode", "standard") or "standard")
        review_seconds = int(adaptive_plan.get("review_duration_seconds", 0) or 0)
        skip_basic = bool(adaptive_plan.get("skip_basic_definition", False))
        inject_challenge = bool(adaptive_plan.get("inject_challenge_variant", False))
        analogy_mode = bool(adaptive_plan.get("analogy_mode", False))
        analogy_domain = str(adaptive_plan.get("analogy_domain", "") or "").strip()

        weak_points: List[str] = []
        for item in adaptive_plan.get("review_points", []) or []:
            if not isinstance(item, dict):
                continue
            kp = str(item.get("knowledge", "")).strip()
            if kp:
                weak_points.append(kp)

        learner_grade = learner_profile.get("grade", "unknown")
        required_mastery_avg = self._safe_float(adaptive_plan.get("required_mastery_avg", 0.5), 0.5)
        prerequisite_mastery_avg = self._safe_float(adaptive_plan.get("prerequisite_mastery_avg", 0.5), 0.5)

        lines = [
            f"- 当前模式: {mode}",
            f"- 学生年级: {learner_grade}",
            f"- 目标知识平均掌握度: {required_mastery_avg:.2f}",
            f"- 前置知识平均掌握度: {prerequisite_mastery_avg:.2f}",
        ]

        if weak_points:
            lines.append(f"- 优先补齐薄弱点: {', '.join(weak_points)}")

        if mode == "remedial":
            lines.append(f"- 开头必须插入约 {max(20, review_seconds)}~40 秒前置复习，先讲薄弱前置再解题")
            lines.append("- 每步旁白更慢、更短句，关键结论重复一次")
            lines.append("- visual_cues 中加入明确视觉支架提示，例如：高亮辅助线/关键点闪烁/步骤编号")
        elif mode == "advanced":
            lines.append("- 跳过基础定义，直接进入解题结构、变式与迁移")
            lines.append("- 至少追加一个思维拔高点或反例提醒")
        else:
            lines.append("- 保持标准讲解节奏，关键步骤保留必要解释")

        if skip_basic:
            lines.append("- 避免重复基础概念定义")
        if inject_challenge:
            lines.append("- 在结尾加入一个简短变式挑战")

        if analogy_mode and analogy_domain:
            lines.append(f"- 优先采用 {analogy_domain} 类比来解释数学关系（不改变数学严谨性）")

        return "\n".join(lines)

    def _safe_float(self, value: Any, default: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def _parse_json_response(self, response: str) -> Dict[str, Any]:
        """解析 LLM 返回的 JSON 响应"""
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        json_pattern = r'\{[\s\S]*\}'
        match = re.search(json_pattern, response)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass

        return {"steps": [], "total_duration": 0.0}

    def _format_structured_geometry_for_prompt(self, data: Optional[Dict[str, Any]]) -> str:
        """将结构化几何数据转为可读文本。"""
        if not data:
            return ""
        try:
            return json.dumps(data, ensure_ascii=False, indent=2)
        except Exception:
            return str(data)

    def _normalize_on_screen_texts(self, items: Any) -> List[Dict[str, str]]:
        """标准化 on_screen_texts，兼容字符串列表与对象列表。"""
        normalized: List[Dict[str, str]] = []
        if not isinstance(items, list):
            return normalized

        for item in items:
            if isinstance(item, str):
                text = item.strip()
                if not text:
                    continue
                normalized.append({
                    "text": text,
                    "kind": "description",
                    "target_area": "formula_area",
                })
                continue

            if not isinstance(item, dict):
                continue

            text = str(item.get("text", "")).strip()
            if not text:
                continue

            kind = str(item.get("kind", "description")).strip() or "description"
            target_area = str(item.get("target_area", "formula_area")).strip() or "formula_area"
            if target_area not in {"formula_area", "geometry_area"}:
                target_area = "formula_area"

            normalized.append({
                "text": text,
                "kind": kind,
                "target_area": target_area,
            })

        return normalized

    def _collect_known_entities(
        self,
        semantic_graph: Optional[Dict[str, Any]],
        drawable_scene: Optional[Dict[str, Any]],
    ) -> List[str]:
        entity_ids = set()
        for source in (semantic_graph or {}, drawable_scene or {}):
            points = source.get("points") or {}
            if isinstance(points, dict):
                entity_ids.update(str(item) for item in points.keys())
            elif isinstance(points, list):
                entity_ids.update(
                    str(item.get("id"))
                    for item in points
                    if isinstance(item, dict) and item.get("id")
                )

            for bucket in ("lines", "objects", "angles", "primitives"):
                for item in source.get(bucket, []) or []:
                    if isinstance(item, dict) and item.get("id"):
                        entity_ids.add(str(item.get("id")))

        return sorted(item for item in entity_ids if item)

    def _normalize_spoken_formulas(
        self,
        value: Any,
        *,
        on_screen_texts: List[Dict[str, str]],
        narration: Any,
        visual_cues: Any,
        title: Any,
    ) -> List[str]:
        candidates: List[str] = []

        if isinstance(value, str):
            token = value.strip()
            if token:
                candidates.append(token)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    token = str(item.get("latex") or item.get("text") or "").strip()
                else:
                    token = str(item).strip()
                if token:
                    candidates.append(token)

        for item in on_screen_texts:
            if not isinstance(item, dict):
                continue
            if str(item.get("target_area", "formula_area")).strip() != "formula_area":
                continue
            token = str(item.get("text", "")).strip()
            if token and self._looks_like_formula(token):
                candidates.append(token)

        texts = [str(title or ""), str(narration or "")]
        texts.extend(str(cue or "") for cue in (visual_cues or []))
        for text in texts:
            candidates.extend(self._extract_formula_candidates_from_text(text))

        return self._dedupe_preserve_order(candidates)[:6]

    def _normalize_visible_segments(
        self,
        value: Any,
        *,
        narration: Any,
        visual_cues: Any,
        title: Any,
    ) -> List[str]:
        tokens: List[str] = []

        if isinstance(value, str):
            tokens.extend(re.split(r"[\s,，;；|/]+", value))
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    token = str(item.get("segment") or item.get("target") or "").strip()
                    if token:
                        tokens.append(token)
                else:
                    token = str(item).strip()
                    if token:
                        tokens.append(token)

        text_blob = " ".join(
            [str(title or ""), str(narration or ""), " ".join(str(cue or "") for cue in (visual_cues or []))]
        )
        # 避免把“3 cm”中的单位误识别成线段（如 CM）。
        for match in re.findall(
            r"(?<!\d\s)(?<![A-Za-z0-9_'])([A-Za-z]\d*['′]?\s*[A-Za-z]\d*['′]?)(?![A-Za-z0-9_'])",
            text_blob,
        ):
            tokens.append(match)

        normalized: List[str] = []
        for token in tokens:
            segment = self._normalize_segment_token(token)
            if segment:
                normalized.append(segment)
        return self._dedupe_preserve_order(normalized)[:10]

    def _normalize_required_actions(self, value: Any) -> List[Dict[str, Any]]:
        if not isinstance(value, list):
            return []

        normalized: List[Dict[str, Any]] = []
        for item in value:
            if not isinstance(item, dict):
                continue
            action_type = str(item.get("type") or item.get("action") or "").strip()
            if not action_type:
                continue
            payload: Dict[str, Any] = {"type": action_type}
            target = item.get("target")
            targets = item.get("targets")
            if target is not None:
                payload["target"] = target
            if isinstance(targets, list):
                payload["targets"] = targets
            for key in ("axis", "from", "to", "to_line", "params", "at"):
                if key in item:
                    payload[key] = item[key]
            normalized.append(payload)
        return normalized[:8]

    def _normalize_auxiliary_line_actions(self, value: Any) -> List[Dict[str, Any]]:
        if not isinstance(value, list):
            return []

        VALID_ACTIONS = {
            "draw_perpendicular_auxiliary",
            "draw_connection_auxiliary",
            "connect_center_tangent",
            "draw_parallel_auxiliary",
            "extend_segment",
        }

        normalized: List[Dict[str, Any]] = []
        for item in value:
            if not isinstance(item, dict):
                continue
            action = str(item.get("action") or item.get("type") or "").strip()
            if not action or action not in VALID_ACTIONS:
                continue

            payload: Dict[str, Any] = {
                "action": action,
                "id": str(item.get("id") or f"aux_{len(normalized) + 1}").strip(),
            }

            from_point = str(item.get("from") or "").strip()
            to_point = str(item.get("to") or "").strip()
            to_line = str(item.get("to_line") or "").strip()
            foot = str(item.get("foot") or "").strip()
            reason = str(item.get("reason") or "").strip()
            persist = str(item.get("persist") or "until_step_end").strip()

            if from_point:
                payload["from"] = from_point
            if to_point:
                payload["to"] = to_point
            if to_line:
                payload["to_line"] = to_line
            if foot:
                payload["foot"] = foot
            if reason:
                payload["reason"] = reason
            if persist in {"until_step_end", "until_video_end"}:
                payload["persist"] = persist
            else:
                payload["persist"] = "until_step_end"

            style_payload: Dict[str, Any] = {}
            if isinstance(item.get("style"), dict):
                style = item.get("style")
                if str(style.get("dashed")).lower() in {"true", "1", "yes"}:
                    style_payload["dashed"] = True
                if style.get("color"):
                    style_payload["color"] = str(style.get("color")).strip()
                if style.get("stroke_width"):
                    try:
                        style_payload["stroke_width"] = float(style.get("stroke_width"))
                    except (TypeError, ValueError):
                        pass
            if style_payload:
                payload["style"] = style_payload

            normalized.append(payload)
        return normalized[:5]

    def _normalize_animation_policy(self, value: Any) -> str:
        token = str(value or "auto").strip().lower()
        if token in {"auto", "required", "none"}:
            return token
        return "auto"

    def _extract_formula_candidates_from_text(self, text: str) -> List[str]:
        if not text:
            return []
        patterns = [
            re.compile(r"[A-Za-z0-9'()\^²√+\-=/×·<>]{2,}\s*=\s*[A-Za-z0-9'()\^²√+\-=/×·<>]{1,}"),
            re.compile(r"\\?[A-Za-z]+\s*=\s*\\?[A-Za-z0-9]+"),
        ]
        results: List[str] = []
        for pattern in patterns:
            results.extend(match.strip(" ，。；：,. ") for match in pattern.findall(text))
        return [item for item in results if self._looks_like_formula(item)]

    def _looks_like_formula(self, text: str) -> bool:
        token = str(text or "").strip()
        if not token:
            return False
        return any(symbol in token for symbol in ["=", "+", "-", "√", "²", "×", "/", "^", "∠", "∥", "⊥"])

    def _normalize_segment_token(self, token: Any) -> str:
        raw = str(token or "").strip()
        if not raw:
            return ""
        if raw.lower().startswith("seg_"):
            raw = raw[4:]
        raw = raw.replace("′", "1").replace("'", "1").replace(" ", "")
        refs = re.findall(r"[A-Za-z]\d*", raw)
        if len(refs) == 2:
            a, b = refs[0].upper(), refs[1].upper()
            return "".join(sorted([a, b]))
        return ""

    def _dedupe_preserve_order(self, values: List[str]) -> List[str]:
        seen = set()
        result: List[str] = []
        for item in values:
            token = str(item or "").strip()
            if not token or token in seen:
                continue
            seen.add(token)
            result.append(token)
        return result
