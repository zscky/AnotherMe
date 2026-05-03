"""
折叠计划硬约束校验器
确保折叠动画的正确性和一致性
"""

from __future__ import annotations

from typing import Any, Dict, List, Set, Tuple


class FoldPlanValidator:
    """
    硬约束校验（最重要）:
    1. 折叠题必须生成 fold_plan：axis、moving_part、fixed_part、image_pairs
    2. 没有 axis 不允许 animate_fold
    3. 默认只允许一次主折叠；后续步骤除非显式 refold，否则禁止 transform
    4. 折叠后图元（B' C' 等）在折叠前不得可见
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
        执行所有硬约束校验
        
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

        # 1. 校验 fold_plan 完整性
        self._validate_fold_plan_exists(teaching_ir, geometry_ir)

        # 2. 校验 axis 存在性
        self._validate_axis_exists(teaching_ir, geometry_ir)

        # 3. 校验 animate_fold 必须有 axis
        self._validate_animate_fold_has_axis(teaching_ir)

        # 4. 校验单次折叠限制
        self._validate_single_fold_restriction(teaching_ir)

        # 5. 校验折叠后图元可见性
        self._validate_image_points_visibility(teaching_ir, geometry_ir)

        return len(self.errors) == 0, self.errors, self.warnings

    def _validate_fold_plan_exists(
        self,
        teaching_ir: Dict[str, Any],
        geometry_ir: Dict[str, Any],
    ) -> None:
        """校验 fold_plan 必须包含 axis、moving_part、fixed_part、image_pairs"""
        global_data = teaching_ir.get("global", {}) if isinstance(teaching_ir, dict) else {}
        fold_plan = global_data.get("fold_plan", {}) if isinstance(global_data, dict) else {}

        if not fold_plan:
            self.errors.append("折叠题必须生成 fold_plan")
            return

        required_fields = ["axis", "moving_part", "fixed_part", "image_pairs"]
        missing_fields = [f for f in required_fields if f not in fold_plan or not fold_plan.get(f)]

        if missing_fields:
            self.errors.append(f"fold_plan 缺少必需字段: {', '.join(missing_fields)}")

        # 校验 axis 不为空
        axis = str(fold_plan.get("axis", "")).strip()
        if not axis:
            self.errors.append("fold_plan.axis 不能为空")

        # 校验 image_pairs 格式
        image_pairs = fold_plan.get("image_pairs", []) if isinstance(fold_plan, dict) else []
        if not image_pairs:
            self.warnings.append("fold_plan.image_pairs 为空，无法建立对应点关系")
        else:
            for i, pair in enumerate(image_pairs):
                if not isinstance(pair, dict):
                    self.errors.append(f"image_pairs[{i}] 必须是字典类型")
                    continue
                source = str(pair.get("source", "")).strip()
                image = str(pair.get("image", "")).strip()
                if not source:
                    self.errors.append(f"image_pairs[{i}] 缺少 source 字段")
                if not image:
                    self.errors.append(f"image_pairs[{i}] 缺少 image 字段")

    def _validate_axis_exists(
        self,
        teaching_ir: Dict[str, Any],
        geometry_ir: Dict[str, Any],
    ) -> None:
        """校验 axis 必须在几何实体中存在"""
        global_data = teaching_ir.get("global", {}) if isinstance(teaching_ir, dict) else {}
        fold_plan = global_data.get("fold_plan", {}) if isinstance(global_data, dict) else {}
        axis = str(fold_plan.get("axis", "")).strip()

        if not axis:
            return

        # 检查 axis 是否在 segments 中
        segments = geometry_ir.get("segments", []) if isinstance(geometry_ir, dict) else []
        segment_ids = {str(s.get("id", "")).strip() for s in segments if isinstance(s, dict)}
        segment_labels = {str(s.get("label", "")).strip() for s in segments if isinstance(s, dict)}

        if axis not in segment_ids and axis not in segment_labels:
            self.errors.append(f"fold_plan.axis '{axis}' 不存在于几何实体中")

    def _validate_animate_fold_has_axis(self, teaching_ir: Dict[str, Any]) -> None:
        """校验所有 animate_fold 动作必须有 axis"""
        steps = teaching_ir.get("steps", []) if isinstance(teaching_ir, dict) else []

        for step in steps:
            if not isinstance(step, dict):
                continue

            step_id = step.get("step_id", "unknown")
            actions = step.get("actions", []) if isinstance(step, dict) else []

            for action in actions:
                if not isinstance(action, dict):
                    continue

                action_name = str(action.get("action", "")).strip()
                if action_name == "animate_fold":
                    axis = str(action.get("axis", "")).strip()
                    if not axis:
                        self.errors.append(f"步骤 {step_id}: animate_fold 动作缺少 axis 字段")

    def _validate_single_fold_restriction(self, teaching_ir: Dict[str, Any]) -> None:
        """
        校验单次折叠限制:
        - 默认只允许一次主折叠
        - 后续步骤除非显式 refold，否则禁止 transform
        """
        steps = teaching_ir.get("steps", []) if isinstance(teaching_ir, dict) else []
        global_data = teaching_ir.get("global", {}) if isinstance(teaching_ir, dict) else {}
        fold_plan = global_data.get("fold_plan", {}) if isinstance(global_data, dict) else {}

        fold_executed = False
        main_fold_step_id = None

        for step in steps:
            if not isinstance(step, dict):
                continue

            step_id = step.get("step_id", "unknown")
            actions = step.get("actions", []) if isinstance(step, dict) else []
            fold_execution = step.get("fold_execution", {}) if isinstance(step, dict) else {}

            # 检查是否是折叠步骤
            is_fold_step = False
            has_animate_fold = False

            for action in actions:
                if not isinstance(action, dict):
                    continue
                action_name = str(action.get("action", "")).strip()
                if action_name == "animate_fold":
                    has_animate_fold = True
                    is_fold_step = True

            # 检查 fold_execution 标记
            if isinstance(fold_execution, dict):
                if fold_execution.get("is_fold_step", False):
                    is_fold_step = True

            if is_fold_step and has_animate_fold:
                if fold_executed:
                    # 检查是否允许重新折叠
                    allow_refold = bool(fold_execution.get("allow_refold", False))
                    if not allow_refold:
                        self.errors.append(
                            f"步骤 {step_id}: 禁止重复折叠。"
                            f"主折叠已在步骤 {main_fold_step_id} 执行，"
                            f"除非显式设置 allow_refold=True"
                        )
                else:
                    fold_executed = True
                    main_fold_step_id = step_id

            # 检查非折叠步骤是否有 transform 操作
            if fold_executed and not is_fold_step:
                # 检查是否有 transform 类型的操作
                for action in actions:
                    if not isinstance(action, dict):
                        continue
                    action_name = str(action.get("action", "")).strip()
                    if action_name in {"animate_fold", "reflect_point_over_line", "move_point"}:
                        allow_refold = bool(fold_execution.get("allow_refold", False))
                        if not allow_refold:
                            self.errors.append(
                                f"步骤 {step_id}: 主折叠后禁止 transform 操作，"
                                f"除非显式设置 allow_refold=True"
                            )
                            break

    def _validate_image_points_visibility(
        self,
        teaching_ir: Dict[str, Any],
        geometry_ir: Dict[str, Any],
    ) -> None:
        """
        校验折叠后图元（B' C' 等）在折叠前不得可见
        """
        global_data = teaching_ir.get("global", {}) if isinstance(teaching_ir, dict) else {}
        fold_plan = global_data.get("fold_plan", {}) if isinstance(global_data, dict) else {}
        image_pairs = fold_plan.get("image_pairs", []) if isinstance(fold_plan, dict) else []

        if not image_pairs:
            return

        # 收集所有像点
        image_points = set()
        for pair in image_pairs:
            if isinstance(pair, dict):
                image = str(pair.get("image", "")).strip()
                if image:
                    image_points.add(image)

        if not image_points:
            return

        # 检查每个步骤的可见性设置
        steps = teaching_ir.get("steps", []) if isinstance(teaching_ir, dict) else []
        fold_executed = False

        for step in steps:
            if not isinstance(step, dict):
                continue

            step_id = step.get("step_id", "unknown")
            actions = step.get("actions", []) if isinstance(step, dict) else []
            fold_execution = step.get("fold_execution", {}) if isinstance(step, dict) else {}

            # 检查是否是折叠步骤
            is_fold_step = False
            for action in actions:
                if not isinstance(action, dict):
                    continue
                action_name = str(action.get("action", "")).strip()
                if action_name == "animate_fold":
                    is_fold_step = True
                    break

            if isinstance(fold_execution, dict):
                if fold_execution.get("is_fold_step", False):
                    is_fold_step = True

            if is_fold_step:
                fold_executed = True

            # 在折叠前检查像点是否可见
            if not fold_executed:
                visible_segments = step.get("visible_segments", []) if isinstance(step, dict) else []
                focus_targets = step.get("focus_targets", []) if isinstance(step, dict) else []

                # 检查 visible_segments
                for segment in visible_segments:
                    seg_str = str(segment).strip()
                    for image_point in image_points:
                        if image_point in seg_str:
                            self.errors.append(
                                f"步骤 {step_id}: 折叠前像点 '{image_point}' 不应可见，"
                                f"但出现在 visible_segments: '{seg_str}'"
                            )

                # 检查 focus_targets
                for target in focus_targets:
                    target_str = str(target).strip()
                    if target_str in image_points:
                        self.errors.append(
                            f"步骤 {step_id}: 折叠前像点 '{target_str}' 不应作为焦点"
                        )

    def get_fold_state(self, teaching_ir: Dict[str, Any]) -> Dict[str, Any]:
        """
        获取折叠状态信息
        """
        steps = teaching_ir.get("steps", []) if isinstance(teaching_ir, dict) else []
        global_data = teaching_ir.get("global", {}) if isinstance(teaching_ir, dict) else {}
        fold_plan = global_data.get("fold_plan", {}) if isinstance(global_data, dict) else {}

        fold_executed = False
        main_fold_step_id = None
        fold_count = 0

        for step in steps:
            if not isinstance(step, dict):
                continue

            step_id = step.get("step_id", "unknown")
            actions = step.get("actions", []) if isinstance(step, dict) else []

            for action in actions:
                if not isinstance(action, dict):
                    continue
                action_name = str(action.get("action", "")).strip()
                if action_name == "animate_fold":
                    fold_count += 1
                    if not fold_executed:
                        main_fold_step_id = step_id
                    fold_executed = True

        return {
            "has_fold_plan": bool(fold_plan),
            "axis": fold_plan.get("axis") if isinstance(fold_plan, dict) else None,
            "fold_executed": fold_executed,
            "main_fold_step_id": main_fold_step_id,
            "fold_count": fold_count,
            "image_pairs": fold_plan.get("image_pairs", []) if isinstance(fold_plan, dict) else [],
        }
