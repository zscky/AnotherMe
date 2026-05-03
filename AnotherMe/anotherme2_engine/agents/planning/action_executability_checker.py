"""
Check and repair teaching actions before animation execution.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List, Set, Tuple


class ActionExecutabilityChecker:
    """Validate teaching IR action dependencies and apply safe repairs."""

    def check_and_repair(
        self,
        *,
        teaching_ir: Dict[str, Any],
        geometry_ir: Dict[str, Any],
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        ir = copy.deepcopy(teaching_ir if isinstance(teaching_ir, dict) else {})
        steps = ir.get("steps") if isinstance(ir.get("steps"), list) else []

        entities = self._collect_entities(geometry_ir)
        fold_axis = str(geometry_ir.get("transform", {}).get("fold_axis", "")).strip()

        issues: List[Dict[str, Any]] = []
        repaired = 0

        # 追踪折叠状态
        fold_state = self._init_fold_state(ir)

        for step_index, step in enumerate(steps):
            if not isinstance(step, dict):
                continue
            step_id = self._safe_step_id(step.get("step_id"), step_index + 1)
            actions = step.get("actions") if isinstance(step.get("actions"), list) else []
            fold_execution = step.get("fold_execution", {}) if isinstance(step, dict) else {}

            # 检查是否是折叠步骤
            is_fold_step = self._is_fold_step(actions, fold_execution)

            # 检查 refold 权限
            allow_refold = bool(fold_execution.get("allow_refold", False)) if isinstance(fold_execution, dict) else False

            # 如果已经执行过折叠且不允许 refold，移除后续的 animate_fold
            if fold_state["fold_executed"] and is_fold_step and not allow_refold:
                # 过滤掉 animate_fold 动作
                filtered_actions = [
                    action for action in actions
                    if not (isinstance(action, dict) and str(action.get("action", "")).strip() == "animate_fold")
                ]
                removed_count = len(actions) - len(filtered_actions)
                if removed_count > 0:
                    step["actions"] = filtered_actions
                    repaired += removed_count
                    issues.append({
                        "type": "redundant_fold_removed",
                        "step_id": step_id,
                        "message": f"步骤 {step_id} 的 animate_fold 被移除：主折叠已在步骤 {fold_state['main_fold_step_id']} 执行，且未设置 allow_refold=True",
                    })
                    actions = filtered_actions

            # 如果已经执行过折叠且不允许 refold，禁止 transform 操作
            if fold_state["fold_executed"] and not is_fold_step and not allow_refold:
                transform_actions = [
                    "animate_fold", "reflect_point_over_line", "move_point",
                    "transform", "rotate", "translate"
                ]
                for action in actions:
                    if not isinstance(action, dict):
                        continue
                    action_name = str(action.get("action", "")).strip()
                    if action_name in transform_actions:
                        issues.append({
                            "type": "transform_after_fold_forbidden",
                            "step_id": step_id,
                            "action": action_name,
                            "message": f"步骤 {step_id}: 主折叠后禁止 '{action_name}' 操作，除非显式设置 allow_refold=True",
                        })

            # 更新折叠状态
            if is_fold_step:
                if not fold_state["fold_executed"]:
                    fold_state["fold_executed"] = True
                    fold_state["main_fold_step_id"] = step_id
                fold_state["fold_count"] += 1

            for action_index, action in enumerate(actions):
                if not isinstance(action, dict):
                    issues.append(
                        {
                            "type": "invalid_action_payload",
                            "step_id": step_id,
                            "action_index": action_index,
                            "message": "action must be an object",
                        }
                    )
                    continue

                action_name = str(action.get("action", "")).strip()
                if not action_name:
                    issues.append(
                        {
                            "type": "missing_action_name",
                            "step_id": step_id,
                            "action_index": action_index,
                            "message": "missing action name",
                        }
                    )
                    continue

                if action_name in {"highlight_fold_axis", "animate_fold"}:
                    axis = str(action.get("axis", "")).strip()
                    if not axis and fold_axis:
                        action["axis"] = fold_axis
                        repaired += 1
                    elif not axis:
                        issues.append(
                            {
                                "type": "missing_axis",
                                "step_id": step_id,
                                "action_index": action_index,
                                "message": "fold action is missing axis",
                            }
                        )
                    elif not self._entity_exists(axis, entities):
                        issues.append(
                            {
                                "type": "unknown_axis",
                                "step_id": step_id,
                                "action_index": action_index,
                                "message": f"axis {axis} does not exist in geometry entities",
                            }
                        )

                if action_name == "create_image_point":
                    source = str(action.get("from", "")).strip()
                    target = str(action.get("to", "")).strip()
                    if source and not self._entity_exists(source, entities):
                        issues.append(
                            {
                                "type": "missing_dependency",
                                "step_id": step_id,
                                "action_index": action_index,
                                "message": f"source point {source} does not exist",
                            }
                        )
                    if target:
                        entities["points"].add(target)

                if action_name == "draw_perpendicular_auxiliary":
                    from_point = str(action.get("from", "")).strip()
                    to_line = str(action.get("to_line", "")).strip()
                    new_point = str(action.get("new_point", "")).strip()

                    if from_point and not self._entity_exists(from_point, entities):
                        issues.append(
                            {
                                "type": "missing_dependency",
                                "step_id": step_id,
                                "action_index": action_index,
                                "message": f"point {from_point} is referenced before creation",
                            }
                        )

                    if to_line and not self._entity_exists(to_line, entities):
                        issues.append(
                            {
                                "type": "missing_dependency",
                                "step_id": step_id,
                                "action_index": action_index,
                                "message": f"line {to_line} is referenced before creation",
                            }
                        )

                    if new_point:
                        entities["points"].add(new_point)

                if action_name in {"highlight_entity", "highlight_relation"}:
                    targets = [str(item).strip() for item in (action.get("targets") or []) if str(item).strip()]
                    if not targets:
                        issues.append(
                            {
                                "type": "empty_targets",
                                "step_id": step_id,
                                "action_index": action_index,
                                "message": "highlight action has no targets",
                            }
                        )
                    else:
                        unknown = [item for item in targets if not self._entity_exists(item, entities)]
                        if unknown:
                            issues.append(
                                {
                                    "type": "unknown_targets",
                                    "step_id": step_id,
                                    "action_index": action_index,
                                    "message": f"targets not found: {', '.join(unknown)}",
                                }
                            )

            # 更新步骤的 fold_execution 信息
            if is_fold_step:
                if not isinstance(step.get("fold_execution"), dict):
                    step["fold_execution"] = {}
                step["fold_execution"]["is_fold_step"] = True
                step["fold_execution"]["fold_executed_before"] = fold_state["fold_count"] > 1

        # 更新全局 fold_state
        ir["fold_state"] = fold_state

        status = "pass"
        if issues and repaired:
            status = "repaired"
        elif issues:
            status = "needs_repair"
        elif repaired:
            status = "repaired"

        report = {
            "checker_version": "v2",
            "status": status,
            "issue_count": len(issues),
            "repaired_action_count": repaired,
            "fold_state": fold_state,
            "issues": issues,
        }
        return ir, report

    def _init_fold_state(self, teaching_ir: Dict[str, Any]) -> Dict[str, Any]:
        """初始化折叠状态"""
        global_data = teaching_ir.get("global", {}) if isinstance(teaching_ir, dict) else {}
        fold_plan = global_data.get("fold_plan", {}) if isinstance(global_data, dict) else {}

        return {
            "fold_executed": False,
            "main_fold_step_id": None,
            "fold_count": 0,
            "has_fold_plan": bool(fold_plan),
            "axis": fold_plan.get("axis") if isinstance(fold_plan, dict) else None,
        }

    def _is_fold_step(self, actions: List[Dict[str, Any]], fold_execution: Dict[str, Any]) -> bool:
        """检查步骤是否为折叠步骤"""
        # 检查 actions
        for action in actions:
            if not isinstance(action, dict):
                continue
            action_name = str(action.get("action", "")).strip()
            if action_name == "animate_fold":
                return True

        # 检查 fold_execution 标记
        if isinstance(fold_execution, dict):
            if fold_execution.get("is_fold_step", False):
                return True

        return False

    def _collect_entities(self, geometry_ir: Dict[str, Any]) -> Dict[str, Set[str]]:
        points = {str(item).strip() for item in (geometry_ir.get("points") or []) if str(item).strip()}

        segment_ids = set()
        segment_labels = set()
        for item in geometry_ir.get("segments", []) or []:
            if isinstance(item, dict):
                segment_id = str(item.get("id", "")).strip()
                segment_label = str(item.get("label", "")).strip()
                if segment_id:
                    segment_ids.add(segment_id)
                if segment_label:
                    segment_labels.add(segment_label)
            else:
                token = str(item).strip()
                if token:
                    segment_ids.add(token)

        shapes = {
            str(item.get("id", "")).strip()
            for item in (geometry_ir.get("shapes") or [])
            if isinstance(item, dict) and str(item.get("id", "")).strip()
        }

        return {
            "points": points,
            "segments": segment_ids,
            "segment_labels": segment_labels,
            "shapes": shapes,
        }

    def _entity_exists(self, token: str, entities: Dict[str, Set[str]]) -> bool:
        value = str(token).strip()
        return bool(
            value
            and (
                value in entities["points"]
                or value in entities["segments"]
                or value in entities["segment_labels"]
                or value in entities["shapes"]
            )
        )

    def _safe_step_id(self, raw: Any, fallback: int) -> int:
        if isinstance(raw, int):
            return raw
        try:
            return int(raw)
        except (TypeError, ValueError):
            return fallback
