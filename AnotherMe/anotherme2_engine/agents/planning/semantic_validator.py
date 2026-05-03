"""
语义校验器
校验动作顺序、状态一致性、可见性门控
"""

from __future__ import annotations

from typing import Any, Dict, List, Set, Tuple


class SemanticValidator:
    """
    语义校验（比现在 formal 校验更关键）:
    1. 校验"动作顺序"：先定轴，再定折叠部分，再执行动画
    2. 校验"状态一致性"：不能第2步折叠、第3步又回原位
    3. 校验"可见性门控"：折叠对象不能提前出场
    """

    def __init__(self) -> None:
        self.errors: List[str] = []
        self.warnings: List[str] = []

    def validate(
        self,
        teaching_ir: Dict[str, Any],
        geometry_ir: Dict[str, Any],
    ) -> Tuple[bool, List[str], List[str]]:
        """
        执行所有语义校验
        
        Returns:
            (is_valid, errors, warnings)
        """
        self.errors = []
        self.warnings = []

        # 检查是否为折叠题
        problem_type = str(geometry_ir.get("problem_type", "")).strip()
        problem_pattern = str(geometry_ir.get("problem_pattern", "")).strip()
        is_fold_problem = problem_type == "fold_transform" or problem_pattern == "fold_transform"

        if not is_fold_problem:
            return True, [], []

        # 1. 校验动作顺序
        self._validate_action_sequence(teaching_ir)

        # 2. 校验状态一致性
        self._validate_state_consistency(teaching_ir)

        # 3. 校验可见性门控
        self._validate_visibility_gating(teaching_ir, geometry_ir)

        return len(self.errors) == 0, self.errors, self.warnings

    def _validate_action_sequence(self, teaching_ir: Dict[str, Any]) -> None:
        """
        校验动作顺序：
        - 先定轴 (highlight_fold_axis)
        - 再定折叠部分 (create_image_point 或 focus_targets)
        - 再执行动画 (animate_fold)
        """
        steps = teaching_ir.get("steps", []) if isinstance(teaching_ir, dict) else []
        global_data = teaching_ir.get("global", {}) if isinstance(teaching_ir, dict) else {}
        fold_plan = global_data.get("fold_plan", {}) if isinstance(global_data, dict) else {}

        if not fold_plan:
            return

        axis_defined = False
        fold_part_defined = False
        fold_executed = False

        for step in steps:
            if not isinstance(step, dict):
                continue

            step_id = step.get("step_id", "unknown")
            actions = step.get("actions", []) if isinstance(step, dict) else []

            for action in actions:
                if not isinstance(action, dict):
                    continue

                action_name = str(action.get("action", "")).strip()

                # 检查是否定义了轴
                if action_name == "highlight_fold_axis":
                    axis = str(action.get("axis", "")).strip()
                    if axis:
                        axis_defined = True

                # 检查是否定义了折叠部分
                if action_name == "create_image_point":
                    source = str(action.get("from", "")).strip()
                    target = str(action.get("to", "")).strip()
                    if source and target:
                        fold_part_defined = True

                # 检查是否执行了折叠
                if action_name == "animate_fold":
                    if not axis_defined:
                        self.errors.append(
                            f"步骤 {step_id}: 动作顺序错误。"
                            f"执行 animate_fold 前必须先定义折叠轴 (highlight_fold_axis)"
                        )
                    if not fold_part_defined:
                        self.warnings.append(
                            f"步骤 {step_id}: 建议先定义折叠部分 (create_image_point) "
                            f"再执行 animate_fold"
                        )
                    fold_executed = True

    def _validate_state_consistency(self, teaching_ir: Dict[str, Any]) -> None:
        """
        校验状态一致性：
        - 不能第2步折叠、第3步又回原位
        - 折叠后状态应该保持一致
        """
        steps = teaching_ir.get("steps", []) if isinstance(teaching_ir, dict) else []

        fold_executed = False
        fold_step_id = None
        fold_axis = None

        for step in steps:
            if not isinstance(step, dict):
                continue

            step_id = step.get("step_id", "unknown")
            actions = step.get("actions", []) if isinstance(step, dict) else []
            fold_execution = step.get("fold_execution", {}) if isinstance(step, dict) else {}

            # 检查是否是折叠步骤
            is_fold_step = False
            current_axis = None

            for action in actions:
                if not isinstance(action, dict):
                    continue
                action_name = str(action.get("action", "")).strip()
                if action_name == "animate_fold":
                    is_fold_step = True
                    current_axis = str(action.get("axis", "")).strip()

            if isinstance(fold_execution, dict):
                if fold_execution.get("is_fold_step", False):
                    is_fold_step = True

            if is_fold_step:
                if fold_executed:
                    # 检查是否是同一轴
                    if current_axis and fold_axis and current_axis != fold_axis:
                        self.errors.append(
                            f"步骤 {step_id}: 状态不一致。"
                            f"已在步骤 {fold_step_id} 沿轴 '{fold_axis}' 折叠，"
                            f"不能沿不同轴 '{current_axis}' 再次折叠"
                        )
                else:
                    fold_executed = True
                    fold_step_id = step_id
                    fold_axis = current_axis

            # 检查是否有"回原位"的操作
            if fold_executed and not is_fold_step:
                for action in actions:
                    if not isinstance(action, dict):
                        continue
                    action_name = str(action.get("action", "")).strip()
                    # 检查是否有反向操作
                    if action_name in {"unfold", "restore_original", "reset_transform"}:
                        self.errors.append(
                            f"步骤 {step_id}: 状态不一致。"
                            f"折叠后不能执行 '{action_name}' 回原位操作"
                        )

    def _validate_visibility_gating(self, teaching_ir: Dict[str, Any], geometry_ir: Dict[str, Any]) -> None:
        """
        校验可见性门控：
        - 折叠对象（像点、折叠后的图形）不能提前出场
        - 折叠前只能看到原始图形
        """
        steps = teaching_ir.get("steps", []) if isinstance(teaching_ir, dict) else []
        global_data = teaching_ir.get("global", {}) if isinstance(teaching_ir, dict) else {}
        fold_plan = global_data.get("fold_plan", {}) if isinstance(global_data, dict) else {}

        if not fold_plan:
            return

        # 获取像点列表
        image_pairs = fold_plan.get("image_pairs", []) if isinstance(fold_plan, dict) else []
        image_points: Set[str] = set()
        source_points: Set[str] = set()
        
        for pair in image_pairs:
            if isinstance(pair, dict):
                source = str(pair.get("source", "")).strip()
                image = str(pair.get("image", "")).strip()
                if source:
                    source_points.add(source)
                if image:
                    image_points.add(image)

        # 获取移动部分和固定部分
        moving_part = set(fold_plan.get("moving_part", [])) if isinstance(fold_plan, dict) else set()
        fixed_part = set(fold_plan.get("fixed_part", [])) if isinstance(fold_plan, dict) else set()

        fold_executed = False

        for step in steps:
            if not isinstance(step, dict):
                continue

            step_id = step.get("step_id", "unknown")
            actions = step.get("actions", []) if isinstance(step, dict) else []
            focus_targets = step.get("focus_targets", []) if isinstance(step, dict) else []
            visible_segments = step.get("visible_segments", []) if isinstance(step, dict) else []

            # 检查是否是折叠步骤
            is_fold_step = False
            for action in actions:
                if not isinstance(action, dict):
                    continue
                action_name = str(action.get("action", "")).strip()
                if action_name == "animate_fold":
                    is_fold_step = True
                    break

            if is_fold_step:
                fold_executed = True

            # 在折叠前，检查是否有像点提前出场
            if not fold_executed:
                # 检查 focus_targets
                for target in focus_targets:
                    target_str = str(target).strip()
                    if target_str in image_points:
                        self.errors.append(
                            f"步骤 {step_id}: 可见性门控错误。"
                            f"像点 '{target_str}' 在折叠前不应作为焦点"
                        )

                # 检查 visible_segments
                for segment in visible_segments:
                    seg_str = str(segment).strip()
                    for image_point in image_points:
                        if image_point in seg_str:
                            self.errors.append(
                                f"步骤 {step_id}: 可见性门控错误。"
                                f"像点 '{image_point}' 在折叠前不应可见，"
                                f"但出现在 visible_segments: '{seg_str}'"
                            )

                # 检查 actions
                for action in actions:
                    if not isinstance(action, dict):
                        continue
                    action_name = str(action.get("action", "")).strip()
                    
                    # 检查是否提前创建了像点
                    if action_name == "create_image_point":
                        target = str(action.get("to", "")).strip()
                        if target in image_points:
                            self.warnings.append(
                                f"步骤 {step_id}: 像点 '{target}' 在折叠前创建，"
                                f"请确保其初始位置与源点重合且不可见"
                            )

    def get_action_sequence_report(self, teaching_ir: Dict[str, Any]) -> Dict[str, Any]:
        """
        获取动作顺序报告
        """
        steps = teaching_ir.get("steps", []) if isinstance(teaching_ir, dict) else []
        
        sequence = []
        axis_defined_step = None
        fold_part_defined_step = None
        fold_executed_step = None

        for step in steps:
            if not isinstance(step, dict):
                continue

            step_id = step.get("step_id", "unknown")
            actions = step.get("actions", []) if isinstance(step, dict) else []

            step_info = {
                "step_id": step_id,
                "actions": [],
                "axis_defined": False,
                "fold_part_defined": False,
                "fold_executed": False,
            }

            for action in actions:
                if not isinstance(action, dict):
                    continue
                action_name = str(action.get("action", "")).strip()
                step_info["actions"].append(action_name)

                if action_name == "highlight_fold_axis":
                    step_info["axis_defined"] = True
                    if axis_defined_step is None:
                        axis_defined_step = step_id

                if action_name == "create_image_point":
                    step_info["fold_part_defined"] = True
                    if fold_part_defined_step is None:
                        fold_part_defined_step = step_id

                if action_name == "animate_fold":
                    step_info["fold_executed"] = True
                    if fold_executed_step is None:
                        fold_executed_step = step_id

            sequence.append(step_info)

        return {
            "sequence": sequence,
            "axis_defined_step": axis_defined_step,
            "fold_part_defined_step": fold_part_defined_step,
            "fold_executed_step": fold_executed_step,
            "is_valid_sequence": (
                axis_defined_step is not None and
                fold_executed_step is not None and
                (fold_part_defined_step is None or fold_part_defined_step <= fold_executed_step)
            ),
        }
