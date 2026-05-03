"""
动画智能体 - 负责生成 Manim 动画代码
直接使用视觉工具分析图片，获取图形信息
"""
import json
import re
from pathlib import Path
from typing import Dict, Any, Optional, List, Set, Tuple

from ..foundation.base_agent import BaseAgent
from ..foundation.state import VideoProject, ScriptStep
from ..perception.vision_tool import VisionTool
from ..planning.canvas_scene import CanvasScene
from ..planning.scene_graph_updater import SceneGraphUpdater
from ..planning.animation_planner import AnimationPlanner
from ..planning.teaching_ir import TeachingIRPlanner
from ..planning.problem_pattern import ProblemPatternClassifier
from ..planning.action_executability_checker import ActionExecutabilityChecker
from .case_replay_recorder import CaseReplayRecorder
from .codegen import TemplateCodeGenerator
from ..planning.template_retriever import TemplateRetriever
try:
    from output_paths import DEFAULT_OUTPUT_DIR
except ModuleNotFoundError:
    from anotherme2_engine.output_paths import DEFAULT_OUTPUT_DIR


class AnimationAgent(BaseAgent):
    """动画智能体"""

    SYSTEM_PROMPT = """你是一个专业的 Manim 动画工程师，专门制作数学解题动画。

你的任务是根据视频脚本和题目图片分析，生成完整的 Manim 动画代码。

要求：
1. 【强制】代码必须完整输出，绝对不能截断、省略或用省略号代替任何部分
2. 【强制】所有字符串必须正确闭合，所有括号、引号必须成对出现
3. 使用 Manim Community Edition 语法
4. 颜色搭配美观，适合教育视频
5. 背景色使用深色系 (#1a1a2e 或类似)
6. 不要使用 `font` 参数设置字体（会报错）
7. 优先使用 `Text` 而不是 `Tex`，避免 LaTeX 依赖问题
8. 不要设置全局字体配置
9. Text 内容中避免过长的字符串，超过 20 字的文本请拆分成多行
10. 【强制】run_time 必须是合法 Python 浮点数，例如 run_time=1.5，绝对不能写成 run_time=0.01.5 或 run_time=1.5.0 等多小数点形式

【音画同步要求 - 最重要】：
10. 每个步骤开头必须调用 self.add_sound(r"音频绝对路径", time_offset=0)
    示例：self.add_sound(r"D:/output/audio/narration_001.mp3", time_offset=0)
    说明：这里的 add_sound 放在“当前步骤真正开始执行的位置”，所以 time_offset 应该相对于当前步骤起点，而不是全局累计秒数
11. 每步内所有动画 run_time 之和 + self.wait() 时长，必须严格等于该步骤的音频时长
    - 在步骤末尾加 self.wait(剩余时间) 来对齐，剩余时间 = 音频时长 - 所有动画run_time之和
    - 若剩余时间 <= 0 则不加 wait()
12. 脚本中已列出每步的音频时长；若代码按步骤顺序生成，则每步 add_sound 的 time_offset 固定为 0

输出格式（只输出代码块，不要任何解释）：
```python
# 完整的 Manim 代码
```
"""

    def __init__(self, config: Dict[str, Any], llm: Optional[Any] = None,
                 vision_tool: Optional[VisionTool] = None):
        super().__init__(config, llm)
        self.system_prompt = config.get("system_prompt", self.SYSTEM_PROMPT)
        self.vision_tool = vision_tool
        self.scene_graph_updater = SceneGraphUpdater()
        self.animation_planner = AnimationPlanner()
        self.teaching_ir_planner = TeachingIRPlanner()
        self.problem_pattern_classifier = ProblemPatternClassifier()
        self.action_executability_checker = ActionExecutabilityChecker()
        self.case_replay_recorder = CaseReplayRecorder()
        self.use_template_codegen = bool(config.get("use_template_codegen", True))
        self.canvas_config = config.get("canvas_config", {
            "frame_height": 8.0,
            "frame_width": 14.222,
            "pixel_height": 1080,
            "pixel_width": 1920,
            "safe_margin": 0.4,
            "left_panel_x_max": 0.75,
            "right_panel_x_min": 1.8,
            "formula_max_visible_slots": 8,
            "formula_math_font_size": 24,
            "formula_text_font_size": 24,
        })
        self.layout = config.get("layout", "left_graph_right_formula")
        self.output_dir = Path(config.get("output_dir", str(DEFAULT_OUTPUT_DIR)))
        self.template_codegen = TemplateCodeGenerator(self.canvas_config)
        self.use_template_retrieval = bool(config.get("use_template_retrieval", True))
        self.template_retrieval_top_k = int(config.get("template_retrieval_top_k", 3))
        self.template_retrieval_mode = str(config.get("template_retrieval_mode", "component")).strip() or "component"
        self.template_retrieval_allow_full_scene_fallback = bool(
            config.get("template_retrieval_allow_full_scene_fallback", True)
        )
        self.prefer_conservative_on_complex = bool(config.get("prefer_conservative_on_complex", False))
        self.conservative_step_threshold = int(config.get("conservative_step_threshold", 6))
        self.export_incremental_codegen_debug = bool(
            config.get("export_incremental_codegen_debug", False)
        )
        self.template_retriever = TemplateRetriever(
            allow_full_scene_fallback=self.template_retrieval_allow_full_scene_fallback,
        )

    def _safe_step_id(self, raw_value: Any, fallback: int) -> int:
        if isinstance(raw_value, int):
            return raw_value
        try:
            return int(raw_value)
        except (TypeError, ValueError):
            pass
        text = str(raw_value or "").strip()
        match = re.search(r"\d+", text)
        if match:
            try:
                return int(match.group(0))
            except ValueError:
                pass
        return fallback

    def _build_animation_base_scene(
        self,
        coordinate_scene_data: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """构建动画初始题图：折叠后的派生点先停留在源点，真正移动由 step updater 完成。"""
        base_scene = json.loads(json.dumps(coordinate_scene_data or {}))
        points = base_scene.get("points", [])
        if not isinstance(points, list):
            return base_scene

        point_lookup = {
            str(item.get("id", "")).strip(): item
            for item in points
            if isinstance(item, dict) and item.get("id")
        }
        for item in points:
            if not isinstance(item, dict):
                continue
            derived = item.get("derived")
            if not isinstance(derived, dict):
                continue
            if str(derived.get("type", "")).strip().lower() != "reflect_point":
                continue
            source_id = str(derived.get("source", "")).strip()
            source_item = point_lookup.get(source_id)
            source_coord = source_item.get("coord") if isinstance(source_item, dict) else None
            if isinstance(source_coord, list) and len(source_coord) == 2:
                item["coord"] = [float(source_coord[0]), float(source_coord[1])]
        return base_scene

    def _export_step_debug_code(self, step_index: int, manim_code: str, mode_tag: str = "active") -> str:
        """将每步累计生成代码导出到 output/debug，便于检查循环生成链路。"""
        debug_dir = self.output_dir / "debug"
        debug_dir.mkdir(parents=True, exist_ok=True)
        safe_mode_tag = re.sub(r"[^a-zA-Z0-9_\-]", "_", mode_tag) or "active"
        file_path = debug_dir / f"step_{step_index:02d}_{safe_mode_tag}_manim.py"
        file_path.write_text(manim_code, encoding="utf-8")
        return str(file_path)

    def _layout_step_canvas(self, canvas_scene: CanvasScene, plan: Dict[str, Any]) -> Dict[str, Any]:
        """根据 planner 输出给当前步骤分配公式区布局。"""
        max_slots = max(1, int(self.canvas_config.get("formula_max_visible_slots", 8)))
        formula_items = (plan.get("formula_items", []) or [])[:max_slots] # 从计划中获取当前步骤需要展示的公式列表
        reserved_elements = []
        forced_formula_reset = False
        if formula_items:
            # 调用分局器分配位置
            requested_reset = True
            try:
                reserved_elements = canvas_scene.reserve_step_formula_blocks(
                    step_id=plan["step_id"],
                    formula_items=formula_items,
                    reset_formula_area=requested_reset,
                )
            except ValueError:
                # 公式区不足时清空重排，保证当前步骤有可用布局
                forced_formula_reset = True
                reserved_elements = canvas_scene.reserve_step_formula_blocks(
                    step_id=plan["step_id"],
                    formula_items=formula_items,
                    reset_formula_area=True,
                )

        return {
            "reserved_formula_elements": [
                {
                    "id": element.id,
                    "content": element.content,
                    "x": element.x,
                    "y": element.y,
                    "width": element.width,
                    "height": element.height,
                }
                for element in reserved_elements
            ],
            "force_formula_reset": forced_formula_reset,
            "snapshot": canvas_scene.get_layout_snapshot(),
        }

    def _format_script_for_prompt(self, steps: list) -> str:
        """将脚本格式化为提示词，包含音频同步信息"""
        lines = []
        cumulative = 0.0
        for step in steps:
            # 优先使用 TTS 实测时长，没有则用脚本预估时长
            dur = float(step.audio_duration) if step.audio_duration else float(step.duration)
            audio_path = (
                str(Path(step.audio_file).resolve()).replace("\\", "/")
                if step.audio_file else None
            )
            lines.append(f"步骤 {step.id}: {step.title}")
            lines.append(f"  本步骤在全片中的累计开始秒（仅作参考）：{cumulative:.2f}")
            lines.append("  add_sound time_offset（相对当前步骤起点）：0.00")
            if audio_path:
                lines.append(f"  音频文件路径：{audio_path}")
            lines.append(f"=此步骤动画总时长必须恰好为 {dur:.2f} 秒（所有run_time + wait()之和）")
            lines.append(f"  旁白：{step.narration}")
            lines.append(f"  视觉：{', '.join(step.visual_cues)}")
            if getattr(step, "on_screen_texts", None):
                display_items = [
                    str(item.get("text", "")).strip()
                    for item in step.on_screen_texts
                    if isinstance(item, dict) and str(item.get("text", "")).strip()
                ]
                if display_items:
                    lines.append(f"  屏幕文字：{' | '.join(display_items)}")
            lines.append("")
            cumulative += dur
        lines.append(f"所有步骤累计总时长：{cumulative:.2f} 秒")
        return "\n".join(lines)

    def _build_canvas_instructions(self) -> str:
        """构建画布尺寸与布局约束，显式告诉模型避免越界"""
        """只是提供一段提示词"""
        cfg = self.canvas_config
        return (
            f"- 必须在代码中设置: config.frame_height={cfg['frame_height']}, "
            f"config.frame_width={cfg['frame_width']}, "
            f"config.pixel_height={cfg['pixel_height']}, "
            f"config.pixel_width={cfg['pixel_width']}\n"
            f"- 安全边距至少 {cfg['safe_margin']}，所有元素必须留在可见区域内，不得超出画布\n"
            f"- 布局模式: {self.layout}\n"
            f"- 左侧图形区: x <= {cfg['left_panel_x_max']}，几何图形与点线标注都放左侧\n"
            f"- 右侧文字区: x >= {cfg['right_panel_x_min']}，可放公式和描述性文字\n"
            f"- 右侧文字区一次最多显示 {int(cfg.get('formula_max_visible_slots', 8))} 条公式，且严格不重叠\n"
            "- 右侧公式字号统一并适当减小，避免同屏公式大小不一致\n"
            "- 右侧文字区使用 VGroup(...).arrange(DOWN, aligned_edge=LEFT) 并固定在右侧，避免与图形重叠"
        )

    def _format_scene_graph_for_prompt(self, scene_graph: Dict[str, Any]) -> str:
        """将 scene graph 序列化为提示词文本。"""
        try:
            return json.dumps(scene_graph, ensure_ascii=False, indent=2)
        except Exception:
            return str(scene_graph)

    def _extract_code_block(self, text: str) -> str:
        """从响应中提取代码块"""
        text = text.strip()

        # 方法 1: 正则提取 ```python 块
        code_pattern = r'```python\s*([\s\S]*?)\s*```'
        match = re.search(code_pattern, text)
        if match:
            code = match.group(1).strip()
            # 递归清理可能嵌套的代码块
            if code.startswith('```'):
                return self._extract_code_block(code)
            return code

        # 方法 2: 提取 ``` 块（不带语言标记）
        code_pattern = r'```\s*([\s\S]*?)\s*```'
        match = re.search(code_pattern, text)
        if match:
            code = match.group(1).strip()
            if code.startswith('```'):
                return self._extract_code_block(code)
            return code

        # 方法 3: 暴力清理 - 删除所有 ``` 行
        lines = text.split('\n')
        cleaned_lines = [l for l in lines if not l.strip().startswith('```')]
        cleaned = '\n'.join(cleaned_lines).strip()

        # 检查是否包含有效的 Python 代码
        if cleaned.startswith('from manim') or cleaned.startswith('import manim'):
            return cleaned

        # 返回清理后的结果
        return cleaned

    def _collect_known_entities(
        self,
        drawable_scene: Optional[Dict[str, Any]],
        semantic_graph: Optional[Dict[str, Any]],
    ) -> List[str]:
        entity_ids = set()
        for source in (drawable_scene or {}, semantic_graph or {}):
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

    def _has_drawable_geometry(self, drawable_scene: Optional[Dict[str, Any]]) -> bool:
        if not isinstance(drawable_scene, dict):
            return False
        points = drawable_scene.get("points")
        if isinstance(points, dict):
            has_points = any(
                isinstance(payload, dict) and (payload.get("coord") or payload.get("pos"))
                for payload in points.values()
            )
        elif isinstance(points, list):
            has_points = any(
                isinstance(payload, dict) and payload.get("coord")
                for payload in points
            )
        else:
            has_points = False
        if not has_points:
            return False
        primitives = drawable_scene.get("primitives") or []
        if any(
            isinstance(item, dict) and str(item.get("type", "")).strip()
            for item in primitives
        ):
            return True
        for bucket in ("lines", "objects", "angles", "circles", "arcs", "segments", "polygons"):
            items = drawable_scene.get(bucket)
            if isinstance(items, list) and bool(items):
                return True
        return False

    def _scene_point_ids(self, scene: Optional[Dict[str, Any]]) -> Set[str]:
        if not isinstance(scene, dict):
            return set()
        points = scene.get("points")
        if isinstance(points, dict):
            return {str(key) for key in points.keys() if str(key).strip()}
        if isinstance(points, list):
            return {
                str(item.get("id"))
                for item in points
                if isinstance(item, dict) and str(item.get("id", "")).strip()
            }
        return set()

    def _scene_points(self, scene: Optional[Dict[str, Any]]) -> Dict[str, List[float]]:
        """提取当前 scene 中可用于位移动画比对的点坐标。"""
        result: Dict[str, List[float]] = {}
        if not isinstance(scene, dict):
            return result

        points = scene.get("points", {})
        if isinstance(points, dict):
            for point_id, payload in points.items():
                if not isinstance(payload, dict):
                    continue
                coord = payload.get("coord")
                pos = coord if isinstance(coord, list) and len(coord) == 2 else payload.get("pos")
                if not isinstance(pos, list) or len(pos) != 2:
                    continue
                try:
                    result[str(point_id)] = [float(pos[0]), float(pos[1])]
                except (TypeError, ValueError):
                    continue
            return result

        if isinstance(points, list):
            for item in points:
                if not isinstance(item, dict):
                    continue
                point_id = str(item.get("id", "")).strip()
                coord = item.get("coord")
                if not point_id or not isinstance(coord, list) or len(coord) != 2:
                    continue
                try:
                    result[point_id] = [float(coord[0]), float(coord[1])]
                except (TypeError, ValueError):
                    continue

        return result

    def _extract_moved_points(
        self,
        prev_scene: Dict[str, Any],
        curr_scene: Dict[str, Any],
        eps: float = 1e-6,
    ) -> Dict[str, List[float]]:
        """比对前后步骤的点位变化，仅提取真正移动过的点。"""
        prev_points = self._scene_points(prev_scene)
        curr_points = self._scene_points(curr_scene)
        moved: Dict[str, List[float]] = {}
        for point_id, curr_pos in curr_points.items():
            prev_pos = prev_points.get(point_id)
            if prev_pos is None:
                continue
            if abs(curr_pos[0] - prev_pos[0]) > eps or abs(curr_pos[1] - prev_pos[1]) > eps:
                moved[point_id] = curr_pos
        return moved

    def _authoritative_step_scene(
        self,
        base_scene: Dict[str, Any],
        ctx: Dict[str, Any],
    ) -> Dict[str, Any]:
        """选择当前步骤真正应作为动画真值的 scene。"""
        if not isinstance(ctx, dict):
            return base_scene
        step_scene = ctx.get("step_scene", {})
        if not isinstance(step_scene, dict):
            return base_scene
        if not bool(step_scene.get("allow_geometry_motion", False)):
            return base_scene

        candidate = step_scene.get("scene", {})
        if not isinstance(candidate, dict):
            return base_scene

        if set(self._scene_points(candidate).keys()) != set(self._scene_points(base_scene).keys()):
            return base_scene
        return candidate

    def _normalize_step_scene_geometry(
        self,
        base_scene: Optional[Dict[str, Any]],
        step_scene: Optional[Dict[str, Any]],
        *,
        step_index: int,
    ) -> Dict[str, Any]:
        base_scene_dict = base_scene if isinstance(base_scene, dict) else {}
        if not isinstance(step_scene, dict):
            if self._has_drawable_geometry(base_scene_dict):
                return {"scene": json.loads(json.dumps(base_scene_dict)), "allow_geometry_motion": False}
            raise ValueError(f"step {step_index} has no valid scene payload")

        candidate = step_scene.get("scene")
        if not isinstance(candidate, dict) or not self._has_drawable_geometry(candidate):
            if self._has_drawable_geometry(base_scene_dict):
                normalized = dict(step_scene)
                normalized["scene"] = json.loads(json.dumps(base_scene_dict))
                normalized["allow_geometry_motion"] = False
                return normalized
            raise ValueError(f"step {step_index} lost all drawable geometry")

        base_point_ids = self._scene_point_ids(base_scene_dict)
        candidate_point_ids = self._scene_point_ids(candidate)
        if base_point_ids and not base_point_ids.issubset(candidate_point_ids):
            raise ValueError(
                f"step {step_index} scene dropped base geometry points: "
                f"{sorted(base_point_ids - candidate_point_ids)}"
            )
        return step_scene

    def _ensure_presentable_video_code(
        self,
        manim_code: str,
        expected_steps: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        is_valid, error_message, report = self.template_codegen.validator.validate(
            manim_code,
            expected_steps=expected_steps,
        )
        if not is_valid:
            raise ValueError(error_message)
        return report

    def _fail_with_geometry_error(
        self,
        state: Dict[str, Any],
        message: str,
        error_message: str,
    ) -> Dict[str, Any]:
        if "messages" not in state:
            state["messages"] = []
        state["messages"].append({"role": "assistant", "content": message})
        project = state.get("project")
        if project is not None:
            project.status = "failed"
            project.error_message = error_message
            state["project"] = project

        metadata = state.get("metadata") if isinstance(state.get("metadata"), dict) else {}
        try:
            case_path = self.case_replay_recorder.record(
                output_dir=self.output_dir,
                payload={
                    "problem_text": str(getattr(project, "problem_text", "") or "")[:240],
                    "problem_pattern": str((metadata.get("problem_pattern") or {}).get("problem_pattern", "")),
                    "sub_pattern": str((metadata.get("problem_pattern") or {}).get("sub_pattern", "")),
                    "execution_check": metadata.get("teaching_ir_execution_check", {}),
                    "render_result": {
                        "status": "failed",
                        "reason": str(error_message),
                    },
                },
            )
            metadata["case_record_path"] = case_path
            state["metadata"] = metadata
        except Exception:
            pass

        state["current_step"] = "animation_failed"
        return state

    def _build_expected_steps(self, steps: List[ScriptStep]) -> List[Dict[str, Any]]:
        expected: List[Dict[str, Any]] = []
        for index, step in enumerate(steps, start=1):
            duration = float(step.audio_duration) if step.audio_duration else float(step.duration)
            expected.append(
                {
                    "step_id": self._safe_step_id(getattr(step, "id", None), index),
                    "duration": round(duration, 2),
                }
            )
        return expected

    def _derived_point_ids(self, scene: Optional[Dict[str, Any]]) -> Set[str]:
        result: Set[str] = set()
        if not isinstance(scene, dict):
            return result
        points = scene.get("points")
        if isinstance(points, list):
            for item in points:
                if not isinstance(item, dict):
                    continue
                if not isinstance(item.get("derived"), dict):
                    continue
                point_id = str(item.get("id", "")).strip()
                if point_id:
                    result.add(point_id)
        elif isinstance(points, dict):
            for point_id, payload in points.items():
                if isinstance(payload, dict) and isinstance(payload.get("derived"), dict):
                    result.add(str(point_id))
        return result

    def _build_timing_budget(
        self,
        *,
        duration: float,
        formula_actions: List[Dict[str, Any]],
        movement_actions: List[Dict[str, Any]],
        emphasis_actions: List[Dict[str, Any]],
        label_actions: List[Dict[str, Any]],
        restore_actions: List[Dict[str, Any]],
        helper_line_actions: List[Dict[str, Any]],
        formula_reset: float,
    ) -> Dict[str, float]:
        transform_enabled = any(
            str(item.get("mode", "")).strip().lower() == "transform"
            for item in emphasis_actions
            if isinstance(item, dict)
        )
        budget = {
            "duration": round(float(duration), 2),
            "formula_reset": round(formula_reset if formula_actions else 0.0, 2),
            "formula_show": round(min(1.0, duration * 0.25), 2) if formula_actions else 0.0,
            "movement": round(min(0.8, duration * 0.30), 2) if movement_actions else 0.0,
            "emphasis": round(min(0.6, duration * 0.22), 2) if emphasis_actions else 0.0,
            "transform": round(min(0.7, duration * 0.22), 2) if transform_enabled else 0.0,
            "label_show": round(min(0.6, duration * 0.20), 2) if label_actions else 0.0,
            "label_hide": round(min(0.4, duration * 0.15), 2) if label_actions else 0.0,
            "restore": round(min(0.25, duration * 0.10), 2) if restore_actions else 0.0,
            "helper_draw": round(min(1.2, duration * 0.25), 2) if helper_line_actions else 0.0,
            "helper_hold": round(min(0.5, duration * 0.10), 2) if helper_line_actions else 0.0,
            "helper_fade": round(min(0.4, duration * 0.12), 2) if helper_line_actions else 0.0,
        }
        used = sum(float(v) for k, v in budget.items() if k != "duration")      
        budget["wait"] = round(max(duration - used, 0.0), 2)
        return budget

    def _apply_timing_profile(
        self,
        budget: Dict[str, float],
        *,
        duration: float,
        formula_scale: float,
        movement_scale: float,
        emphasis_scale: float,
        label_scale: float,
    ) -> Dict[str, float]:
        tuned = dict(budget)
        scale_map = {
            "formula_show": formula_scale,
            "movement": movement_scale,
            "emphasis": emphasis_scale,
            "transform": emphasis_scale,
            "label_show": label_scale,
            "label_hide": label_scale,
        }
        for key, scale in scale_map.items():
            raw_value = float(tuned.get(key, 0.0) or 0.0)
            if raw_value <= 0:
                continue
            tuned[key] = round(min(duration * 0.7, raw_value * scale), 2)

        used = sum(float(v) for k, v in tuned.items() if k not in {"duration", "wait"})
        tuned["wait"] = round(max(duration - used, 0.0), 2)
        tuned["duration"] = round(duration, 2)
        return tuned

    def _attach_animation_specs(
        self,
        contexts: List[Dict[str, Any]],
        *,
        base_coordinate_scene: Optional[Dict[str, Any]],
        conservative: bool,
        adaptive_plan: Optional[Dict[str, Any]] = None,
    ) -> None:
        prev_scene = self._build_animation_base_scene(base_coordinate_scene)
        hidden_derived = self._derived_point_ids(prev_scene)
        has_formula_visible = False

        visual_profile = adaptive_plan.get("visual_profile") if isinstance(adaptive_plan, dict) and isinstance(adaptive_plan.get("visual_profile"), dict) else {}
        scaffold_level = str(visual_profile.get("scaffold_level", "medium") or "medium").lower()
        highlight_intensity = str(visual_profile.get("highlight_intensity", "medium") or "medium").lower()
        label_key_entities = bool(visual_profile.get("label_key_entities", False))
        blink_auxiliary_lines = bool(visual_profile.get("blink_auxiliary_lines", False))

        formula_scale = 1.0
        movement_scale = 1.0
        emphasis_scale = 1.0
        label_scale = 1.0
        force_labels = False
        if scaffold_level == "high":
            formula_scale = 1.35
            movement_scale = 1.15
            emphasis_scale = 1.35
            label_scale = 1.3
            force_labels = True
        elif scaffold_level == "low":
            formula_scale = 0.9
            movement_scale = 0.9
            emphasis_scale = 0.85
            label_scale = 0.85

        if highlight_intensity == "high":
            emphasis_scale = max(emphasis_scale, 1.5)
        elif highlight_intensity == "low":
            emphasis_scale = min(emphasis_scale, 0.85)

        for index, ctx in enumerate(contexts, start=1):
            plan = ctx.get("animation_plan", {})
            step_scene = ctx.get("step_scene", {})
            current_scene = self._authoritative_step_scene(prev_scene, ctx)
            focus_entities = list(plan.get("focus_entities", []) or [])
            duration = float(plan.get("duration", 1.0) or 1.0)
            action_types = {
                str(item.get("type", "")).strip().lower()
                for item in (plan.get("actions", []) or [])
                if isinstance(item, dict)
            }
            layout = ctx.get("canvas_layout", {})
            formula_elements = list(layout.get("reserved_formula_elements", []) or [])
            force_formula_reset = bool(layout.get("force_formula_reset", False))
            formula_actions = [
                {
                    "type": "show_formula",
                    "content": str(item.get("content", "")),
                    "layout": item,
                }
                for item in formula_elements
                if isinstance(item, dict)
            ]

            moved_points = self._extract_moved_points(prev_scene, current_scene)
            movement_actions: List[Dict[str, Any]] = []
            if not conservative:
                movement_actions = [
                    {
                        "type": "move_point",
                        "point_id": point_id,
                        "reveal": point_id in hidden_derived,
                    }
                    for point_id in moved_points.keys()
                ]

            emphasis_mode = "transform" if ("transform" in action_types and not conservative) else "highlight"
            if not conservative and highlight_intensity == "high":
                emphasis_mode = "maintain"
            emphasis_actions: List[Dict[str, Any]] = []
            if focus_entities:
                emphasis_actions.append(
                    {
                        "type": "highlight",
                        "mode": emphasis_mode,
                        "targets": focus_entities,
                    }
                )

            label_actions: List[Dict[str, Any]] = []
            if not conservative and ("label" in action_types or force_labels or label_key_entities):
                label_actions = [
                    {
                        "type": "show_temp_label",
                        "target": entity_id,
                    }
                    for entity_id in (focus_entities[:3] if force_labels else focus_entities)
                ]

            if not conservative and blink_auxiliary_lines and focus_entities:
                emphasis_actions.append(
                    {
                        "type": "highlight",
                        "mode": "transform",
                        "targets": focus_entities[:2],
                    }
                )

            restore_actions: List[Dict[str, Any]] = []
            if focus_entities:
                restore_actions.append(
                    {
                        "type": "restore_style",
                        "targets": focus_entities,
                    }
                )

            helper_line_actions: List[Dict[str, Any]] = []
            step_scene_data = step_scene.get("scene") if isinstance(step_scene, dict) else step_scene
            if isinstance(step_scene_data, dict):
                operations = step_scene_data.get("operations") or []
                for op in operations:
                    if not isinstance(op, dict):
                        continue
                    if str(op.get("type", "")).strip().lower() == "helper_line":
                        helper_line_actions.append(op)

            teaching_step = plan.get("teaching_step") or {}
            if isinstance(teaching_step, dict):
                for action in teaching_step.get("auxiliary_line_actions") or []:
                    if isinstance(action, dict):
                        helper_line_actions.append(action)

            timing_budget = self._build_timing_budget(
                duration=duration,
                formula_actions=formula_actions,
                movement_actions=movement_actions,
                emphasis_actions=emphasis_actions,
                label_actions=label_actions,
                restore_actions=restore_actions,
                helper_line_actions=helper_line_actions,
                formula_reset=0.20 if ((plan.get("reset_formula_area", False) or force_formula_reset) and has_formula_visible and formula_actions) else 0.0,
            )
            timing_budget = self._apply_timing_profile(
                timing_budget,
                duration=duration,
                formula_scale=formula_scale,
                movement_scale=movement_scale,
                emphasis_scale=emphasis_scale,
                label_scale=label_scale,
            )

            ctx["animation_spec"] = {
                "step_id": self._safe_step_id(plan.get("step_id"), index),
                "title": str(plan.get("title", "")),
                "fallback_mode": "conservative" if conservative else "formal",
                "focus_entities": focus_entities,
                "formula_actions": formula_actions,
                "reset_formula_area": bool(plan.get("reset_formula_area", False) or force_formula_reset),
                "movement_actions": movement_actions,
                "emphasis_actions": emphasis_actions,
                "label_actions": label_actions,
                "restore_actions": restore_actions,
                "helper_line_actions": helper_line_actions,
                "timing_budget": timing_budget,
            }

            has_formula_visible = bool(formula_actions)
            prev_scene = current_scene if isinstance(current_scene, dict) and current_scene else prev_scene

    def _write_debug_json(self, filename: str, payload: Any) -> None:
        debug_dir = self.output_dir / "debug"
        debug_dir.mkdir(parents=True, exist_ok=True)
        (debug_dir / filename).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _write_debug_text(self, filename: str, content: str) -> None:
        debug_dir = self.output_dir / "debug"
        debug_dir.mkdir(parents=True, exist_ok=True)
        (debug_dir / filename).write_text(str(content), encoding="utf-8")

    def _normalize_string_items(self, value: Any) -> List[str]:
        if value is None:
            return []
        if isinstance(value, str):
            parts = re.split(r"[\s,;/|]+", value)
            return sorted({part.strip().lower() for part in parts if part.strip()})
        if isinstance(value, list):
            result: List[str] = []
            for item in value:
                result.extend(self._normalize_string_items(item))
            return sorted(set(result))
        return [str(value).strip().lower()]

    def _build_template_retrieval_query(
        self,
        metadata: Dict[str, Any],
        *,
        ctx: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        drawable_scene = metadata.get("drawable_scene") or {}
        geometry_facts = metadata.get("geometry_facts") or {}
        primitives = sorted(
            {
                str(item.get("type", "")).strip().lower()
                for item in (drawable_scene.get("primitives") or [])
                if isinstance(item, dict) and str(item.get("type", "")).strip()
            }
        )
        template_hints = self._normalize_string_items(
            (geometry_facts.get("templates") if isinstance(geometry_facts, dict) else [])
            or metadata.get("template_hints")
            or []
        )
        motions: List[str] = []
        tags = set(template_hints)
        summary_parts: List[str] = []

        if ctx:
            plan = ctx.get("animation_plan", {})
            animation_spec = ctx.get("animation_spec", {})
            summary_parts.extend(
                [
                    str(ctx.get("title", "")).strip(),
                    str(plan.get("title", "")).strip(),
                ]
            )
            for item in (plan.get("actions") or []):
                if isinstance(item, dict) and str(item.get("type", "")).strip():
                    motions.append(str(item.get("type", "")).strip().lower())
            for field_name in (
                "movement_actions",
                "emphasis_actions",
                "label_actions",
                "restore_actions",
                "formula_actions",
            ):
                for item in animation_spec.get(field_name, []) or []:
                    if isinstance(item, dict) and str(item.get("type", "")).strip():
                        motions.append(str(item.get("type", "")).strip().lower())

        if "circle" in primitives:
            tags.add("circle")
        if "angle" in primitives or "right_angle" in primitives:
            tags.add("angle")
        if "arc" in primitives:
            tags.add("circle")
        if any(item in motions for item in {"move_point", "translation"}):
            tags.add("translation")
        if any(item in motions for item in {"transform", "rotation"}):
            tags.add("rotation")
        if "fold" in template_hints or "reflection" in template_hints:
            tags.add("fold")

        summary = " ".join(part for part in summary_parts if part).strip()
        return {
            "summary": summary,
            "tags": sorted(tags),
            "primitives": primitives,
            "motions": sorted(set(motions)),
            "helpers": [],
            "template_hints": template_hints,
        }

    def _annotate_template_references(
        self,
        metadata: Dict[str, Any],
        contexts: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        if not self.use_template_retrieval:
            metadata["template_references"] = []
            metadata["template_retrieval_query"] = {}
            metadata["template_retrieval_mode"] = "disabled"
            return []

        aggregate: Dict[str, Dict[str, Any]] = {}
        query_log: Dict[str, Any] = {
            "mode": self.template_retrieval_mode,
            "top_k": self.template_retrieval_top_k,
            "steps": [],
        }

        global_query = self._build_template_retrieval_query(metadata)
        query_log["global"] = global_query

        for ctx in contexts:
            step_query = self._build_template_retrieval_query(metadata, ctx=ctx)
            refs = [
                item.to_payload()
                for item in self.template_retriever.retrieve(step_query, top_k=self.template_retrieval_top_k)
            ]
            ctx["retrieved_templates"] = refs
            query_log["steps"].append(
                {
                    "step_id": ctx.get("step_id"),
                    "query": step_query,
                    "result_ids": [item.get("id") for item in refs],
                }
            )
            for item in refs:
                current = aggregate.get(str(item.get("id")))
                if current is None or float(item.get("score", 0.0)) > float(current.get("score", 0.0)):
                    aggregate[str(item.get("id"))] = item

        if not aggregate:
            for item in self.template_retriever.retrieve(global_query, top_k=self.template_retrieval_top_k):
                aggregate[item.id] = item.to_payload()

        ordered = sorted(
            aggregate.values(),
            key=lambda item: (-float(item.get("score", 0.0)), str(item.get("id", ""))),
        )
        metadata["template_references"] = ordered
        metadata["template_retrieval_query"] = query_log
        metadata["template_retrieval_mode"] = self.template_retrieval_mode
        return ordered

    def _format_template_references_for_prompt(self, references: List[Dict[str, Any]]) -> str:
        if not references:
            return "无"
        chunks: List[str] = []
        for item in references[: max(1, self.template_retrieval_top_k + 1)]:
            chunks.append(
                "\n".join(
                    [
                        f"- 模板ID: {item.get('id', '')}",
                        f"  场景/片段: {item.get('snippet_name', '')}",
                        f"  摘要: {item.get('summary', '')}",
                        f"  命中原因: {item.get('reason', '')}",
                        f"  可用 helper: {', '.join(item.get('helpers', []) or []) or '无'}",
                        f"  参考代码片段:\n```python\n{item.get('excerpt', '')}\n```",
                    ]
                )
            )
        return "\n\n".join(chunks)

    def _summarize_template_adoption(
        self,
        manim_code: str,
        references: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        helper_hits = sorted(
            {
                helper
                for item in references
                for helper in (item.get("helpers") or [])
                if helper and re.search(rf"\b{re.escape(str(helper))}\b", manim_code)
            }
        )
        matched_reference_ids = sorted(
            {
                str(item.get("id"))
                for item in references
                if any(
                    helper and re.search(rf"\b{re.escape(str(helper))}\b", manim_code)
                    for helper in (item.get("helpers") or [])
                )
            }
        )
        return {
            "helper_hits": helper_hits,
            "matched_reference_ids": matched_reference_ids,
            "reference_count": len(references),
        }

    def _build_template_candidate(
        self,
        *,
        project: VideoProject,
        steps: List[ScriptStep],
        coordinate_scene_data: Optional[Dict[str, Any]],
        teaching_ir: Optional[Dict[str, Any]] = None,
        expected_steps: List[Dict[str, Any]],
        conservative: bool,
        adaptive_plan: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        candidate = {
            "ok": False,
            "mode": "template_conservative" if conservative else "template_formal",
            "fallback_level": "conservative" if conservative else "formal",
            "code": "",
            "contexts": [],
            "snapshots": [],
            "report": {},
            "error": None,
        }
        try:
            code, contexts, snapshots = self._generate_template_code_iteratively(
                project=project,
                steps=steps,
                coordinate_scene_data=coordinate_scene_data,
                teaching_ir=teaching_ir,
                expected_steps=expected_steps,
                conservative=conservative,
                adaptive_plan=adaptive_plan,
            )
            report = self._ensure_presentable_video_code(code, expected_steps)
            candidate.update(
                {
                    "ok": True,
                    "code": code,
                    "contexts": contexts,
                    "snapshots": snapshots,
                    "report": report,
                }
            )
        except Exception as exc:
            candidate["error"] = str(exc)
        return candidate

    def _build_llm_fallback_candidate(
        self,
        *,
        steps: List[ScriptStep],
        metadata: Dict[str, Any],
        expected_steps: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        candidate = {
            "ok": False,
            "mode": "llm_fallback",
            "fallback_level": "llm",
            "code": "",
            "contexts": [],
            "snapshots": [],
            "report": {},
            "error": None,
        }
        if self.llm is None:
            candidate["error"] = "llm is not configured"
            return candidate

        try:
            scene_payload = metadata.get("drawable_scene") or metadata.get("semantic_graph") or {}
            known_entities = self._collect_known_entities(
                metadata.get("drawable_scene"),
                metadata.get("semantic_graph"),
            )
            template_references = metadata.get("template_references", [])
            prompt = (
                "请根据以下结构化几何信息与讲解脚本，输出完整可运行的 Manim 代码。\n"
                "必须满足音画同步与时长约束，禁止省略代码。\n\n"
                "[画布约束]\n"
                f"{self._build_canvas_instructions()}\n\n"
                "[已知几何实体 ID]\n"
                f"{', '.join(known_entities) if known_entities else '无'}\n\n"
                "[脚本步骤]\n"
                f"{self._format_script_for_prompt(steps)}\n\n"
                "[结构化几何 Scene]\n"
                f"{self._format_scene_graph_for_prompt(scene_payload)}\n\n"
                "[模板参考 - 只用于学习写法，不是答案]\n"
                f"{self._format_template_references_for_prompt(template_references)}\n\n"
                "[模板使用规则]\n"
                "- 这些模板只用于学习对象组织、动画写法和 helper 用法。\n"
                "- 绝对不能照搬模板里的坐标、点名、题设关系、整段场景流程。\n"
                "- 几何实体、位置、步骤顺序必须以当前题目的结构化数据为准。\n"
                "- 若模板与当前题目冲突，必须服从当前题目的 scene_graph / drawable_scene。\n"
                "- 如果借鉴 helper，请在生成代码里内联必要 helper，不要 import 外部模板文件。"
            )
            messages = self._format_messages(system_prompt=self.system_prompt, user_prompt=prompt)
            response = self._invoke_llm(messages)
            code = self._extract_code_block(response or "")
            if not str(code).strip():
                raise ValueError("llm returned empty code")

            report = self._ensure_presentable_video_code(code, expected_steps)
            candidate.update(
                {
                    "ok": True,
                    "code": str(code),
                    "report": report,
                }
            )
        except Exception as exc:
            candidate["error"] = str(exc)

        return candidate

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Generate formal Manim lecture-video code from validated geometry only."""
        project = state["project"]
        if getattr(project, "status", "") == "failed":
            return state

        script_steps = project.script_steps
        if not script_steps:
            state["messages"].append({
                "role": "assistant",
                "content": "缺少讲解脚本步骤，无法生成正式讲解视频。",
            })
            return state

        metadata = state.setdefault("metadata", {})
        adaptive_plan = metadata.get("adaptive_plan") if isinstance(metadata.get("adaptive_plan"), dict) else {}
        problem_text = str(getattr(project, "problem_text", "") or "")

        problem_pattern = self.problem_pattern_classifier.classify(
            problem_text=problem_text,
            metadata=metadata,
        )
        metadata["problem_pattern"] = problem_pattern
        self._write_debug_json("problem_pattern.json", problem_pattern)

        drawable_scene_data = metadata.get("drawable_scene")
        coordinate_scene_data = metadata.get("coordinate_scene")
        animation_scene_data = (
            coordinate_scene_data
            if isinstance(coordinate_scene_data, dict) and self._has_drawable_geometry(coordinate_scene_data)
            else drawable_scene_data
        )
        drawable_scene_presentable = self._has_drawable_geometry(animation_scene_data)
        if not drawable_scene_presentable:
            return self._fail_with_geometry_error(
                state,
                "缺少有效 drawable geometry，未生成正式视频脚本；调试信息已保存到 debug/。",
                "missing valid drawable geometry for formal video generation",
            )

        geometry_ir = self.teaching_ir_planner.build_geometry_ir(
            metadata=metadata,
            problem_text=problem_text,
        )
        if not str(geometry_ir.get("problem_pattern", "")).strip():
            geometry_ir["problem_pattern"] = str(problem_pattern.get("problem_pattern", ""))
        if not str(geometry_ir.get("sub_pattern", "")).strip():
            geometry_ir["sub_pattern"] = str(problem_pattern.get("sub_pattern", ""))

        teaching_ir = self.teaching_ir_planner.build_teaching_ir(
            steps=script_steps,
            geometry_ir=geometry_ir,
            metadata=metadata,
            problem_text=problem_text,
        )

        teaching_ir, execution_check = self.action_executability_checker.check_and_repair(
            teaching_ir=teaching_ir,
            geometry_ir=geometry_ir,
        )

        metadata["geometry_ir"] = geometry_ir
        metadata["teaching_ir"] = teaching_ir
        metadata["teaching_ir_execution_check"] = execution_check
        self._write_debug_json("geometry_ir.json", geometry_ir)
        self._write_debug_json("teaching_ir.json", teaching_ir)
        self._write_debug_json("teaching_ir_execution_check.json", execution_check)

        expected_steps = self._build_expected_steps(script_steps)
        if self.use_template_codegen:
            formal_candidate = self._build_template_candidate(
                project=project,
                steps=script_steps,
                coordinate_scene_data=animation_scene_data,
                teaching_ir=teaching_ir,
                expected_steps=expected_steps,
                conservative=False,
                adaptive_plan=adaptive_plan,
            )
            conservative_candidate = self._build_template_candidate(
                project=project,
                steps=script_steps,
                coordinate_scene_data=animation_scene_data,
                teaching_ir=teaching_ir,
                expected_steps=expected_steps,
                conservative=True,
                adaptive_plan=adaptive_plan,
            )
        else:
            formal_candidate = {
                "ok": False,
                "mode": "template_formal",
                "fallback_level": "formal",
                "code": "",
                "contexts": [],
                "snapshots": [],
                "report": {},
                "error": "template generation disabled by config",
            }
            conservative_candidate = {
                "ok": False,
                "mode": "template_conservative",
                "fallback_level": "conservative",
                "code": "",
                "contexts": [],
                "snapshots": [],
                "report": {},
                "error": "template generation disabled by config",
            }

        retrieval_contexts = list(formal_candidate["contexts"] or conservative_candidate["contexts"] or [])
        if not retrieval_contexts:
            retrieval_contexts = self._prepare_animation_context(
                script_steps,
                animation_scene_data,
                teaching_ir=teaching_ir,
            )
            self._attach_animation_specs(
                retrieval_contexts,
                base_coordinate_scene=animation_scene_data,
                conservative=False,
                adaptive_plan=adaptive_plan,
            )
        template_references = self._annotate_template_references(metadata, retrieval_contexts)
        self._write_debug_json("template_references.json", template_references)
        self._write_debug_json("template_retrieval_query.json", metadata.get("template_retrieval_query", {}))
        if formal_candidate["contexts"]:
            for src_ctx, retrieval_ctx in zip(formal_candidate["contexts"], retrieval_contexts):
                src_ctx["retrieved_templates"] = list(retrieval_ctx.get("retrieved_templates", []))
        if conservative_candidate["contexts"]:
            for src_ctx, retrieval_ctx in zip(conservative_candidate["contexts"], retrieval_contexts):
                src_ctx["retrieved_templates"] = list(retrieval_ctx.get("retrieved_templates", []))

        llm_fallback_candidate = {
            "ok": False,
            "mode": "llm_fallback",
            "fallback_level": "llm",
            "code": "",
            "contexts": [],
            "snapshots": [],
            "report": {},
            "error": "not attempted",
        }
        if not self.use_template_codegen or (not formal_candidate["ok"] and not conservative_candidate["ok"]):
            llm_fallback_candidate = self._build_llm_fallback_candidate(
                steps=script_steps,
                metadata=metadata,
                expected_steps=expected_steps,
            )

        prefer_conservative = (
            self.prefer_conservative_on_complex
            and self.conservative_step_threshold > 0
            and len(script_steps) >= self.conservative_step_threshold
        )

        if prefer_conservative and conservative_candidate["ok"]:
            selected = conservative_candidate
        else:
            selected = formal_candidate if formal_candidate["ok"] else conservative_candidate

        if not selected["ok"] and llm_fallback_candidate["ok"]:
            selected = llm_fallback_candidate
        if not selected["ok"]:
            self._write_debug_json(
                "formal_validation.json",
                {
                    "selected_mode": None,
                    "candidates": {
                        "formal": {
                            "ok": formal_candidate["ok"],
                            "error": formal_candidate["error"],
                            "report": formal_candidate["report"],
                        },
                        "conservative": {
                            "ok": conservative_candidate["ok"],
                            "error": conservative_candidate["error"],
                            "report": conservative_candidate["report"],
                        },
                        "llm_fallback": {
                            "ok": llm_fallback_candidate["ok"],
                            "error": llm_fallback_candidate["error"],
                            "report": llm_fallback_candidate["report"],
                        },
                    },
                },
            )
            return self._fail_with_geometry_error(
                state,
                "模板路径未通过静态校验，且 LLM 兜底也失败；调试信息已保存到 debug/。",
                str(
                    formal_candidate["error"]
                    or conservative_candidate["error"]
                    or llm_fallback_candidate["error"]
                    or "animation generation failed"
                ),
            )

        manim_code = str(selected["code"])
        codegen_mode = str(selected["mode"])
        fallback_level = str(selected["fallback_level"])
        step_contexts = list(selected["contexts"])
        if not step_contexts and retrieval_contexts:
            step_contexts = retrieval_contexts
        step_codegen_snapshots = list(selected["snapshots"])
        validation_report = dict(selected["report"])
        step_specs = [ctx.get("animation_spec", {}) for ctx in step_contexts]
        template_adoption = self._summarize_template_adoption(manim_code, template_references)

        self._write_debug_json("step_contexts.json", step_contexts)
        self._write_debug_json("step_animation_specs.json", step_specs)
        self._write_debug_json("template_reference_adoption.json", template_adoption)
        self._write_debug_json(
            "formal_validation.json",
            {
                "selected_mode": codegen_mode,
                "prefer_conservative": prefer_conservative,
                "selected_report": validation_report,
                "candidates": {
                    "formal": {
                        "ok": formal_candidate["ok"],
                        "error": formal_candidate["error"],
                        "report": formal_candidate["report"],
                    },
                    "conservative": {
                        "ok": conservative_candidate["ok"],
                        "error": conservative_candidate["error"],
                        "report": conservative_candidate["report"],
                    },
                        "llm_fallback": {
                            "ok": llm_fallback_candidate["ok"],
                            "error": llm_fallback_candidate["error"],
                            "report": llm_fallback_candidate["report"],
                        },
                },
            },
        )
        self._write_debug_json("error_classification.json", {"render_error_code": None})
        self._write_debug_text("final_codegen_mode.txt", codegen_mode)

        class_match = re.search(r"class\s+(\w+)\s*\([^)]*Scene[^)]*\)", manim_code)
        class_name = class_match.group(1) if class_match else "MathAnimation"

        project.manim_class_name = class_name
        project.manim_file_path = "math_animation.py"
        project.audio_embedded = True

        state["project"] = project
        state["current_step"] = "animation_completed"
        state["messages"].append({
            "role": "assistant",
            "content": f"正式 Manim 讲解脚本已生成：{project.manim_class_name}",
        })

        if "metadata" not in state:
            state["metadata"] = {}
        state["metadata"]["manim_code"] = manim_code
        state["metadata"]["animation_step_contexts"] = step_contexts
        state["metadata"]["step_animation_specs"] = step_specs
        state["metadata"]["formal_validation"] = validation_report
        state["metadata"]["manim_codegen_mode"] = codegen_mode
        state["metadata"]["manim_code_candidates"] = {
            "template_formal": formal_candidate["code"],
            "template_conservative": conservative_candidate["code"],
            "llm_fallback": llm_fallback_candidate["code"],
        }
        state["metadata"]["validation_candidates"] = {
            "template_formal": formal_candidate["report"],
            "template_conservative": conservative_candidate["report"],
            "llm_fallback": llm_fallback_candidate["report"],
        }
        state["metadata"]["template_references"] = template_references
        state["metadata"]["template_retrieval_query"] = metadata.get("template_retrieval_query", {})
        state["metadata"]["template_retrieval_mode"] = metadata.get("template_retrieval_mode", "component_hybrid")
        state["metadata"]["template_reference_adoption"] = template_adoption
        state["metadata"]["fallback_level"] = fallback_level
        state["metadata"]["render_error_code"] = None
        state["metadata"]["geometry_ir"] = geometry_ir
        state["metadata"]["teaching_ir"] = teaching_ir
        state["metadata"]["problem_pattern"] = problem_pattern
        state["metadata"]["teaching_ir_execution_check"] = execution_check
        if step_codegen_snapshots:
            state["metadata"]["animation_step_codegen_snapshots"] = step_codegen_snapshots

        case_path = self.case_replay_recorder.record(
            output_dir=self.output_dir,
            payload={
                "problem_text": problem_text[:240],
                "problem_pattern": str(problem_pattern.get("problem_pattern", "")),
                "sub_pattern": str(problem_pattern.get("sub_pattern", "")),
                "geometry_ir_version": str(geometry_ir.get("version", "v1")),
                "teaching_ir_version": str(teaching_ir.get("version", "v1")),
                "execution_check": execution_check,
                "render_result": {
                    "status": "success",
                    "manim_codegen_mode": codegen_mode,
                },
            },
        )
        state["metadata"]["case_record_path"] = case_path

        return state

    def _prepare_animation_context(
        self,
        steps: List[ScriptStep],
        coordinate_scene_data: Optional[Dict[str, Any]],
        teaching_ir: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        canvas_scene = CanvasScene(max_formula_slots=max(1, int(self.canvas_config.get("formula_max_visible_slots", 8))))
        contexts: List[Dict[str, Any]] = []
        cumulative = 0.0
        running_scene = self._build_animation_base_scene(coordinate_scene_data)

        for index, step in enumerate(steps, start=1):
            teaching_step = self.teaching_ir_planner.get_step_plan(
                teaching_ir,
                step_id=getattr(step, "id", index),
                fallback_index=index,
            )
            raw_step_scene = self.scene_graph_updater.build_step_scene(
                base_scene_graph=running_scene,
                step=step,
                step_index=index,
                teaching_step=teaching_step,
            )
            step_scene = self._normalize_step_scene_geometry(
                running_scene,
                raw_step_scene,
                step_index=index,
            )
            running_scene = step_scene.get("scene", running_scene)
            plan = self.animation_planner.plan_step(step, step_scene, cumulative)
            layout = self._layout_step_canvas(canvas_scene, plan)

            contexts.append({
                "step_id": step.id,
                "title": step.title,
                "step_scene": step_scene,
                "animation_plan": plan,
                "canvas_layout": layout,
                "teaching_step": teaching_step,
            })
            cumulative += plan["duration"]

        return contexts

    def _generate_template_code_iteratively(
        self,
        project: VideoProject,
        steps: List[ScriptStep],
        coordinate_scene_data: Optional[Dict[str, Any]],
        teaching_ir: Optional[Dict[str, Any]] = None,
        *,
        expected_steps: List[Dict[str, Any]],
        conservative: bool,
        adaptive_plan: Optional[Dict[str, Any]] = None,
    ) -> Tuple[str, List[Dict[str, Any]], List[Dict[str, Any]]]:
        canvas_scene = CanvasScene(max_formula_slots=max(1, int(self.canvas_config.get("formula_max_visible_slots", 8))))
        cumulative = 0.0
        contexts: List[Dict[str, Any]] = []
        snapshots: List[Dict[str, Any]] = []
        manim_code = ""

        base_coordinate_scene = self._build_animation_base_scene(coordinate_scene_data)
        running_scene = base_coordinate_scene

        for index, step in enumerate(steps, start=1):
            teaching_step = self.teaching_ir_planner.get_step_plan(
                teaching_ir,
                step_id=getattr(step, "id", index),
                fallback_index=index,
            )
            raw_step_scene = self.scene_graph_updater.build_step_scene(
                base_scene_graph=running_scene,
                step=step,
                step_index=index,
                teaching_step=teaching_step,
            )
            step_scene = self._normalize_step_scene_geometry(
                running_scene,
                raw_step_scene,
                step_index=index,
            )
            running_scene = step_scene.get("scene", running_scene)
            plan = self.animation_planner.plan_step(step, step_scene, cumulative)
            layout = self._layout_step_canvas(canvas_scene, plan)

            ctx = {
                "step_id": step.id,
                "title": step.title,
                "step_scene": step_scene,
                "animation_plan": plan,
                "canvas_layout": layout,
                "teaching_step": teaching_step,
            }
            contexts.append(ctx)

            if self.export_incremental_codegen_debug:
                self._attach_animation_specs(
                    contexts,
                    base_coordinate_scene=base_coordinate_scene,
                    conservative=conservative,
                    adaptive_plan=adaptive_plan,
                )
            snapshot = {
                "step_id": step.id,
                "code_length": None,
                "debug_code_path": None,
                "context": ctx,
            }
            if self.export_incremental_codegen_debug:
                partial_code = self.template_codegen.generate(
                    project=project,
                    coordinate_scene_data=base_coordinate_scene,
                    step_contexts=contexts,
                )
                self._ensure_presentable_video_code(
                    partial_code,
                    expected_steps=expected_steps[: len(contexts)],
                )
                snapshot["code_length"] = len(partial_code)
                snapshot["debug_code_path"] = self._export_step_debug_code(
                    index,
                    partial_code,
                    "conservative" if conservative else "formal",
                )
            snapshots.append(snapshot)
            cumulative += plan["duration"]

        if not self.export_incremental_codegen_debug:
            self._attach_animation_specs(
                contexts,
                base_coordinate_scene=base_coordinate_scene,
                conservative=conservative,
                adaptive_plan=adaptive_plan,
            )

        manim_code = self.template_codegen.generate(
            project=project,
            coordinate_scene_data=base_coordinate_scene,
            step_contexts=contexts,
        )
        self._ensure_presentable_video_code(
            manim_code,
            expected_steps=expected_steps,
        )
        if snapshots:
            snapshots[-1]["code_length"] = len(manim_code)
            if not snapshots[-1].get("debug_code_path"):
                snapshots[-1]["debug_code_path"] = self._export_step_debug_code(
                    len(contexts),
                    manim_code,
                    "conservative" if conservative else "formal",
                )

        return manim_code, contexts, snapshots
