"""
Vision agent: single-pass OCR + geometry-spec extraction.
"""

import base64
import copy
import json
import math
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..foundation.base_agent import BaseAgent
from .coordinate_scene import CoordinateSceneCompiler, CoordinateSceneError
from .geometry_fact_compiler import GeometryFactCompiler
from .graph_builder import GeometryGraph
from .scene_graph import SceneGraph
try:
    from output_paths import DEFAULT_OUTPUT_DIR
except ModuleNotFoundError:
    from anotherme2_engine.output_paths import DEFAULT_OUTPUT_DIR


class VisionAgent(BaseAgent):
    """Extract problem text and structural geometry information from an image."""

    SYSTEM_PROMPT = (
        "You are an expert math-geometry vision model. "
        "Do OCR accurately, then extract geometry entities, relations, and measurements. "
        "Never invent coordinates unless explicitly asked."
    )

    def __init__(
        self,
        config: Dict[str, Any],
        llm: Optional[Any] = None,
        ocr_llm: Optional[Any] = None,
    ):
        super().__init__(config, llm)
        self.ocr_llm = ocr_llm or llm
        self.system_prompt = config.get("system_prompt", self.SYSTEM_PROMPT)
        self.output_dir = config.get("output_dir", str(DEFAULT_OUTPUT_DIR))
        self.export_ggb = bool(config.get("export_ggb", True))
        self.debug_exceptions = bool(config.get("debug_exceptions", False))
        self.geometry_fact_compiler = GeometryFactCompiler()
        self.coordinate_scene_compiler = CoordinateSceneCompiler()

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        project = state["project"]
        image_path = project.problem_image

        if not image_path or not Path(image_path).exists():
            project.status = "failed"
            project.error_message = "Problem image does not exist."
            state["project"] = project
            state["current_step"] = "vision_failed"
            state["messages"].append({"role": "assistant", "content": project.error_message})
            return state

        metadata = state.setdefault("metadata", {})
        geometry_file = project.geometry_file or metadata.get("geometry_file")
        export_ggb = bool(
            metadata.get(
                "export_ggb",
                project.export_ggb if project.export_ggb is not None else self.export_ggb,
            )
        )

        extract_payload = self._extract_and_stabilize_bundle(
            image_path=image_path,
            project_problem_text=project.problem_text or "",
        )
        bundle = extract_payload["bundle"]
        problem_text = extract_payload["problem_text"]
        geometry_facts = extract_payload["geometry_facts"]
        vision_quality = extract_payload["vision_quality"]

        compile_payload = self._compile_and_infer(
            problem_text=problem_text,
            geometry_facts=geometry_facts,
        )
        geometry_spec = compile_payload["geometry_spec"]
        semantic_signals = compile_payload["semantic_signals"]
        if compile_payload.get("compile_error"):
            vision_quality["fallback_events"].append("geometry_spec_compile_fallback")
        bundle["semantic_signals"] = semantic_signals
        if not problem_text and not self._geometry_facts_have_content(geometry_facts):
            project.status = "failed"
            project.error_message = (
                "Vision extraction returned empty OCR text and empty geometry facts. "
                "Please verify the input image or provide --problem text."
            )
            metadata["problem_bundle"] = bundle
            metadata["geometry_facts"] = geometry_facts
            metadata["geometry_spec"] = geometry_spec
            metadata["vision_quality"] = vision_quality
            state["project"] = project
            state["current_step"] = "vision_failed"
            state["messages"].append({"role": "assistant", "content": project.error_message})
            return state
        project.problem_text = problem_text
        metadata["problem_bundle"] = bundle
        metadata["geometry_facts"] = geometry_facts
        metadata["geometry_spec"] = geometry_spec
        metadata["vision_semantic_signals"] = semantic_signals

        normalized_spec: Optional[Dict[str, Any]] = None
        geometry_spec_validation: Dict[str, Any] = {
            "is_valid": True,
            "failed_checks": [],
            "missing_entities": [],
            "unsupported_relations": [],
            "solver_trace": [],
        }
        coordinate_scene: Optional[Dict[str, Any]] = None
        coordinate_scene_validation: Optional[Dict[str, Any]] = None

        try:
            if geometry_file:
                coordinate_scene = self.coordinate_scene_compiler.load_from_file(geometry_file)
                coordinate_scene_validation = self.coordinate_scene_compiler.validate_coordinate_scene(
                    coordinate_scene
                )
                metadata["auto_geometry_status"] = "success"
            else:
                normalized_spec = self.coordinate_scene_compiler.normalize_geometry_spec(
                    geometry_spec
                )
                geometry_spec_validation = {
                    "is_valid": bool(normalized_spec.get("points"))
                    and bool(normalized_spec.get("primitives")),
                    "failed_checks": [],
                    "missing_entities": [],
                    "unsupported_relations": [],
                    "solver_trace": [],
                }
                coordinate_scene = self.coordinate_scene_compiler.solve_coordinate_scene(
                    normalized_spec
                )
                coordinate_scene_validation = self.coordinate_scene_compiler.validate_coordinate_scene(
                    coordinate_scene,
                    normalized_spec,
                )
                metadata["auto_geometry_status"] = (
                    "success" if coordinate_scene_validation["is_valid"] else "invalid"
                )
                if not coordinate_scene_validation["is_valid"]:
                    raise CoordinateSceneError(
                        self.coordinate_scene_compiler._validation_error_message(
                            coordinate_scene_validation
                        )
                    )
        except CoordinateSceneError as exc:
            if not geometry_file:
                try:
                    normalized_spec = normalized_spec or self.coordinate_scene_compiler.normalize_geometry_spec(
                        geometry_spec
                    )
                except Exception:
                    normalized_spec = None

            metadata["normalized_geometry_spec"] = normalized_spec
            metadata["geometry_spec_validation"] = geometry_spec_validation
            metadata["coordinate_scene_validation"] = coordinate_scene_validation or {
                "is_valid": False,
                "failed_checks": [{"type": "compile", "message": str(exc)}],
                "missing_entities": [],
                "unsupported_relations": [],
                "solver_trace": [],
            }
            metadata["auto_geometry_status"] = metadata.get("auto_geometry_status", "unsupported")
            metadata["debug_exports"] = self.coordinate_scene_compiler.write_debug_exports(
                coordinate_scene=None,
                output_dir=self.output_dir,
                export_ggb=export_ggb,
                extra_payloads={
                    "problem_bundle": bundle,
                    "geometry_facts": geometry_facts,
                    "geometry_spec": geometry_spec,
                    "vision_semantic_signals": semantic_signals,
                    "normalized_geometry_spec": normalized_spec,
                    "geometry_spec_validation": geometry_spec_validation,
                    "coordinate_scene_validation": metadata["coordinate_scene_validation"],
                },
            )

            if geometry_file:
                project.status = "failed"
                project.error_message = (
                    "Geometry file validation failed; stopping the workflow. "
                    f"geometry_file={geometry_file}. Details: {exc}"
                )
                vision_quality["scene_source"] = "failed_geometry_file_validation"
                vision_quality["vision_quality_level"] = "degraded"
                metadata["vision_quality"] = vision_quality
                state["project"] = project
                state["current_step"] = "vision_failed"
                state["messages"].append({"role": "assistant", "content": project.error_message})
                return state

            vision_quality["fallback_events"].append("coordinate_scene_fallback")
            fold_solver_failed = self._fold_solver_failed(metadata["coordinate_scene_validation"])
            if fold_solver_failed:
                vision_quality["fallback_events"].append("fold_solver_failed_safe_fallback")
            fallback_policy = self._assess_schematic_scene_policy(
                problem_text=problem_text,
                semantic_signals=semantic_signals,
            )
            if fold_solver_failed:
                fallback_policy = {
                    "mode": "limited",
                    "allow_solver_fallback": False,
                    "animation_mode": "weak_graph_strong_explanation",
                }
            semantic_signals = self._downgrade_semantic_signals_for_schematic(
                semantic_signals,
                policy=fallback_policy,
            )
            bundle["semantic_signals"] = semantic_signals
            fallback_geometry = normalized_spec or geometry_spec
            used_safe_fallback = False
            if str(fallback_policy.get("mode", "")).strip() == "limited":
                fallback_geometry = self._prune_fold_reflection_artifacts(fallback_geometry)
                used_safe_fallback = True
                vision_quality["fallback_events"].append("fold_safe_fallback_pruned")
            semantic_graph = self._build_semantic_graph(
                fallback_geometry
            )
            drawable_scene = self._build_schematic_drawable_scene(
                fallback_geometry,
                allow_solver_fallback=bool(fallback_policy.get("allow_solver_fallback", True)),
            )
            if str(fallback_policy.get("mode", "")).strip() == "limited":
                drawable_scene["layout_mode"] = (
                    "schematic_safe_fallback" if used_safe_fallback else "schematic_limited_fallback"
                )
            fallback_geometry_graph = self._build_geometry_graph_payload(
                drawable_scene
            )

            metadata["coordinate_scene"] = None
            metadata["coordinate_scene_validation"] = metadata["coordinate_scene_validation"]
            metadata["semantic_graph"] = semantic_graph
            metadata["semantic_graph_json"] = json.dumps(
                semantic_graph, ensure_ascii=False
            )
            metadata["drawable_scene"] = drawable_scene
            metadata["drawable_scene_json"] = json.dumps(
                drawable_scene, ensure_ascii=False
            )
            metadata["scene_graph"] = semantic_graph
            metadata["scene_graph_json"] = metadata["semantic_graph_json"]
            metadata["geometry_graph"] = fallback_geometry_graph
            metadata["geometry_graph_json"] = json.dumps(
                fallback_geometry_graph, ensure_ascii=False
            )
            metadata["semantic_graph_source"] = "normalized_geometry_spec_fallback"
            metadata["drawable_scene_source"] = "schematic_from_normalized_geometry_spec"
            metadata["scene_graph_source"] = metadata["semantic_graph_source"]
            metadata["vision_semantic_signals"] = semantic_signals

            vision_quality["scene_source"] = str(drawable_scene.get("layout_mode", "schematic_fallback"))
            vision_quality["vision_quality_level"] = self._compute_vision_quality_level(
                text_source=str(vision_quality.get("text_source", "")),
                geometry_source=str(vision_quality.get("geometry_source", "")),
                scene_source=str(vision_quality.get("scene_source", "")),
            )
            metadata["vision_quality"] = vision_quality
            metadata["vision_quality_level"] = vision_quality["vision_quality_level"]
            metadata["vision_text_source"] = vision_quality.get("text_source")
            metadata["vision_geometry_source"] = vision_quality.get("geometry_source")
            metadata["vision_scene_source"] = vision_quality.get("scene_source")

            self._write_debug_text(
                "vision_diagnostic_report.json",
                json.dumps(
                    {
                        "vision_quality": vision_quality,
                        "fallback_policy": fallback_policy,
                        "scene_error": str(exc),
                        "compile_error": compile_payload.get("compile_error"),
                        "coordinate_scene_validation": metadata["coordinate_scene_validation"],
                        "geometry_spec_validation": geometry_spec_validation,
                        "recommended_geometry_actions": semantic_signals.get(
                            "recommended_geometry_actions",
                            [],
                        ),
                        "recommended_geometry_action_details": semantic_signals.get(
                            "recommended_geometry_action_details",
                            [],
                        ),
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
            )

            state["project"] = project
            state["current_step"] = "vision_completed"
            state["messages"].append(
                {
                    "role": "assistant",
                    "content": (
                        "Automatic coordinate-scene compilation failed, "
                        f"but the workflow will continue with structured geometry fallback: {exc}"
                    ),
                }
            )
            return state

        semantic_graph = self.coordinate_scene_compiler.derive_semantic_graph(coordinate_scene)
        drawable_scene = self.coordinate_scene_compiler.derive_drawable_scene(coordinate_scene)
        geometry_graph_payload = self._build_geometry_graph_payload(drawable_scene)
        ggb_commands = self.coordinate_scene_compiler.export_ggb_commands(coordinate_scene)
        debug_exports = self.coordinate_scene_compiler.write_debug_exports(
            coordinate_scene=coordinate_scene,
            output_dir=self.output_dir,
            export_ggb=export_ggb,
                extra_payloads={
                    "problem_bundle": bundle,
                    "geometry_facts": geometry_facts,
                    "geometry_spec": geometry_spec,
                    "vision_semantic_signals": semantic_signals,
                    "normalized_geometry_spec": normalized_spec,
                    "geometry_spec_validation": geometry_spec_validation,
                "coordinate_scene_validation": coordinate_scene_validation,
            },
        )

        metadata["normalized_geometry_spec"] = normalized_spec
        metadata["geometry_spec_validation"] = geometry_spec_validation
        metadata["coordinate_scene"] = coordinate_scene
        metadata["coordinate_scene_json"] = json.dumps(coordinate_scene, ensure_ascii=False)
        metadata["coordinate_scene_validation"] = coordinate_scene_validation
        metadata["ggb_commands"] = ggb_commands
        metadata["semantic_graph"] = semantic_graph
        metadata["semantic_graph_json"] = json.dumps(semantic_graph, ensure_ascii=False)
        metadata["drawable_scene"] = drawable_scene
        metadata["drawable_scene_json"] = json.dumps(drawable_scene, ensure_ascii=False)
        metadata["scene_graph"] = semantic_graph
        metadata["scene_graph_json"] = metadata["semantic_graph_json"]
        metadata["geometry_graph"] = geometry_graph_payload
        metadata["geometry_graph_json"] = json.dumps(
            geometry_graph_payload, ensure_ascii=False
        )
        metadata["semantic_graph_source"] = "derived_from_coordinate_scene"
        metadata["drawable_scene_source"] = "derived_from_coordinate_scene"
        metadata["scene_graph_source"] = metadata["semantic_graph_source"]
        metadata["debug_exports"] = debug_exports
        metadata["vision_semantic_signals"] = semantic_signals

        vision_quality["scene_source"] = "coordinate_scene"
        vision_quality["vision_quality_level"] = self._compute_vision_quality_level(
            text_source=str(vision_quality.get("text_source", "")),
            geometry_source=str(vision_quality.get("geometry_source", "")),
            scene_source=str(vision_quality.get("scene_source", "")),
        )
        metadata["vision_quality"] = vision_quality
        metadata["vision_quality_level"] = vision_quality["vision_quality_level"]
        metadata["vision_text_source"] = vision_quality.get("text_source")
        metadata["vision_geometry_source"] = vision_quality.get("geometry_source")
        metadata["vision_scene_source"] = vision_quality.get("scene_source")

        self._write_debug_text(
            "vision_diagnostic_report.json",
            json.dumps(
                {
                    "vision_quality": vision_quality,
                    "compile_error": compile_payload.get("compile_error"),
                    "geometry_spec_validation": geometry_spec_validation,
                    "coordinate_scene_validation": coordinate_scene_validation,
                    "recommended_geometry_actions": semantic_signals.get(
                        "recommended_geometry_actions",
                        [],
                    ),
                    "recommended_geometry_action_details": semantic_signals.get(
                        "recommended_geometry_action_details",
                        [],
                    ),
                },
                ensure_ascii=False,
                indent=2,
            ),
        )

        state["project"] = project
        state["current_step"] = "vision_completed"
        state["messages"].append(
            {
                "role": "assistant",
                "content": f"Problem recognition completed: {problem_text[:50]}...",
            }
        )
        return state

    def _extract_and_stabilize_bundle(
        self,
        *,
        image_path: str,
        project_problem_text: str,
    ) -> Dict[str, Any]:
        bundle = self._analyze_problem_bundle(image_path)
        fallback_events: List[str] = []
        if self._bundle_is_effectively_empty(bundle):
            fallback_events.append("recover_problem_bundle")
            bundle = self._recover_problem_bundle(image_path, bundle)
        bundle = self._stabilize_problem_bundle(bundle, image_path=image_path)

        problem_text = str(project_problem_text or "").strip() or str(
            bundle.get("problem_text", "")
        ).strip()
        if str(project_problem_text or "").strip():
            text_source = "manual_override"
        else:
            text_source = str(bundle.get("problem_text_source", "model"))
        geometry_source = str(bundle.get("geometry_facts_source", "model"))
        fallback_events.extend(list(bundle.get("fallback_events") or []))

        raw_geometry_facts = bundle.get("geometry_facts")
        legacy_geometry_spec = bundle.get("geometry_spec")
        geometry_facts = (
            raw_geometry_facts
            if isinstance(raw_geometry_facts, dict)
            else legacy_geometry_spec
            if isinstance(legacy_geometry_spec, dict)
            else {}
        )
        vision_quality = {
            "text_source": text_source,
            "geometry_source": geometry_source,
            "scene_source": "unknown",
            "vision_quality_level": "recovered",
            "fallback_events": list(dict.fromkeys(fallback_events)),
        }
        return {
            "bundle": bundle,
            "problem_text": problem_text,
            "geometry_facts": geometry_facts,
            "vision_quality": vision_quality,
        }

    def _compile_and_infer(
        self,
        *,
        problem_text: str,
        geometry_facts: Dict[str, Any],
    ) -> Dict[str, Any]:
        geometry_spec, compile_error = self._compile_geometry_spec_with_diagnostics(
            geometry_facts,
            problem_text=problem_text,
        )
        semantic_signals = self._infer_semantic_signals(
            problem_text=problem_text,
            geometry_facts=geometry_facts,
            geometry_spec=geometry_spec,
        )
        return {
            "geometry_spec": geometry_spec,
            "semantic_signals": semantic_signals,
            "compile_error": compile_error,
        }

    def _compose_compiler_geometry_facts(
        self,
        geometry_facts: Optional[Dict[str, Any]],
        *,
        problem_text: str,
    ) -> Dict[str, Any]:
        merged = copy.deepcopy(geometry_facts or {})
        has_fold_semantics = self._contains_fold_semantics(problem_text)
        has_explicit_midpoint = bool(re.search(r"中点|midpoint", str(problem_text or ""), re.IGNORECASE))
        has_high_risk_semantics = bool(
            re.search(
                r"折叠|翻折|对折|切线|圆幂|轨迹|圆|⊙|○|locus|fold|reflect|tangent|circle|dynamic|moving",
                str(problem_text or ""),
                re.IGNORECASE,
            )
        )
        allow_derived_for_compiler = bool(self.config.get("allow_derived_facts_for_compiler", False))
        allow_derived_for_compiler = allow_derived_for_compiler and not has_high_risk_semantics

        def keep_inferred_relation(item: Any) -> bool:
            if not isinstance(item, dict):
                return False
            confidence = item.get("confidence")
            if confidence is not None:
                try:
                    if float(confidence) < 0.7:
                        return False
                except (TypeError, ValueError):
                    pass
            relation_type = str(item.get("type", "")).strip().lower()
            if has_fold_semantics and relation_type == "midpoint" and not has_explicit_midpoint:
                return False
            return True

        def keep_inferred_measurement(item: Any) -> bool:
            if not isinstance(item, dict):
                return False
            confidence = item.get("confidence")
            if confidence is not None:
                try:
                    if float(confidence) < 0.7:
                        return False
                except (TypeError, ValueError):
                    pass
            return True

        observed_relations = list(merged.get("observed_relations") or merged.get("relations") or [])
        text_explicit_relations = list(merged.get("text_explicit_relations") or [])
        derived_relations = list(merged.get("derived_relations") or merged.get("inferred_relations") or [])

        observed_measurements = list(merged.get("observed_measurements") or merged.get("measurements") or [])
        text_explicit_measurements = list(merged.get("text_explicit_measurements") or [])
        derived_measurements = list(merged.get("derived_measurements") or merged.get("inferred_measurements") or [])

        compiler_relations = self._dedupe_fact_dicts(
            [*observed_relations, *text_explicit_relations]
        )
        compiler_measurements = self._dedupe_fact_dicts(
            [*observed_measurements, *text_explicit_measurements]
        )

        if allow_derived_for_compiler:
            compiler_relations = self._dedupe_fact_dicts(
                [
                    *compiler_relations,
                    *[
                        item
                        for item in derived_relations
                        if keep_inferred_relation(item)
                    ],
                ]
            )
            compiler_measurements = self._dedupe_fact_dicts(
                [
                    *compiler_measurements,
                    *[
                        item
                        for item in derived_measurements
                        if keep_inferred_measurement(item)
                    ],
                ]
            )

        merged["relations"] = compiler_relations
        merged["measurements"] = compiler_measurements
        merged["compiler_fact_layers"] = {
            "observed_relations": len(observed_relations),
            "text_explicit_relations": len(text_explicit_relations),
            "derived_relations": len(derived_relations),
            "observed_measurements": len(observed_measurements),
            "text_explicit_measurements": len(text_explicit_measurements),
            "derived_measurements": len(derived_measurements),
            "allow_derived_for_compiler": allow_derived_for_compiler,
        }
        return merged

    def _compile_geometry_spec_with_diagnostics(
        self,
        geometry_facts: Optional[Dict[str, Any]],
        *,
        problem_text: str,
    ) -> Tuple[Dict[str, Any], Optional[str]]:
        merged_facts = self._compose_compiler_geometry_facts(
            geometry_facts,
            problem_text=problem_text,
        )
        try:
            return (
                self.geometry_fact_compiler.compile(
                    merged_facts,
                    problem_text=problem_text,
                ),
                None,
            )
        except Exception as exc:
            self._record_debug_issue("compile_geometry_spec", exc)
            return (
                {
                    "templates": [],
                    "confidence": 0.0,
                    "ambiguities": [],
                    "roles": {},
                    "points": [],
                    "primitives": [],
                    "constraints": [],
                    "measurements": [],
                },
                str(exc),
            )

    def _compute_vision_quality_level(
        self,
        *,
        text_source: str,
        geometry_source: str,
        scene_source: str,
    ) -> str:
        normalized_scene_source = str(scene_source or "").strip().lower()
        if normalized_scene_source == "coordinate_scene":
            if str(text_source) == "model" and str(geometry_source) == "model":
                return "exact"
            return "recovered"
        if "solver_fallback" in normalized_scene_source or "safe_fallback" in normalized_scene_source:
            return "schematic"
        return "degraded"

    def _contains_fold_semantics(self, problem_text: str) -> bool:
        return bool(
            re.search(
                r"折叠|翻折|对折|折痕|对应点|fold|reflect",
                str(problem_text or ""),
                re.IGNORECASE,
            )
        )

    def _fold_solver_failed(self, validation_report: Optional[Dict[str, Any]]) -> bool:
        if not isinstance(validation_report, dict):
            return False
        solver_trace = validation_report.get("solver_trace") or []
        for item in solver_trace:
            if "template fold failed" in str(item).lower() or "unsupported template: fold" in str(item).lower():
                return True
        return False

    def _prune_fold_reflection_artifacts(self, geometry_data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        payload = copy.deepcopy(geometry_data or {})
        if not isinstance(payload, dict):
            return {}

        points = payload.get("points") or []
        reflected_point_ids: set = set()
        if isinstance(points, list):
            filtered_points: List[Dict[str, Any]] = []
            for item in points:
                if not isinstance(item, dict):
                    filtered_points.append(item)
                    continue
                point_id = str(item.get("id", "")).strip()
                derived = item.get("derived") if isinstance(item.get("derived"), dict) else {}
                if str(derived.get("type", "")).strip().lower() == "reflect_point":
                    if point_id:
                        reflected_point_ids.add(point_id)
                    continue
                filtered_points.append(item)
            payload["points"] = filtered_points

        removed_primitive_ids: set = set()
        primitives = payload.get("primitives") or []
        if isinstance(primitives, list):
            filtered_primitives: List[Dict[str, Any]] = []
            for item in primitives:
                if not isinstance(item, dict):
                    filtered_primitives.append(item)
                    continue
                primitive_id = str(item.get("id", "")).strip()
                primitive_type = str(item.get("type", "")).strip().lower()
                refs = [str(ref).strip() for ref in (item.get("points") or []) if str(ref).strip()]
                should_drop = False
                if primitive_type in {"segment", "polygon", "angle", "right_angle", "arc"}:
                    should_drop = any(ref in reflected_point_ids for ref in refs)
                elif primitive_type == "circle":
                    center = str(item.get("center", "")).strip()
                    radius_point = str(item.get("radius_point", "")).strip()
                    should_drop = center in reflected_point_ids or radius_point in reflected_point_ids
                if should_drop:
                    if primitive_id:
                        removed_primitive_ids.add(primitive_id)
                    continue
                filtered_primitives.append(item)
            payload["primitives"] = filtered_primitives

        constraints = payload.get("constraints") or []
        if isinstance(constraints, list):
            filtered_constraints: List[Dict[str, Any]] = []
            for item in constraints:
                if not isinstance(item, dict):
                    filtered_constraints.append(item)
                    continue
                entities = [str(entity).strip() for entity in (item.get("entities") or []) if str(entity).strip()]
                if any(entity in reflected_point_ids or entity in removed_primitive_ids for entity in entities):
                    continue
                filtered_constraints.append(item)
            payload["constraints"] = filtered_constraints

        measurements = payload.get("measurements") or []
        if isinstance(measurements, list):
            filtered_measurements: List[Dict[str, Any]] = []
            for item in measurements:
                if not isinstance(item, dict):
                    filtered_measurements.append(item)
                    continue
                entities = [str(entity).strip() for entity in (item.get("entities") or []) if str(entity).strip()]
                if any(entity in reflected_point_ids or entity in removed_primitive_ids for entity in entities):
                    continue
                filtered_measurements.append(item)
            payload["measurements"] = filtered_measurements

        display = payload.get("display")
        if isinstance(display, dict):
            point_display = display.get("points")
            if isinstance(point_display, dict):
                for point_id in reflected_point_ids:
                    point_display.pop(point_id, None)
            primitive_display = display.get("primitives")
            if isinstance(primitive_display, dict):
                for primitive_id in removed_primitive_ids:
                    primitive_display.pop(primitive_id, None)

        return payload

    def _assess_schematic_scene_policy(
        self,
        *,
        problem_text: str,
        semantic_signals: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        text = str(problem_text or "")
        signals = semantic_signals if isinstance(semantic_signals, dict) else {}
        inferred_pattern = str(signals.get("inferred_problem_pattern", "")).strip()
        high_risk_pattern = inferred_pattern in {"fold_transform", "circle_geometry", "dynamic_point"}
        high_risk_text = bool(
            re.search(
                r"折叠|翻折|对折|切线|圆幂|轨迹|locus|fold|tangent|dynamic|moving",
                text,
                re.IGNORECASE,
            )
        )
        if high_risk_pattern or high_risk_text:
            return {
                "mode": "limited",
                "allow_solver_fallback": False,
                "animation_mode": "weak_graph_strong_explanation",
            }
        return {
            "mode": "standard",
            "allow_solver_fallback": True,
            "animation_mode": "normal",
        }

    def _downgrade_semantic_signals_for_schematic(
        self,
        semantic_signals: Dict[str, Any],
        *,
        policy: Dict[str, Any],
    ) -> Dict[str, Any]:
        adjusted = copy.deepcopy(semantic_signals or {})
        if str(policy.get("mode", "")).strip() != "limited":
            return adjusted
        adjusted["needs_extra_geometry_animation"] = False
        adjusted["recommended_geometry_actions"] = []
        adjusted["recommended_geometry_action_details"] = []
        adjusted["fallback_animation_mode"] = str(policy.get("animation_mode", "weak_graph_strong_explanation"))
        return adjusted

    def _analyze_problem_bundle(self, image_path: str) -> Dict[str, Any]:
        with open(image_path, "rb") as file:
            image_data = base64.b64encode(file.read()).decode()

        prompt = """
Analyze this plane-geometry problem image and return JSON only.

Requirements:
1. `problem_text` must contain the full OCR text.
2. `geometry_facts` must contain only entities, relations, and known measurements. Do not invent coordinates.
3. Be conservative. If something is uncertain, leave it out instead of guessing.
4. Segment or line names such as `AB`, `AC`, `BE` are not point ids. Only labeled points like `A`, `B`, `C`, `O`, `D`, `E`, `M`, `P`, `C1` belong in `points`.
5. Prefer simple fact buckets instead of final compiler-ready schema:
   - `points`
   - `segments`
   - `polygons`
   - `circles`
   - `arcs`
   - `angles`
   - `right_angles`
   - `relations`
   - `measurements`
6. Each relation item must use one of:
   `point_on_segment`, `point_on_circle`, `collinear`, `perpendicular`, `parallel`, `midpoint`, `equal_length`, `intersect`.
7. Each measurement item must use one of:
   `length`, `angle`, `ratio`.
8. For a circle, include `center`, and if possible include `radius_point` or `points_on_circle`.
9. For an arc, include `center` and only the two arc endpoints.
10. If you cannot fit something into the simple fact buckets, omit it instead of inventing a new schema.

Return exactly:
{
  "problem_text": "full OCR text",
  "geometry_facts": {
    "confidence": 0.0,
    "ambiguities": [],
    "roles": {},
    "points": [],
    "segments": [],
    "polygons": [],
    "circles": [],
    "arcs": [],
    "angles": [],
    "right_angles": [],
    "relations": [],
    "measurements": []
  }
}
"""

        messages = [
            {"role": "system", "content": self.system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_data}"},
                    },
                ],
            },
        ]

        result = self._invoke_model(messages, model_role="geometry").strip()
        try:
            Path(self.output_dir).mkdir(parents=True, exist_ok=True)
            debug_dir = Path(self.output_dir) / "debug"
            debug_dir.mkdir(parents=True, exist_ok=True)
            (debug_dir / "vision_bundle_raw_response.txt").write_text(result, encoding="utf-8")
        except Exception as exc:
            self._record_debug_issue("analyze_problem_bundle_raw_response", exc)
        parsed_bundle = self._parse_json_like_output(
            result,
            {
                "problem_text": "",
                "geometry_facts": {
                    "confidence": 0.0,
                    "ambiguities": [],
                    "roles": {},
                    "points": [],
                    "segments": [],
                    "polygons": [],
                    "circles": [],
                    "arcs": [],
                    "angles": [],
                    "right_angles": [],
                    "relations": [],
                    "measurements": [],
                },
                "geometry_spec": {
                    "templates": [],
                    "confidence": 0.0,
                    "ambiguities": [],
                    "roles": {},
                    "points": [],
                    "primitives": [],
                    "constraints": [],
                    "measurements": [],
                },
            },
        )
        if not isinstance(parsed_bundle, dict):
            parsed_bundle = {}

        model_problem_text = str(parsed_bundle.get("problem_text", "")).strip()
        ocr_problem_text = ""
        try:
            ocr_problem_text = self._extract_problem_text_fallback(image_path)
        except Exception as exc:
            self._record_debug_issue("extract_problem_text_fallback", exc)
        model_score = self._problem_text_quality_score(model_problem_text)
        ocr_score = self._problem_text_quality_score(ocr_problem_text)
        parsed_bundle["problem_text_source"] = "model"
        if ocr_problem_text and (
            not model_problem_text or ocr_score >= (model_score - 0.2)
        ):
            parsed_bundle["problem_text"] = ocr_problem_text
            parsed_bundle["problem_text_source"] = "ocr_fallback"

        if not isinstance(parsed_bundle.get("geometry_facts"), dict):
            parsed_bundle["geometry_facts"] = self._extract_geometry_facts_fallback(
                image_path=image_path,
                problem_text=str(parsed_bundle.get("problem_text", "")).strip(),
            )
            parsed_bundle["geometry_facts_source"] = "geometry_fallback"
        else:
            parsed_bundle["geometry_facts_source"] = "model"

        self._write_debug_text(
            "vision_ocr_vs_geometry_text_quality.json",
            json.dumps(
                {
                    "model_score": round(model_score, 2),
                    "ocr_score": round(ocr_score, 2),
                    "picked": "ocr"
                    if str(parsed_bundle.get("problem_text", "")).strip() == ocr_problem_text
                    else "geometry_bundle",
                },
                ensure_ascii=False,
                indent=2,
            ),
        )

        return parsed_bundle

    def _bundle_is_effectively_empty(self, bundle: Optional[Dict[str, Any]]) -> bool:
        if not isinstance(bundle, dict):
            return True
        problem_text = str(bundle.get("problem_text", "")).strip()
        geometry_facts = bundle.get("geometry_facts") or bundle.get("geometry_spec") or {}
        return (not problem_text) and (not self._geometry_facts_have_content(geometry_facts))

    def _geometry_facts_have_content(self, geometry_facts: Optional[Dict[str, Any]]) -> bool:
        if not isinstance(geometry_facts, dict):
            return False
        buckets = [
            "points",
            "segments",
            "polygons",
            "circles",
            "arcs",
            "angles",
            "right_angles",
            "relations",
            "text_explicit_relations",
            "derived_relations",
            "measurements",
            "text_explicit_measurements",
            "derived_measurements",
            "inferred_relations",
            "inferred_measurements",
            "primitives",
            "constraints",
        ]
        for bucket in buckets:
            items = geometry_facts.get(bucket)
            if isinstance(items, list) and items:
                return True
            if isinstance(items, dict) and items:
                return True
        return False

    def _recover_problem_bundle(
        self,
        image_path: str,
        original_bundle: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        recovered = copy.deepcopy(original_bundle or {})
        fallback_events = list(recovered.get("fallback_events") or [])
        recovered.setdefault("problem_text", "")
        recovered.setdefault(
            "geometry_facts",
            {
                "confidence": 0.0,
                "ambiguities": [],
                "roles": {},
                "points": [],
                "segments": [],
                "polygons": [],
                "circles": [],
                "arcs": [],
                "angles": [],
                "right_angles": [],
                "relations": [],
                "measurements": [],
            },
        )

        if not str(recovered.get("problem_text", "")).strip():
            recovered["problem_text"] = self._extract_problem_text_fallback(image_path)
            recovered["problem_text_source"] = "ocr_fallback"
            fallback_events.append("recover_problem_text_fallback")

        if not self._geometry_facts_have_content(recovered.get("geometry_facts")):
            recovered["geometry_facts"] = self._extract_geometry_facts_fallback(
                image_path=image_path,
                problem_text=str(recovered.get("problem_text", "")).strip(),
            )
            recovered["geometry_facts_source"] = "geometry_fallback"
            fallback_events.append("recover_geometry_facts_fallback")

        recovered["fallback_events"] = list(dict.fromkeys(fallback_events))

        return recovered

    def _stabilize_problem_bundle(
        self,
        bundle: Optional[Dict[str, Any]],
        *,
        image_path: str,
    ) -> Dict[str, Any]:
        stabilized = copy.deepcopy(bundle or {})
        fallback_events = list(stabilized.get("fallback_events") or [])
        problem_text = str(stabilized.get("problem_text", "")).strip()
        geometry_facts = stabilized.get("geometry_facts")
        if not isinstance(geometry_facts, dict):
            geometry_facts = {}
        text_source = str(stabilized.get("problem_text_source", "model"))
        geometry_source = str(stabilized.get("geometry_facts_source", "model"))

        if not problem_text:
            problem_text = self._extract_problem_text_fallback(image_path)
            text_source = "ocr_fallback"
            fallback_events.append("problem_text_fallback")
        else:
            upgraded = self._upgrade_problem_text_if_needed(problem_text, image_path=image_path)
            if upgraded != problem_text:
                text_source = "upgraded_ocr"
                fallback_events.append("problem_text_upgrade")
            problem_text = upgraded

        text_facts = self._extract_text_facts_from_problem_text(problem_text)
        geometry_facts = self._merge_text_facts_into_geometry_facts(
            geometry_facts,
            text_facts,
        )
        geometry_facts = self._sanitize_geometry_facts(geometry_facts, problem_text=problem_text)
        if (
            geometry_facts.get("text_explicit_relations")
            or geometry_facts.get("text_explicit_measurements")
            or geometry_facts.get("derived_relations")
            or geometry_facts.get("derived_measurements")
            or geometry_facts.get("inferred_relations")
            or geometry_facts.get("inferred_measurements")
        ):
            if geometry_source == "model":
                geometry_source = "sanitized_layered_facts"

        if not self._geometry_facts_have_content(geometry_facts):
            fallback = self._extract_geometry_facts_fallback(
                image_path=image_path,
                problem_text=problem_text,
            )
            geometry_facts = self._sanitize_geometry_facts(fallback, problem_text=problem_text)
            geometry_source = "geometry_fallback"
            fallback_events.append("geometry_facts_fallback")

        stabilized["problem_text"] = problem_text
        stabilized["geometry_facts"] = geometry_facts
        stabilized["text_facts"] = text_facts
        stabilized["problem_text_source"] = text_source
        stabilized["geometry_facts_source"] = geometry_source
        stabilized["fallback_events"] = list(dict.fromkeys(fallback_events))
        return stabilized

    def _extract_text_facts_from_problem_text(self, problem_text: str) -> Dict[str, Any]:
        normalized = self._normalize_prime_markers(problem_text)
        result: Dict[str, Any] = {
            "points": [],
            "segments": [],
            "text_explicit_relations": [],
            "text_explicit_measurements": [],
            "derived_relations": [],
            "derived_measurements": [],
        }
        if not str(normalized or "").strip():
            return result

        points: List[str] = []
        for token in re.findall(r"[A-Z]\d*'*", normalized):
            point = self._normalize_point_token(token)
            if point:
                points.append(point)
        result["points"] = self._ordered_unique_tokens(points)

        segments: List[str] = []
        for match in re.findall(
            r"(?<!\d\s)(?<![A-Za-z0-9_'])([A-Z]\d*['′]?\s*[A-Z]\d*['′]?)(?![A-Za-z0-9_'])",
            normalized,
        ):
            seg = self._normalize_segment_token(match)
            if seg:
                segments.append(seg)
        result["segments"] = self._ordered_unique_tokens(segments)

        text_relations: List[Dict[str, Any]] = []
        text_measurements: List[Dict[str, Any]] = []
        derived_measurements: List[Dict[str, Any]] = []

        for match in re.finditer(r"([A-Z]\d*'*)\s*是\s*([A-Z]\d*'*[A-Z]\d*'*)\s*的?中点", normalized):
            point_id = self._normalize_point_token(match.group(1))
            segment_id = self._normalize_segment_token(match.group(2))
            if point_id and segment_id:
                text_relations.append({"type": "midpoint", "point": point_id, "segment": segment_id})

        for match in re.finditer(r"([A-Z]\d*'*)\s*(?:在|是)\s*([A-Z]\d*'*[A-Z]\d*'*)\s*(?:上|上一点|上的一点)", normalized):
            point_id = self._normalize_point_token(match.group(1))
            segment_id = self._normalize_segment_token(match.group(2))
            if point_id and segment_id:
                text_relations.append({"type": "point_on_segment", "point": point_id, "segment": segment_id})

        for match in re.finditer(r"([A-Z]\d*'*)\s*(?:在|属于)?\s*[⊙○]\s*([A-Z]\d*'*)\s*(?:上|内)?", normalized):
            point_id = self._normalize_point_token(match.group(1))
            center = self._normalize_point_token(match.group(2))
            if point_id and center:
                text_relations.append({"type": "point_on_circle", "point": point_id, "circle": f"circle_{center}"})

        for match in re.finditer(
            r"(?<![A-Z0-9'′])([A-Z]\d*['′]?[A-Z]\d*['′]?)\s*=\s*([-+]?\d+(?:\.\d+)?)",
            normalized,
        ):
            segment_id = self._normalize_segment_token(match.group(1))
            if not segment_id:
                continue
            value = self._safe_float(match.group(2), default=None)
            if value is None:
                continue
            text_measurements.append({"type": "length", "segment": segment_id, "value": value})

        for match in re.finditer(r"∠\s*([A-Z]\d*'*(?:[A-Z]\d*'*){2})\s*=\s*([-+]?\d+(?:\.\d+)?)", normalized):
            angle_name = self._normalize_angle_name("∠" + match.group(1))
            value = self._safe_float(match.group(2), default=None)
            if angle_name and value is not None:
                text_measurements.append({"type": "angle", "angle": angle_name, "value": value})

        for match in re.finditer(r"tan\s*([A-Z]\d*'*)\s*=\s*([-+]?\d+(?:\.\d+)?)", normalized, flags=re.IGNORECASE):
            angle_name = self._normalize_angle_name("∠" + match.group(1))
            if angle_name:
                derived_measurements.append({"type": "angle", "angle": angle_name, "value": f"arctan({match.group(2)})"})

        result["text_explicit_relations"] = self._dedupe_fact_dicts(text_relations)
        result["text_explicit_measurements"] = self._dedupe_fact_dicts(text_measurements)
        result["derived_measurements"] = self._dedupe_fact_dicts(derived_measurements)
        return result

    def _merge_text_facts_into_geometry_facts(
        self,
        geometry_facts: Optional[Dict[str, Any]],
        text_facts: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        merged = copy.deepcopy(geometry_facts or {})
        text_payload = text_facts if isinstance(text_facts, dict) else {}

        merged_points = self._ordered_unique_tokens(
            [
                *[str(item).strip() for item in (merged.get("points") or []) if str(item).strip()],
                *[str(item).strip() for item in (text_payload.get("points") or []) if str(item).strip()],
            ]
        )
        merged_segments = self._ordered_unique_tokens(
            [
                *[str(item).strip() for item in (merged.get("segments") or []) if str(item).strip()],
                *[str(item).strip() for item in (text_payload.get("segments") or []) if str(item).strip()],
            ]
        )
        merged["points"] = merged_points
        merged["segments"] = merged_segments

        for bucket in (
            "text_explicit_relations",
            "text_explicit_measurements",
            "derived_relations",
            "derived_measurements",
        ):
            combined = [
                *[item for item in (merged.get(bucket) or []) if isinstance(item, dict)],
                *[item for item in (text_payload.get(bucket) or []) if isinstance(item, dict)],
            ]
            merged[bucket] = self._dedupe_fact_dicts(combined)

        return merged

    def _upgrade_problem_text_if_needed(self, problem_text: str, *, image_path: str) -> str:
        base_text = str(problem_text or "").strip()
        if not self._should_retry_problem_text(base_text):
            return base_text

        try:
            fallback_text = self._extract_problem_text_fallback(image_path)
        except Exception:
            return base_text

        fallback_text = str(fallback_text or "").strip()
        base_score = self._problem_text_quality_score(base_text)
        fallback_score = self._problem_text_quality_score(fallback_text)

        picked = fallback_text if fallback_score > (base_score + 0.8) else base_text
        debug_payload = {
            "base_score": round(base_score, 2),
            "fallback_score": round(fallback_score, 2),
            "picked": "fallback" if picked == fallback_text else "base",
            "base_preview": base_text[:160],
            "fallback_preview": fallback_text[:160],
        }
        self._write_debug_text(
            "problem_text_quality_check.json",
            json.dumps(debug_payload, ensure_ascii=False, indent=2),
        )
        return picked

    def _should_retry_problem_text(self, problem_text: str) -> bool:
        text = str(problem_text or "").strip()
        if not text:
            return True
        if len(text) < 40:
            if not re.search(r"[。！？?]$", text) and ("\n" not in text):
                return True
            return False

        has_blank = bool(re.search(r"（\s*\)|\(\s*\)", text))
        has_choice_markers = bool(re.search(r"(?:^|\n)\s*[A-DＡ-Ｄ][\.、．\)]\s*", text, re.IGNORECASE))
        has_terminal_punctuation = bool(re.search(r"[。！？?]$", text))
        if has_blank and not has_choice_markers:
            return True

        if len(text) < 80 and (not has_choice_markers) and (not has_terminal_punctuation) and ("\n" not in text):
            return True

        if text.endswith(("，", ",", "、", "；", ";", ":", "：")):
            return True
        return False

    def _problem_text_quality_score(self, problem_text: str) -> float:
        text = str(problem_text or "").strip()
        if not text:
            return 0.0

        score = min(len(text), 600) / 120.0
        if "\n" in text:
            score += 0.8
        if re.search(r"(?:^|\n)\s*[A-DＡ-Ｄ][\.、．\)]\s*", text, re.IGNORECASE):
            score += 1.5
        if re.search(r"（\s*\)|\(\s*\)", text):
            score += 0.6
        if re.search(r"[。！？?]$", text):
            score += 0.4
        return score

    def _sanitize_geometry_facts(
        self,
        geometry_facts: Optional[Dict[str, Any]],
        *,
        problem_text: str,
    ) -> Dict[str, Any]:
        facts = copy.deepcopy(geometry_facts or {})
        sanitized: Dict[str, Any] = {
            "confidence": self._safe_float(facts.get("confidence"), default=0.0),
            "ambiguities": [
                str(item).strip()
                for item in (facts.get("ambiguities") or [])
                if str(item).strip()
            ],
            "roles": facts.get("roles") if isinstance(facts.get("roles"), dict) else {},
            "points": [],
            "segments": [],
            "polygons": [],
            "circles": [],
            "arcs": [],
            "angles": [],
            "right_angles": [],
            "relations": [],
            "observed_relations": [],
            "text_explicit_relations": [],
            "derived_relations": [],
            "inferred_relations": [],
            "measurements": [],
            "observed_measurements": [],
            "text_explicit_measurements": [],
            "derived_measurements": [],
            "inferred_measurements": [],
        }

        points = self._ordered_unique_tokens(
            list(self._iter_point_tokens(facts.get("points")))
            + list(self._iter_problem_text_points(problem_text))
        )
        point_set = set(points)
        sanitized["points"] = points

        segments = self._ordered_unique_tokens(
            list(self._iter_segment_tokens(facts.get("segments")))
            + self._infer_problem_text_segments(problem_text, point_set)
        )
        segment_set = set(segments)
        sanitized["segments"] = segments

        polygons = self._ordered_unique_tokens(
            list(self._iter_polygon_tokens(facts.get("polygons")))
            + self._infer_problem_text_polygons(problem_text, point_set)
        )
        sanitized["polygons"] = polygons

        circles = self._sanitize_circle_bucket(
            facts.get("circles"),
            point_set=point_set,
        )
        sanitized["circles"] = circles

        circle_ref_map: Dict[str, str] = {}
        for item in circles:
            circle_id = str(item.get("id", "")).strip()
            center = str(item.get("center", "")).strip()
            if circle_id:
                circle_ref_map[circle_id] = circle_id
            if center:
                circle_ref_map[center] = circle_id or center

        arcs = self._sanitize_arc_bucket(
            facts.get("arcs"),
            point_set=point_set,
            circle_ref_map=circle_ref_map,
        )
        sanitized["arcs"] = arcs

        # Ensure circle/arc referenced points are retained with deterministic ordering.
        sanitized["points"] = self._merge_ordered_points(sanitized["points"], point_set)

        sanitized["angles"] = self._sanitize_angle_bucket(
            facts.get("angles"),
            point_set=point_set,
        )
        sanitized["right_angles"] = self._sanitize_angle_bucket(
            facts.get("right_angles"),
            point_set=point_set,
            force_right=True,
        )
        sanitized["measurements"] = self._sanitize_measurement_bucket(
            facts.get("measurements"),
            point_set=point_set,
            segment_set=segment_set,
        )
        angle_vertices = self._collect_angle_vertices(
            angles=sanitized["angles"],
            right_angles=sanitized["right_angles"],
            measurements=sanitized["measurements"],
        )
        has_fold_semantics = self._contains_fold_semantics(problem_text)
        has_explicit_midpoint = bool(re.search(r"中点|midpoint", str(problem_text or ""), re.IGNORECASE))

        sanitized["text_explicit_relations"] = self._sanitize_relation_bucket(
            facts.get("text_explicit_relations"),
            point_set=point_set,
            segment_set=segment_set,
            circle_ref_map=circle_ref_map,
            angle_vertices=angle_vertices,
            has_fold_semantics=has_fold_semantics,
            allow_midpoint=has_explicit_midpoint,
        )
        sanitized["derived_relations"] = self._sanitize_relation_bucket(
            [
                *(facts.get("derived_relations") or []),
                *(facts.get("inferred_relations") or []),
            ],
            point_set=point_set,
            segment_set=segment_set,
            circle_ref_map=circle_ref_map,
            angle_vertices=angle_vertices,
            has_fold_semantics=has_fold_semantics,
            allow_midpoint=has_explicit_midpoint,
        )
        sanitized["text_explicit_measurements"] = self._sanitize_measurement_bucket(
            facts.get("text_explicit_measurements"),
            point_set=point_set,
            segment_set=segment_set,
        )
        sanitized["derived_measurements"] = self._sanitize_measurement_bucket(
            [
                *(facts.get("derived_measurements") or []),
                *(facts.get("inferred_measurements") or []),
            ],
            point_set=point_set,
            segment_set=segment_set,
        )

        sanitized["text_explicit_relations"] = self._ensure_fact_metadata(
            sanitized["text_explicit_relations"],
            source="problem_text_explicit",
            status="text_explicit",
            default_confidence=0.98,
        )
        sanitized["derived_relations"] = self._ensure_fact_metadata(
            sanitized["derived_relations"],
            source="problem_text_derived",
            status="derived",
            default_confidence=0.72,
        )
        sanitized["text_explicit_measurements"] = self._ensure_fact_metadata(
            sanitized["text_explicit_measurements"],
            source="problem_text_explicit",
            status="text_explicit",
            default_confidence=0.98,
        )
        sanitized["derived_measurements"] = self._ensure_fact_metadata(
            sanitized["derived_measurements"],
            source="problem_text_derived",
            status="derived",
            default_confidence=0.72,
        )
        sanitized["relations"] = self._sanitize_relation_bucket(
            facts.get("relations"),
            point_set=point_set,
            segment_set=segment_set,
            circle_ref_map=circle_ref_map,
            angle_vertices=angle_vertices,
            has_fold_semantics=has_fold_semantics,
            allow_midpoint=has_explicit_midpoint,
        )
        sanitized["observed_relations"] = copy.deepcopy(sanitized["relations"])
        sanitized["observed_measurements"] = copy.deepcopy(sanitized["measurements"])

        self._augment_facts_from_problem_text(
            sanitized,
            problem_text=problem_text,
            point_set=point_set,
            segment_set=segment_set,
        )

        sanitized["relations"] = self._dedupe_fact_dicts(
            [
                *sanitized.get("observed_relations", []),
                *sanitized.get("text_explicit_relations", []),
            ]
        )
        sanitized["measurements"] = self._dedupe_fact_dicts(
            [
                *sanitized.get("observed_measurements", []),
                *sanitized.get("text_explicit_measurements", []),
            ]
        )
        sanitized["derived_relations"] = self._dedupe_fact_dicts(sanitized.get("derived_relations", []))
        sanitized["derived_measurements"] = self._dedupe_fact_dicts(sanitized.get("derived_measurements", []))
        # Backward compatibility for downstream consumers still reading inferred_*.
        sanitized["inferred_relations"] = copy.deepcopy(sanitized["derived_relations"])
        sanitized["inferred_measurements"] = copy.deepcopy(sanitized["derived_measurements"])
        sanitized["points"] = self._merge_ordered_points(sanitized["points"], point_set)
        return sanitized

    def _iter_point_tokens(self, raw: Any):
        if isinstance(raw, (list, tuple)):
            for item in raw:
                token = self._normalize_point_token(item if not isinstance(item, dict) else item.get("id") or item.get("label") or item.get("name"))
                if token:
                    yield token

    def _iter_problem_text_points(self, text: str):
        normalized = self._normalize_prime_markers(text)
        for token in re.findall(r"[A-Z]\d*'*", normalized):
            point = self._normalize_point_token(token)
            if point:
                yield point

    def _iter_segment_tokens(self, raw: Any):
        if isinstance(raw, (list, tuple)):
            for item in raw:
                token = self._normalize_segment_token(item if not isinstance(item, dict) else item.get("id") or item.get("segment") or item.get("label"))
                if token:
                    yield token

    def _iter_polygon_tokens(self, raw: Any):
        if isinstance(raw, (list, tuple)):
            for item in raw:
                token = self._normalize_polygon_token(item if not isinstance(item, dict) else item.get("id") or item.get("polygon") or item.get("label"))
                if token:
                    yield token

    def _sanitize_angle_bucket(
        self,
        raw_bucket: Any,
        *,
        point_set: set,
        force_right: bool = False,
    ) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []
        seen: set = set()
        for raw in (raw_bucket or []):
            if not isinstance(raw, dict):
                continue
            vertex = self._normalize_point_token(raw.get("vertex"))
            refs: List[str] = []
            sides = raw.get("sides")
            if vertex and isinstance(sides, (list, tuple)) and len(sides) == 2:
                for side in sides:
                    endpoints = self._segment_endpoints_from_token(side)
                    if len(endpoints) == 2 and vertex in endpoints:
                        refs.append(endpoints[0] if endpoints[1] == vertex else endpoints[1])

            if len(refs) != 2:
                angle_points = self._extract_angle_points_from_text(
                    raw.get("angle")
                    or raw.get("name")
                    or raw.get("label")
                    or raw.get("description")
                    or ""
                )
                if len(angle_points) == 3:
                    refs = [angle_points[0], angle_points[2]]
                    vertex = vertex or angle_points[1]

            if len(refs) == 2 and vertex:
                point_set.add(vertex)
                point_set.add(refs[0])
                point_set.add(refs[1])

            if len(refs) == 2 and vertex and vertex in point_set and refs[0] in point_set and refs[1] in point_set:
                payload = {"vertex": vertex, "sides": [self._normalize_segment_token(vertex + refs[0]), self._normalize_segment_token(vertex + refs[1])]}
                for key in ("name", "label", "description"):
                    if str(raw.get(key, "")).strip():
                        payload[key] = str(raw.get(key)).strip()
                        break
                signature = (vertex, tuple(sorted(refs)), force_right)
                if signature not in seen:
                    seen.add(signature)
                    result.append(payload)
        return result

    def _sanitize_circle_bucket(
        self,
        raw_bucket: Any,
        *,
        point_set: set,
    ) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []
        seen: set = set()
        for raw in (raw_bucket or []):
            circle_id = ""
            center = ""
            radius_point = ""
            points_on_circle: List[str] = []

            if isinstance(raw, str):
                center = self._normalize_circle_center_token(raw)
            elif isinstance(raw, dict):
                circle_id = self._normalize_circle_id(raw.get("id") or raw.get("circle") or raw.get("circle_id"))
                center = self._normalize_point_token(raw.get("center") or raw.get("origin") or raw.get("o"))
                if not center:
                    center = self._normalize_circle_center_token(raw.get("label") or raw.get("name") or raw.get("id"))
                radius_point = self._normalize_point_token(raw.get("radius_point") or raw.get("point"))
                points_on_circle = [
                    self._normalize_point_token(item)
                    for item in self._extract_points_from_any(
                        raw.get("points_on_circle")
                        or raw.get("points")
                        or raw.get("on_points")
                        or raw.get("entities")
                    )
                ]
                points_on_circle = [item for item in points_on_circle if item and item != center]

            if not center:
                continue
            if not circle_id:
                circle_id = f"circle_{center}"

            if center:
                point_set.add(center)
            if radius_point:
                point_set.add(radius_point)
            for point_id in points_on_circle:
                point_set.add(point_id)

            payload: Dict[str, Any] = {"id": circle_id, "center": center}
            if radius_point and radius_point != center:
                payload["radius_point"] = radius_point
            unique_circle_points = self._ordered_unique_tokens(points_on_circle)
            if unique_circle_points:
                payload["points_on_circle"] = unique_circle_points

            signature = json.dumps(payload, ensure_ascii=False, sort_keys=True)
            if signature in seen:
                continue
            seen.add(signature)
            result.append(payload)
        return result

    def _sanitize_arc_bucket(
        self,
        raw_bucket: Any,
        *,
        point_set: set,
        circle_ref_map: Dict[str, str],
    ) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []
        seen: set = set()
        for raw in (raw_bucket or []):
            arc_id = ""
            center = ""
            circle_ref = ""
            endpoints: List[str] = []

            if isinstance(raw, str):
                refs = [self._normalize_point_token(item) for item in self._extract_points_from_any(raw)]
                endpoints = [item for item in refs if item][:2]
            elif isinstance(raw, dict):
                arc_id = str(raw.get("id") or "").strip().replace(" ", "_")
                center = self._normalize_point_token(raw.get("center") or raw.get("origin"))
                circle_ref = self._resolve_circle_ref(
                    raw.get("circle") or raw.get("circle_id"),
                    circle_ref_map,
                )
                refs = [
                    self._normalize_point_token(item)
                    for item in self._extract_points_from_any(
                        raw.get("points")
                        or raw.get("endpoints")
                        or [raw.get("start"), raw.get("end")]
                        or raw.get("entities")
                    )
                ]
                endpoints = [item for item in refs if item][:2]

            if len(endpoints) != 2:
                continue

            for point_id in endpoints:
                point_set.add(point_id)
            if center:
                point_set.add(center)

            if not arc_id:
                arc_id = f"arc_{endpoints[0]}{endpoints[1]}"

            payload: Dict[str, Any] = {
                "id": arc_id,
                "points": endpoints,
            }
            if center:
                payload["center"] = center
            if circle_ref:
                payload["circle"] = circle_ref

            signature = json.dumps(payload, ensure_ascii=False, sort_keys=True)
            if signature in seen:
                continue
            seen.add(signature)
            result.append(payload)
        return result

    def _sanitize_relation_bucket(
        self,
        raw_bucket: Any,
        *,
        point_set: set,
        segment_set: set,
        circle_ref_map: Dict[str, str],
        angle_vertices: set,
        has_fold_semantics: bool,
        allow_midpoint: bool,
    ) -> List[Dict[str, Any]]:
        allowed = {
            "point_on_segment",
            "point_on_circle",
            "collinear",
            "perpendicular",
            "parallel",
            "midpoint",
            "equal_length",
            "intersect",
        }
        result: List[Dict[str, Any]] = []
        seen: set = set()
        for raw in (raw_bucket or []):
            if not isinstance(raw, dict):
                continue
            relation_type = str(raw.get("type", "")).strip().lower()
            if relation_type not in allowed:
                continue
            item = None
            entity_refs = [str(item).strip() for item in (raw.get("entities") or []) if str(item).strip()]
            if relation_type == "point_on_segment":
                point_id = self._normalize_point_token(raw.get("point") or (entity_refs[0] if entity_refs else ""))
                segment_raw = raw.get("segment") or raw.get("line") or (entity_refs[1] if len(entity_refs) >= 2 else "")
                segment_id = self._normalize_segment_token(segment_raw)
                if point_id and point_id in point_set and segment_id:
                    item = {"type": relation_type, "point": point_id, "segment": segment_id}
            elif relation_type == "collinear":
                raw_points = raw.get("points") or entity_refs
                pts = [self._normalize_point_token(item) for item in raw_points]
                pts = [item for item in pts if item and item in point_set]
                if len(dict.fromkeys(pts)) == 3:
                    item = {"type": relation_type, "points": list(dict.fromkeys(pts))}
            elif relation_type in {"parallel", "perpendicular", "equal_length"}:
                raw_segments = raw.get("segments") or raw.get("lines") or entity_refs
                segs = [self._normalize_segment_token(item) for item in raw_segments]
                segs = [item for item in segs if item]
                if relation_type == "equal_length" and len(segs) >= 2:
                    item = {"type": relation_type, "segments": list(dict.fromkeys(segs))}
                elif len(dict.fromkeys(segs)) == 2:
                    item = {"type": relation_type, "segments": list(dict.fromkeys(segs))}
            elif relation_type == "midpoint":
                point_id = self._normalize_point_token(raw.get("point") or raw.get("midpoint") or (entity_refs[0] if entity_refs else ""))
                segment_raw = raw.get("segment") or raw.get("line") or (entity_refs[1] if len(entity_refs) >= 2 else "")
                segment_id = self._normalize_segment_token(segment_raw)
                if has_fold_semantics and not allow_midpoint:
                    continue
                if point_id and point_id in point_set and segment_id:
                    item = {"type": relation_type, "point": point_id, "segment": segment_id}
            elif relation_type == "intersect":
                point_id = self._normalize_point_token(raw.get("point") or raw.get("intersection") or (entity_refs[0] if entity_refs else ""))
                raw_segments = raw.get("segments") or raw.get("lines") or entity_refs[1:]
                segs = [self._normalize_segment_token(item) for item in raw_segments]
                segs = [item for item in segs if item]
                if point_id and point_id in point_set and len(dict.fromkeys(segs)) == 2:
                    item = {"type": relation_type, "point": point_id, "segments": list(dict.fromkeys(segs))}
            elif relation_type == "point_on_circle":
                point_id = self._normalize_point_token(raw.get("point") or (entity_refs[0] if entity_refs else ""))
                circle_raw = raw.get("circle") or raw.get("circle_id") or (entity_refs[1] if len(entity_refs) >= 2 else "")
                circle_id = self._resolve_circle_ref(circle_raw, circle_ref_map)
                if point_id and point_id in point_set and circle_id:
                    item = {"type": relation_type, "point": point_id, "circle": circle_id}

            if not item:
                continue
            item = self._carry_fact_metadata(item=item, raw=raw)
            signature = json.dumps(item, ensure_ascii=False, sort_keys=True)
            if signature in seen:
                continue
            seen.add(signature)
            result.append(item)
        return result

    def _sanitize_measurement_bucket(
        self,
        raw_bucket: Any,
        *,
        point_set: set,
        segment_set: set,
    ) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []
        seen: set = set()
        for raw in (raw_bucket or []):
            if not isinstance(raw, dict):
                continue
            measurement_type = str(raw.get("type", "")).strip().lower()
            item = None
            if measurement_type == "length":
                segment_id = self._normalize_segment_token(raw.get("segment") or raw.get("line"))
                if not segment_id:
                    entities = [str(item).strip() for item in (raw.get("entities") or []) if str(item).strip()]
                    if len(entities) == 2:
                        segment_id = self._normalize_segment_token("".join(entities))
                value = self._extract_numeric_or_symbolic_value(raw.get("value"))
                if segment_id and value is not None:
                    item = {"type": "length", "segment": segment_id, "value": value}
            elif measurement_type == "angle":
                value = self._extract_angle_value(raw.get("value"))
                angle_name = self._normalize_angle_name(raw.get("angle") or raw.get("name") or raw.get("label"))
                vertex = self._normalize_point_token(raw.get("vertex"))
                if angle_name and value is not None:
                    item = {"type": "angle", "angle": angle_name, "value": value}
                elif vertex and value is not None:
                    payload = {"type": "angle", "vertex": vertex, "value": value}
                    if str(raw.get("description", "")).strip():
                        payload["description"] = str(raw.get("description")).strip()
                    item = payload
                else:
                    entities = [
                        self._normalize_point_token(entity)
                        for entity in (raw.get("entities") or [])
                    ]
                    entities = [entity for entity in entities if entity]
                    if len(entities) == 3 and value is not None:
                        item = {"type": "angle", "entities": entities, "value": value}
            elif measurement_type == "ratio":
                value = self._extract_numeric_or_symbolic_value(raw.get("value"))
                raw_segments = raw.get("segments") or raw.get("lines") or raw.get("entities") or []
                segs = [self._normalize_segment_token(item) for item in raw_segments]
                segs = [item for item in segs if item]
                if len(segs) >= 2 and value is not None:
                    item = {"type": "ratio", "segments": segs[:2], "value": value}
            if not item:
                continue
            item = self._carry_fact_metadata(item=item, raw=raw)
            signature = json.dumps(item, ensure_ascii=False, sort_keys=True)
            if signature in seen:
                continue
            seen.add(signature)
            result.append(item)
        return result

    def _collect_angle_vertices(
        self,
        *,
        angles: List[Dict[str, Any]],
        right_angles: List[Dict[str, Any]],
        measurements: List[Dict[str, Any]],
    ) -> set:
        vertices: set = set()
        for bucket in (angles, right_angles):
            for item in bucket:
                if not isinstance(item, dict):
                    continue
                vertex = self._normalize_point_token(item.get("vertex"))
                if vertex:
                    vertices.add(vertex)
        for item in measurements:
            if not isinstance(item, dict):
                continue
            vertex = self._normalize_point_token(item.get("vertex"))
            if vertex:
                vertices.add(vertex)
                continue
            entities = [
                self._normalize_point_token(entity)
                for entity in (item.get("entities") or [])
            ]
            entities = [entity for entity in entities if entity]
            if len(entities) == 3:
                vertices.add(entities[1])
                continue
            angle_points = self._extract_angle_points_from_text(item.get("angle") or "")
            if len(angle_points) == 3:
                vertices.add(angle_points[1])
        return vertices

    def _augment_facts_from_problem_text(
        self,
        facts: Dict[str, Any],
        *,
        problem_text: str,
        point_set: set,
        segment_set: set,
    ) -> None:
        normalized = self._normalize_prime_markers(problem_text)
        facts.setdefault("observed_relations", copy.deepcopy(facts.get("relations") or []))
        facts.setdefault("observed_measurements", copy.deepcopy(facts.get("measurements") or []))
        facts.setdefault("text_explicit_relations", [])
        facts.setdefault("text_explicit_measurements", [])
        facts.setdefault("derived_relations", [])
        facts.setdefault("derived_measurements", [])
        facts.setdefault("inferred_relations", [])
        facts.setdefault("inferred_measurements", [])

        def with_provenance(
            payload: Dict[str, Any],
            *,
            source: str,
            status: str,
            evidence: str,
            confidence: float,
        ) -> Dict[str, Any]:
            item = copy.deepcopy(payload)
            item["source"] = source
            item["status"] = status
            item["confidence"] = confidence
            item["evidence"] = [evidence]
            return item

        def push_relation(
            payload: Dict[str, Any],
            *,
            bucket: str,
            source: str,
            status: str,
            confidence: float,
            also_primary: bool,
        ) -> None:
            enriched = with_provenance(
                payload,
                source=source,
                status=status,
                evidence=f"problem_text:{str(problem_text or '').strip()[:120]}",
                confidence=confidence,
            )
            if enriched not in facts[bucket]:
                facts[bucket].append(enriched)
            if also_primary and enriched not in facts["relations"]:
                facts["relations"].append(copy.deepcopy(enriched))

        def push_measurement(
            payload: Dict[str, Any],
            *,
            bucket: str,
            source: str,
            status: str,
            confidence: float,
            also_primary: bool,
        ) -> None:
            enriched = with_provenance(
                payload,
                source=source,
                status=status,
                evidence=f"problem_text:{str(problem_text or '').strip()[:120]}",
                confidence=confidence,
            )
            if enriched not in facts[bucket]:
                facts[bucket].append(enriched)
            if also_primary and enriched not in facts["measurements"]:
                facts["measurements"].append(copy.deepcopy(enriched))

        for match in re.finditer(r"[⊙○]\s*([A-Z]\d*'*)", normalized):
            center = self._normalize_point_token(match.group(1))
            if not center:
                continue
            point_set.add(center)
            if center not in facts["points"]:
                facts["points"].append(center)
            circle_payload = {"id": f"circle_{center}", "center": center}
            if circle_payload not in facts["circles"]:
                facts["circles"].append(circle_payload)

        for match in re.finditer(r"([A-Z]\d*'*)\s*(?:在|属于)?\s*[⊙○]\s*([A-Z]\d*'*)\s*(?:上|内)?", normalized):
            point_id = self._normalize_point_token(match.group(1))
            center = self._normalize_point_token(match.group(2))
            if not point_id or not center:
                continue
            point_set.add(point_id)
            point_set.add(center)
            if point_id not in facts["points"]:
                facts["points"].append(point_id)
            if center not in facts["points"]:
                facts["points"].append(center)
            circle_id = f"circle_{center}"
            circle_payload = {"id": circle_id, "center": center}
            if circle_payload not in facts["circles"]:
                facts["circles"].append(circle_payload)
            relation_payload = {"type": "point_on_circle", "point": point_id, "circle": circle_id}
            push_relation(
                relation_payload,
                bucket="text_explicit_relations",
                source="problem_text_explicit",
                status="text_explicit",
                confidence=0.98,
                also_primary=True,
            )

        if "菱形" in normalized:
            for match in re.finditer(r"菱形\s*([A-Z]\d*'*)([A-Z]\d*'*)([A-Z]\d*'*)([A-Z]\d*'*)", normalized):
                refs = [self._normalize_point_token(token) for token in match.groups()]
                refs = [item for item in refs if item]
                if len(refs) != 4:
                    continue
                polygon = "".join(refs)
                if polygon not in facts["polygons"]:
                    facts["polygons"].append(polygon)
                for first, second in zip(refs, refs[1:] + refs[:1]):
                    seg = self._normalize_segment_token(first + second)
                    if seg and seg not in facts["segments"]:
                        facts["segments"].append(seg)
                parallels = [
                    {"type": "parallel", "segments": [self._normalize_segment_token(refs[0] + refs[1]), self._normalize_segment_token(refs[2] + refs[3])]},
                    {"type": "parallel", "segments": [self._normalize_segment_token(refs[1] + refs[2]), self._normalize_segment_token(refs[3] + refs[0])]},
                    {"type": "equal_length", "segments": [self._normalize_segment_token(refs[0] + refs[1]), self._normalize_segment_token(refs[1] + refs[2])]},
                    {"type": "equal_length", "segments": [self._normalize_segment_token(refs[1] + refs[2]), self._normalize_segment_token(refs[2] + refs[3])]},
                    {"type": "equal_length", "segments": [self._normalize_segment_token(refs[2] + refs[3]), self._normalize_segment_token(refs[3] + refs[0])]},
                ]
                for relation in parallels:
                    push_relation(
                        relation,
                        bucket="derived_relations",
                        source="problem_text_derived",
                        status="derived",
                        confidence=0.72,
                        also_primary=False,
                    )

        for match in re.finditer(r"沿\s*([A-Z]\d*'*[A-Z]\d*'*)\s*(?:折叠|翻折)", normalized):
            seg = self._normalize_segment_token(match.group(1))
            if seg and seg not in facts["segments"]:
                facts["segments"].append(seg)

        for match in re.finditer(
            r"(?<![A-Z0-9'′])([A-Z]\d*['′]?[A-Z]\d*['′]?)\s*=\s*([-+]?\d+(?:\.\d+)?)",
            normalized,
        ):
            token = self._normalize_segment_token(match.group(1))
            if token:
                payload = {"type": "length", "segment": token, "value": self._safe_float(match.group(2), default=None)}
                if payload["value"] is not None:
                    push_measurement(
                        payload,
                        bucket="text_explicit_measurements",
                        source="problem_text_explicit",
                        status="text_explicit",
                        confidence=0.98,
                        also_primary=True,
                    )

        for match in re.finditer(r"tan\s*([A-Z]\d*'*)\s*=\s*([-+]?\d+(?:\.\d+)?)", normalized, flags=re.IGNORECASE):
            angle_name = self._normalize_angle_name("∠" + match.group(1))
            if angle_name:
                payload = {"type": "angle", "angle": angle_name, "value": f"arctan({match.group(2)})"}
                push_measurement(
                    payload,
                    bucket="derived_measurements",
                    source="problem_text_derived",
                    status="derived",
                    confidence=0.68,
                    also_primary=False,
                )

        for match in re.finditer(r"∠\s*([A-Z]\d*'*(?:[A-Z]\d*'*){2})\s*=\s*([-+]?\d+(?:\.\d+)?)", normalized):
            angle_name = self._normalize_angle_name("∠" + match.group(1))
            value = self._safe_float(match.group(2), default=None)
            if angle_name and value is not None:
                payload = {"type": "angle", "angle": angle_name, "value": value}
                push_measurement(
                    payload,
                    bucket="text_explicit_measurements",
                    source="problem_text_explicit",
                    status="text_explicit",
                    confidence=0.98,
                    also_primary=True,
                )

    def _infer_problem_text_segments(self, text: str, point_set: set) -> List[str]:
        normalized = self._normalize_prime_markers(text)
        result: List[str] = []
        pattern = re.compile(r"(?<![A-Z0-9'])([A-Z]\d*'*[A-Z]\d*'*)(?![A-Z0-9'])")
        for match in pattern.finditer(normalized):
            segment = self._normalize_segment_token(match.group(1))
            if not segment:
                continue
            endpoints = self._segment_endpoints_from_token(segment)
            if len(endpoints) == 2 and point_set and (
                endpoints[0] not in point_set or endpoints[1] not in point_set
            ):
                continue
            result.append(segment)
        return result

    def _infer_problem_text_polygons(self, text: str, point_set: set) -> List[str]:
        normalized = self._normalize_prime_markers(text)
        result: List[str] = []
        for match in re.finditer(r"(?:菱形|平行四边形|四边形|△|三角形)?\s*([A-Z]\d*'*(?:[A-Z]\d*'*){2,3})", normalized):
            token = self._normalize_polygon_token(match.group(1))
            if token:
                result.append(token)
        return result

    def _normalize_point_token(self, raw: Any) -> str:
        text = self._normalize_prime_markers(raw).strip().replace(" ", "")
        if not text:
            return ""
        if re.fullmatch(r"[A-Za-z]\d*'*", text):
            return text[0].upper() + text[1:]
        return ""

    def _normalize_segment_token(self, raw: Any) -> str:
        text = self._normalize_prime_markers(raw).strip().replace(" ", "")
        if text.startswith("seg_"):
            text = text[4:]
        refs = re.findall(r"[A-Za-z]\d*'*", text)
        if len(refs) == 2 and "".join(refs) == text:
            return refs[0][0].upper() + refs[0][1:] + refs[1][0].upper() + refs[1][1:]
        return ""

    def _normalize_polygon_token(self, raw: Any) -> str:
        text = self._normalize_prime_markers(raw).strip().replace(" ", "")
        refs = re.findall(r"[A-Za-z]\d*'*", text)
        if len(refs) >= 3 and "".join(refs) == text:
            return "".join(ref[0].upper() + ref[1:] for ref in refs)
        return ""

    def _normalize_circle_center_token(self, raw: Any) -> str:
        text = self._normalize_prime_markers(raw).strip().replace(" ", "")
        if not text:
            return ""
        marker_match = re.search(r"[⊙○]([A-Za-z]\d*'*)", text)
        if marker_match:
            return self._normalize_point_token(marker_match.group(1))
        if text.lower().startswith("circle_"):
            return self._normalize_point_token(text.split("_", 1)[1])
        refs = re.findall(r"[A-Za-z]\d*'*", text)
        if len(refs) == 1:
            return self._normalize_point_token(refs[0])
        return ""

    def _normalize_circle_id(self, raw: Any) -> str:
        text = str(raw or "").strip().replace(" ", "_")
        if not text:
            return ""
        return self._normalize_prime_markers(text)

    def _resolve_circle_ref(self, raw: Any, circle_ref_map: Dict[str, str]) -> str:
        direct = self._normalize_circle_id(raw)
        if direct and direct in circle_ref_map:
            return circle_ref_map[direct]
        center = self._normalize_circle_center_token(raw)
        if center and center in circle_ref_map:
            return circle_ref_map[center]
        return direct or center

    def _extract_points_from_any(self, raw: Any) -> List[str]:
        if raw is None:
            return []
        if isinstance(raw, str):
            normalized = self._normalize_prime_markers(raw)
            return re.findall(r"[A-Za-z]\d*'*", normalized)
        if isinstance(raw, dict):
            for key in ("points", "endpoints", "entities", "vertices"):
                if raw.get(key) is not None:
                    return self._extract_points_from_any(raw.get(key))
            for key in ("id", "label", "name"):
                if raw.get(key) is not None:
                    return self._extract_points_from_any(raw.get(key))
            return []
        if isinstance(raw, (list, tuple)):
            result: List[str] = []
            for item in raw:
                result.extend(self._extract_points_from_any(item))
            return result
        return []

    def _segment_endpoints_from_token(self, raw: Any) -> List[str]:
        text = self._normalize_prime_markers(raw).strip().replace(" ", "")
        if text.startswith("seg_"):
            text = text[4:]
        refs = re.findall(r"[A-Za-z]\d*'*", text)
        if len(refs) == 2 and "".join(refs) == text:
            return [refs[0][0].upper() + refs[0][1:], refs[1][0].upper() + refs[1][1:]]
        return []

    def _normalize_angle_name(self, raw: Any) -> str:
        text = self._normalize_prime_markers(raw).strip().replace(" ", "")
        if not text:
            return ""
        if not text.startswith("∠"):
            text = "∠" + text
        refs = re.findall(r"[A-Za-z]\d*'*", text)
        if len(refs) in {1, 3}:
            return "∠" + "".join(ref[0].upper() + ref[1:] for ref in refs)
        return ""

    def _extract_angle_points_from_text(self, raw: Any) -> List[str]:
        text = self._normalize_prime_markers(raw).strip()
        if not text:
            return []
        match = re.search(r"(?:∠|angle)?\s*([A-Za-z]\d*'*(?:[A-Za-z]\d*'*){2})", text, flags=re.IGNORECASE)
        if not match:
            return []
        refs = [self._normalize_point_token(item) for item in re.findall(r"[A-Za-z]\d*'*", match.group(1))]
        refs = [item for item in refs if item]
        if len(refs) == 3:
            return refs
        return []

    def _extract_angle_value(self, raw: Any) -> Any:
        text = str(raw or "").strip()
        if not text:
            return None
        arctan_match = re.search(r"arctan\(\s*[-+]?\d+(?:\.\d+)?\s*\)", text, flags=re.IGNORECASE)
        if arctan_match:
            return arctan_match.group(0)
        numeric = self._safe_float(text, default=None)
        if numeric is not None:
            return numeric
        match = re.search(r"[-+]?\d+(?:\.\d+)?", text)
        if match and ("tan" in text.lower() or "arctan" in text.lower()):
            return f"arctan({match.group(0)})"
        return None

    def _extract_numeric_or_symbolic_value(self, raw: Any) -> Any:
        numeric = self._safe_float(raw, default=None)
        if numeric is not None:
            return numeric
        text = str(raw or "").strip()
        return text if text else None

    def _ordered_unique_tokens(self, values: List[str]) -> List[str]:
        seen = set()
        ordered: List[str] = []
        for value in values:
            if not value or value in seen:
                continue
            seen.add(value)
            ordered.append(value)
        return ordered

    def _dedupe_fact_dicts(self, values: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        deduped: List[Dict[str, Any]] = []
        seen = set()
        for value in values:
            if not isinstance(value, dict):
                continue
            try:
                signature = json.dumps(value, ensure_ascii=False, sort_keys=True)
            except Exception:
                signature = repr(sorted(value.items(), key=lambda item: item[0]))
            if signature in seen:
                continue
            seen.add(signature)
            deduped.append(copy.deepcopy(value))
        return deduped

    def _ensure_fact_metadata(
        self,
        values: List[Dict[str, Any]],
        *,
        source: str,
        status: str,
        default_confidence: float,
    ) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        for value in values:
            if not isinstance(value, dict):
                continue
            item = copy.deepcopy(value)
            item.setdefault("source", source)
            item.setdefault("status", status)
            item.setdefault("confidence", default_confidence)
            if not isinstance(item.get("evidence"), list):
                item["evidence"] = []
            normalized.append(item)
        return self._dedupe_fact_dicts(normalized)

    def _carry_fact_metadata(self, *, item: Dict[str, Any], raw: Dict[str, Any]) -> Dict[str, Any]:
        merged = copy.deepcopy(item)
        if not isinstance(raw, dict):
            return merged

        for key in ("source", "status"):
            value = raw.get(key)
            if str(value or "").strip():
                merged[key] = str(value).strip()

        if raw.get("confidence") is not None:
            confidence = self._safe_float(raw.get("confidence"), default=None)
            if confidence is not None:
                merged["confidence"] = confidence

        evidence = raw.get("evidence")
        if isinstance(evidence, list):
            merged["evidence"] = [str(item).strip() for item in evidence if str(item).strip()]
        elif str(evidence or "").strip():
            merged["evidence"] = [str(evidence).strip()]

        return merged

    def _merge_ordered_points(self, existing_points: List[str], point_set: set) -> List[str]:
        ordered = self._ordered_unique_tokens(list(existing_points or []))
        seen = set(ordered)
        extras = sorted(item for item in point_set if item and item not in seen)
        ordered.extend(extras)
        return ordered

    def _safe_float(self, raw: Any, default: Optional[float]) -> Optional[float]:
        try:
            return float(raw)
        except (TypeError, ValueError):
            return default

    def _normalize_prime_markers(self, raw: Any) -> str:
        return str(raw or "").replace("′", "'").replace("’", "'").replace("`", "'")

    def _extract_problem_text_fallback(self, image_path: str) -> str:
        prompt = (
            "Read the image carefully and transcribe the full OCR text of the math problem. "
            "You must include all visible text in order: title/number, problem statement, known conditions, "
            "diagram labels that appear in text, and all multiple-choice options if present. "
            "Preserve line breaks and output plain text only. Do not explain anything."
        )
        result = self.analyze_image(image_path, prompt, model_role="ocr")
        self._write_debug_text("vision_problem_text_fallback.txt", result)
        return str(result or "").strip()

    def _extract_geometry_facts_fallback(
        self,
        *,
        image_path: str,
        problem_text: str,
    ) -> Dict[str, Any]:
        prompt = f"""
Analyze the plane-geometry image and return JSON only.

Problem text (may be partial OCR):
{problem_text}

Return exactly:
{{
  "confidence": 0.0,
  "ambiguities": [],
  "roles": {{}},
  "points": [],
  "segments": [],
  "polygons": [],
  "circles": [],
  "arcs": [],
  "angles": [],
  "right_angles": [],
  "relations": [],
  "measurements": []
}}

Be conservative. If uncertain, omit instead of guessing.
"""
        result = self.analyze_image(image_path, prompt, model_role="geometry")
        self._write_debug_text("vision_geometry_facts_fallback.txt", result)
        parsed = self._parse_json_like_output(
            result,
            {
                "confidence": 0.0,
                "ambiguities": [],
                "roles": {},
                "points": [],
                "segments": [],
                "polygons": [],
                "circles": [],
                "arcs": [],
                "angles": [],
                "right_angles": [],
                "relations": [],
                "measurements": [],
            },
        )
        return parsed if isinstance(parsed, dict) else {
            "confidence": 0.0,
            "ambiguities": [],
            "roles": {},
            "points": [],
            "segments": [],
            "polygons": [],
            "circles": [],
            "arcs": [],
            "angles": [],
            "right_angles": [],
            "relations": [],
            "measurements": [],
        }

    def _infer_semantic_signals(
        self,
        *,
        problem_text: str,
        geometry_facts: Dict[str, Any],
        geometry_spec: Dict[str, Any],
    ) -> Dict[str, Any]:
        text = str(problem_text or "")
        lower_text = text.lower()
        templates = {
            str(item).strip().lower()
            for item in (geometry_spec.get("templates") or geometry_facts.get("templates") or [])
            if str(item).strip()
        }
        relation_types = {
            str(item.get("type", "")).strip().lower()
            for item in (geometry_facts.get("relations") or [])
            if isinstance(item, dict)
        }
        relation_types.update(
            {
                str(item.get("type", "")).strip().lower()
                for item in (geometry_spec.get("constraints") or [])
                if isinstance(item, dict)
            }
        )

        is_fold = bool(re.search(r"折叠|翻折|对折|fold|reflect|镜像", text, re.IGNORECASE)) or ("fold" in templates)
        is_circle = bool(re.search(r"圆|弧|切线|圆心|circle|tangent|chord", text, re.IGNORECASE)) or any(
            token in templates for token in {"circle", "arc"}
        )
        is_dynamic = bool(re.search(r"动点|轨迹|变化|locus|moving", text, re.IGNORECASE))
        has_similarity = bool(re.search(r"相似|全等|similar|congruent", text, re.IGNORECASE))
        has_distance_goal = bool(re.search(r"距离|distance|最短|shortest|垂线|perpendicular", text, re.IGNORECASE))
        has_tangent = bool(re.search(r"切线|tangent", text, re.IGNORECASE))

        inferred_pattern = "static_proof"
        inferred_sub_pattern = "direct_relation_proof"
        confidence = 0.62
        if is_fold:
            inferred_pattern = "fold_transform"
            if has_distance_goal:
                inferred_sub_pattern = "fold_point_to_point_distance"
            elif has_similarity:
                inferred_sub_pattern = "fold_then_similarity"
            else:
                inferred_sub_pattern = "fold_transform_generic"
            confidence = 0.9
        elif is_dynamic:
            inferred_pattern = "dynamic_point"
            inferred_sub_pattern = "locus_tracking"
            confidence = 0.84
        elif is_circle:
            inferred_pattern = "circle_geometry"
            inferred_sub_pattern = "radius_chord_tangent"
            confidence = 0.82
        elif has_similarity:
            inferred_pattern = "similarity_congruence"
            inferred_sub_pattern = "triangle_similarity"
            confidence = 0.8
        elif has_distance_goal:
            inferred_pattern = "metric_computation"
            inferred_sub_pattern = "length_area_computation"
            confidence = 0.74

        action_details: List[Dict[str, Any]] = []

        def push_action(action: str, confidence_value: float, evidence: List[str]) -> None:
            token = str(action or "").strip()
            if not token:
                return
            action_details.append(
                {
                    "action": token,
                    "confidence": round(float(confidence_value), 2),
                    "evidence": list(dict.fromkeys([str(item).strip() for item in evidence if str(item).strip()])),
                }
            )

        if is_fold:
            push_action("highlight_fold_axis", 0.93, ["text: 折叠关键词", "pattern: fold_transform"])
            push_action("animate_fold", 0.92, ["text: 折叠关键词", "pattern: fold_transform"])
            if has_distance_goal or "midpoint" in relation_types:
                push_action(
                    "draw_perpendicular_auxiliary",
                    0.81,
                    ["fold + distance/midpoint", "relation: midpoint/perpendicular"],
                )
        if has_tangent or (is_circle and "perpendicular" in relation_types):
            push_action(
                "connect_center_tangent",
                0.79 if has_tangent else 0.7,
                ["text: tangent/circle", "relation: perpendicular"],
            )
        if has_similarity:
            push_action("draw_connection_auxiliary", 0.77, ["text: 相似/全等"])
        elif "parallel" in relation_types and inferred_pattern in {"static_proof", "similarity_congruence"}:
            push_action("draw_connection_auxiliary", 0.66, ["relation: parallel"])

        best_action_confidence: Dict[str, float] = {}
        best_action_evidence: Dict[str, List[str]] = {}
        for item in action_details:
            action = str(item.get("action", "")).strip()
            confidence_value = float(item.get("confidence", 0.0) or 0.0)
            if action not in best_action_confidence or confidence_value > best_action_confidence[action]:
                best_action_confidence[action] = confidence_value
                best_action_evidence[action] = list(item.get("evidence") or [])

        recommended_action_details = [
            {
                "action": action,
                "confidence": round(best_action_confidence[action], 2),
                "evidence": best_action_evidence[action],
            }
            for action in self._normalize_action_hints(list(best_action_confidence.keys()))
        ]
        recommended_actions = [
            item["action"]
            for item in recommended_action_details
            if float(item.get("confidence", 0.0) or 0.0) >= 0.7
        ]

        return {
            "signal_version": "v1",
            "inferred_problem_pattern": inferred_pattern,
            "inferred_sub_pattern": inferred_sub_pattern,
            "needs_extra_geometry_animation": bool(recommended_actions),
            "recommended_geometry_actions": recommended_actions,
            "recommended_geometry_action_details": recommended_action_details,
            "confidence": round(confidence, 2),
            "evidence": {
                "templates": sorted(templates),
                "relation_types": sorted(item for item in relation_types if item),
                "text_flags": {
                    "is_fold": is_fold,
                    "is_circle": is_circle,
                    "is_dynamic": is_dynamic,
                    "has_similarity": has_similarity,
                    "has_distance_goal": has_distance_goal,
                    "has_tangent": has_tangent,
                },
            },
        }

    def _normalize_action_hints(self, actions: List[str]) -> List[str]:
        normalized: List[str] = []
        seen = set()
        for action in actions:
            token = str(action or "").strip()
            if not token or token in seen:
                continue
            seen.add(token)
            normalized.append(token)
        return normalized

    def _write_debug_text(self, filename: str, content: str) -> None:
        try:
            debug_dir = Path(self.output_dir) / "debug"
            debug_dir.mkdir(parents=True, exist_ok=True)
            (debug_dir / filename).write_text(str(content or ""), encoding="utf-8")
        except Exception as exc:
            self._record_debug_issue("write_debug_text", exc)

    def _record_debug_issue(self, scope: str, exc: Exception) -> None:
        if not self.debug_exceptions:
            return
        try:
            debug_dir = Path(self.output_dir) / "debug"
            debug_dir.mkdir(parents=True, exist_ok=True)
            log_file = debug_dir / "vision_internal_errors.log"
            existing = ""
            if log_file.exists():
                existing = log_file.read_text(encoding="utf-8")
            timestamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
            snippet = f"[{timestamp}] {scope}: {exc.__class__.__name__}: {exc}\n"
            log_file.write_text(existing + snippet, encoding="utf-8")
        except Exception:
            return

    def _build_geometry_graph_payload(self, scene_graph_data: Dict[str, Any]) -> Dict[str, Any]:
        try:
            scene = SceneGraph(scene_graph_data)
            geometry_graph = GeometryGraph(scene)
            return geometry_graph.to_payload()
        except Exception:
            return {"nodes": [], "edges": [], "stats": {"node_count": 0, "edge_count": 0}}

    def _build_semantic_graph(self, geometry_data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        geometry_data = geometry_data or {}
        semantic_graph = {
            "points": {},
            "lines": [],
            "objects": [],
            "incidence": [],
            "angles": [],
            "relations": [],
            "primitives": copy.deepcopy(geometry_data.get("primitives", [])),
        }

        for point in geometry_data.get("points", []):
            if isinstance(point, dict):
                point_id = str(point.get("id", "")).strip()
            else:
                point_id = str(point).strip()
            if point_id:
                semantic_graph["points"][point_id] = {}

        for primitive in geometry_data.get("primitives", []):
            primitive_type = str(primitive.get("type", "")).strip().lower()
            primitive_id = str(primitive.get("id", "")).strip()
            refs = [str(item) for item in (primitive.get("points") or [])]
            if primitive_type == "segment" and len(refs) == 2:
                semantic_graph["lines"].append(
                    {"id": primitive_id, "type": "segment", "points": refs}
                )
            elif primitive_type == "polygon" and len(refs) >= 3:
                semantic_graph["objects"].append(
                    {"id": primitive_id, "type": "polygon", "points": refs}
                )
            elif primitive_type == "circle":
                semantic_graph["objects"].append(
                    {
                        "id": primitive_id,
                        "type": "circle",
                        "center": primitive.get("center"),
                        "radius_point": primitive.get("radius_point"),
                    }
                )
            elif primitive_type == "arc":
                semantic_graph["objects"].append(
                    {
                        "id": primitive_id,
                        "type": "arc",
                        "points": refs,
                        "center": primitive.get("center"),
                    }
                )
            elif primitive_type in {"angle", "right_angle"} and len(refs) == 3:
                semantic_graph["angles"].append(
                    {"id": primitive_id, "points": refs, "value": primitive.get("value")}
                )

        for constraint in geometry_data.get("constraints", []):
            relation_type = str(constraint.get("type", "")).strip().lower()
            entities = [str(item) for item in (constraint.get("entities") or [])]
            if relation_type == "point_on_segment" and len(entities) == 2:
                semantic_graph["incidence"].append(
                    {"type": "point_on_line", "entities": entities}
                )
            elif relation_type == "point_on_circle" and len(entities) == 2:
                semantic_graph["incidence"].append(
                    {"type": "point_on_object", "entities": entities}
                )
            else:
                semantic_graph["relations"].append(
                    {"type": relation_type, "entities": entities}
                )

        return semantic_graph

    def _build_schematic_drawable_scene(
        self,
        geometry_data: Optional[Dict[str, Any]],
        *,
        allow_solver_fallback: bool = True,
    ) -> Dict[str, Any]:
        if (
            allow_solver_fallback
            and isinstance(geometry_data, dict)
            and geometry_data.get("points")
            and geometry_data.get("primitives")
        ):
            try:
                partial_scene = self.coordinate_scene_compiler.solve_coordinate_scene(geometry_data)
                drawable_scene = self.coordinate_scene_compiler.derive_drawable_scene(partial_scene)
                drawable_scene["layout_mode"] = "schematic_solver_fallback"
                return drawable_scene
            except Exception:
                pass
        drawable_scene = self._build_semantic_graph(geometry_data)
        drawable_scene["layout_mode"] = "schematic_fallback"
        self._attach_fallback_positions(drawable_scene, geometry_data or {})
        return drawable_scene

    def _compile_geometry_spec(
        self,
        geometry_facts: Optional[Dict[str, Any]],
        *,
        problem_text: str,
    ) -> Dict[str, Any]:
        compiled, _ = self._compile_geometry_spec_with_diagnostics(
            geometry_facts,
            problem_text=problem_text,
        )
        return compiled

    def _attach_fallback_positions(
        self,
        scene_graph: Dict[str, Any],
        geometry_data: Dict[str, Any],
    ) -> None:
        points = scene_graph.get("points") or {}
        if not isinstance(points, dict) or not points:
            return

        positions: Dict[str, List[float]] = {}
        lines = scene_graph.get("lines") or []
        objects = scene_graph.get("objects") or []
        constraints = geometry_data.get("constraints") or []
        measurements = geometry_data.get("measurements") or []
        segment_map: Dict[str, Tuple[str, str]] = {}

        for line in lines:
            if not isinstance(line, dict):
                continue
            line_id = str(line.get("id", "")).strip()
            refs = [str(item).strip() for item in (line.get("points") or []) if str(item).strip()]
            if line_id and len(refs) == 2:
                segment_map[line_id] = (refs[0], refs[1])

        self._apply_circle_parallel_extension_layout(
            positions=positions,
            objects=objects,
            constraints=constraints,
            measurements=measurements,
            segment_map=segment_map,
        )

        for obj in objects:
            if not isinstance(obj, dict):
                continue
            obj_type = str(obj.get("type", "")).strip().lower()
            refs = [str(item).strip() for item in (obj.get("points") or []) if str(item).strip()]
            if obj_type in {"polygon", "triangle"} and len(refs) >= 3:
                radius = 3.2
                for index, point_id in enumerate(refs):
                    angle = (math.pi / 2) - (2 * math.pi * index / len(refs))
                    positions.setdefault(
                        point_id,
                        [round(radius * math.cos(angle), 6), round(radius * math.sin(angle), 6)],
                    )
                break

        for obj in objects:
            if not isinstance(obj, dict):
                continue
            if str(obj.get("type", "")).strip().lower() != "circle":
                continue
            center = str(obj.get("center", "")).strip()
            if center:
                positions.setdefault(center, [0.0, 0.0])

        for obj in objects:
            if not isinstance(obj, dict):
                continue
            if str(obj.get("type", "")).strip().lower() != "circle":
                continue
            circle_id = str(obj.get("id", "")).strip()
            center = str(obj.get("center", "")).strip()
            radius_point = str(obj.get("radius_point", "")).strip()
            members: List[str] = []
            if radius_point:
                members.append(radius_point)
            for constraint in constraints:
                if str(constraint.get("type", "")).strip().lower() != "point_on_circle":
                    continue
                entities = [str(item).strip() for item in (constraint.get("entities") or [])]
                if len(entities) == 2 and entities[1] == circle_id and entities[0]:
                    members.append(entities[0])
            members = list(dict.fromkeys(members))
            if not center or center not in positions or not members:
                continue
            cx, cy = positions[center]
            radius = 3.0
            for index, point_id in enumerate(members):
                angle = (5 * math.pi / 6) - (2 * math.pi * index / max(len(members), 3))
                positions.setdefault(
                    point_id,
                    [round(cx + radius * math.cos(angle), 6), round(cy + radius * math.sin(angle), 6)],
                )

        for start, end in segment_map.values():
            if start in positions and end in positions:
                continue
            if start not in positions and end not in positions:
                positions[start] = [-3.0, 0.0]
                positions[end] = [3.0, 0.0]
                break

        for _ in range(4):
            changed = False
            for start, end in segment_map.values():
                if start in positions and end not in positions:
                    positions[end] = [positions[start][0] + 2.6, positions[start][1] + 1.2]
                    changed = True
                elif end in positions and start not in positions:
                    positions[start] = [positions[end][0] - 2.6, positions[end][1] - 1.2]
                    changed = True
            if not changed:
                break

        segment_mid_counts: Dict[str, int] = {}
        for constraint in constraints:
            if str(constraint.get("type", "")).strip().lower() != "point_on_segment":
                continue
            entities = [str(item).strip() for item in (constraint.get("entities") or [])]
            if len(entities) != 2:
                continue
            point_id, segment_id = entities
            endpoints = segment_map.get(segment_id)
            if not endpoints or endpoints[0] not in positions or endpoints[1] not in positions:
                continue
            count = segment_mid_counts.get(segment_id, 0)
            segment_mid_counts[segment_id] = count + 1
            ratio = 0.5 if count == 0 else min(0.25 + 0.25 * count, 0.8)
            ax, ay = positions[endpoints[0]]
            bx, by = positions[endpoints[1]]
            positions.setdefault(
                point_id,
                [round(ax + (bx - ax) * ratio, 6), round(ay + (by - ay) * ratio, 6)],
            )

        unresolved = [point_id for point_id in points.keys() if point_id not in positions]
        for index, point_id in enumerate(unresolved):
            col = index % 3
            row = index // 3
            positions[point_id] = [-4.0 + col * 3.0, -2.0 - row * 2.0]

        for point_id, payload in points.items():
            coord = positions.get(point_id)
            if coord is None:
                continue
            if not isinstance(payload, dict):
                payload = {}
                points[point_id] = payload
            payload["pos"] = [float(coord[0]), float(coord[1])]

    def _apply_circle_parallel_extension_layout(
        self,
        *,
        positions: Dict[str, List[float]],
        objects: List[Dict[str, Any]],
        constraints: List[Dict[str, Any]],
        measurements: List[Dict[str, Any]],
        segment_map: Dict[str, Tuple[str, str]],
    ) -> bool:
        circle_objects = [
            obj for obj in objects
            if isinstance(obj, dict) and str(obj.get("type", "")).strip().lower() == "circle"
        ]
        parallel_constraints = [
            item for item in constraints
            if str(item.get("type", "")).strip().lower() == "parallel"
        ]
        if not circle_objects or not parallel_constraints:
            return False

        for circle in circle_objects:
            circle_id = str(circle.get("id", "")).strip()
            center = str(circle.get("center", "")).strip()
            if not circle_id or not center:
                continue
            members = self._circle_members(circle_id, circle, constraints)
            if len(members) < 3:
                continue

            for relation in parallel_constraints:
                entities = [str(item).strip() for item in (relation.get("entities") or []) if str(item).strip()]
                if len(entities) != 2:
                    continue
                seg1 = segment_map.get(entities[0])
                seg2 = segment_map.get(entities[1])
                if not seg1 or not seg2:
                    continue

                layout = self._classify_parallel_layout(
                    seg1=seg1,
                    seg2=seg2,
                    members=members,
                    segment_map=segment_map,
                )
                if layout is None:
                    continue

                chord_a, chord_c, anchor_b, external_point = layout
                remaining = [item for item in members if item not in {chord_a, chord_c, anchor_b}]
                if len(remaining) == 1:
                    angle_map = {
                        chord_a: 210.0,
                        remaining[0]: 285.0,
                        chord_c: 350.0,
                        anchor_b: 75.0,
                    }
                else:
                    angle_map = {
                        chord_a: 210.0,
                        chord_c: 350.0,
                        anchor_b: 75.0,
                    }
                    extra_count = max(len(remaining), 1)
                    for index, point_id in enumerate(remaining):
                        angle_map[point_id] = 285.0 - index * (50.0 / extra_count)

                radius = self._infer_radius_from_measurements(angle_map, measurements)
                positions.setdefault(center, [0.0, 0.0])
                cx, cy = positions[center]
                for point_id, angle_deg in angle_map.items():
                    angle = math.radians(angle_deg)
                    positions[point_id] = [
                        round(cx + radius * math.cos(angle), 6),
                        round(cy + radius * math.sin(angle), 6),
                    ]

                ext_length = self._measurement_length_between(
                    measurements,
                    anchor_b,
                    external_point,
                ) or (radius * 1.9)
                chord_dir = [
                    positions[chord_c][0] - positions[chord_a][0],
                    positions[chord_c][1] - positions[chord_a][1],
                ]
                norm = math.hypot(chord_dir[0], chord_dir[1]) or 1.0
                direction = [chord_dir[0] / norm, chord_dir[1] / norm]
                positions[external_point] = [
                    round(positions[anchor_b][0] + direction[0] * ext_length, 6),
                    round(positions[anchor_b][1] + direction[1] * ext_length, 6),
                ]
                return True

        return False

    def _circle_members(
        self,
        circle_id: str,
        circle: Dict[str, Any],
        constraints: List[Dict[str, Any]],
    ) -> List[str]:
        members: List[str] = []
        radius_point = str(circle.get("radius_point", "")).strip()
        if radius_point:
            members.append(radius_point)
        for constraint in constraints:
            if str(constraint.get("type", "")).strip().lower() != "point_on_circle":
                continue
            entities = [str(item).strip() for item in (constraint.get("entities") or []) if str(item).strip()]
            if len(entities) == 2 and entities[1] == circle_id:
                members.append(entities[0])
        return list(dict.fromkeys(members))

    def _classify_parallel_layout(
        self,
        *,
        seg1: Tuple[str, str],
        seg2: Tuple[str, str],
        members: List[str],
        segment_map: Dict[str, Tuple[str, str]],
    ) -> Optional[Tuple[str, str, str, str]]:
        member_set = set(members)
        for chord_seg, ext_seg in ((seg1, seg2), (seg2, seg1)):
            if not all(point in member_set for point in chord_seg):
                continue
            circle_points = [point for point in ext_seg if point in member_set]
            external_points = [point for point in ext_seg if point not in member_set]
            if len(circle_points) != 1 or len(external_points) != 1:
                continue
            anchor_b = circle_points[0]
            external_point = external_points[0]
            chord_a, chord_c = chord_seg

            linked_candidates = []
            for endpoints in segment_map.values():
                if external_point not in endpoints:
                    continue
                other = endpoints[0] if endpoints[1] == external_point else endpoints[1]
                if other in chord_seg:
                    linked_candidates.append(other)
            if linked_candidates:
                chord_c = linked_candidates[0]
                chord_a = chord_seg[0] if chord_seg[1] == chord_c else chord_seg[1]

            return chord_a, chord_c, anchor_b, external_point
        return None

    def _infer_radius_from_measurements(
        self,
        angle_map: Dict[str, float],
        measurements: List[Dict[str, Any]],
    ) -> float:
        for measurement in measurements:
            if str(measurement.get("type", "")).strip().lower() != "length":
                continue
            entities = [str(item).strip() for item in (measurement.get("entities") or []) if str(item).strip()]
            if len(entities) != 2:
                continue
            first, second = entities
            if first not in angle_map or second not in angle_map:
                continue
            value = self._coerce_float(measurement.get("value"), default=0.0)
            if value <= 0:
                continue
            delta = abs(angle_map[first] - angle_map[second]) % 360.0
            delta = min(delta, 360.0 - delta)
            if delta <= 1e-6:
                continue
            radius = value / (2 * math.sin(math.radians(delta) / 2))
            if radius > 0:
                return radius
        return 3.0

    def _measurement_length_between(
        self,
        measurements: List[Dict[str, Any]],
        first: str,
        second: str,
    ) -> Optional[float]:
        pair = {first, second}
        for measurement in measurements:
            if str(measurement.get("type", "")).strip().lower() != "length":
                continue
            entities = [str(item).strip() for item in (measurement.get("entities") or []) if str(item).strip()]
            if len(entities) == 2 and set(entities) == pair:
                value = self._coerce_float(measurement.get("value"), default=0.0)
                if value > 0:
                    return value
        return None

    def _coerce_float(self, value: Any, *, default: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def analyze_image(
        self,
        image_path: str,
        prompt: str,
        *,
        model_role: str = "geometry",
    ) -> str:
        if not image_path or not Path(image_path).exists():
            return f"Error: image file does not exist: {image_path}"

        with open(image_path, "rb") as file:
            image_data = base64.b64encode(file.read()).decode()

        messages = [
            {"role": "system", "content": self.system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_data}"},
                    },
                ],
            },
        ]
        return self._invoke_model(messages, model_role=model_role).strip()

    def _invoke_model(self, messages: list, *, model_role: str = "geometry") -> str:
        if model_role != "ocr" or self.ocr_llm is None or self.ocr_llm is self.llm:
            return self._invoke_llm(messages)

        last_error: Optional[Exception] = None
        attempts = max(self.max_retries, 1)
        for attempt in range(attempts):
            try:
                response = self.ocr_llm.invoke(messages)
                return response.content
            except Exception as exc:
                last_error = exc
                if not self._is_retryable_llm_error(exc) or attempt >= attempts - 1:
                    raise
                sleep_seconds = self.retry_backoff_seconds * (2 ** attempt)
                print(
                    f"[{self.__class__.__name__}] OCR request hit a temporary limit; "
                    f"retrying in {sleep_seconds:.1f}s ({attempt + 1}/{attempts})"
                )
                time.sleep(sleep_seconds)

        if last_error is not None:
            raise last_error
        raise RuntimeError("OCR model invocation failed without an exception.")

    def parse_geometry_spec(self, image_path: str) -> dict:
        bundle = self._analyze_problem_bundle(image_path)
        geometry_facts = bundle.get("geometry_facts") or bundle.get("geometry_spec") or {}
        return self._compile_geometry_spec(
            geometry_facts,
            problem_text=str(bundle.get("problem_text", "")).strip(),
        )

    def parse_geometry_scene(self, image_path: str) -> dict:
        return self.parse_geometry_spec(image_path)

    def _parse_json_like_output(self, result: str, fallback: Dict[str, Any]) -> Dict[str, Any]:
        candidates = [result]
        match = re.search(r"```json\s*([\s\S]*?)\s*```", result)
        if match:
            candidates.append(match.group(1).strip())
        brace_match = re.search(r"\{[\s\S]*\}", result)
        if brace_match:
            candidates.append(brace_match.group(0))

        for candidate in candidates:
            for variant in (candidate, self._clean_json_like_text(candidate)):
                try:
                    return json.loads(variant)
                except json.JSONDecodeError:
                    continue
        return fallback

    def _clean_json_like_text(self, text: str) -> str:
        cleaned = str(text or "")
        cleaned = re.sub(r"```json\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = cleaned.replace("```", "")
        cleaned = re.sub(r"//.*?$", "", cleaned, flags=re.MULTILINE)
        cleaned = re.sub(r"/\*[\s\S]*?\*/", "", cleaned)
        cleaned = re.sub(r"(\})(\s*\{)", r"\1,\2", cleaned)
        cleaned = re.sub(r"(\])(\s*\{)", r"\1,\2", cleaned)
        cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
        return cleaned.strip()
