import unittest

from agents.perception.coordinate_scene import CoordinateSceneCompiler, CoordinateSceneError
from agents.planning.canvas_scene import CanvasScene
from agents.execution.codegen import TemplateCodeGenerator
from agents.perception.geometry_fact_compiler import GeometryFactCompiler


class CoordinateSceneCompilerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.compiler = CoordinateSceneCompiler()
        self.fact_compiler = GeometryFactCompiler()

    def test_validate_coordinate_scene_resolves_reflected_point(self) -> None:
        coordinate_scene = {
            "mode": "2d",
            "points": [
                {"id": "C", "coord": [0, 0]},
                {"id": "B", "coord": [0, 6]},
                {"id": "A", "coord": [8, 0]},
                {"id": "D", "coord": [3, 0]},
                {"id": "C1", "derived": {"type": "reflect_point", "source": "C", "axis": ["B", "D"]}},
            ],
            "primitives": [
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
                {"id": "seg_AC", "type": "segment", "points": ["A", "C"]},
                {"id": "seg_BD", "type": "segment", "points": ["B", "D"]},
                {"id": "seg_BC1", "type": "segment", "points": ["B", "C1"]},
                {"id": "seg_DC1", "type": "segment", "points": ["D", "C1"]},
                {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
                {"id": "poly_ADC1", "type": "polygon", "points": ["A", "D", "C1"]},
                {"id": "right_C", "type": "right_angle", "points": ["A", "C", "B"]},
            ],
            "constraints": [
                {"type": "point_on_segment", "entities": ["D", "seg_AC"]},
                {"type": "perpendicular", "entities": ["seg_AC", "seg_BC"]},
                {"type": "collinear", "entities": ["A", "D", "C"]},
                {"type": "equal_length", "entities": ["seg_BC", "seg_BC1"]},
            ],
            "display": {},
            "measurements": [
                {"type": "length", "entities": ["B", "C"], "value": 6},
                {"type": "length", "entities": ["A", "C"], "value": 8},
                {"type": "length", "entities": ["C", "D"], "value": 3},
                {"type": "angle", "entities": ["A", "C", "B"], "value": 90},
            ],
        }

        report = self.compiler.validate_coordinate_scene(coordinate_scene)
        self.assertTrue(report["is_valid"])
        point_lookup = {item["id"]: item["coord"] for item in report["resolved_scene"]["points"]}
        self.assertEqual(point_lookup["C1"], [4.8, 2.4])

    def test_normalize_geometry_spec_canonicalizes_prime_label(self) -> None:
        spec = {
            "templates": ["right_triangle"],
            "points": [{"id": "A"}, {"id": "B"}, {"id": "C"}, {"id": "C'"}],
            "primitives": [{"type": "segment", "points": ["A", "C'"]}],
            "constraints": [],
            "measurements": [],
        }
        normalized = self.compiler.normalize_geometry_spec(spec)
        point_ids = [item["id"] for item in normalized["points"]]
        self.assertIn("C1", point_ids)
        self.assertEqual(normalized["display"]["points"]["C1"]["label"], "C'")

    def test_solve_right_triangle_geometry_spec(self) -> None:
        spec = {
            "templates": ["right_triangle"],
            "roles": {"right_vertex": "C", "horizontal_point": "A", "vertical_point": "B"},
            "points": [{"id": "A"}, {"id": "B"}, {"id": "C"}],
            "primitives": [{"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]}],
            "constraints": [{"type": "perpendicular", "entities": ["seg_AC", "seg_BC"]}],
            "measurements": [
                {"type": "length", "entities": ["A", "C"], "value": 8},
                {"type": "length", "entities": ["B", "C"], "value": 6},
            ],
        }
        scene = self.compiler.compile(geometry_spec=spec)
        point_lookup = {item["id"]: item["coord"] for item in scene["points"]}
        self.assertEqual(point_lookup["C"], [0.0, 0.0])
        self.assertEqual(point_lookup["A"], [8.0, 0.0])
        self.assertEqual(point_lookup["B"], [0.0, 6.0])

    def test_solve_rectangle_geometry_spec(self) -> None:
        spec = {
            "templates": ["rectangle"],
            "points": [{"id": "A"}, {"id": "B"}, {"id": "C"}, {"id": "D"}],
            "primitives": [{"id": "poly_ABCD", "type": "polygon", "points": ["A", "B", "C", "D"]}],
            "constraints": [
                {"type": "parallel", "entities": ["seg_AB", "seg_CD"]},
                {"type": "parallel", "entities": ["seg_BC", "seg_AD"]},
                {"type": "perpendicular", "entities": ["seg_AB", "seg_BC"]},
            ],
            "measurements": [
                {"type": "length", "entities": ["A", "B"], "value": 10},
                {"type": "length", "entities": ["B", "C"], "value": 4},
            ],
        }
        scene = self.compiler.compile(geometry_spec=spec)
        point_lookup = {item["id"]: item["coord"] for item in scene["points"]}
        self.assertEqual(point_lookup["A"], [0.0, 0.0])
        self.assertEqual(point_lookup["B"], [10.0, 0.0])
        self.assertEqual(point_lookup["C"], [10.0, 4.0])
        self.assertEqual(point_lookup["D"], [0.0, 4.0])

    def test_solve_circle_geometry_spec(self) -> None:
        spec = {
            "templates": ["circle_basic"],
            "points": [{"id": "O"}, {"id": "A"}, {"id": "B"}],
            "primitives": [{"id": "circle_OA", "type": "circle", "center": "O", "radius_point": "A"}],
            "constraints": [{"type": "point_on_circle", "entities": ["B", "circle_OA"]}],
            "measurements": [{"type": "length", "entities": ["O", "A"], "value": 5}],
        }
        scene = self.compiler.compile(geometry_spec=spec)
        report = self.compiler.validate_coordinate_scene(scene)
        self.assertTrue(report["is_valid"])
        point_lookup = {item["id"]: item["coord"] for item in report["resolved_scene"]["points"]}
        self.assertAlmostEqual(point_lookup["A"][0], 5.0, places=6)
        self.assertAlmostEqual(point_lookup["A"][1], 0.0, places=6)

    def test_point_on_segment_without_measurement_fails_conservatively(self) -> None:
        spec = {
            "templates": ["right_triangle"],
            "points": [{"id": "A"}, {"id": "B"}, {"id": "C"}, {"id": "D"}],
            "primitives": [
                {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
                {"id": "seg_AC", "type": "segment", "points": ["A", "C"]},
            ],
            "constraints": [{"type": "point_on_segment", "entities": ["D", "seg_AC"]}],
            "measurements": [
                {"type": "length", "entities": ["A", "C"], "value": 8},
                {"type": "length", "entities": ["B", "C"], "value": 6},
            ],
        }
        with self.assertRaises(CoordinateSceneError):
            self.compiler.compile(geometry_spec=spec)

    def test_fold_rhombus_geometry_preserves_prime_points_and_solves_axis_point(self) -> None:
        facts = {
            "points": ["A", "B", "C", "D", "E", "B′", "C′"],
            "segments": ["AB", "BC", "CD", "DA", "DE", "EB", "EB′", "B′C′", "C′D"],
            "polygons": ["ABCD", "AB′C′D"],
            "angles": [{"vertex": "B", "sides": ["AB", "BC"], "name": "∠ABC"}],
            "right_angles": [{"vertex": "E", "sides": ["EB", "EB′"], "label": "∠BEB′"}],
            "relations": [
                {"type": "point_on_segment", "point": "E", "segment": "AB"},
                {"type": "parallel", "segments": ["AB", "CD"]},
                {"type": "parallel", "segments": ["AD", "BC"]},
            ],
            "measurements": [
                {"type": "length", "segment": "AD", "value": 5},
                {"type": "angle", "vertex": "B", "value": "arctan(2)", "description": "tan∠ABC = 2"},
            ],
        }

        geometry_spec = self.fact_compiler.compile(
            facts,
            problem_text="在菱形ABCD中，AD=5，tanB=2，E是AB上一点，将菱形ABCD沿DE折叠，使B、C的对应点分别是B′、C′，当∠BEB′=90°时",
        )
        normalized = self.compiler.normalize_geometry_spec(geometry_spec)
        scene = self.compiler.compile(geometry_spec=normalized)
        report = self.compiler.validate_coordinate_scene(scene)

        self.assertTrue(report["is_valid"], report["failed_checks"])
        point_lookup = {item["id"]: item["coord"] for item in report["resolved_scene"]["points"]}
        self.assertIn("B1", point_lookup)
        self.assertIn("C1", point_lookup)
        self.assertIn("E", point_lookup)
        self.assertTrue(0.0 < point_lookup["E"][0] < point_lookup["A"][0])

    def test_fold_guardrail_does_not_auto_expand_reflected_segments(self) -> None:
        facts = {
            "points": ["A", "B", "C", "D", "B′", "C′"],
            "segments": ["AB", "BC", "CD", "DA", "B′C′", "C′D"],
            "polygons": ["ABCD", "AB′C′D"],
            "relations": [],
            "measurements": [],
        }

        geometry_spec = self.fact_compiler.compile(
            facts,
            problem_text="将菱形ABCD沿AD折叠，使B、C对应到B′、C′",
        )

        segment_pairs = {
            tuple(str(p).strip() for p in primitive.get("points", []))
            for primitive in geometry_spec.get("primitives", [])
            if str(primitive.get("type", "")).strip().lower() == "segment"
        }
        undirected_pairs = {frozenset(pair) for pair in segment_pairs if len(pair) == 2}

        self.assertIn(frozenset(("B'", "C'")), undirected_pairs)
        self.assertNotIn(frozenset(("A", "B'")), undirected_pairs)

    def test_fold_guardrail_preserves_explicit_reflected_constraints_and_measurements(self) -> None:
        facts = {
            "points": ["A", "B", "D", "B′"],
            "segments": ["AB", "BB′", "DB′"],
            "relations": [
                {"type": "midpoint", "point": "D", "segment": "BB′"},
            ],
            "measurements": [
                {"type": "length", "segment": "DB′", "value": 3},
            ],
        }

        geometry_spec = self.fact_compiler.compile(
            facts,
            problem_text="将线段BB′沿AB折叠后，点D是BB′中点，且DB′=3",
        )

        self.assertTrue(
            any(
                str(item.get("type", "")).strip().lower() == "midpoint"
                and "D" in [str(entity).strip() for entity in (item.get("entities") or [])]
                for item in geometry_spec.get("constraints", [])
            )
        )
        self.assertTrue(
            any(
                str(item.get("type", "")).strip().lower() == "length"
                and float(item.get("value", 0)) == 3.0
                for item in geometry_spec.get("measurements", [])
            )
        )

    def test_parse_tangent_value_supports_fraction_notation(self) -> None:
        self.assertAlmostEqual(self.compiler._parse_tangent_value("tan(∠ABC)=1/2"), 0.5)
        self.assertAlmostEqual(self.compiler._parse_tangent_value("arctan(3/4)"), 0.75)
        self.assertAlmostEqual(self.compiler._parse_tangent_value("tanB=2"), 2.0)

    def test_export_ggb_filters_unapproved_segment_sources(self) -> None:
        coordinate_scene = {
            "mode": "2d",
            "points": [
                {"id": "A", "coord": [0, 0]},
                {"id": "B", "coord": [4, 0]},
                {"id": "C", "coord": [0, 3]},
            ],
            "primitives": [
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
                {"id": "seg_AC", "type": "segment", "points": ["A", "C"]},
            ],
            "constraints": [],
            "measurements": [],
            "display": {
                "primitives": {
                    "seg_AB": {"source": "given"},
                    "seg_BC": {"source": "approved_auxiliary", "style": "dashed", "role": "construction"},
                    "seg_AC": {"source": "derived"},
                }
            },
        }

        commands = self.compiler.export_ggb_commands(coordinate_scene)
        command_text = "\n".join(commands)
        self.assertIn("seg_AB = Segment(A, B)", command_text)
        self.assertIn("seg_BC = Segment(B, C)", command_text)
        self.assertNotIn("seg_AC = Segment(A, C)", command_text)


class TemplateCodeGeneratorTests(unittest.TestCase):
    def test_codegen_uses_circle_primitive(self) -> None:
        generator = TemplateCodeGenerator(
            {
                "frame_height": 8.0,
                "frame_width": 14.222,
                "pixel_height": 1080,
                "pixel_width": 1920,
                "safe_margin": 0.4,
                "left_panel_x_max": 1.0,
            }
        )
        coordinate_scene = {
            "mode": "2d",
            "points": [
                {"id": "O", "coord": [0, 0]},
                {"id": "A", "coord": [5, 0]},
                {"id": "B", "coord": [0, 5]},
            ],
            "primitives": [
                {"id": "circle_OA", "type": "circle", "center": "O", "radius_point": "A"},
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
            ],
            "constraints": [{"type": "point_on_circle", "entities": ["B", "circle_OA"]}],
            "display": {},
            "measurements": [{"type": "length", "entities": ["O", "A"], "value": 5}],
        }
        project = type("Project", (), {"problem_text": "circle", "script_steps": []})()
        code = generator.generate(project, coordinate_scene, [])
        self.assertIn("Circle(radius=np.linalg.norm", code)
        self.assertIn("lines['seg_AB']", code)

    def test_codegen_raises_when_primitive_references_missing_point(self) -> None:
        generator = TemplateCodeGenerator(
            {
                "frame_height": 8.0,
                "frame_width": 14.222,
                "pixel_height": 1080,
                "pixel_width": 1920,
                "safe_margin": 0.4,
                "left_panel_x_max": 1.0,
            }
        )
        coordinate_scene = {
            "mode": "2d",
            "points": [
                {"id": "A", "coord": [0, 0]},
                {"id": "B", "coord": [4, 0]},
            ],
            "primitives": [
                {"id": "seg_AC", "type": "segment", "points": ["A", "C"]},
            ],
            "constraints": [],
            "display": {},
            "measurements": [],
        }
        project = type("Project", (), {"problem_text": "invalid scene", "script_steps": []})()

        with self.assertRaisesRegex(ValueError, "missing points"):
            generator.generate(project, coordinate_scene, [])


class CanvasSceneLayoutTests(unittest.TestCase):
    def test_formula_slots_replace_old_content_and_enforce_cap(self) -> None:
        scene = CanvasScene(max_formula_slots=3)

        first = scene.reserve_step_formula_blocks(
            step_id=1,
            formula_items=["AB=4", "BC=6", "AC=10", "overflow"],
        )
        self.assertEqual(len(first), 3)
        self.assertEqual([item.id for item in first], ["formula_slot_1", "formula_slot_2", "formula_slot_3"])

        second = scene.reserve_step_formula_blocks(
            step_id=2,
            formula_items=["S=1/2ab"],
            reset_formula_area=True,
        )
        self.assertEqual(len(second), 1)
        self.assertEqual(second[0].id, "formula_slot_1")

        formula_snapshot = scene.get_formula_snapshot()
        self.assertEqual(len(formula_snapshot), 1)
        self.assertEqual(formula_snapshot[0]["content"], "S=1/2ab")


if __name__ == "__main__":
    unittest.main()
