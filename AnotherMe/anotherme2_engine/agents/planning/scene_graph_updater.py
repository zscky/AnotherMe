"""
场景图更新器 - 根据步骤描述生成题图增量状态，保持对象引用稳定
"""
import copy
import re
from typing import Any, Dict, List, Optional, Set


class SceneGraphUpdater:
    """根据步骤描述生成题图增量状态，保持对象引用稳定。"""

    def build_step_scene(
        self,
        base_scene_graph: Dict[str, Any],
        step: Any,
        step_index: int,
        teaching_step: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """根据步骤描述生成题图增量状态，保持对象引用稳定。"""
        current_scene = copy.deepcopy(base_scene_graph or {})
        extracted_focus = self._extract_focus_entities(current_scene, step)
        teaching_focus = self._collect_teaching_focus_targets(teaching_step)
        focus_entities = self._merge_focus_targets(extracted_focus, teaching_focus)

        teaching_actions = (
            teaching_step.get("actions", [])
            if isinstance(teaching_step, dict)
            else []
        )
        required_actions = (
            teaching_step.get("required_actions", [])
            if isinstance(teaching_step, dict)
            else []
        )
        animation_policy = self._resolve_animation_policy(teaching_step)
        explicit_actions_present = bool(teaching_actions) or bool(required_actions)

        operations: List[Dict[str, Any]] = []
        operations.extend(
            self._operations_from_teaching_actions(
                [*(teaching_actions or []), *(required_actions or [])],
                focus_entities,
            )
        )

        has_transform_operation = any(
            str(item.get("type", "")).strip().lower() == "transform"
            for item in operations
        )
        
        # 检查是否应该抑制自动变换
        suppress_auto_transform = (
            isinstance(teaching_step, dict)
            and teaching_step.get("fold_execution", {}).get("suppress_auto_transform", False)
        )
        
        if animation_policy == "auto" and not has_transform_operation and not suppress_auto_transform and (
            (not explicit_actions_present) or self._step_mentions_transform(step)
        ):
            operations.extend(self._infer_operations(step, focus_entities))

        operations = self._dedupe_operations(operations)
        current_scene = self._apply_operations(current_scene, operations, focus_entities, step_index)
        current_scene = self._apply_visibility_policy(
            current_scene,
            teaching_step=teaching_step,
            focus_entities=focus_entities,
        )
        allow_geometry_motion = self._has_geometry_motion(base_scene_graph, current_scene, operations)

        return {
            "step_id": step.id,
            "step_index": step_index,
            "title": step.title,
            "focus_entities": focus_entities,
            "operations": operations,
            "scene": current_scene,
            "allow_geometry_motion": allow_geometry_motion,
        }

    def _step_mentions_transform(self, step: Any) -> bool:
        cue_text = "\n".join([
            str(getattr(step, "title", "") or ""),
            str(getattr(step, "narration", "") or ""),
            " ".join(str(item) for item in (getattr(step, "visual_cues", []) or [])),
        ])
        if not any(keyword in cue_text for keyword in ["折叠", "旋转", "翻折"]):
            return False

        suppress_keywords = [
            "不折叠",
            "不执行折叠",
            "仅观察",
            "先观察",
            "仅高亮",
            "只高亮",
            "高亮折叠轴",
            "标出折叠轴",
            "识别折叠轴",
        ]
        if any(keyword in cue_text for keyword in suppress_keywords):
            return False

        # 仅提到“折叠轴”通常是讲解/识别步骤，不应默认触发几何变换。
        if "折叠轴" in cue_text and not any(keyword in cue_text for keyword in ["沿", "折叠后", "翻折后", "得到", "执行"]):
            return False

        return True

    def _scene_points(self, scene_graph: Dict[str, Any]) -> Dict[str, List[float]]:
        result: Dict[str, List[float]] = {}
        if not isinstance(scene_graph, dict):
            return result

        points = scene_graph.get("points") or {}
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

    def _has_geometry_motion(
        self,
        before_scene: Dict[str, Any],
        after_scene: Dict[str, Any],
        operations: List[Dict[str, Any]],
        eps: float = 1e-6,
    ) -> bool:
        has_transform = any(str(item.get("type", "")).strip().lower() == "transform" for item in operations)
        if not has_transform:
            return False

        before_points = self._scene_points(before_scene)
        after_points = self._scene_points(after_scene)
        for point_id, after_pos in after_points.items():
            before_pos = before_points.get(point_id)
            if before_pos is None:
                continue
            if abs(after_pos[0] - before_pos[0]) > eps or abs(after_pos[1] - before_pos[1]) > eps:
                return True
        return False

    def _apply_operations(
        self,
        scene_graph: Dict[str, Any],
        operations: List[Dict[str, Any]],
        focus_entities: List[str],
        step_index: int,
    ) -> Dict[str, Any]:
        """执行轻量几何更新：在 transform/fold 场景下更新点坐标，形成真实 step scene。"""
        scene = copy.deepcopy(scene_graph or {})
        points = scene.get("points") or {}
        lines = scene.get("lines") or []
        primitives = scene.get("primitives") or []

        def _point_item(pid: str) -> Optional[Dict[str, Any]]:
            if isinstance(points, dict):
                item = points.get(pid)
                return item if isinstance(item, dict) else None
            if isinstance(points, list):
                for item in points:
                    if not isinstance(item, dict):
                        continue
                    if str(item.get("id", "")).strip() == pid:
                        return item
            return None

        def _get_pos(pid: str) -> Optional[List[float]]:
            item = _point_item(pid)
            if item is None:
                return None
            pos = item.get("coord")
            if not isinstance(pos, list) or len(pos) != 2:
                pos = item.get("pos")
            if not isinstance(pos, list) or len(pos) != 2:
                return None
            try:
                return [float(pos[0]), float(pos[1])]
            except (TypeError, ValueError):
                return None

        def _set_pos(pid: str, pos: List[float]) -> None:
            x = float(pos[0])
            y = float(pos[1])
            item = _point_item(pid)
            if item is None:
                if isinstance(points, dict):
                    points[pid] = {"pos": [x, y]}
                elif isinstance(points, list):
                    points.append({"id": pid, "coord": [x, y]})
                return
            if "coord" in item or isinstance(points, list):
                item["coord"] = [x, y]
            else:
                item["pos"] = [x, y]

        def _line_points(line_id: str) -> Optional[List[str]]:
            for item in lines:
                if not isinstance(item, dict):
                    continue
                if str(item.get("id", "")) != line_id:
                    continue
                refs = item.get("points")
                if isinstance(refs, list) and len(refs) >= 2:
                    return [str(refs[0]), str(refs[1])]
            for primitive in primitives:
                if not isinstance(primitive, dict):
                    continue
                if str(primitive.get("type", "")).strip().lower() != "segment":
                    continue
                if str(primitive.get("id", "")).strip() != line_id:
                    continue
                refs = primitive.get("points")
                if isinstance(refs, list) and len(refs) >= 2:
                    return [str(refs[0]), str(refs[1])]
            return None

        def _reflect_point(point: List[float], axis_a: List[float], axis_b: List[float]) -> List[float]:
            ax, ay = axis_a
            bx, by = axis_b
            px, py = point
            vx, vy = bx - ax, by - ay
            denom = vx * vx + vy * vy
            if denom <= 1e-10:
                return point
            # 先投影到轴线，再做镜像。
            t = ((px - ax) * vx + (py - ay) * vy) / denom
            proj_x = ax + t * vx
            proj_y = ay + t * vy
            return [2 * proj_x - px, 2 * proj_y - py]

        has_transform = any(str(op.get("type", "")) == "transform" for op in operations)
        if not has_transform:
            return scene

        # 折叠轴优先级：步骤显式提到的线段 -> AD -> AB -> 第一条可用线段
        axis_pairs: List[List[str]] = []
        for op in operations:
            if str(op.get("type", "")).strip().lower() != "transform":
                continue
            axis_hint = str(op.get("axis", "")).strip()
            if not axis_hint:
                continue
            refs = _line_points(axis_hint)
            if refs:
                axis_pairs.append(refs)
                continue
            parsed = re.findall(r"[A-Za-z]\d*'?", axis_hint)
            if len(parsed) >= 2:
                axis_pairs.append([
                    str(parsed[0]).strip(),
                    str(parsed[1]).strip(),
                ])

        line_ids = {
            str(item.get("id", ""))
            for item in lines
            if isinstance(item, dict) and item.get("id")
        }
        line_ids.update(
            str(item.get("id", ""))
            for item in primitives
            if isinstance(item, dict)
            and item.get("id")
            and str(item.get("type", "")).strip().lower() == "segment"
        )
        for entity_id in focus_entities:
            if entity_id in line_ids:
                refs = _line_points(entity_id)
                if refs:
                    axis_pairs.append(refs)
        if _line_points("AD"):
            axis_pairs.append(_line_points("AD"))
        if _line_points("AB"):
            axis_pairs.append(_line_points("AB"))
        for item in lines:
            if not isinstance(item, dict):
                continue
            refs = item.get("points")
            if isinstance(refs, list) and len(refs) >= 2:
                axis_pairs.append([str(refs[0]), str(refs[1])])

        axis = None
        for pair in axis_pairs:
            if not pair:
                continue
            a = _get_pos(pair[0])
            b = _get_pos(pair[1])
            if a is not None and b is not None:
                axis = (a, b)
                break

        if axis is None:
            return scene

        axis_a, axis_b = axis

        derived_points: List[Dict[str, Any]] = []
        if isinstance(points, list):
            derived_points = [
                item for item in points
                if isinstance(item, dict) and isinstance(item.get("derived"), dict)
            ]

        # 对 derived reflect_point 做折叠更新。
        # 为避免一步跳变过大，前几步采用插值推进。
        alpha = 0.55 if step_index <= 2 else 1.0
        for item in derived_points:
            entity_id = str(item.get("id", "")).strip()
            derived = item.get("derived") or {}
            if str(derived.get("type", "")).strip().lower() != "reflect_point":
                continue
            base_id = str(derived.get("source", "")).strip()
            src = _get_pos(base_id)
            dst = _get_pos(entity_id)
            if src is None or dst is None:
                continue
            target_axis = [str(x) for x in (derived.get("axis") or [])]
            if len(target_axis) == 2:
                local_a = _get_pos(target_axis[0]) or axis_a
                local_b = _get_pos(target_axis[1]) or axis_b
            else:
                local_a, local_b = axis_a, axis_b
            reflected = _reflect_point(src, local_a, local_b)
            nx = dst[0] + (reflected[0] - dst[0]) * alpha
            ny = dst[1] + (reflected[1] - dst[1]) * alpha
            _set_pos(entity_id, [nx, ny])

        scene = self._apply_helper_line_operations(scene, operations)

        return scene

    def _apply_helper_line_operations(
        self,
        scene: Dict[str, Any],
        operations: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        helper_ops = [
            op for op in operations
            if str(op.get("type", "")).strip().lower() == "helper_line"
        ]
        if not helper_ops:
            return scene

        primitives = scene.get("primitives") or []
        if not isinstance(primitives, list):
            primitives = []
            scene["primitives"] = primitives

        display = scene.get("display") or {}
        if not isinstance(display, dict):
            display = {}
            scene["display"] = display
        primitive_display = display.get("primitives") or {}
        if not isinstance(primitive_display, dict):
            primitive_display = {}
            display["primitives"] = primitive_display

        points = scene.get("points") or {}

        def _get_point_pos(pid: str) -> Optional[List[float]]:
            if isinstance(points, dict):
                item = points.get(pid)
                if isinstance(item, dict):
                    coord = item.get("coord") or item.get("pos")
                    if isinstance(coord, list) and len(coord) == 2:
                        try:
                            return [float(coord[0]), float(coord[1])]
                        except (TypeError, ValueError):
                            pass
            elif isinstance(points, list):
                for item in points:
                    if isinstance(item, dict) and str(item.get("id", "")).strip() == pid:
                        coord = item.get("coord") or item.get("pos")
                        if isinstance(coord, list) and len(coord) == 2:
                            try:
                                return [float(coord[0]), float(coord[1])]
                            except (TypeError, ValueError):
                                pass
            return None

        def _get_line_endpoints(line_id: str) -> Optional[List[str]]:
            for prim in primitives:
                if not isinstance(prim, dict):
                    continue
                if str(prim.get("id", "")).strip() == line_id:
                    pts = prim.get("points")
                    if isinstance(pts, list) and len(pts) >= 2:
                        return [str(pts[0]).strip(), str(pts[1]).strip()]
            return None

        for op in helper_ops:
            action = str(op.get("action", "")).strip()
            aux_id = str(op.get("id") or f"aux_{action[:4]}").strip()
            from_point = str(op.get("from", "")).strip()
            to_point = str(op.get("to", "")).strip()
            to_line = str(op.get("to_line", "")).strip()
            foot = str(op.get("foot", "")).strip()
            style = op.get("style") or {}

            segment_points: List[str] = []

            if action == "draw_connection_auxiliary":
                if from_point and to_point:
                    segment_points = [from_point, to_point]

            elif action == "connect_center_tangent":
                if from_point and to_point:
                    segment_points = [from_point, to_point]

            elif action == "draw_perpendicular_auxiliary":
                if from_point and to_line:
                    line_endpoints = _get_line_endpoints(to_line)
                    if line_endpoints:
                        from_pos = _get_point_pos(from_point)
                        p1_pos = _get_point_pos(line_endpoints[0])
                        p2_pos = _get_point_pos(line_endpoints[1])
                        if from_pos and p1_pos and p2_pos:
                            foot_pos = self._compute_foot_point(from_pos, p1_pos, p2_pos)
                            if foot_pos:
                                if foot:
                                    existing_ids = {str(p.get("id", "")).strip() for p in primitives if isinstance(p, dict)}
                                    existing_ids.update(
                                        str(pid).strip()
                                        for pid in (points.keys() if isinstance(points, dict) else [p.get("id", "") for p in (points if isinstance(points, list) else [])])
                                    )
                                    if foot not in existing_ids:
                                        new_point: Dict[str, Any] = {"id": foot, "coord": foot_pos}
                                        if isinstance(points, list):
                                            points.append(new_point)
                                        elif isinstance(points, dict):
                                            points[foot] = {"coord": foot_pos}
                                segment_points = [from_point, foot if foot else f"H_{from_point}"]

            elif action == "draw_parallel_auxiliary":
                if from_point and to_line:
                    line_endpoints = _get_line_endpoints(to_line)
                    if line_endpoints:
                        segment_points = [from_point, f"parallel_end_{aux_id}"]

            elif action == "extend_segment":
                segment_id = str(op.get("segment", "")).strip()
                if segment_id:
                    line_endpoints = _get_line_endpoints(segment_id)
                    if line_endpoints:
                        segment_points = line_endpoints

            if len(segment_points) >= 2:
                new_primitive: Dict[str, Any] = {
                    "id": aux_id,
                    "type": "segment",
                    "points": segment_points,
                }
                primitives.append(new_primitive)

                color = str(style.get("color", "BLUE")).strip()
                dashed = bool(style.get("dashed", True))
                stroke_width = float(style.get("stroke_width", 3) or 3)

                primitive_display[aux_id] = {
                    "show": True,
                    "role": "construction",
                    "source": "approved_auxiliary",
                    "style": "dashed" if dashed else "solid",
                    "color": color,
                    "stroke_width": stroke_width,
                }

        scene["primitives"] = primitives
        scene["display"] = display
        if isinstance(points, dict):
            scene["points"] = points

        return scene

    def _compute_foot_point(
        self,
        point: List[float],
        line_p1: List[float],
        line_p2: List[float],
    ) -> Optional[List[float]]:
        px, py = point
        x1, y1 = line_p1
        x2, y2 = line_p2

        dx, dy = x2 - x1, y2 - y1
        denom = dx * dx + dy * dy
        if denom < 1e-10:
            return None

        t = ((px - x1) * dx + (py - y1) * dy) / denom
        foot_x = x1 + t * dx
        foot_y = y1 + t * dy

        return [foot_x, foot_y]

    def _extract_focus_entities(self, scene_graph: Dict[str, Any], step: Any) -> List[str]:
        """从步骤文本和视觉提示中提取可能的关注实体 ID，保持与题图对象引用一致。"""
        entity_ids = self._collect_entity_ids(scene_graph)
        text = "\n".join([step.title, step.narration, " ".join(step.visual_cues)])
        matched: List[str] = []
        upper_text = text.upper()

        for entity_id in entity_ids:
            aliases = self._entity_aliases(entity_id, scene_graph)
            for alias in aliases:
                pattern = rf"(?<![A-Z0-9_']){re.escape(alias.upper())}(?![A-Z0-9_'])"
                if re.search(pattern, upper_text):
                    matched.append(entity_id)
                    break

        if not matched:
            for cue in step.visual_cues:
                cue_upper = cue.upper()
                for entity_id in entity_ids:
                    aliases = self._entity_aliases(entity_id, scene_graph)
                    if any(alias.upper() in cue_upper for alias in aliases) and entity_id not in matched:
                        matched.append(entity_id)

        return matched

    def _collect_teaching_focus_targets(self, teaching_step: Optional[Dict[str, Any]]) -> List[str]:
        if not isinstance(teaching_step, dict):
            return []
        targets = teaching_step.get("focus_targets") or []
        return [str(item).strip() for item in targets if str(item).strip()]

    def _merge_focus_targets(
        self,
        extracted_focus: List[str],
        teaching_focus: List[str],
    ) -> List[str]:
        merged: List[str] = []
        seen = set()
        for item in [*(teaching_focus or []), *(extracted_focus or [])]:
            token = str(item).strip()
            if not token or token in seen:
                continue
            seen.add(token)
            merged.append(token)
        return merged

    def _operations_from_teaching_actions(
        self,
        actions: Any,
        fallback_focus: List[str],
    ) -> List[Dict[str, Any]]:
        if not isinstance(actions, list):
            return []

        operations: List[Dict[str, Any]] = []
        for item in actions:
            if not isinstance(item, dict):
                continue
            action_name = str(item.get("action") or item.get("type") or "").strip().lower()
            targets = self._action_targets(item, fallback_focus)

            if action_name in {"show_original_figure", "maintain_scene"}:
                operations.append(
                    {
                        "type": "maintain",
                        "targets": targets,
                        "reason": action_name,
                    }
                )
                continue

            if action_name in {
                "highlight_entity",
                "highlight_fold_axis",
                "highlight_relation",
                "highlight_segment",
                "highlight_angle",
                "highlight_triangle",
                "highlight_parallel",
            }:
                if action_name == "highlight_fold_axis":
                    axis = str(item.get("axis", "")).strip()
                    targets = [axis] if axis else targets
                operations.append(
                    {
                        "type": "highlight",
                        "targets": targets,
                    }
                )
                continue

            if action_name in {
                "animate_fold",
                "show_fold_invariants",
                "reflect_point_over_line",
                "move_point",
            }:
                op_targets = targets or fallback_focus
                op: Dict[str, Any] = {
                    "type": "transform",
                    "targets": op_targets,
                    "mode": "fold",
                }
                axis = str(item.get("axis") or item.get("to_line") or item.get("line") or "").strip()
                if axis:
                    op["axis"] = axis
                operations.append(op)
                continue

            # create_image_point 映射为 maintain，不触发 transform
            if action_name == "create_image_point":
                op_targets = targets or fallback_focus
                operations.append({
                    "type": "maintain",
                    "targets": op_targets,
                    "reason": "create_image_point",
                })
                continue

            if action_name in {"show_point", "show_segment", "show_auxiliary_segment", "fade_out_object"}:
                operations.append(
                    {
                        "type": "maintain",
                        "targets": targets,
                        "reason": action_name,
                    }
                )
                continue

            if action_name in {
                "draw_perpendicular_auxiliary",
                "draw_connection_auxiliary",
                "connect_center_tangent",
                "draw_parallel_auxiliary",
                "extend_segment",
            }:
                helper_op: Dict[str, Any] = {
                    "type": "helper_line",
                    "action": action_name,
                    "id": str(item.get("id") or f"aux_{action_name[:4]}").strip(),
                }
                from_point = str(item.get("from", "")).strip()
                to_point = str(item.get("to", "")).strip()
                to_line = str(item.get("to_line", "")).strip()
                foot = str(item.get("foot", "")).strip()
                reason = str(item.get("reason", "")).strip()
                persist = str(item.get("persist", "until_step_end")).strip()
                style = item.get("style") or {}

                if from_point:
                    helper_op["from"] = from_point
                if to_point:
                    helper_op["to"] = to_point
                if to_line:
                    helper_op["to_line"] = to_line
                if foot:
                    helper_op["foot"] = foot
                if reason:
                    helper_op["reason"] = reason
                if persist in {"until_step_end", "until_video_end"}:
                    helper_op["persist"] = persist
                else:
                    helper_op["persist"] = "until_step_end"
                if style:
                    helper_op["style"] = style

                operations.append(helper_op)
                continue

            # 严格执行模式下，未知动作直接忽略，避免自由发挥引入噪声动画。

        return operations

    def _resolve_animation_policy(self, teaching_step: Optional[Dict[str, Any]]) -> str:
        if not isinstance(teaching_step, dict):
            return "auto"
        policy = str(teaching_step.get("animation_policy", "auto") or "auto").strip().lower()
        if policy in {"auto", "required", "none"}:
            return policy
        return "auto"

    def _action_targets(self, action: Dict[str, Any], fallback_focus: List[str]) -> List[str]:
        targets = [
            str(token).strip()
            for token in (action.get("targets") or [])
            if str(token).strip()
        ]
        target = str(action.get("target", "")).strip()
        if target and target not in targets:
            targets.insert(0, target)
        if not targets:
            targets = [str(token).strip() for token in (fallback_focus or []) if str(token).strip()]
        return targets

    def _apply_visibility_policy(
        self,
        scene_graph: Dict[str, Any],
        *,
        teaching_step: Optional[Dict[str, Any]],
        focus_entities: List[str],
    ) -> Dict[str, Any]:
        scene = copy.deepcopy(scene_graph or {})
        primitives = scene.get("primitives") if isinstance(scene.get("primitives"), list) else []
        display = scene.setdefault("display", {}) if isinstance(scene, dict) else {}
        primitive_display = display.setdefault("primitives", {}) if isinstance(display, dict) else {}

        visible_segments_raw = []
        if isinstance(teaching_step, dict):
            visible_segments_raw = list(teaching_step.get("visible_segments") or [])
        visible_norm = {
            self._normalize_segment_token(item)
            for item in visible_segments_raw
            if self._normalize_segment_token(item)
        }
        focus_norm = {
            self._normalize_segment_token(item)
            for item in (focus_entities or [])
            if self._normalize_segment_token(item)
        }

        # 收集派生点（像点）
        derived_point_ids: Set[str] = set()
        points = scene.get("points") or []
        if isinstance(points, list):
            for item in points:
                if isinstance(item, dict) and isinstance(item.get("derived"), dict):
                    derived_point_ids.add(str(item.get("id", "")).strip())
        elif isinstance(points, dict):
            for point_id, item in points.items():
                if isinstance(item, dict) and isinstance(item.get("derived"), dict):
                    derived_point_ids.add(str(point_id).strip())

        scene_segment_norm: Set[str] = set()
        for primitive in primitives:
            if not isinstance(primitive, dict):
                continue
            if str(primitive.get("type", "")).strip().lower() != "segment":
                continue
            segment_id = str(primitive.get("id", "")).strip()
            refs = [str(item).strip() for item in (primitive.get("points") or []) if str(item).strip()]
            scene_segment_norm.update(
                {
                    token
                    for token in {
                        self._normalize_segment_token(segment_id),
                        self._normalize_segment_token("".join(refs)),
                        self._normalize_segment_token("seg_" + "".join(refs)),
                    }
                    if token
                }
            )

        if visible_norm and not (visible_norm & scene_segment_norm):
            visible_norm = set()

        for primitive in primitives:
            if not isinstance(primitive, dict):
                continue
            if str(primitive.get("type", "")).strip().lower() != "segment":
                continue

            segment_id = str(primitive.get("id", "")).strip()
            refs = [str(item).strip() for item in (primitive.get("points") or []) if str(item).strip()]
            payload = primitive_display.setdefault(segment_id, {}) if segment_id else {}
            source = str(payload.get("source", "")).strip().lower()
            if not source:
                role = str(payload.get("role", "")).strip().lower()
                style = str(payload.get("style", "")).strip().lower()
                source = "approved_auxiliary" if role == "construction" or style == "dashed" else "given"
                payload["source"] = source

            alias_norm = {
                self._normalize_segment_token(segment_id),
                self._normalize_segment_token("".join(refs)),
                self._normalize_segment_token("seg_" + "".join(refs)),
            }
            alias_norm = {item for item in alias_norm if item}

            if visible_norm:
                payload["show"] = bool(alias_norm & visible_norm)
                continue

            # 检查线段是否包含派生点
            has_derived_point = bool(set(refs) & derived_point_ids)
            
            if (source in {"derived", "temporary", "invalid"} or has_derived_point) and not (alias_norm & focus_norm):
                payload["show"] = False

        return scene

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

    def _dedupe_operations(self, operations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        unique: List[Dict[str, Any]] = []
        seen = set()
        for item in operations:
            op_type = str(item.get("type", "")).strip().lower()
            mode = str(item.get("mode", "")).strip().lower()
            axis = str(item.get("axis", "")).strip().lower()
            targets = sorted(
                {
                    str(token).strip()
                    for token in (item.get("targets") or [])
                    if str(token).strip()
                }
            )
            key = f"{op_type}|{mode}|{axis}|{','.join(targets)}"
            if key in seen:
                continue
            seen.add(key)
            copied = copy.deepcopy(item)
            if targets:
                copied["targets"] = targets
            unique.append(copied)
        return unique

    def _infer_operations(self, step: Any, focus_entities: List[str]) -> List[Dict[str, Any]]:
        """根据步骤文本和视觉提示，推断可能的动画操作类型，保持与题图对象引用一致。"""
        cue_text = "\n".join([step.title, step.narration, " ".join(step.visual_cues)])
        visual_cue_text = " ".join(step.visual_cues or [])
        operations: List[Dict[str, Any]] = []

        if focus_entities:
            operations.append({
                "type": "reuse_entities",
                "targets": focus_entities,
                "reason": "保持题图对象复用，避免整图重画",
            })

        if any(keyword in cue_text for keyword in ["高亮", "强调", "突出"]):
            operations.append({
                "type": "highlight",
                "targets": focus_entities,
            })

        # 仅当视觉提示里明确要求标注时才加 label，避免自动出现 AB/BD/BC 噪音标签。
        if any(keyword in visual_cue_text for keyword in ["标注", "标记"]):
            operations.append({
                "type": "label",
                "targets": focus_entities,
            })

        if any(keyword in cue_text for keyword in ["折叠", "旋转", "翻折"]):
            operations.append({
                "type": "transform",
                "targets": focus_entities,
                "mode": "fold",
            })

        if not operations:
            operations.append({
                "type": "maintain",
                "targets": focus_entities,
                "reason": "保持当前题图状态，仅做轻量动画",
            })

        return operations

    def _collect_entity_ids(self, scene_graph: Dict[str, Any]) -> List[str]:
        """从题图数据中收集所有实体 ID，保持与题图对象引用一致。"""
        entity_ids: Set[str] = set()
        points = scene_graph.get("points") or {}
        if isinstance(points, dict):
            entity_ids.update(points.keys())
        elif isinstance(points, list):
            entity_ids.update(
                str(item.get("id"))
                for item in points
                if isinstance(item, dict) and item.get("id")
            )

        entity_ids.update(item.get("id") for item in scene_graph.get("lines", []) if item.get("id"))
        entity_ids.update(item.get("id") for item in scene_graph.get("objects", []) if item.get("id"))
        entity_ids.update(item.get("id") for item in scene_graph.get("angles", []) if item.get("id"))
        entity_ids.update(
            item.get("id")
            for item in scene_graph.get("primitives", [])
            if isinstance(item, dict) and item.get("id")
        )
        return sorted(entity_ids)

    def _entity_aliases(self, entity_id: str, scene_graph: Dict[str, Any]) -> List[str]:
        aliases = [entity_id]

        point_match = re.fullmatch(r"([A-Za-z]+)1", entity_id)
        if point_match:
            base = point_match.group(1)
            aliases.extend([base + "'", base + "′"])

        primitive_points = None
        for primitive in scene_graph.get("primitives", []):
            if not isinstance(primitive, dict):
                continue
            if str(primitive.get("id", "")).strip() != entity_id:
                continue
            primitive_points = [str(x) for x in (primitive.get("points") or [])]
            break

        if entity_id.startswith("seg_"):
            raw = entity_id[4:]
            aliases.append(raw)
            aliases.extend([raw.replace("1", "'"), raw.replace("1", "′")])
        elif primitive_points and len(primitive_points) == 2:
            raw = "".join(primitive_points)
            aliases.append(raw)
            aliases.extend([raw.replace("1", "'"), raw.replace("1", "′")])
        elif primitive_points and len(primitive_points) >= 3:
            raw = "".join(primitive_points)
            aliases.append(raw)
            aliases.extend([raw.replace("1", "'"), raw.replace("1", "′")])

        deduped: List[str] = []
        seen = set()
        for alias in aliases:
            normalized = str(alias).strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            deduped.append(normalized)
        return deduped
