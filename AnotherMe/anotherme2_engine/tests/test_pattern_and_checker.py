import json
import tempfile
import unittest
from pathlib import Path

from agents.planning.action_executability_checker import ActionExecutabilityChecker
from agents.execution.case_replay_recorder import CaseReplayRecorder
from agents.planning.problem_pattern import ProblemPatternClassifier
from agents.planning.teaching_ir import TeachingIRPlanner


class PatternAndCheckerTests(unittest.TestCase):
    def test_problem_pattern_classifier_detects_fold(self) -> None:
        classifier = ProblemPatternClassifier()
        result = classifier.classify(
            problem_text="沿 DE 折叠后，求像点到 BC 的距离",
            metadata={},
        )

        self.assertEqual(result["problem_pattern"], "fold_transform")
        self.assertEqual(result["sub_pattern"], "fold_point_to_point_distance")

    def test_teaching_ir_geometry_includes_problem_pattern(self) -> None:
        planner = TeachingIRPlanner()
        metadata = {
            "problem_pattern": {
                "problem_pattern": "fold_transform",
                "sub_pattern": "fold_with_perpendicular_construction",
            },
            "drawable_scene": {
                "points": [{"id": "A", "coord": [0.0, 0.0]}, {"id": "B", "coord": [1.0, 0.0]}],
                "primitives": [{"id": "seg_AB", "type": "segment", "points": ["A", "B"]}],
            },
        }

        geometry_ir = planner.build_geometry_ir(metadata=metadata, problem_text="普通题")
        self.assertEqual(geometry_ir["problem_pattern"], "fold_transform")
        self.assertEqual(geometry_ir["sub_pattern"], "fold_with_perpendicular_construction")
        self.assertEqual(geometry_ir["problem_type"], "fold_transform")

    def test_action_checker_repairs_missing_fold_axis(self) -> None:
        checker = ActionExecutabilityChecker()
        teaching_ir = {
            "version": "v1",
            "steps": [
                {
                    "step_id": 1,
                    "actions": [
                        {"action": "animate_fold", "targets": ["B"]},
                    ],
                }
            ],
        }
        geometry_ir = {
            "points": ["A", "B"],
            "segments": [{"id": "seg_DE", "label": "DE", "points": ["D", "E"]}],
            "transform": {"fold_axis": "seg_DE"},
        }

        repaired, report = checker.check_and_repair(teaching_ir=teaching_ir, geometry_ir=geometry_ir)
        actions = repaired["steps"][0]["actions"]
        fold_actions = [item for item in actions if item.get("action") == "animate_fold"]
        self.assertTrue(fold_actions)
        action = fold_actions[0]

        self.assertEqual(action.get("axis"), "seg_DE")
        self.assertEqual(report["status"], "repaired")
        self.assertGreaterEqual(report["repaired_action_count"], 1)

    def test_action_checker_removes_redundant_fold_without_refold(self) -> None:
        checker = ActionExecutabilityChecker()
        teaching_ir = {
            "version": "v1",
            "global": {
                "fold_plan": {
                    "axis": "seg_DE",
                    "moving_entities": ["B1", "C1"],
                }
            },
            "steps": [
                {
                    "step_id": 1,
                    "fold_execution": {"allow_refold": False},
                    "actions": [{"action": "animate_fold", "axis": "seg_DE", "targets": ["B1"]}],
                },
                {
                    "step_id": 2,
                    "fold_execution": {"allow_refold": False},
                    "actions": [{"action": "animate_fold", "axis": "seg_DE", "targets": ["C1"]}],
                },
            ],
        }
        geometry_ir = {
            "points": ["A", "B", "B1", "C1"],
            "segments": [{"id": "seg_DE", "label": "DE", "points": ["D", "E"]}],
            "transform": {"fold_axis": "seg_DE"},
        }

        repaired, report = checker.check_and_repair(teaching_ir=teaching_ir, geometry_ir=geometry_ir)
        first_actions = repaired["steps"][0]["actions"]
        second_actions = repaired["steps"][1]["actions"]
        self.assertTrue(any(item.get("action") == "animate_fold" for item in first_actions))
        self.assertFalse(any(item.get("action") == "animate_fold" for item in second_actions))
        self.assertEqual(report["status"], "repaired")

    def test_case_replay_recorder_writes_json(self) -> None:
        recorder = CaseReplayRecorder()
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            path = recorder.record(
                output_dir=output_dir,
                payload={"problem_pattern": "fold_transform", "render_result": {"status": "success"}},
            )

            record = json.loads(Path(path).read_text(encoding="utf-8"))
            self.assertEqual(record["problem_pattern"], "fold_transform")
            self.assertEqual(record["render_result"]["status"], "success")
            self.assertIn("case_id", record)

    def test_fold_template_and_aux_scoring_emit_perpendicular_actions(self) -> None:
        planner = TeachingIRPlanner()
        metadata = {
            "problem_pattern": {
                "problem_pattern": "fold_transform",
                "sub_pattern": "fold_with_perpendicular_construction",
            },
            "drawable_scene": {
                "points": [
                    {"id": "B", "coord": [2.0, 0.0]},
                    {
                        "id": "B1",
                        "coord": [0.0, 0.0],
                        "derived": {"type": "reflect_point", "source": "B", "axis": ["D", "E"]},
                    },
                    {"id": "D", "coord": [0.0, 1.0]},
                    {"id": "E", "coord": [1.0, 0.0]},
                ],
                "primitives": [
                    {"id": "seg_DE", "type": "segment", "points": ["D", "E"]},
                ],
            },
        }

        geometry_ir = planner.build_geometry_ir(
            metadata=metadata,
            problem_text="沿DE折叠后，求像点到直线DE的距离",
        )

        step = type("Step", (), {
            "id": 1,
            "title": "折叠并作辅助线",
            "duration": 2.0,
            "narration": "沿DE折叠后，求像点到直线DE的距离",
            "visual_cues": ["折叠", "距离"],
        })()

        teaching_ir = planner.build_teaching_ir(
            steps=[step],
            geometry_ir=geometry_ir,
            metadata=metadata,
            problem_text="沿DE折叠后，求像点到直线DE的距离",
        )

        actions = teaching_ir["steps"][0]["actions"]
        perpendicular_actions = [
            item for item in actions
            if isinstance(item, dict) and item.get("action") == "draw_perpendicular_auxiliary"
        ]

        self.assertTrue(perpendicular_actions)
        self.assertTrue(
            any(str(item.get("reason", "")).startswith("fold") for item in perpendicular_actions)
        )


if __name__ == "__main__":
    unittest.main()
