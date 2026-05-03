import json
import sys
import types
import unittest


langchain_core_module = types.ModuleType("langchain_core")
langchain_core_messages = types.ModuleType("langchain_core.messages")


class _DummyMessage:
    def __init__(self, content=None):
        self.content = content


langchain_core_messages.HumanMessage = _DummyMessage
langchain_core_messages.SystemMessage = _DummyMessage
langchain_core_module.messages = langchain_core_messages
sys.modules.setdefault("langchain_core", langchain_core_module)
sys.modules.setdefault("langchain_core.messages", langchain_core_messages)

from agents.perception.vision_agent import VisionAgent
from agents.perception.geometry_fact_compiler import GeometryFactCompiler
from agents.perception.coordinate_scene import CoordinateSceneCompiler


class VisionAgentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.agent = VisionAgent(config={"output_dir": "./output_test"})
        self.fact_compiler = GeometryFactCompiler()
        self.scene_compiler = CoordinateSceneCompiler()

    def test_parse_json_like_output_handles_inline_comments(self) -> None:
        raw = """
{
  "problem_text": "demo",
  "geometry_facts": {
    "points": ["A", "B"], // comment
    "segments": ["AB",], 
    "relations": [
      {"type": "point_on_segment", "point": "A", "segment": "AB"}, // trailing
    ]
  }
}
"""
        parsed = self.agent._parse_json_like_output(raw, {"problem_text": "", "geometry_facts": {}})
        self.assertEqual(parsed["problem_text"], "demo")
        self.assertEqual(parsed["geometry_facts"]["segments"], ["AB"])

    def test_sanitize_geometry_facts_drops_unlabeled_and_keeps_fold_core(self) -> None:
        facts = {
            "confidence": 0.95,
            "points": ["A", "B", "C", "D", "E", "B′", "C′"],
            "segments": ["AB", "BC", "CD", "DA", "DE", "BE", "EB′", "B′C′", "C′D", "AE"],
            "polygons": ["ABCD", "AB′C′D", "BEB′"],
            "angles": [{"vertex": "B", "sides": ["AB", "BC"], "name": "∠ABC"}],
            "right_angles": [{"vertex": "E", "sides": ["BE", "EB′"], "description": "∠BEB′ = 90°"}],
            "relations": [
                {"type": "point_on_segment", "point": "E", "segment": "AB"},
                {"type": "perpendicular", "lines": ["BE", "EB′"]},
                {"type": "equal_length", "segments": ["DB", "DB′"]},
                {"type": "intersect", "lines": ["DE", "BB′"], "point": "F"},
            ],
            "measurements": [
                {"type": "length", "segment": "AD", "value": 5},
                {"type": "angle", "vertex": "B", "value": "arctan(2) is not angle B; tan B = 2 means tan(∠ABC) = 2"},
                {"type": "angle", "angle": "∠BEB′", "value": 90},
            ],
        }
        problem_text = "在菱形ABCD中，AD=5，tanB=2，E是AB上一点，将菱形ABCD沿DE折叠，使B、C的对应点分别是B′、C′，当∠BEB′=90°时"
        sanitized = self.agent._sanitize_geometry_facts(facts, problem_text=problem_text)

        self.assertIn("B'", sanitized["points"])
        self.assertIn("C'", sanitized["points"])
        self.assertTrue(any(item.get("segment") == "AD" for item in sanitized["measurements"] if item.get("type") == "length"))
        self.assertFalse(
            any(
                item.get("angle") in {"∠B", "∠ABC"}
                for item in sanitized["measurements"]
                if item.get("type") == "angle"
            )
        )
        self.assertTrue(
            any(
                item.get("angle") in {"∠B", "∠ABC"}
                for item in sanitized.get("derived_measurements", [])
                if item.get("type") == "angle"
            )
        )
        self.assertFalse(any(item.get("point") == "F" for item in sanitized["relations"]))

    def test_stabilized_fold_bundle_compiles_to_valid_coordinate_scene(self) -> None:
        raw_bundle = {
            "problem_text": "题1 如图，在菱形ABCD中，AD=5，tanB=2，E是AB上一点，将菱形ABCD沿DE折叠，使B、C的对应点分别是B′、C′，当∠BEB′=90°时",
            "geometry_facts": {
                "confidence": 0.95,
                "points": ["A", "B", "C", "D", "E", "B′", "C′"],
                "segments": ["AB", "BC", "CD", "DA", "DE", "BE", "EB′", "B′C′", "C′D", "AE"],
                "polygons": ["ABCD", "AB′C′D"],
                "angles": [{"vertex": "B", "sides": ["AB", "BC"], "label": "∠B"}],
                "right_angles": [{"vertex": "E", "sides": ["BE", "EB′"], "description": "∠BEB′ = 90°"}],
                "relations": [
                    {"type": "point_on_segment", "point": "E", "segment": "AB"},
                    {"type": "collinear", "points": ["A", "E", "B"]},
                ],
                "measurements": [
                    {"type": "length", "segment": "AD", "value": 5},
                    {"type": "angle", "angle": "∠B", "value": "arctan(2)"},
                ],
            },
        }

        stabilized = self.agent._stabilize_problem_bundle(raw_bundle, image_path=__file__)
        geometry_spec = self.fact_compiler.compile(
            stabilized["geometry_facts"],
            problem_text=stabilized["problem_text"],
        )
        normalized = self.scene_compiler.normalize_geometry_spec(geometry_spec)
        scene = self.scene_compiler.compile(normalized)
        report = self.scene_compiler.validate_coordinate_scene(scene)

        self.assertTrue(report["is_valid"], report["failed_checks"])
        point_lookup = {item["id"]: item["coord"] for item in report["resolved_scene"]["points"]}
        self.assertIn("B1", point_lookup)
        self.assertIn("C1", point_lookup)
        self.assertIn("E", point_lookup)

    def test_sanitize_geometry_facts_preserves_circle_and_arc_content(self) -> None:
        facts = {
            "points": ["A", "B", "C"],
            "circles": [
                {"id": "circle_O", "center": "O", "points_on_circle": ["A", "B", "C"]}
            ],
            "arcs": [
                {"id": "arc_AB", "circle": "circle_O", "points": ["A", "B"]}
            ],
            "relations": [
                {"type": "point_on_circle", "entities": ["C", "circle_O"]}
            ],
            "measurements": [
                {"type": "length", "entities": ["A", "B"], "value": 4}
            ],
        }

        sanitized = self.agent._sanitize_geometry_facts(
            facts,
            problem_text="在⊙O中，AB=4，点C在⊙O上，弧AB所对的圆周角为锐角",
        )
        self.assertTrue(any(item.get("center") == "O" for item in sanitized["circles"]))
        self.assertTrue(any(item.get("circle") == "circle_O" for item in sanitized["arcs"]))
        self.assertIn("O", sanitized["points"])

        geometry_spec = self.fact_compiler.compile(
            sanitized,
            problem_text="在⊙O中，AB=4，点C在⊙O上",
        )

        primitive_types = {str(item.get("type", "")).lower() for item in geometry_spec.get("primitives", [])}
        self.assertIn("circle", primitive_types)
        self.assertIn("arc", primitive_types)
        self.assertTrue(
            any(
                str(item.get("type", "")).lower() == "point_on_circle"
                for item in geometry_spec.get("constraints", [])
            )
        )

    def test_sanitize_keeps_angle_entities_and_label_defined_angle(self) -> None:
        facts = {
            "points": ["A", "B", "C"],
            "angles": [{"label": "∠ABC"}],
            "measurements": [{"type": "angle", "entities": ["A", "B", "C"], "value": 60}],
        }

        sanitized = self.agent._sanitize_geometry_facts(
            facts,
            problem_text="在三角形ABC中，∠ABC=60°",
        )
        self.assertTrue(any(item.get("vertex") == "B" for item in sanitized["angles"]))
        self.assertTrue(
            any(
                item.get("type") == "angle" and item.get("entities") == ["A", "B", "C"]
                for item in sanitized["measurements"]
            )
        )

        geometry_spec = self.fact_compiler.compile(sanitized, problem_text="在三角形ABC中，∠ABC=60°")
        self.assertTrue(
            any(
                item.get("type") == "angle" and item.get("entities") == ["A", "B", "C"]
                for item in geometry_spec.get("measurements", [])
            )
        )

    def test_rhombus_equal_length_relations_are_pairwise(self) -> None:
        sanitized = self.agent._sanitize_geometry_facts(
            {"points": ["A", "B", "C", "D"]},
            problem_text="在菱形ABCD中，求证对角线互相垂直",
        )

        equal_relations = [
            item
            for item in sanitized.get("derived_relations", [])
            if str(item.get("type", "")).lower() == "equal_length"
        ]
        self.assertGreaterEqual(len(equal_relations), 3)
        self.assertTrue(all(len(item.get("segments", [])) == 2 for item in equal_relations))
        self.assertFalse(
            any(
                str(item.get("type", "")).lower() == "equal_length"
                for item in sanitized.get("relations", [])
            )
        )

    def test_compose_compiler_geometry_facts_ignores_derived_by_default(self) -> None:
        geometry_facts = {
            "observed_relations": [
                {"type": "point_on_segment", "point": "E", "segment": "AB"}
            ],
            "text_explicit_relations": [
                {"type": "parallel", "segments": ["AB", "CD"]}
            ],
            "derived_relations": [
                {"type": "equal_length", "segments": ["AB", "BC"], "confidence": 0.95}
            ],
            "observed_measurements": [
                {"type": "length", "segment": "AD", "value": 5}
            ],
            "text_explicit_measurements": [
                {"type": "angle", "angle": "∠ABC", "value": 60}
            ],
            "derived_measurements": [
                {"type": "angle", "angle": "∠B", "value": "arctan(2)", "confidence": 0.95}
            ],
        }

        composed = self.agent._compose_compiler_geometry_facts(
            geometry_facts,
            problem_text="在菱形ABCD中，AD=5，tanB=2",
        )

        relation_types = {str(item.get("type", "")).lower() for item in composed.get("relations", [])}
        measurement_angles = {
            str(item.get("angle", "")).strip()
            for item in composed.get("measurements", [])
            if str(item.get("type", "")).lower() == "angle"
        }
        self.assertIn("point_on_segment", relation_types)
        self.assertIn("parallel", relation_types)
        self.assertNotIn("equal_length", relation_types)
        self.assertIn("∠ABC", measurement_angles)
        self.assertNotIn("∠B", measurement_angles)

    def test_compose_compiler_geometry_facts_blocks_derived_on_high_risk_even_if_enabled(self) -> None:
        agent = VisionAgent(
            config={
                "output_dir": "./output_test",
                "allow_derived_facts_for_compiler": True,
            }
        )
        geometry_facts = {
            "observed_relations": [
                {"type": "point_on_segment", "point": "E", "segment": "AB"}
            ],
            "derived_relations": [
                {"type": "equal_length", "segments": ["AB", "BC"], "confidence": 0.99}
            ],
            "observed_measurements": [
                {"type": "length", "segment": "AD", "value": 5}
            ],
            "derived_measurements": [
                {"type": "angle", "angle": "∠B", "value": "arctan(2)", "confidence": 0.99}
            ],
        }

        composed = agent._compose_compiler_geometry_facts(
            geometry_facts,
            problem_text="沿DE折叠后求值",
        )

        relation_types = {str(item.get("type", "")).lower() for item in composed.get("relations", [])}
        measurement_angles = {
            str(item.get("angle", "")).strip()
            for item in composed.get("measurements", [])
            if str(item.get("type", "")).lower() == "angle"
        }
        self.assertIn("point_on_segment", relation_types)
        self.assertNotIn("equal_length", relation_types)
        self.assertNotIn("∠B", measurement_angles)

    def test_compose_compiler_geometry_facts_filters_low_confidence_derived_even_when_enabled(self) -> None:
        agent = VisionAgent(
            config={
                "output_dir": "./output_test",
                "allow_derived_facts_for_compiler": True,
            }
        )

        raw_bundle = {
            "problem_text": "在四边形ABCD中，已知条件如下",
            "geometry_facts": {
                "points": ["A", "B", "C", "D"],
                "segments": ["AB", "BC", "CD", "DA"],
                "derived_relations": [
                    {"type": "parallel", "segments": ["AB", "CD"], "confidence": 0.35}
                ],
                "derived_measurements": [
                    {"type": "angle", "angle": "∠B", "value": "arctan(2)", "confidence": 0.35}
                ],
            },
        }

        stabilized = agent._stabilize_problem_bundle(raw_bundle, image_path=__file__)
        composed = agent._compose_compiler_geometry_facts(
            stabilized.get("geometry_facts") or {},
            problem_text=stabilized.get("problem_text", ""),
        )

        relation_types = {str(item.get("type", "")).lower() for item in composed.get("relations", [])}
        measurement_angles = {
            str(item.get("angle", "")).strip()
            for item in composed.get("measurements", [])
            if str(item.get("type", "")).lower() == "angle"
        }
        self.assertNotIn("parallel", relation_types)
        self.assertNotIn("∠B", measurement_angles)

    def test_sanitize_preserves_input_layered_fact_buckets(self) -> None:
        facts = {
            "points": ["A", "B", "C", "D", "E"],
            "segments": ["AB", "BC", "CD", "DA"],
            "relations": [{"type": "point_on_segment", "point": "E", "segment": "AB"}],
            "text_explicit_relations": [{"type": "parallel", "segments": ["AB", "CD"]}],
            "inferred_relations": [{"type": "equal_length", "segments": ["AB", "BC"], "confidence": 0.92}],
            "measurements": [{"type": "length", "segment": "AB", "value": 3}],
            "text_explicit_measurements": [{"type": "angle", "angle": "∠ABC", "value": 60}],
            "inferred_measurements": [{"type": "angle", "angle": "∠B", "value": "arctan(2)", "confidence": 0.9}],
        }

        sanitized = self.agent._sanitize_geometry_facts(
            facts,
            problem_text="在四边形ABCD中，AB∥CD，AB=3，∠ABC=60°",
        )

        self.assertTrue(any(item.get("type") == "parallel" for item in sanitized.get("text_explicit_relations", [])))
        self.assertTrue(any(item.get("type") == "equal_length" for item in sanitized.get("derived_relations", [])))
        self.assertTrue(any(item.get("angle") == "∠ABC" for item in sanitized.get("text_explicit_measurements", [])))
        self.assertTrue(any(item.get("angle") == "∠B" for item in sanitized.get("derived_measurements", [])))

    def test_compose_compiler_geometry_facts_blocks_derived_on_circle_high_risk(self) -> None:
        agent = VisionAgent(
            config={
                "output_dir": "./output_test",
                "allow_derived_facts_for_compiler": True,
            }
        )
        geometry_facts = {
            "observed_relations": [
                {"type": "point_on_circle", "point": "C", "circle": "circle_O"}
            ],
            "derived_relations": [
                {"type": "parallel", "segments": ["AB", "CD"], "confidence": 0.99}
            ],
            "observed_measurements": [
                {"type": "length", "segment": "AB", "value": 4}
            ],
            "derived_measurements": [
                {"type": "angle", "angle": "∠B", "value": "arctan(2)", "confidence": 0.99}
            ],
        }

        composed = agent._compose_compiler_geometry_facts(
            geometry_facts,
            problem_text="在圆O中，已知点C在圆上，求证某结论",
        )

        relation_types = {str(item.get("type", "")).lower() for item in composed.get("relations", [])}
        measurement_angles = {
            str(item.get("angle", "")).strip()
            for item in composed.get("measurements", [])
            if str(item.get("type", "")).lower() == "angle"
        }
        self.assertIn("point_on_circle", relation_types)
        self.assertNotIn("parallel", relation_types)
        self.assertNotIn("∠B", measurement_angles)

    def test_extract_text_facts_from_problem_text_outputs_structured_layers(self) -> None:
        text = "在菱形ABCD中，E是AB上一点，M是CD的中点，AD=5，∠ABC=60°，tanB=2"
        text_facts = self.agent._extract_text_facts_from_problem_text(text)

        relation_types = {str(item.get("type", "")).lower() for item in text_facts.get("text_explicit_relations", [])}
        angle_values = {
            str(item.get("angle", "")).strip(): item.get("value")
            for item in text_facts.get("text_explicit_measurements", [])
            if str(item.get("type", "")).lower() == "angle"
        }
        derived_angles = {
            str(item.get("angle", "")).strip()
            for item in text_facts.get("derived_measurements", [])
            if str(item.get("type", "")).lower() == "angle"
        }

        self.assertIn("point_on_segment", relation_types)
        self.assertIn("midpoint", relation_types)
        self.assertEqual(angle_values.get("∠ABC"), 60.0)
        self.assertIn("∠B", derived_angles)

    def test_stabilize_problem_bundle_merges_text_facts_into_layered_geometry_facts(self) -> None:
        bundle = {
            "problem_text": "在菱形ABCD中，E是AB上一点，AD=5，∠ABC=60°，tanB=2",
            "geometry_facts": {
                "points": ["A", "B", "C", "D"],
                "segments": ["AB", "BC", "CD", "DA"],
                "relations": [],
                "measurements": [],
            },
        }

        self.agent._extract_problem_text_fallback = lambda _image_path: bundle["problem_text"]
        stabilized = self.agent._stabilize_problem_bundle(bundle, image_path=__file__)
        geometry_facts = stabilized.get("geometry_facts") or {}

        self.assertTrue(stabilized.get("text_facts"))
        self.assertTrue(geometry_facts.get("text_explicit_relations"))
        self.assertTrue(geometry_facts.get("text_explicit_measurements"))
        self.assertTrue(geometry_facts.get("derived_measurements"))
        self.assertTrue(geometry_facts.get("inferred_measurements"))

    def test_sanitize_fold_conflicting_midpoint_is_dropped_without_explicit_midpoint(self) -> None:
        facts = {
            "points": ["A", "B", "D", "E", "B′"],
            "segments": ["AB", "AE", "EB", "DE"],
            "angles": [{"vertex": "E", "sides": ["AE", "EB"], "name": "∠AEB"}],
            "relations": [{"type": "midpoint", "point": "E", "segment": "AB"}],
        }

        sanitized = self.agent._sanitize_geometry_facts(
            facts,
            problem_text="在图形中，将△ABD沿DE折叠后得到点B′，且∠AEB为锐角",
        )

        self.assertFalse(
            any(str(item.get("type", "")).lower() == "midpoint" for item in sanitized.get("relations", []))
        )

    def test_sanitize_fold_explicit_midpoint_is_preserved(self) -> None:
        facts = {
            "points": ["A", "B", "D", "E", "B′"],
            "segments": ["AB", "AE", "EB", "DE"],
            "angles": [{"vertex": "E", "sides": ["AE", "EB"], "name": "∠AEB"}],
            "relations": [{"type": "midpoint", "point": "E", "segment": "AB"}],
        }

        sanitized = self.agent._sanitize_geometry_facts(
            facts,
            problem_text="在图形中，E是AB的中点，将△ABD沿DE折叠后得到点B′",
        )

        self.assertTrue(
            any(str(item.get("type", "")).lower() == "midpoint" for item in sanitized.get("relations", []))
        )

    def test_upgrade_problem_text_prefers_higher_quality_fallback(self) -> None:
        original = "题1 如图，求线段长度（ ）"
        fallback = "题1 如图，求线段长度（ ）\nA. 2\nB. 3\nC. 4\nD. 5"
        self.agent._extract_problem_text_fallback = lambda _image_path: fallback

        upgraded = self.agent._upgrade_problem_text_if_needed(original, image_path=__file__)

        self.assertEqual(upgraded, fallback)

    def test_upgrade_problem_text_skips_retry_for_short_complete_sentence(self) -> None:
        original = "题1 已知AB=3，求BC。"
        called = {"value": False}

        def _fallback(_image_path):
            called["value"] = True
            return "unused"

        self.agent._extract_problem_text_fallback = _fallback
        upgraded = self.agent._upgrade_problem_text_if_needed(original, image_path=__file__)

        self.assertEqual(upgraded, original)
        self.assertFalse(called["value"])

    def test_analyze_bundle_survives_ocr_fallback_exception(self) -> None:
        self.agent._encode_image = lambda _image_path: "ZmFrZQ=="
        self.agent._invoke_model = lambda _messages, model_role=None: json.dumps(
            {
                "problem_text": "在三角形ABC中，AB=3",
                "geometry_facts": {
                    "points": ["A", "B", "C"],
                    "segments": ["AB", "BC", "CA"],
                    "relations": [],
                    "measurements": [{"type": "length", "segment": "AB", "value": 3}],
                },
            },
            ensure_ascii=False,
        )

        def _raise_ocr(_image_path):
            raise RuntimeError("ocr down")

        self.agent._extract_problem_text_fallback = _raise_ocr

        bundle = self.agent._analyze_problem_bundle(__file__)

        self.assertEqual(bundle.get("problem_text_source"), "model")
        self.assertEqual(str(bundle.get("problem_text", "")).strip(), "在三角形ABC中，AB=3")
        self.assertIsInstance(bundle.get("geometry_facts"), dict)


if __name__ == "__main__":
    unittest.main()
