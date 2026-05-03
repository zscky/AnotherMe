"""
模板化 Manim 代码生成器。
根据 coordinate_scene + step_contexts 生成稳定、可修复的动画代码。
"""

import hashlib
import re
from typing import Any, Dict, List, Optional, Set, Tuple

from .formal_video_validator import FormalVideoValidator


class TemplateCodeGenerator:
    """使用 CoordinateScene + StepContexts 生成 Manim 代码。"""

    def __init__(self, canvas_config: Dict[str, Any]):
        self.canvas_config = canvas_config
        self.prefer_mathtex = bool(canvas_config.get("prefer_mathtex", False))
        self.formula_math_font_size = int(canvas_config.get("formula_math_font_size", 24))
        self.formula_text_font_size = int(canvas_config.get("formula_text_font_size", 24))
        self.formula_max_visible_slots = int(canvas_config.get("formula_max_visible_slots", 8))
        self.validator = FormalVideoValidator(canvas_config)

    def generate(
        self,
        project: Any,
        coordinate_scene_data: Dict[str, Any],
        step_contexts: List[Dict[str, Any]],
    ) -> str:
        class_name = self._build_class_name(project)
        initial_scene = self._resolve_initial_scene(
            coordinate_scene_data=coordinate_scene_data,
            step_contexts=step_contexts,
        )

        point_lookup = self._scene_points(initial_scene)
        point_payload_lookup = self._point_payload_lookup(initial_scene)
        primitives = initial_scene.get("primitives", []) if isinstance(initial_scene, dict) else []
        if not point_lookup:
            raise ValueError("template codegen requires a drawable scene with concrete points")
        if not any(str(item.get("type", "")).strip().lower() == "segment" for item in primitives):
            raise ValueError("template codegen requires at least one drawable segment")
        self._validate_drawable_scene_semantics(initial_scene, point_lookup)
        display = initial_scene.get("display", {}) if isinstance(initial_scene, dict) else {}
        point_display = display.get("points", {}) if isinstance(display, dict) else {}
        primitive_display = display.get("primitives", {}) if isinstance(display, dict) else {}
        frame_height = float(self.canvas_config.get("frame_height", 8.0))
        frame_width = float(self.canvas_config.get("frame_width", 14.222))
        pixel_height = int(self.canvas_config.get("pixel_height", 1080))
        pixel_width = int(self.canvas_config.get("pixel_width", 1920))
        safe_margin = float(self.canvas_config.get("safe_margin", 0.4))
        left_panel_x_max = float(self.canvas_config.get("left_panel_x_max", 0.75))
        geometry_bbox = self._coordinate_bbox(point_lookup)
        screen_points = self._screen_point_map(
            point_lookup,
            geometry_bbox,
            frame_width,
            frame_height,
            left_panel_x_max,
            safe_margin,
        )

        step_by_id = {int(s.id): s for s in getattr(project, "script_steps", [])}
        point_ids = list(point_lookup.keys())
        hidden_derived_point_ids = {
            point_id
            for point_id, payload in point_payload_lookup.items()
            if isinstance(payload.get("derived"), dict)
        }

        code: List[str] = []
        code.append("from manim import *")
        code.append("import math")
        code.append("import os")
        code.append("import numpy as np")
        code.append("")
        code.append(f"config.frame_height = {frame_height}")
        code.append(f"config.frame_width = {frame_width}")
        code.append(f"config.pixel_height = {pixel_height}")
        code.append(f"config.pixel_width = {pixel_width}")
        code.append("")
        code.append(f"class {class_name}(Scene):")
        code.append("    def construct(self):")
        code.append("        self.camera.background_color = '#1a1a2e'")
        code.append("")
        code.append("        # 对象注册表：同一几何元素在全流程复用")
        code.append("        points = {}")
        code.append("        point_labels = {}")
        code.append("        lines = {}")
        code.append("        objects = {}")
        code.append(f"        hidden_derived_points = {repr(sorted(hidden_derived_point_ids))}")
        code.append("")

        for point_id in point_ids:
            sx, sy = screen_points.get(point_id, (0.0, 0.0))
            safe_id = self._safe_text(point_id)
            label_text = self._safe_text(
                self._point_label_text(point_id, point_display, point_payload_lookup.get(point_id))
            )
            label_dx, label_dy = self._label_offset(
                point_id,
                screen_points,
                point_display,
                point_payload_lookup.get(point_id),
            )
            point_ctor = (
                f"Dot(point=np.array([{sx:.3f}, {sy:.3f}, 0]), radius=0.05, color=WHITE)"
            )
            if point_id in hidden_derived_point_ids:
                point_ctor += ".set_opacity(0)"
            code.append(f"        points['{safe_id}'] = {point_ctor}")
            show_label = self._display_bool(point_display, point_id, "show_label", True)
            if show_label:
                label_ctor = (
                    f"Text('{label_text}', font_size=24, color=WHITE).move_to(np.array([{sx + label_dx:.3f}, {sy + label_dy:.3f}, 0]))"
                )
                if point_id in hidden_derived_point_ids:
                    label_ctor += ".set_opacity(0)"
                code.append(
                    f"        point_labels['{safe_id}'] = {label_ctor}"
                )
                code.append(f"        self.add(points['{safe_id}'], point_labels['{safe_id}'])")
            else:
                code.append(f"        self.add(points['{safe_id}'])")

        if point_ids:
            code.append("")

        for primitive in primitives:
            primitive_id = self._safe_text(str(primitive.get("id", "")))
            primitive_type = str(primitive.get("type", "")).strip().lower()
            refs = [self._safe_text(str(p)) for p in (primitive.get("points") or [])]
            color = self._manim_color_expr(self._display_value(primitive_display, primitive_id, "color"))
            fill_opacity = float(self._display_value(primitive_display, primitive_id, "fill_opacity", 0.05) or 0.05)
            line_style = str(self._display_value(primitive_display, primitive_id, "style", "solid") or "solid").strip().lower()
            stroke_width = float(self._display_value(primitive_display, primitive_id, "stroke_width", 3) or 3)
            show_primitive = self._display_bool(
                primitive_display,
                primitive_id,
                "show",
                default=(primitive_type not in {"angle", "right_angle"}),
            )
            if not show_primitive:
                continue

            if primitive_type == "segment" and len(refs) == 2:
                if not self._segment_visible_for_render(primitive_id, primitive_display):
                    continue
                p1, p2 = refs
                code.append(f"        if '{p1}' in points and '{p2}' in points:")
                line_cls = "DashedLine" if line_style == "dashed" else "Line"
                code.append(
                    f"            lines['{primitive_id}'] = always_redraw(lambda p1='{p1}', p2='{p2}': "
                    f"{line_cls}(points[p1].get_center(), points[p2].get_center(), color={color}, stroke_width={stroke_width:.2f}))"
                )
                code.append(f"            self.add(lines['{primitive_id}'])")
                continue

            if primitive_type == "polygon" and len(refs) >= 3:
                refs_repr = repr(refs)
                code.append(f"        if all(k in points for k in {refs}):")
                code.append(
                    f"            objects['{primitive_id}'] = always_redraw(lambda refs={refs_repr}: "
                    f"Polygon(*[points[r].get_center() for r in refs], color={color}, stroke_width=3, fill_opacity={fill_opacity:.2f}))"
                )
                code.append(f"            self.add(objects['{primitive_id}'])")
                continue

            if primitive_type == "circle":
                center = self._safe_text(str(primitive.get("center", "")))
                radius_point = self._safe_text(str(primitive.get("radius_point", "")))
                code.append(f"        if '{center}' in points and '{radius_point}' in points:")
                code.append(
                    f"            objects['{primitive_id}'] = always_redraw(lambda c='{center}', r='{radius_point}': "
                    f"Circle(radius=np.linalg.norm(points[r].get_center() - points[c].get_center()), color={color}, stroke_width=3, fill_opacity={fill_opacity:.2f}).move_to(points[c].get_center()))"
                )
                code.append(f"            self.add(objects['{primitive_id}'])")
                continue

            if primitive_type == "arc" and len(refs) == 2:
                center = self._safe_text(str(primitive.get("center", "")))
                start_point, end_point = refs
                code.append(
                    f"        if '{center}' in points and '{start_point}' in points and '{end_point}' in points:"
                )
                code.append(
                    f"            objects['{primitive_id}'] = always_redraw(lambda c='{center}', s='{start_point}', e='{end_point}': "
                    f"Arc(radius=np.linalg.norm(points[s].get_center() - points[c].get_center()), "
                    f"start_angle=np.arctan2((points[s].get_center()-points[c].get_center())[1], (points[s].get_center()-points[c].get_center())[0]), "
                    f"angle=((np.arctan2((points[e].get_center()-points[c].get_center())[1], (points[e].get_center()-points[c].get_center())[0]) - np.arctan2((points[s].get_center()-points[c].get_center())[1], (points[s].get_center()-points[c].get_center())[0]) + 2*np.pi) % (2*np.pi)), "
                    f"color={color}).move_arc_center_to(points[c].get_center()))"
                )
                code.append(f"            self.add(objects['{primitive_id}'])")
                continue

            if primitive_type in {'angle', 'right_angle'} and len(refs) == 3:
                p1, vertex, p2 = refs
                code.append(f"        if '{p1}' in points and '{vertex}' in points and '{p2}' in points:")
                if primitive_type == "right_angle":
                    code.append(
                        f"            objects['{primitive_id}'] = always_redraw(lambda p1='{p1}', v='{vertex}', p2='{p2}': "
                        f"RightAngle(Line(points[v].get_center(), points[p1].get_center()), "
                        f"Line(points[v].get_center(), points[p2].get_center()), "
                        f"length=max(0.14, min(0.30, min(np.linalg.norm(points[p1].get_center()-points[v].get_center()), np.linalg.norm(points[p2].get_center()-points[v].get_center())) * 0.18)), "
                        f"color={color}))"
                    )
                else:
                    angle_value = primitive.get("value")
                    use_other_angle = False
                    try:
                        if angle_value is not None:
                            use_other_angle = float(angle_value) > 180.0
                    except (TypeError, ValueError):
                        use_other_angle = False
                    code.append(
                        f"            objects['{primitive_id}'] = always_redraw(lambda p1='{p1}', v='{vertex}', p2='{p2}': "
                        f"Angle(Line(points[v].get_center(), points[p1].get_center()), "
                        f"Line(points[v].get_center(), points[p2].get_center()), "
                        f"radius=max(0.18, min(0.40, min(np.linalg.norm(points[p1].get_center()-points[v].get_center()), np.linalg.norm(points[p2].get_center()-points[v].get_center())) * 0.22)), "
                        f"other_angle={str(use_other_angle)}, color={color}))"
                    )
                code.append(f"            self.add(objects['{primitive_id}'])")

        code.append("")
        code.append("        current_formula_group = VGroup()")
        code.append("")
        code.append("        def _safe_add_sound(path, time_offset=0.0):")
        code.append("            if not path:")
        code.append("                return")
        code.append("            if not os.path.exists(path):")
        code.append("                return")
        code.append("            try:")
        code.append("                if os.path.getsize(path) <= 0:")
        code.append("                    return")
        code.append("            except OSError:")
        code.append("                return")
        code.append("            try:")
        code.append("                self.add_sound(path, time_offset=time_offset)")
        code.append("            except Exception:")
        code.append("                pass")
        code.append("")

        prev_scene = initial_scene
        has_formula_group = False
        formula_slot_history: List[Tuple[float, float, float, float]] = []
        visible_formula_texts: Set[str] = set()

        for ctx in step_contexts:
            plan = ctx.get("animation_plan", {})
            animation_spec = ctx.get("animation_spec", {}) if isinstance(ctx, dict) else {}
            timing_budget = animation_spec.get("timing_budget", {}) if isinstance(animation_spec, dict) else {}
            step_id = int(plan.get("step_id", 0))
            title = self._safe_text(str(plan.get("title", f"步骤{step_id}")))
            title = self._safe_text(self._clean_display_text(title))
            duration = self._safe_duration(
                timing_budget.get("duration", plan.get("duration", 1.0)),
                1.0,
            )
            focus_entities = animation_spec.get("focus_entities", plan.get("focus_entities", [])) or []
            action_types = {
                str(a.get("type", ""))
                for a in plan.get("actions", [])
                if isinstance(a, dict)
            }
            layout = ctx.get("canvas_layout", {})
            formula_elements = [
                action.get("layout", action)
                for action in (animation_spec.get("formula_actions", []) or [])
                if isinstance(action, dict)
            ] or (layout.get("reserved_formula_elements", []) or [])
            emphasis_actions = [
                item for item in (animation_spec.get("emphasis_actions", []) or [])
                if isinstance(item, dict)
            ]
            movement_actions = [
                item for item in (animation_spec.get("movement_actions", []) or [])
                if isinstance(item, dict)
            ]
            label_actions = [
                item for item in (animation_spec.get("label_actions", []) or [])
                if isinstance(item, dict)
            ]
            restore_actions = [
                item for item in (animation_spec.get("restore_actions", []) or [])
                if isinstance(item, dict)
            ]
            helper_line_actions = [
                item for item in (animation_spec.get("helper_line_actions", []) or [])
                if isinstance(item, dict)
            ]

            step = step_by_id.get(step_id)
            audio_file = ""
            time_offset = float(plan.get("time_offset", 0.0))
            if step and getattr(step, "audio_file", None):
                audio_file = str(step.audio_file).replace("\\", "/")

            code.append(f"        # Step {step_id}: {title}")
            if audio_file:
                code.append(
                    f"        _safe_add_sound(r'{self._safe_text(audio_file)}', time_offset={time_offset:.2f})"
                )

            used = 0.0

            if formula_elements:
                reset_formula_area = bool(animation_spec.get("reset_formula_area", False))
                current_formula_slots = [
                    (
                        float(el.get("x", 0.7)),
                        float(el.get("y", 0.2)),
                        float(el.get("width", 0.25)),
                        float(el.get("height", 0.12)),
                    )
                    for el in formula_elements
                    if isinstance(el, dict)
                ]
                if (
                    has_formula_group
                    and not reset_formula_area
                    and self.formula_max_visible_slots > 0
                    and len(formula_slot_history) + len(current_formula_slots) > self.formula_max_visible_slots
                ):
                    reset_formula_area = True
                # 上游即便漏传 reset 标记，也在 codegen 侧兜底避免文字/公式重叠。
                if has_formula_group and not reset_formula_area:
                    overlap_found = any(
                        self._boxes_overlap(slot, old_slot)
                        for slot in current_formula_slots
                        for old_slot in formula_slot_history
                    )
                    if overlap_found:
                        reset_formula_area = True
                formula_reset_time = self._safe_duration(
                    timing_budget.get("formula_reset", 0.20),
                    0.20,
                )
                if reset_formula_area and has_formula_group:
                    code.append("        if len(current_formula_group) > 0:")
                    code.append(f"            self.play(FadeOut(current_formula_group), run_time={formula_reset_time:.2f})")
                    used += formula_reset_time
                    code.append("        current_formula_group = VGroup()")
                    visible_formula_texts.clear()

                code.append("        step_formula_group = VGroup()")
                code.append("        formula_specs = []")
                appended_formula_count = 0
                for el in formula_elements:
                    raw_content = str(el.get("content", ""))
                    raw_content = self._clean_display_text(raw_content)
                    line_label = self._parse_line_length_label(raw_content)
                    display_content = raw_content
                    x = float(el.get("x", 0.7))
                    y = float(el.get("y", 0.2))
                    w = float(el.get("width", 0.25))
                    h = float(el.get("height", 0.12))
                    center_nx = x + w * 0.5
                    center_ny = y + h * 0.5
                    if line_label:
                        _, length_text = line_label
                        display_content = length_text
                    normalized_display_content = re.sub(r"\s+", " ", display_content).strip()
                    if not normalized_display_content:
                        continue
                    if has_formula_group and not reset_formula_area and normalized_display_content in visible_formula_texts:
                        continue
                    wrap_width_est = max(w * frame_width - 0.30, 1.2)
                    formula_tex = self._to_mathtex(display_content) if self.prefer_mathtex else ""
                    if formula_tex:
                        content = self._safe_text(formula_tex)
                        code.append(f"        formula_specs.append(('math', '{content}', {center_nx:.6f}, {center_ny:.6f}, {w:.6f}, {h:.6f}))")
                    else:
                        wrapped = self._safe_text(self._wrap_plain_text(display_content, wrap_width_est))
                        code.append(f"        formula_specs.append(('text', '{wrapped}', {center_nx:.6f}, {center_ny:.6f}, {w:.6f}, {h:.6f}))")
                    visible_formula_texts.add(normalized_display_content)
                    appended_formula_count += 1
                if appended_formula_count == 0:
                    code.append("        step_formula_group = VGroup()")
                else:
                    code.append("        uniform_formula_scale = 1.0")
                    code.append("        pending_formula_objs = []")
                    code.append("        for kind, content, block_nx, block_ny, block_nw, block_nh in formula_specs:")
                    code.append("            block_x = -config.frame_width / 2 + block_nx * config.frame_width")
                    code.append("            block_y = config.frame_height / 2 - block_ny * config.frame_height")
                    code.append("            max_width = max(block_nw * config.frame_width - 0.30, 1.2)")
                    code.append("            max_height = max(block_nh * config.frame_height - 0.10, 0.45)")
                    code.append("            if kind == 'math':")
                    code.append(f"                formula_obj = MathTex(content, font_size={self.formula_math_font_size}, color=YELLOW)")
                    code.append("            else:")
                    code.append(f"                formula_obj = Text(content, font_size={self.formula_text_font_size}, color=YELLOW, line_spacing=0.85)")
                    code.append("            width_ratio = max_width / max(formula_obj.width, 1e-6)")
                    code.append("            height_ratio = max_height / max(formula_obj.height, 1e-6)")
                    code.append("            fit_ratio = min(1.0, width_ratio, height_ratio)")
                    code.append("            uniform_formula_scale = min(uniform_formula_scale, fit_ratio)")
                    code.append("            pending_formula_objs.append((formula_obj, block_x, block_y))")
                    code.append("        for formula_obj, block_x, block_y in pending_formula_objs:")
                    code.append("            if uniform_formula_scale < 1.0:")
                    code.append("                formula_obj.scale(uniform_formula_scale)")
                    code.append("            formula_obj.move_to(np.array([block_x, block_y, 0]))")
                    code.append("            step_formula_group.add(formula_obj)")
                show_time = self._safe_duration(
                    timing_budget.get("formula_show", min(1.0, duration * 0.25)),
                    0.15,
                )
                code.append("        if len(step_formula_group) > 0:")
                code.append(f"            self.play(FadeIn(step_formula_group), run_time={show_time:.2f})")
                if has_formula_group and not reset_formula_area:
                    code.append("            current_formula_group.add(*step_formula_group)")
                else:
                    code.append("            current_formula_group = step_formula_group")
                if reset_formula_area:
                    formula_slot_history = list(current_formula_slots)
                else:
                    formula_slot_history.extend(current_formula_slots)
                used += show_time
                has_formula_group = True

            current_scene = self._authoritative_step_scene(initial_scene, ctx)
            moved_points = self._extract_moved_points(prev_scene, current_scene)
            moved_point_ids = [
                str(item.get("point_id", "")).strip()
                for item in movement_actions
                if str(item.get("point_id", "")).strip()
            ] or list(moved_points.keys())
            if moved_point_ids:
                current_lookup = self._scene_points(current_scene)
                current_bbox = self._coordinate_bbox(current_lookup)
                current_screen_points = self._screen_point_map(
                    current_lookup,
                    current_bbox,
                    frame_width,
                    frame_height,
                    left_panel_x_max,
                    safe_margin,
                )
                move_time = self._safe_duration(
                    timing_budget.get("movement", min(0.8, duration * 0.3)),
                    0.2,
                )
                code.append("        move_anims = []")
                for point_id in moved_point_ids:
                    sx, sy = current_screen_points.get(point_id, (0.0, 0.0))
                    safe_id = self._safe_text(point_id)
                    label_dx, label_dy = self._label_offset(
                        point_id,
                        current_screen_points,
                        point_display,
                        point_payload_lookup.get(point_id),
                    )
                    code.append(f"        if '{safe_id}' in points:")
                    if point_id in hidden_derived_point_ids:
                        code.append(
                            f"            move_anims.append(points['{safe_id}'].animate.move_to(np.array([{sx:.3f}, {sy:.3f}, 0])).set_opacity(1))"
                        )
                    else:
                        code.append(
                            f"            move_anims.append(points['{safe_id}'].animate.move_to(np.array([{sx:.3f}, {sy:.3f}, 0])))"
                        )
                    code.append(f"        if '{safe_id}' in point_labels:")
                    if point_id in hidden_derived_point_ids:
                        code.append(
                            f"            move_anims.append(point_labels['{safe_id}'].animate.move_to(np.array([{sx + label_dx:.3f}, {sy + label_dy:.3f}, 0])).set_opacity(1))"
                        )
                    else:
                        code.append(
                            f"            move_anims.append(point_labels['{safe_id}'].animate.move_to(np.array([{sx + label_dx:.3f}, {sy + label_dy:.3f}, 0])))"
                        )
                code.append("        if move_anims:")
                code.append(f"            self.play(*move_anims, run_time={move_time:.2f})")
                used += move_time

            target_infos = self._build_focus_target_infos(focus_entities, point_lookup, primitives, primitive_display)
            targets = [t["expr"] for t in target_infos]
            emphasis_modes = {
                str(item.get("mode", "")).strip().lower()
                for item in emphasis_actions
                if str(item.get("mode", "")).strip()
            }
            highlight_enabled = (
                any(mode in {"highlight", "maintain"} for mode in emphasis_modes)
                or ("highlight" in action_types or "maintain" in action_types or "reuse_entities" in action_types)
            )
            transform_enabled = (
                "transform" in emphasis_modes
                or "transform" in action_types
            )

            if targets and highlight_enabled:
                hi_time = self._safe_duration(
                    timing_budget.get("emphasis", min(0.8, duration * 0.35)),
                    0.2,
                )
                code.append("        highlight_anims = []")
                for target_expr in targets:
                    code.append(f"        highlight_anims.append({target_expr}.animate.set_color(YELLOW))")
                code.append(f"        self.play(*highlight_anims, run_time={hi_time:.2f})")
                used += hi_time

            if targets and transform_enabled:
                tf_time = self._safe_duration(
                    timing_budget.get("transform", min(0.9, duration * 0.30)),
                    0.2,
                )
                code.append("        transform_anims = []")
                for info in target_infos:
                    if info.get("kind") == "line":
                        code.append(
                            f"        transform_anims.append({info['expr']}.animate.set_color(ORANGE))"
                        )
                    else:
                        code.append(
                            f"        transform_anims.append({info['expr']}.animate.scale(1.05).set_color(ORANGE))"
                        )
                code.append(f"        self.play(*transform_anims, run_time={tf_time:.2f})")
                used += tf_time

            label_target_ids = {
                str(item.get("target", "")).strip()
                for item in label_actions
                if str(item.get("target", "")).strip()
            }
            label_target_infos = [
                info
                for info in target_infos
                if info.get("kind") == "point" and (not label_target_ids or info.get("id") in label_target_ids)
            ]

            if label_target_infos and (label_actions or "label" in action_types):
                show_label_time = self._safe_duration(
                    timing_budget.get("label_show", min(0.6, duration * 0.2)),
                    0.15,
                )
                hide_label_time = self._safe_duration(
                    timing_budget.get("label_hide", min(0.4, duration * 0.15)),
                    0.1,
                )
                code.append("        temp_labels = VGroup()")
                for info in label_target_infos:
                    entity = self._safe_text(info["id"])
                    code.append(
                        f"        temp_labels.add(Text('{entity}', font_size=24, color=GREEN).next_to({info['expr']}, UP * 0.25))"
                    )
                code.append("        if len(temp_labels) > 0:")
                code.append(f"            self.play(FadeIn(temp_labels), run_time={show_label_time:.2f})")
                code.append(f"            self.play(FadeOut(temp_labels), run_time={hide_label_time:.2f})")
                used += show_label_time + hide_label_time

            restore_enabled = bool(restore_actions) or highlight_enabled or transform_enabled or "maintain" in action_types
            if targets and restore_enabled:
                restore_time = self._safe_duration(
                    timing_budget.get("restore", min(0.4, duration * 0.15)),
                    0.1,
                )
                code.append("        restore_anims = []")
                for info in target_infos:
                    if info.get("kind") == "line":
                        code.append(
                            f"        restore_anims.append({info['expr']}.animate.set_color({info['default_color']}).set_stroke(width=3))"
                        )
                    else:
                        code.append(
                            f"        restore_anims.append({info['expr']}.animate.set_color({info['default_color']}))"
                        )
                code.append(f"        self.play(*restore_anims, run_time={restore_time:.2f})")
                used += restore_time

            if helper_line_actions:
                helper_draw_time = self._safe_duration(
                    timing_budget.get("helper_draw", 1.0),
                    0.5,
                )
                helper_hold_time = self._safe_duration(
                    timing_budget.get("helper_hold", 0.3),
                    0.1,
                )
                helper_fade_time = self._safe_duration(
                    timing_budget.get("helper_fade", 0.3),
                    0.1,
                )
                code.append("        helper_lines = VGroup()")
                for hl_action in helper_line_actions:
                    hl_id = self._safe_text(str(hl_action.get("id") or f"aux_{len(helper_line_actions)}"))
                    hl_from = self._safe_text(str(hl_action.get("from") or ""))
                    hl_to = self._safe_text(str(hl_action.get("to") or ""))
                    hl_to_line = self._safe_text(str(hl_action.get("to_line") or ""))
                    hl_foot = self._safe_text(str(hl_action.get("foot") or ""))
                    hl_style = hl_action.get("style") or {}
                    hl_persist = str(hl_action.get("persist") or "until_step_end").strip()

                    color = str(hl_style.get("color", "BLUE")).strip()
                    dashed = bool(hl_style.get("dashed", True))
                    stroke_width = float(hl_style.get("stroke_width", 3) or 3)

                    if hl_from and hl_to:
                        code.append(f"        if '{hl_from}' in points and '{hl_to}' in points:")
                        if dashed:
                            code.append(
                                f"            hl_{hl_id} = DashedLine(points['{hl_from}'].get_center(), points['{hl_to}'].get_center(), color={color}, stroke_width={stroke_width:.2f})"
                            )
                        else:
                            code.append(
                                f"            hl_{hl_id} = Line(points['{hl_from}'].get_center(), points['{hl_to}'].get_center(), color={color}, stroke_width={stroke_width:.2f})"
                            )
                        code.append(f"            helper_lines.add(hl_{hl_id})")
                        code.append(f"            lines['{hl_id}'] = hl_{hl_id}")
                    elif hl_from and hl_foot:
                        code.append(f"        if '{hl_from}' in points and '{hl_foot}' in points:")
                        if dashed:
                            code.append(
                                f"            hl_{hl_id} = DashedLine(points['{hl_from}'].get_center(), points['{hl_foot}'].get_center(), color={color}, stroke_width={stroke_width:.2f})"
                            )
                        else:
                            code.append(
                                f"            hl_{hl_id} = Line(points['{hl_from}'].get_center(), points['{hl_foot}'].get_center(), color={color}, stroke_width={stroke_width:.2f})"
                            )
                        code.append(f"            helper_lines.add(hl_{hl_id})")
                        code.append(f"            lines['{hl_id}'] = hl_{hl_id}")

                code.append("        if len(helper_lines) > 0:")
                code.append(f"            self.play(Create(helper_lines), run_time={helper_draw_time:.2f})")
                used += helper_draw_time

                if helper_hold_time > 0:
                    code.append(f"            self.wait({helper_hold_time:.2f})")
                    used += helper_hold_time

                temp_helpers = [
                    hl for hl in helper_line_actions
                    if str(hl.get("persist", "until_step_end")).strip() == "until_step_end"
                ]
                if temp_helpers:
                    code.append(f"            self.play(FadeOut(helper_lines), run_time={helper_fade_time:.2f})")
                    used += helper_fade_time

            remain = round(max(duration - used, 0.0), 2)
            if remain > 0:
                code.append(f"        self.wait({remain:.2f})")

            code.append("")
            prev_scene = current_scene if isinstance(current_scene, dict) and current_scene else prev_scene

        return "\n".join(code)

    def validate_formal_video_code(
        self,
        manim_code: str,
        expected_steps: Optional[List[Dict[str, Any]]] = None,
    ) -> Tuple[bool, str]:
        is_valid, error_message, _report = self.validator.validate(
            manim_code,
            expected_steps=expected_steps,
        )
        return is_valid, error_message

    def _validate_drawable_scene_semantics(
        self,
        scene: Dict[str, Any],
        point_lookup: Dict[str, List[float]],
    ) -> None:
        if not isinstance(scene, dict):
            return
        point_ids = set(point_lookup.keys())
        primitive_map = {
            str(item.get("id", "")).strip(): item
            for item in (scene.get("primitives") or [])
            if isinstance(item, dict) and str(item.get("id", "")).strip()
        }

        for primitive in scene.get("primitives", []) or []:
            if not isinstance(primitive, dict):
                continue
            primitive_id = str(primitive.get("id", "")).strip() or "<anonymous>"
            primitive_type = str(primitive.get("type", "")).strip().lower()
            refs = [str(item).strip() for item in (primitive.get("points") or []) if str(item).strip()]

            if primitive_type == "segment":
                if len(refs) != 2:
                    raise ValueError(f"segment {primitive_id} must reference exactly 2 points")
                missing = [ref for ref in refs if ref not in point_ids]
                if missing:
                    raise ValueError(f"segment {primitive_id} references missing points: {missing}")
            elif primitive_type == "polygon":
                if len(refs) < 3:
                    raise ValueError(f"polygon {primitive_id} must reference at least 3 points")
                missing = [ref for ref in refs if ref not in point_ids]
                if missing:
                    raise ValueError(f"polygon {primitive_id} references missing points: {missing}")
            elif primitive_type == "circle":
                center = str(primitive.get("center", "")).strip()
                radius_point = str(primitive.get("radius_point", "")).strip()
                if not center or not radius_point:
                    raise ValueError(f"circle {primitive_id} must reference center and radius_point")
                missing = [ref for ref in [center, radius_point] if ref not in point_ids]
                if missing:
                    raise ValueError(f"circle {primitive_id} references missing points: {missing}")
            elif primitive_type == "arc":
                center = str(primitive.get("center", "")).strip()
                if len(refs) != 2:
                    raise ValueError(f"arc {primitive_id} must reference exactly 2 points")
                missing = [ref for ref in ([center] + refs) if ref and ref not in point_ids]
                if not center:
                    raise ValueError(f"arc {primitive_id} must reference center")
                if missing:
                    raise ValueError(f"arc {primitive_id} references missing points: {missing}")
            elif primitive_type in {"angle", "right_angle"}:
                if len(refs) != 3:
                    raise ValueError(f"{primitive_type} {primitive_id} must reference exactly 3 points")
                missing = [ref for ref in refs if ref not in point_ids]
                if missing:
                    raise ValueError(f"{primitive_type} {primitive_id} references missing points: {missing}")

        display = scene.get("display", {}) if isinstance(scene.get("display"), dict) else {}
        primitive_display = display.get("primitives", {}) if isinstance(display.get("primitives"), dict) else {}
        for primitive_id, payload in primitive_display.items():
            if not isinstance(payload, dict):
                continue
            role = str(payload.get("role", "")).strip().lower()
            style = str(payload.get("style", "")).strip().lower()
            primitive = primitive_map.get(str(primitive_id).strip())
            if not isinstance(primitive, dict):
                continue
            if str(primitive.get("type", "")).strip().lower() != "segment":
                continue
            if role == "construction" and style != "dashed":
                raise ValueError(f"construction segment {primitive_id} must use dashed style")
        for relation in scene.get("constraints", []) or []:
            if not isinstance(relation, dict):
                continue
            relation_type = str(relation.get("type", "")).strip().lower()
            entities = [str(item).strip() for item in (relation.get("entities") or []) if str(item).strip()]
            if relation_type not in {"point_in_polygon", "point_outside_polygon"} or len(entities) != 2:
                continue
            point_id, polygon_id = entities
            polygon = primitive_map.get(polygon_id)
            if point_id not in point_lookup:
                raise ValueError(f"drawable scene constraint {relation_type} references missing point {point_id}")
            if not isinstance(polygon, dict):
                raise ValueError(f"drawable scene constraint {relation_type} references missing polygon {polygon_id}")
            refs = [str(item).strip() for item in (polygon.get("points") or []) if str(item).strip()]
            if len(refs) < 3:
                raise ValueError(f"drawable scene polygon {polygon_id} has invalid point refs")
            missing_polygon_points = [ref for ref in refs if ref not in point_lookup]
            if missing_polygon_points:
                raise ValueError(
                    f"drawable scene polygon {polygon_id} references missing points: {missing_polygon_points}"
                )
            inside = self._point_in_polygon(point_lookup[point_id], [point_lookup[ref] for ref in refs])
            if relation_type == "point_in_polygon" and not inside:
                raise ValueError(f"drawable scene violates point_in_polygon for {point_id} in {polygon_id}")
            if relation_type == "point_outside_polygon" and inside:
                raise ValueError(f"drawable scene violates point_outside_polygon for {point_id} outside {polygon_id}")

    def _point_in_polygon(
        self,
        point: List[float],
        polygon: List[List[float]],
    ) -> bool:
        x = float(point[0])
        y = float(point[1])
        inside = False
        total = len(polygon)
        if total < 3:
            return False
        for index in range(total):
            x1, y1 = float(polygon[index][0]), float(polygon[index][1])
            x2, y2 = float(polygon[(index + 1) % total][0]), float(polygon[(index + 1) % total][1])
            intersects = ((y1 > y) != (y2 > y))
            if not intersects:
                continue
            cross_x = (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-9) + x1
            if x < cross_x:
                inside = not inside
        return inside

    def _build_class_name(self, project: Any) -> str:
        source = str(getattr(project, "problem_text", "") or "math_animation")
        digest = hashlib.sha1(source.encode("utf-8", errors="ignore")).hexdigest()[:8]
        # 固定短类名，显著降低 Windows 下 partial_movie_files 路径长度。
        return f"SceneMain_{digest}"

    def _safe_text(self, text: str) -> str:
        return text.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ")

    def _safe_duration(self, value: Any, default_value: float) -> float:
        try:
            val = float(value)
            if val <= 0:
                return default_value
            return round(val, 2)
        except (ValueError, TypeError):
            return default_value

    def _boxes_overlap(
        self,
        box_a: Tuple[float, float, float, float],
        box_b: Tuple[float, float, float, float],
        eps: float = 1e-3,
    ) -> bool:
        ax, ay, aw, ah = box_a
        bx, by, bw, bh = box_b
        a_left, a_top, a_right, a_bottom = ax, ay, ax + aw, ay + ah
        b_left, b_top, b_right, b_bottom = bx, by, bx + bw, by + bh
        return not (
            a_right <= b_left + eps
            or b_right <= a_left + eps
            or a_bottom <= b_top + eps
            or b_bottom <= a_top + eps
        )

    def _to_mathtex(self, text: str) -> str:
        if not self._looks_like_formula(text):
            return ""

        latex = text.strip()
        latex = latex.replace("′", "'")
        latex = latex.replace("△", r"\triangle ")
        latex = latex.replace("×", r"\times ")
        latex = latex.replace("·", r"\cdot ")
        latex = latex.replace("≤", r"\le ")
        latex = latex.replace("≥", r"\ge ")
        latex = latex.replace("≠", r"\neq ")
        latex = latex.replace("²", "^2")
        latex = latex.replace("°", r"^{\circ}")
        latex = re.sub(r"√\(([^()]+)\)", r"\\sqrt{\1}", latex)
        latex = re.sub(r"(?<![\\A-Za-z])√([A-Za-z0-9]+)", r"\\sqrt{\1}", latex)
        latex = latex.replace("cm²", r"\\,\\mathrm{cm}^2")
        latex = re.sub(r"(?<![A-Za-z])cm\b", r"\\,\\mathrm{cm}", latex)
        latex = re.sub(r"\s+", " ", latex).strip()
        return latex

    def _wrap_plain_text(self, text: str, max_width: float) -> str:
        normalized = re.sub(r"\s+", " ", text).strip()
        if not normalized:
            return ""

        max_chars = max(8, min(22, int(max_width * 5.2)))
        lines: List[str] = []
        current = ""
        for char in normalized:
            current += char
            if len(current) >= max_chars and char not in " ,，。；：)）]】":
                lines.append(current)
                current = ""
        if current:
            lines.append(current)
        return "\n".join(lines[:4])

    def _parse_line_length_label(self, text: str) -> Optional[Tuple[str, str]]:
        candidate = text.strip()
        match = re.fullmatch(
            r"([A-Za-z]{1,3}'?)\s*=\s*(\d+(?:\.\d+)?)\s*cm\b",
            candidate,
            flags=re.IGNORECASE,
        )
        if not match:
            return None
        line_id = match.group(1).upper()
        length_val = match.group(2)
        return line_id, f"{length_val} cm"

    def _looks_like_formula(self, text: str) -> bool:
        candidate = text.strip()
        if not candidate:
            return False
        if re.search(r"[\u4e00-\u9fff]", candidate):
            return False
        return any(token in candidate for token in ["=", "+", "-", "√", "²", "×", "/", "cm", "^"])

    def _coordinate_bbox(self, point_lookup: Dict[str, List[float]]) -> Tuple[float, float, float, float]:
        if not point_lookup:
            return (0.0, 1.0, 0.0, 1.0)
        xs = [coord[0] for coord in point_lookup.values()]
        ys = [coord[1] for coord in point_lookup.values()]
        min_x = min(xs)
        max_x = max(xs)
        min_y = min(ys)
        max_y = max(ys)
        if abs(max_x - min_x) < 1e-6:
            max_x = min_x + 1.0
        if abs(max_y - min_y) < 1e-6:
            max_y = min_y + 1.0
        return (min_x, max_x, min_y, max_y)

    def _screen_point_map(
        self,
        point_lookup: Dict[str, List[float]],
        bbox: Tuple[float, float, float, float],
        frame_width: float,
        frame_height: float,
        left_panel_x_max: float,
        safe_margin: float,
    ) -> Dict[str, Tuple[float, float]]:
        result: Dict[str, Tuple[float, float]] = {}
        for point_id, coord in point_lookup.items():
            result[point_id] = self._coord_to_geometry_scene_xy(
                coord[0],
                coord[1],
                bbox,
                frame_width,
                frame_height,
                left_panel_x_max,
                safe_margin,
            )
        return result

    def _coord_to_geometry_scene_xy(
        self,
        x: float,
        y: float,
        bbox: Tuple[float, float, float, float],
        frame_width: float,
        frame_height: float,
        left_panel_x_max: float,
        safe_margin: float,
    ) -> Tuple[float, float]:
        min_x, max_x, min_y, max_y = bbox
        half_w = frame_width / 2.0
        half_h = frame_height / 2.0
        x_min_scene = -half_w + safe_margin
        x_max_scene = left_panel_x_max - safe_margin * 0.2
        y_min_scene = -half_h + safe_margin
        y_max_scene = half_h - safe_margin

        data_width = max(max_x - min_x, 1e-6)
        data_height = max(max_y - min_y, 1e-6)
        scene_width = max(x_max_scene - x_min_scene, 1e-6)
        scene_height = max(y_max_scene - y_min_scene, 1e-6)
        scale = min(scene_width / data_width, scene_height / data_height)

        data_center_x = (min_x + max_x) / 2.0
        data_center_y = (min_y + max_y) / 2.0
        scene_center_x = (x_min_scene + x_max_scene) / 2.0
        scene_center_y = (y_min_scene + y_max_scene) / 2.0

        sx = scene_center_x + (float(x) - data_center_x) * scale
        sy = scene_center_y + (float(y) - data_center_y) * scale
        return sx, sy

    def _display_bool(
        self,
        display_block: Dict[str, Any],
        entity_id: str,
        key: str,
        default: bool,
    ) -> bool:
        item = display_block.get(entity_id)
        if not isinstance(item, dict):
            return default
        return bool(item.get(key, default))

    def _display_value(
        self,
        display_block: Dict[str, Any],
        entity_id: str,
        key: str,
        default: Any = None,
    ) -> Any:
        item = display_block.get(entity_id)
        if not isinstance(item, dict):
            return default
        return item.get(key, default)

    def _manim_color_expr(self, color_name: Any, default: str = "BLUE_E") -> str:
        if color_name is None:
            return default
        name = str(color_name).strip()
        if not name:
            return default
        upper_name = name.upper()
        known_colors = {
            "WHITE", "BLUE", "BLUE_E", "GREEN", "YELLOW", "RED", "ORANGE",
            "GRAY", "GREY", "PURPLE", "TEAL", "PINK", "GOLD", "MAROON", "BLACK",
        }
        if upper_name in known_colors:
            return upper_name
        return f'"{self._safe_text(name)}"'

    def _build_focus_target_infos(
        self,
        focus_entities: List[str],
        point_lookup: Dict[str, List[float]],
        primitives: List[Dict[str, Any]],
        primitive_display: Dict[str, Any],
    ) -> List[Dict[str, str]]:
        point_ids = set(point_lookup.keys())
        primitive_kind: Dict[str, str] = {}
        primitive_color: Dict[str, str] = {}

        for primitive in primitives:
            if not isinstance(primitive, dict):
                continue
            primitive_id = str(primitive.get("id", "")).strip()
            primitive_type = str(primitive.get("type", "")).strip().lower()
            refs = [str(item).strip() for item in (primitive.get("points") or []) if str(item).strip()]
            if not primitive_id:
                continue

            # 仅允许引用当前场景已可绘制的 primitive，避免后续访问未注册对象。
            drawable = True
            if primitive_type == "segment":
                if not self._segment_visible_for_render(primitive_id, primitive_display):
                    continue
                drawable = len(refs) == 2 and all(ref in point_ids for ref in refs)
            elif primitive_type == "polygon":
                drawable = len(refs) >= 3 and all(ref in point_ids for ref in refs)
            elif primitive_type == "circle":
                center = str(primitive.get("center", "")).strip()
                radius_point = str(primitive.get("radius_point", "")).strip()
                drawable = bool(center and radius_point and center in point_ids and radius_point in point_ids)
            elif primitive_type == "arc":
                center = str(primitive.get("center", "")).strip()
                drawable = bool(center and center in point_ids and len(refs) == 2 and all(ref in point_ids for ref in refs))
            elif primitive_type in {"angle", "right_angle"}:
                drawable = len(refs) == 3 and all(ref in point_ids for ref in refs)
            if not drawable:
                continue

            show_primitive = self._display_bool(
                primitive_display,
                primitive_id,
                "show",
                default=(primitive_type not in {"angle", "right_angle"}),
            )
            if not show_primitive and primitive_type in {"angle", "right_angle"}:
                continue
            primitive_kind[primitive_id] = "line" if primitive_type == "segment" else "object"
            default = "BLUE_E" if primitive_type == "segment" else "BLUE"
            primitive_color[primitive_id] = self._manim_color_expr(
                self._display_value(primitive_display, primitive_id, "color"),
                default=default,
            )

        targets: List[Dict[str, str]] = []
        for raw in focus_entities:
            entity_id = str(raw)
            safe = self._safe_text(entity_id)
            if entity_id in point_ids:
                targets.append({
                    "id": entity_id,
                    "expr": f"points['{safe}']",
                    "kind": "point",
                    "default_color": "WHITE",
                })
            elif primitive_kind.get(entity_id) == "line":
                targets.append({
                    "id": entity_id,
                    "expr": f"lines['{safe}']",
                    "kind": "line",
                    "default_color": primitive_color.get(entity_id, "BLUE_E"),
                })
            elif primitive_kind.get(entity_id) == "object":
                targets.append({
                    "id": entity_id,
                    "expr": f"objects['{safe}']",
                    "kind": "object",
                    "default_color": primitive_color.get(entity_id, "BLUE"),
                })

        deduped: List[Dict[str, str]] = []
        seen = set()
        for target in targets:
            key = target["expr"]
            if key in seen:
                continue
            seen.add(key)
            deduped.append(target)
        return deduped

    def _segment_source(self, primitive_id: str, primitive_display: Dict[str, Any]) -> str:
        payload = primitive_display.get(primitive_id)
        if not isinstance(payload, dict):
            return ""
        source = str(payload.get("source", "")).strip().lower()
        if source:
            return source
        role = str(payload.get("role", "")).strip().lower()
        style = str(payload.get("style", "")).strip().lower()
        if role == "construction" or style == "dashed":
            return "approved_auxiliary"
        return "given"

    def _segment_visible_for_render(self, primitive_id: str, primitive_display: Dict[str, Any]) -> bool:
        payload = primitive_display.get(primitive_id)
        if isinstance(payload, dict):
            if payload.get("show") is False:
                return False
            source = self._segment_source(primitive_id, primitive_display)
            if source and source not in {"given", "approved_auxiliary"}:
                return False
            role = str(payload.get("role", "")).strip().lower()
            if role == "construction" and source != "approved_auxiliary":
                return False
        return True

    def _scene_points(self, scene: Dict[str, Any]) -> Dict[str, List[float]]:
        """从 coordinate_scene 或旧 scene_graph 中提取点坐标。"""
        result: Dict[str, List[float]] = {}
        if not isinstance(scene, dict):
            return result
        points = scene.get("points", {})
        if isinstance(points, dict):
            for pid, payload in points.items():
                if not isinstance(payload, dict):
                    continue
                coord = payload.get("coord")
                pos = coord if isinstance(coord, list) and len(coord) == 2 else payload.get("pos")
                if not isinstance(pos, list) or len(pos) != 2:
                    continue
                try:
                    result[str(pid)] = [float(pos[0]), float(pos[1])]
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

    def _point_payload_lookup(self, scene: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        lookup: Dict[str, Dict[str, Any]] = {}
        if not isinstance(scene, dict):
            return lookup
        points = scene.get("points", [])
        if isinstance(points, dict):
            for point_id, payload in points.items():
                if isinstance(payload, dict):
                    lookup[str(point_id)] = payload
            return lookup
        if isinstance(points, list):
            for item in points:
                if not isinstance(item, dict):
                    continue
                point_id = str(item.get("id", "")).strip()
                if not point_id:
                    continue
                lookup[point_id] = item
        return lookup

    def _point_label_text(
        self,
        point_id: str,
        point_display: Dict[str, Any],
        payload: Optional[Dict[str, Any]],
    ) -> str:
        explicit = self._display_value(point_display, point_id, "label")
        if isinstance(explicit, str) and explicit.strip():
            return explicit.strip()

        derived = payload.get("derived") if isinstance(payload, dict) else None
        if isinstance(derived, dict) and str(derived.get("type", "")).strip().lower() == "reflect_point":
            source_id = str(derived.get("source", "")).strip()
            if source_id:
                return f"{source_id}'"

        match = re.fullmatch(r"([A-Za-z]+)1", point_id)
        if match:
            return f"{match.group(1)}'"
        return point_id

    def _label_offset(
        self,
        point_id: str,
        screen_points: Dict[str, Tuple[float, float]],
        point_display: Dict[str, Any],
        payload: Optional[Dict[str, Any]],
    ) -> Tuple[float, float]:
        explicit = str(self._display_value(point_display, point_id, "label_direction", "") or "").strip().lower()
        if explicit:
            mapping = {
                "up": (0.0, 0.28),
                "down": (0.0, -0.30),
                "left": (-0.26, 0.0),
                "right": (0.26, 0.0),
                "up_left": (-0.22, 0.24),
                "up_right": (0.22, 0.24),
                "down_left": (-0.22, -0.24),
                "down_right": (0.22, -0.24),
            }
            if explicit in mapping:
                return mapping[explicit]

        x, y = screen_points.get(point_id, (0.0, 0.0))
        if y < -1.5:
            return (0.0, -0.30)
        if y > 2.0:
            return (0.0, 0.28)
        if x < -2.4:
            return (-0.24, 0.10)
        if x > 0.5:
            return (0.24, 0.10)
        return (0.0, 0.28)

    def _extract_moved_points(
        self,
        prev_scene: Dict[str, Any],
        curr_scene: Dict[str, Any],
        eps: float = 1e-6,
    ) -> Dict[str, List[float]]:
        prev_points = self._scene_points(prev_scene)
        curr_points = self._scene_points(curr_scene)
        moved: Dict[str, List[float]] = {}
        for pid, curr_pos in curr_points.items():
            prev_pos = prev_points.get(pid)
            if prev_pos is None:
                continue
            if abs(curr_pos[0] - prev_pos[0]) > eps or abs(curr_pos[1] - prev_pos[1]) > eps:
                moved[pid] = curr_pos
        return moved

    def _authoritative_step_scene(
        self,
        base_scene: Dict[str, Any],
        ctx: Dict[str, Any],
    ) -> Dict[str, Any]:
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

    def _resolve_initial_scene(
        self,
        *,
        coordinate_scene_data: Dict[str, Any],
        step_contexts: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        base_scene = coordinate_scene_data if isinstance(coordinate_scene_data, dict) else {}
        if self._scene_points(base_scene):
            return base_scene
        for ctx in step_contexts:
            if not isinstance(ctx, dict):
                continue
            step_scene = ctx.get("step_scene", {})
            if not isinstance(step_scene, dict):
                continue
            candidate = step_scene.get("scene", {})
            if isinstance(candidate, dict) and self._scene_points(candidate):
                return candidate
        return base_scene

    def _to_mathtex(self, text: str) -> str:
        if not self._looks_like_formula(text):
            return ""

        latex = text.strip()
        replacements = {
            "脳": r"\times ",
            "路": r"\cdot ",
            "虏": "^2",
            "掳": r"^{\circ}",
            "//": r"\parallel ",
            "∠": r"\angle ",
            "△": r"\triangle ",
            "≤": r"\le ",
            "≥": r"\ge ",
            "≠": r"\neq ",
            "∵": r"\because ",
            "∴": r"\therefore ",
        }
        for source, target in replacements.items():
            latex = latex.replace(source, target)

        latex = re.sub(r"(?<![A-Za-z])cm\b", r"\\,\\mathrm{cm}", latex)
        latex = re.sub(r"\s+", " ", latex).strip()
        if not self._is_safe_mathtex_content(latex):
            return ""
        return latex

    def _looks_like_formula(self, text: str) -> bool:
        candidate = text.strip()
        if not candidate:
            return False
        if re.search(r"[\u4e00-\u9fff]", candidate):
            return False
        if self._contains_mojibake(candidate):
            return False
        formula_tokens = ["=", "+", "-", "/", "cm", "^", "//", "∠", "△", "≤", "≥", "≠"]
        return any(token in candidate for token in formula_tokens)

    def _contains_mojibake(self, text: str) -> bool:
        markers = ["鈭", "锛", "銆", "鐨", "姣", "∵", "∴"]
        return any(marker in text for marker in markers)

    def _is_safe_mathtex_content(self, text: str) -> bool:
        if not text.strip():
            return False
        if self._contains_mojibake(text):
            return False
        safe_pattern = re.compile(r"^[A-Za-z0-9\s\\{}_^=+\-*/().,:|<>\[\]]+$")
        return bool(safe_pattern.fullmatch(text))

    def _clean_display_text(self, text: str) -> str:
        cleaned = str(text or "").strip()
        if not cleaned:
            return ""
        replacements = {
            "\u922d\u71d7": "\u2220",
            "\u922d": "\u2220",
            "\u922e": "\u2220",
            "\u925b": "\u25b3",
            "\u922b": "\u25b3",
            "\u6397": "\u00b0",
            "\u865f": "^2",
            "\u8123": "\u00d7",
            "\u8def": "\u00b7",
            "\u71d7": "A",
            "\u71d8": "B",
            "\u71d9": "C",
            "\u71e9": "P",
            "\u77e8": "A",
            "\u7805": "P",
        }
        for source, target in replacements.items():
            cleaned = cleaned.replace(source, target)
        cleaned = cleaned.replace("??", "").replace("锛?", "").replace("銆?", "")
        return re.sub(r"\s+", " ", cleaned).strip()

    def _wrap_plain_text(self, text: str, max_width: float) -> str:
        normalized = re.sub(r"\s+", " ", self._clean_display_text(text)).strip()
        if not normalized:
            return ""
        max_chars = max(8, min(22, int(max_width * 5.2)))
        lines: List[str] = []
        current = ""
        for char in normalized:
            current += char
            if len(current) >= max_chars and char not in " ,，。；：!?":
                lines.append(current)
                current = ""
        if current:
            lines.append(current)
        return "\n".join(lines[:4])

    def _to_mathtex(self, text: str) -> str:
        candidate = self._clean_display_text(text)
        if not self._looks_like_formula(candidate):
            return ""
        latex = candidate
        replacements = {
            "\u2019": "'",
            "\u2032": "'",
            "\u25b3": r"\triangle ",
            "\u00d7": r"\times ",
            "\u00b7": r"\cdot ",
            "\u2264": r"\le ",
            "\u2265": r"\ge ",
            "\u2260": r"\neq ",
            "\u2220": r"\angle ",
            "\u00b0": r"^{\circ}",
        }
        for source, target in replacements.items():
            latex = latex.replace(source, target)
        latex = latex.replace("cm^2", r"\\,\\mathrm{cm}^2")
        latex = re.sub(r"(?<![A-Za-z])cm\b", r"\\,\\mathrm{cm}", latex)
        latex = re.sub(r"\s+", " ", latex).strip()
        if not self._is_safe_mathtex_content(latex):
            return ""
        return latex

    def _looks_like_formula(self, text: str) -> bool:
        candidate = self._clean_display_text(text).strip()
        if not candidate:
            return False
        if re.search(r"[\u4e00-\u9fff]", candidate):
            return False
        formula_tokens = ["=", "+", "-", "/", "cm", "^", "//", "\u2220", "\u25b3", "\u00b0"]
        return any(token in candidate for token in formula_tokens)

    def _contains_mojibake(self, text: str) -> bool:
        markers = ["\u95b3", "\u95bf", "\u95b5", "\u95bb", "\u6fee"]
        return any(marker in str(text) for marker in markers)

    def _is_safe_mathtex_content(self, text: str) -> bool:
        if not text.strip():
            return False
        if self._contains_mojibake(text):
            return False
        safe_pattern = re.compile(r"^[A-Za-z0-9\s\\{}_^=+\-*/().,:|<>\[\]']+$")
        return bool(safe_pattern.fullmatch(text))
