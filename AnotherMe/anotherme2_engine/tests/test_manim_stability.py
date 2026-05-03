import os
import tempfile
import unittest
from pathlib import Path
import sys
import types

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

from agents.execution.codegen import TemplateCodeGenerator
from agents.execution.error_classifier import classify_render_error
from agents.execution.formal_video_validator import FormalVideoValidator
from agents.execution.animation_agent import AnimationAgent
from agents.planning.animation_planner import AnimationPlanner
from agents.execution.merge_agent import MergeAgent
from agents.planning.script_agent import ScriptAgent
from agents.foundation.state import ScriptStep, VideoProject
from agents.planning.template_retriever import TemplateRetriever


def _canvas_config():
    return {
        "frame_height": 8.0,
        "frame_width": 14.222,
        "pixel_height": 1080,
        "pixel_width": 1920,
        "safe_margin": 0.4,
        "left_panel_x_max": 1.0,
        "right_panel_x_min": 1.8,
    }


def _coordinate_scene():
    return {
        "mode": "2d",
        "points": [
            {"id": "A", "coord": [0, 0]},
            {"id": "B", "coord": [4, 0]},
            {"id": "C", "coord": [0, 3]},
        ],
        "primitives": [
            {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
            {"id": "seg_AC", "type": "segment", "points": ["A", "C"]},
            {"id": "seg_BC", "type": "segment", "points": ["B", "C"]},
            {"id": "poly_ABC", "type": "polygon", "points": ["A", "B", "C"]},
        ],
        "constraints": [],
        "display": {},
        "measurements": [],
    }


def _project(audio_file: str = "audio/step1.mp3") -> VideoProject:
    return VideoProject(
        problem_text="triangle",
        script_steps=[
            ScriptStep(
                id=1,
                title="已知条件",
                duration=2.4,
                narration="展示三角形的已知条件。",
                visual_cues=["highlight"],
                audio_file=audio_file,
                audio_duration=2.4,
            )
        ],
    )


def _step_contexts():
    formula_layout = {
        "content": "AB = 4",
        "x": 0.72,
        "y": 0.10,
        "width": 0.20,
        "height": 0.10,
    }
    return [
        {
            "step_id": 1,
            "title": "已知条件",
            "step_scene": {
                "allow_geometry_motion": False,
                "scene": _coordinate_scene(),
            },
            "animation_plan": {
                "step_id": 1,
                "title": "已知条件",
                "duration": 2.4,
                "focus_entities": ["A", "seg_AB"],
                "actions": [
                    {"type": "highlight"},
                    {"type": "label"},
                ],
                "time_offset": 0.0,
            },
            "canvas_layout": {
                "reserved_formula_elements": [formula_layout],
            },
            "animation_spec": {
                "step_id": 1,
                "title": "已知条件",
                "fallback_mode": "formal",
                "focus_entities": ["A", "seg_AB"],
                "formula_actions": [
                    {
                        "type": "show_formula",
                        "content": "AB = 4",
                        "layout": formula_layout,
                    }
                ],
                "movement_actions": [
                    {"type": "move_point", "point_id": "B"},
                ],
                "emphasis_actions": [
                    {"type": "highlight", "mode": "highlight", "targets": ["A", "seg_AB"]},
                ],
                "label_actions": [
                    {"type": "show_temp_label", "target": "A"},
                ],
                "restore_actions": [
                    {"type": "restore_style", "targets": ["A", "seg_AB"]},
                ],
                "timing_budget": {
                    "duration": 2.4,
                    "formula_reset": 0.0,
                    "formula_show": 0.4,
                    "movement": 0.5,
                    "emphasis": 0.5,
                    "transform": 0.0,
                    "label_show": 0.3,
                    "label_hide": 0.2,
                    "restore": 0.2,
                    "wait": 0.3,
                },
            },
        }
    ]


class StubMergeAgent(MergeAgent):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.last_rendered_code = ""

    def _render_manim(self, manim_file: str, output_file: str, class_name: str = "MathAnimation"):
        self.last_rendered_code = Path(manim_file).read_text(encoding="utf-8")
        Path(output_file).write_bytes(b"fake-mp4")
        return True, ""


class _StubLLM:
    def __init__(self, response_text: str):
        self.response_text = response_text
        self.last_messages = None

    def invoke(self, messages):
        self.last_messages = messages
        return types.SimpleNamespace(content=self.response_text)


class _CountingGenerator(TemplateCodeGenerator):
    def __init__(self, canvas_config: dict, code: str):
        super().__init__(canvas_config)
        self.code = code
        self.calls = 0

    def generate(self, project, coordinate_scene_data, step_contexts):
        self.calls += 1
        return self.code


class ManimStabilityTests(unittest.TestCase):
    def test_script_agent_visible_segments_skips_unit_tokens(self) -> None:
        agent = ScriptAgent(config={}, llm=None)

        segments = agent._normalize_visible_segments(
            value=[],
            narration="已知 AB = 3 cm, BC = 4 cm。",
            visual_cues=[],
            title="长度关系",
        )

        self.assertIn("AB", segments)
        self.assertIn("BC", segments)
        self.assertNotIn("CM", segments)

        explicit_segments = agent._normalize_visible_segments(
            value=["CM", "AB"],
            narration="",
            visual_cues=[],
            title="",
        )
        self.assertIn("CM", explicit_segments)

    def test_script_agent_postprocess_drops_leading_review_steps(self) -> None:
        agent = ScriptAgent(config={}, llm=None)
        steps = [
            ScriptStep(
                id=1,
                title="前置知识复习",
                duration=3.0,
                narration="先回顾菱形和三角函数定义。",
                visual_cues=[],
            ),
            ScriptStep(
                id=2,
                title="读题并整理已知",
                duration=4.0,
                narration="根据题目先标出已知和所求。",
                visual_cues=[],
            ),
        ]

        processed = agent._postprocess_script_steps(steps)
        self.assertEqual(1, len(processed))
        self.assertEqual("读题并整理已知", processed[0].title)
        self.assertEqual(1, processed[0].id)

    def test_script_agent_postprocess_enriches_brief_narration(self) -> None:
        agent = ScriptAgent(config={}, llm=None)
        steps = [
            ScriptStep(
                id=1,
                title="计算关系",
                duration=3.0,
                narration="求出长度。",
                visual_cues=[],
            ),
        ]

        processed = agent._postprocess_script_steps(steps)
        narration = processed[0].narration
        self.assertIn("已知条件", narration)
        self.assertIn("逐步推导", narration)
        self.assertTrue("结论" in narration or "得到" in narration)

    def test_codegen_clean_display_text_preserves_si_lu(self) -> None:
        generator = TemplateCodeGenerator(_canvas_config())
        self.assertEqual(generator._clean_display_text("思路：根据折叠性质"), "思路：根据折叠性质")

    def test_animation_planner_prioritizes_spoken_formulas(self) -> None:
        planner = AnimationPlanner()
        step = ScriptStep(
            id=1,
            title="公式讲解",
            duration=2.0,
            narration="由已知可得 AB=BC。",
            visual_cues=["高亮 AB"],
            spoken_formulas=["AB = BC", "AB \\parallel CD"],
            on_screen_texts=[{"text": "观察关系", "kind": "description", "target_area": "formula_area"}],
            audio_duration=2.0,
        )
        step_scene = {"operations": [], "focus_entities": []}

        plan = planner.plan_step(step, step_scene, time_offset=0.0)
        self.assertIn("AB = BC", plan["formula_items"])
        self.assertIn("AB \\parallel CD", plan["formula_items"])

    def test_animation_planner_adds_explanatory_copy_for_formula_only_step(self) -> None:
        planner = AnimationPlanner()
        step = ScriptStep(
            id=1,
            title="计算 EB",
            duration=2.0,
            narration="结合折叠对应关系计算线段 EB。",
            visual_cues=[],
            spoken_formulas=["EB = 5 - \\sqrt{5}"],
            audio_duration=2.0,
        )
        step_scene = {"operations": [], "focus_entities": []}

        plan = planner.plan_step(step, step_scene, time_offset=0.0)
        self.assertIn("EB = 5 - \\sqrt{5}", plan["formula_items"])
        self.assertTrue(
            any(
                item.startswith("要点：") or item.startswith("思路：")
                for item in plan["formula_items"]
            )
        )

    def test_animation_planner_filters_ambiguous_single_letter_formula(self) -> None:
        planner = AnimationPlanner()
        step = ScriptStep(
            id=2,
            title="三角函数",
            duration=2.0,
            narration="由 tanB=2 推导后续关系。",
            visual_cues=[],
            spoken_formulas=["tan B = 2", "B = 2", "tanB=2"],
            audio_duration=2.0,
        )
        step_scene = {"operations": [], "focus_entities": []}

        plan = planner.plan_step(step, step_scene, time_offset=0.0)
        formulas = plan["formula_items"]
        self.assertIn("tan B = 2", formulas)
        self.assertNotIn("B = 2", formulas)
        self.assertEqual(1, sum(1 for item in formulas if item.replace(" ", "").lower() == "tanb=2"))

    def test_prepare_animation_context_generates_fold_movement_from_coordinate_scene(self) -> None:
        agent = AnimationAgent(
            config={
                "canvas_config": _canvas_config(),
            },
            llm=None,
        )
        coordinate_scene = {
            "mode": "2d",
            "points": [
                {"id": "A", "coord": [0.0, 0.0]},
                {"id": "B", "coord": [2.0, 0.5]},
                {"id": "D", "coord": [0.0, 2.0]},
                {"id": "E", "coord": [1.0, 1.0]},
                {
                    "id": "B1",
                    "derived": {"type": "reflect_point", "source": "B", "axis": ["D", "E"]},
                },
            ],
            "primitives": [
                {"id": "seg_AB", "type": "segment", "points": ["A", "B"]},
                {"id": "seg_DE", "type": "segment", "points": ["D", "E"]},
            ],
            "constraints": [],
            "display": {},
            "measurements": [],
        }
        steps = [
            ScriptStep(
                id=1,
                title="观察图形",
                duration=2.0,
                narration="先观察已知图形。",
                visual_cues=["高亮 DE"],
                audio_duration=2.0,
            ),
            ScriptStep(
                id=2,
                title="执行折叠",
                duration=2.0,
                narration="沿 DE 折叠得到像点。",
                visual_cues=["折叠"],
                audio_duration=2.0,
            ),
        ]
        teaching_ir = {
            "steps": [
                {"step_id": 1, "focus_targets": ["seg_DE"], "actions": [{"action": "highlight_fold_axis", "axis": "seg_DE"}]},
                {
                    "step_id": 2,
                    "focus_targets": ["seg_DE", "B1"],
                    "actions": [{"action": "animate_fold", "axis": "seg_DE", "targets": ["B1"]}],
                },
            ]
        }

        contexts = agent._prepare_animation_context(
            steps,
            coordinate_scene,
            teaching_ir=teaching_ir,
        )
        agent._attach_animation_specs(
            contexts,
            base_coordinate_scene=coordinate_scene,
            conservative=False,
        )

        movement_actions = contexts[1]["animation_spec"]["movement_actions"]
        moved_points = {item.get("point_id") for item in movement_actions}
        self.assertIn("B1", moved_points)

    def test_template_retriever_prefers_tangent_component_templates(self) -> None:
        retriever = TemplateRetriever(
            template_dir=Path(__file__).resolve().parents[1] / "template" / "manim_templates"
        )
        refs = retriever.retrieve(
            {
                "summary": "circle tangent angle",
                "tags": ["circle", "tangent", "angle"],
                "primitives": ["circle", "segment", "angle"],
                "motions": ["highlight"],
            },
            top_k=3,
        )

        self.assertTrue(refs)
        top_ids = {item.id for item in refs}
        self.assertTrue(any("tangent" in item_id for item_id in top_ids))
        self.assertTrue(
            any(
                ("tangent" in item.reason.lower()) or ("angle" in item.reason.lower())
                for item in refs
            )
        )

    def test_template_codegen_emits_expected_actions_and_passes_validation(self) -> None:
        generator = TemplateCodeGenerator(_canvas_config())
        project = _project()
        code = generator.generate(project, _coordinate_scene(), _step_contexts())

        self.assertIn("move_anims.append(points['B'].animate.move_to", code)
        self.assertIn("highlight_anims.append(points['A'].animate.set_color(YELLOW))", code)
        self.assertIn("self.play(FadeIn(temp_labels), run_time=0.30)", code)

        validator = FormalVideoValidator(_canvas_config())
        is_valid, error_message, report = validator.validate(
            code,
            expected_steps=[{"step_id": 1, "duration": 2.4}],
        )
        self.assertTrue(is_valid, error_message)
        self.assertTrue(report["is_valid"])

    def test_validator_rejects_forbidden_partial_llm_code(self) -> None:
        validator = FormalVideoValidator(_canvas_config())
        invalid_code = """
from manim import *
import os

class MathAnimation(Scene):
    def construct(self):
        points = {}
        lines = {}
        points['A'] = Dot()
        points['B'] = Dot()
        lines['seg_AB'] = Line()
        exec("print('bad')")
"""
        is_valid, error_message, report = validator.validate(
            invalid_code,
            expected_steps=[],
        )
        self.assertFalse(is_valid)
        self.assertIn("forbidden", error_message)
        self.assertEqual(report["failed_checks"][0]["check"], "forbidden_calls")

    def test_llm_prompt_includes_template_references_and_copy_guard(self) -> None:
        generated_code = TemplateCodeGenerator(_canvas_config()).generate(
            _project(),
            _coordinate_scene(),
            _step_contexts(),
        )
        llm = _StubLLM(f"```python\n{generated_code}\n```")
        agent = AnimationAgent(
            config={
                "canvas_config": _canvas_config(),
                "use_template_codegen": False,
                "use_template_retrieval": True,
                "template_retrieval_top_k": 2,
            },
            llm=llm,
        )
        metadata = {
            "drawable_scene": _coordinate_scene(),
            "semantic_graph": _coordinate_scene(),
            "template_references": [
                {
                    "id": "helper.make_angle_mark",
                    "snippet_name": "make_angle_mark",
                    "summary": "Create a reusable angle marker.",
                    "reason": "matched angle, circle",
                    "helpers": ["make_angle_mark"],
                    "excerpt": "def make_angle_mark(...):\n    return angle, label",
                }
            ],
        }

        candidate = agent._build_llm_fallback_candidate(
            steps=_project().script_steps,
            metadata=metadata,
            expected_steps=[{"step_id": 1, "duration": 2.4}],
        )

        self.assertTrue(candidate["ok"], candidate.get("error"))
        prompt_text = str(llm.last_messages[-1].content)
        self.assertIn("模板参考 - 只用于学习写法，不是答案", prompt_text)
        self.assertIn("绝对不能照搬模板里的坐标", prompt_text)
        self.assertIn("helper.make_angle_mark", prompt_text)

    def test_template_candidate_only_generates_full_code_once_by_default(self) -> None:
        generated_code = TemplateCodeGenerator(_canvas_config()).generate(
            _project(),
            _coordinate_scene(),
            _step_contexts(),
        )
        agent = AnimationAgent(
            config={
                "canvas_config": _canvas_config(),
                "use_template_codegen": True,
                "export_incremental_codegen_debug": False,
            }
        )
        counting_generator = _CountingGenerator(_canvas_config(), generated_code)
        agent.template_codegen = counting_generator

        candidate = agent._build_template_candidate(
            project=_project(),
            steps=_project().script_steps,
            coordinate_scene_data=_coordinate_scene(),
            expected_steps=[{"step_id": 1, "duration": 2.4}],
            conservative=False,
        )

        self.assertTrue(candidate["ok"], candidate.get("error"))
        self.assertEqual(counting_generator.calls, 1)

    def test_error_classifier_maps_common_failures(self) -> None:
        self.assertEqual(classify_render_error("SyntaxError: invalid syntax"), "PY_SYNTAX")
        self.assertEqual(classify_render_error("ValueError: run_time of 0 <= 0 seconds"), "INVALID_TIMING")
        self.assertEqual(classify_render_error("LaTeX Error converting to dvi"), "LATEX_TEXT_INVALID")
        self.assertEqual(classify_render_error("AttributeError: object has no attribute"), "MANIM_API")

    def test_merge_agent_switches_to_conservative_candidate_before_render(self) -> None:
        generator = TemplateCodeGenerator(_canvas_config())
        project = _project()
        conservative_code = generator.generate(project, _coordinate_scene(), _step_contexts())

        with tempfile.TemporaryDirectory() as tmpdir:
            agent = StubMergeAgent(
                config={
                    "output_dir": tmpdir,
                    "canvas_config": _canvas_config(),
                    "layout": "left_graph_right_formula",
                    "max_repair_rounds": 1,
                }
            )
            project.manim_class_name = "MathAnimation"
            project.audio_embedded = True
            state = {
                "project": project,
                "messages": [],
                "current_step": "animation_completed",
                "metadata": {
                    "manim_code": "def broken(",
                    "manim_codegen_mode": "template_formal",
                    "manim_code_candidates": {
                        "template_formal": "def broken(",
                        "template_conservative": conservative_code,
                    },
                    "validation_candidates": {
                        "template_formal": {"is_valid": False},
                        "template_conservative": {"is_valid": True},
                    },
                    "fallback_level": "formal",
                },
            }

            result = agent.process(state)

            self.assertEqual(result["metadata"]["manim_codegen_mode"], "template_conservative")
            self.assertEqual(result["metadata"]["fallback_level"], "conservative")
            self.assertIn("highlight_anims.append(points['A'].animate.set_color(YELLOW))", agent.last_rendered_code)
            self.assertEqual(result["project"].status, "completed")
            self.assertTrue(result["project"].final_video_path.endswith("animation.mp4"))

    def test_select_rendered_mp4_ignores_partial_movie_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            agent = MergeAgent(config={"output_dir": tmpdir})
            media_dir = Path(tmpdir) / "media"
            partial_file = media_dir / "videos" / "math_animation" / "480p15" / "partial_movie_files" / "MathAnimation" / "00001.mp4"
            final_file = media_dir / "videos" / "math_animation" / "480p15" / "MathAnimation.mp4"

            partial_file.parent.mkdir(parents=True, exist_ok=True)
            final_file.parent.mkdir(parents=True, exist_ok=True)
            partial_file.write_bytes(b"partial")
            final_file.write_bytes(b"final")

            selected = agent._select_rendered_mp4(media_dir, pre_existing_state={}, class_name="MathAnimation")
            self.assertEqual(selected, final_file)

    def test_select_rendered_mp4_does_not_pick_stale_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            agent = MergeAgent(config={"output_dir": tmpdir})
            media_dir = Path(tmpdir) / "media"
            stale_final = media_dir / "videos" / "math_animation" / "480p15" / "MathAnimation.mp4"
            partial_new = media_dir / "videos" / "math_animation" / "480p15" / "partial_movie_files" / "MathAnimation" / "00002.mp4"

            stale_final.parent.mkdir(parents=True, exist_ok=True)
            partial_new.parent.mkdir(parents=True, exist_ok=True)
            stale_final.write_bytes(b"stale-final")

            pre_existing_state = {
                str(stale_final.resolve()): (
                    stale_final.stat().st_mtime,
                    stale_final.stat().st_size,
                    agent._fingerprint_file(stale_final),
                )
            }
            partial_new.write_bytes(b"new-partial")

            selected = agent._select_rendered_mp4(
                media_dir,
                pre_existing_state=pre_existing_state,
                class_name="MathAnimation",
            )
            self.assertIsNone(selected)

    def test_select_rendered_mp4_prefers_class_name_match(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            agent = MergeAgent(config={"output_dir": tmpdir})
            media_dir = Path(tmpdir) / "media"
            target_file = media_dir / "videos" / "math_animation" / "480p15" / "MathAnimation.mp4"
            other_file = media_dir / "videos" / "math_animation" / "480p15" / "OtherScene.mp4"

            target_file.parent.mkdir(parents=True, exist_ok=True)
            target_file.write_bytes(b"target")
            other_file.write_bytes(b"other")

            selected = agent._select_rendered_mp4(
                media_dir,
                pre_existing_state={},
                class_name="MathAnimation",
            )
            self.assertEqual(selected, target_file)

    def test_select_rendered_mp4_detects_overwrite_when_mtime_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            agent = MergeAgent(config={"output_dir": tmpdir})
            media_dir = Path(tmpdir) / "media"
            final_file = media_dir / "videos" / "math_animation" / "480p15" / "MathAnimation.mp4"

            final_file.parent.mkdir(parents=True, exist_ok=True)
            final_file.write_bytes(b"old")
            old_mtime = final_file.stat().st_mtime
            pre_existing_state = {
                str(final_file.resolve()): (old_mtime, final_file.stat().st_size, agent._fingerprint_file(final_file))
            }

            final_file.write_bytes(b"new-content")
            os.utime(final_file, (old_mtime, old_mtime))

            selected = agent._select_rendered_mp4(
                media_dir,
                pre_existing_state=pre_existing_state,
                class_name="MathAnimation",
            )
            self.assertEqual(selected, final_file)

    def test_select_rendered_mp4_detects_overwrite_when_size_and_mtime_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            agent = MergeAgent(config={"output_dir": tmpdir})
            media_dir = Path(tmpdir) / "media"
            final_file = media_dir / "videos" / "math_animation" / "480p15" / "MathAnimation.mp4"

            final_file.parent.mkdir(parents=True, exist_ok=True)
            final_file.write_bytes(b"old_data")
            old_mtime = final_file.stat().st_mtime
            old_size = final_file.stat().st_size
            pre_existing_state = {
                str(final_file.resolve()): (old_mtime, old_size, agent._fingerprint_file(final_file))
            }

            final_file.write_bytes(b"new_data")
            os.utime(final_file, (old_mtime, old_mtime))

            selected = agent._select_rendered_mp4(
                media_dir,
                pre_existing_state=pre_existing_state,
                class_name="MathAnimation",
            )
            self.assertEqual(final_file.stat().st_size, old_size)
            self.assertEqual(selected, final_file)


if __name__ == "__main__":
    unittest.main()
