"""Static validation for generated Manim lecture video code."""

from __future__ import annotations

import ast
import re
from typing import Any, Dict, List, Tuple


class FormalVideoValidator:
    """Validate generated Manim code before render."""

    def __init__(self, canvas_config: Dict[str, Any] | None = None):
        self.canvas_config = canvas_config or {}
        self.right_panel_x_min = float(self.canvas_config.get("right_panel_x_min", 1.8))

    def validate(
        self,
        manim_code: str,
        expected_steps: List[Dict[str, Any]] | None = None,
    ) -> Tuple[bool, str, Dict[str, Any]]:
        code = str(manim_code or "")
        report: Dict[str, Any] = {
            "is_valid": True,
            "failed_checks": [],
            "checks": [],
            "timing": [],
        }

        def fail(check: str, message: str) -> None:
            report["is_valid"] = False
            report["failed_checks"].append({"check": check, "message": message})

        def ok(check: str, detail: str = "") -> None:
            report["checks"].append({"check": check, "detail": detail})

        if len(code.strip()) < 50:
            fail("non_empty_code", "generated Manim code is empty or too short")
            return False, "generated Manim code is empty or too short", report
        ok("non_empty_code", "code length is sufficient")

        debug_markers = [
            "class DataAnalysisScene",
            "Drawable Scene",
            "Semantic Graph",
            "Geometry Graph",
            "layout_mode:",
            "points: {}",
            "lines: []",
            "node_count:",
            "edge_count:",
        ]
        for marker in debug_markers:
            if marker in code:
                fail("no_debug_markers", f"generated Manim code contains debug-only marker: {marker}")
                break
        else:
            ok("no_debug_markers", "no debug-only markers detected")

        if "points['" not in code:
            fail("drawable_points", "generated Manim code does not create any drawable points")
        else:
            ok("drawable_points", "point registry detected")

        has_geometry_container = "lines['" in code or "objects['" in code
        if not has_geometry_container:
            fail("drawable_geometry", "generated Manim code does not create drawable geometry objects")
        else:
            ok("drawable_geometry", "geometry registry detected")

        geometry_tokens = [
            "Dot(",
            "Line(",
            "DashedLine(",
            "Polygon(",
            "Circle(",
            "Angle(",
            "RightAngle(",
            "Arc(",
        ]
        if not any(token in code for token in geometry_tokens):
            fail("geometry_constructors", "generated Manim code is missing core geometric constructors")
        else:
            ok("geometry_constructors", "geometry constructors detected")

        try:
            tree = ast.parse(code)
            ok("ast_parse", "python syntax parsed successfully")
        except SyntaxError as exc:
            fail("ast_parse", f"python syntax invalid: {exc}")
            return False, f"python syntax invalid: {exc}", report

        self._validate_imports(tree, report, fail, ok)
        self._validate_forbidden_calls(tree, report, fail, ok)
        self._validate_play_calls(tree, report, fail, ok)
        self._validate_run_times(tree, report, fail, ok)
        self._validate_layout_constraints(code, report, fail, ok)
        self._validate_timing_budgets(code, expected_steps or [], report, fail, ok)

        if report["failed_checks"]:
            first = report["failed_checks"][0]["message"]
            return False, first, report
        return True, "", report

    def _validate_imports(self, tree: ast.AST, report: Dict[str, Any], fail, ok) -> None:
        allowed_imports = {"math", "os", "numpy"}
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name not in allowed_imports:
                        fail("imports", f"unauthorized import detected: {alias.name}")
                        return
            if isinstance(node, ast.ImportFrom):
                if node.module != "manim":
                    fail("imports", f"unauthorized import-from detected: {node.module}")
                    return
        ok("imports", "imports limited to manim/math/os/numpy")

    def _validate_forbidden_calls(self, tree: ast.AST, report: Dict[str, Any], fail, ok) -> None:
        forbidden = {"exec", "eval", "compile", "__import__", "open"}
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if isinstance(func, ast.Name) and func.id in forbidden:
                fail("forbidden_calls", f"forbidden call detected: {func.id}")
                return
        ok("forbidden_calls", "no forbidden calls detected")

    def _validate_play_calls(self, tree: ast.AST, report: Dict[str, Any], fail, ok) -> None:
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if not (
                isinstance(func, ast.Attribute)
                and isinstance(func.value, ast.Name)
                and func.value.id == "self"
                and func.attr == "play"
            ):
                continue
            if not node.args:
                fail("self_play_args", "self.play call has no animation arguments")
                return
            for arg in node.args:
                if isinstance(arg, ast.Starred):
                    continue
                if isinstance(arg, ast.Call):
                    continue
                if isinstance(arg, ast.Attribute) and arg.attr == "animate":
                    continue
                fail("self_play_args", "self.play contains a non-animation argument")
                return
        ok("self_play_args", "all self.play calls use animation-like arguments")

    def _validate_run_times(self, tree: ast.AST, report: Dict[str, Any], fail, ok) -> None:
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            for keyword in node.keywords:
                if keyword.arg != "run_time":
                    continue
                if isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, (int, float)):
                    if float(keyword.value.value) <= 0:
                        fail("run_time_positive", "run_time must be positive")
                        return
        ok("run_time_positive", "all literal run_time values are positive")

    def _validate_layout_constraints(self, code: str, report: Dict[str, Any], fail, ok) -> None:
        text_left_pattern = re.compile(
            r"(?:Text|MathTex|Tex)\([^\n]*\)\s*\.\s*(?:to_edge\(LEFT|to_corner\((?:UL|DL))"
        )
        graph_right_pattern = re.compile(
            r"(?:Polygon|Line|Dot|Circle|Square|Triangle)\([^\n]*\)\s*\.\s*(?:to_edge\(RIGHT|to_corner\((?:UR|DR))"
        )
        if text_left_pattern.search(code):
            fail("layout_constraints", "left/right layout violation: text placed on left side")
            return
        if graph_right_pattern.search(code):
            fail("layout_constraints", "left/right layout violation: geometry placed on right side")
            return
        ok("layout_constraints", "left graph/right formula layout preserved")

    def _validate_timing_budgets(
        self,
        code: str,
        expected_steps: List[Dict[str, Any]],
        report: Dict[str, Any],
        fail,
        ok,
    ) -> None:
        if not expected_steps:
            ok("timing_budgets", "no expected timing metadata provided")
            return

        normalized_steps = sorted(expected_steps, key=lambda item: int(item.get("step_id", 0)))
        step_blocks = self._split_step_blocks(code)
        expected_ids = [int(item.get("step_id", 0)) for item in normalized_steps]
        actual_ids = [step_id for step_id, _ in step_blocks]
        if actual_ids != expected_ids:
            fail("timing_budgets", f"step comments mismatch: expected {expected_ids}, got {actual_ids}")
            return

        tolerance = 0.35
        for expected, (step_id, block) in zip(normalized_steps, step_blocks):
            if "_safe_add_sound(" not in block and "self.add_sound(" not in block:
                fail("timing_budgets", f"step {step_id} is missing add_sound call")
                return
            if "time_offset=0" not in block and "time_offset=0.0" not in block and "time_offset=0.00" not in block:
                fail("timing_budgets", f"step {step_id} add_sound must use time_offset=0")
                return

            run_times = [float(value) for value in re.findall(r"run_time\s*=\s*([0-9]+(?:\.[0-9]+)?)", block)]
            waits = [float(value) for value in re.findall(r"self\.wait\(\s*([0-9]+(?:\.[0-9]+)?)\s*\)", block)]
            actual_duration = round(sum(run_times) + sum(waits), 2)
            expected_duration = round(float(expected.get("duration", 0.0) or 0.0), 2)
            report["timing"].append(
                {
                    "step_id": step_id,
                    "expected_duration": expected_duration,
                    "actual_duration": actual_duration,
                    "difference": round(actual_duration - expected_duration, 2),
                }
            )
            if abs(actual_duration - expected_duration) > tolerance:
                fail(
                    "timing_budgets",
                    f"timing budget mismatch for step {step_id}: expected {expected_duration:.2f}s, got {actual_duration:.2f}s",
                )
                return
        ok("timing_budgets", "step timing budgets align with expected durations")

    def _split_step_blocks(self, code: str) -> List[Tuple[int, str]]:
        lines = code.splitlines()
        blocks: List[Tuple[int, str]] = []
        current_id: int | None = None
        current_lines: List[str] = []
        step_pattern = re.compile(r"^\s*#\s*Step\s+(\d+)\s*:")
        for line in lines:
            match = step_pattern.match(line)
            if match:
                if current_id is not None:
                    blocks.append((current_id, "\n".join(current_lines)))
                current_id = int(match.group(1))
                current_lines = [line]
                continue
            if current_id is not None:
                current_lines.append(line)
        if current_id is not None:
            blocks.append((current_id, "\n".join(current_lines)))
        return blocks
