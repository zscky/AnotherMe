"""
Coordinate-scene compiler and validator.
"""

from __future__ import annotations

import copy
import json
import math
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

try:
    import sympy as sp
except Exception:  # pragma: no cover
    sp = None


EPSILON = 1e-6


class CoordinateSceneError(ValueError):
    """Raised when coordinate-scene compilation or validation fails."""


class CoordinateSceneCompiler:
    """Compile, solve, validate, and export coordinate-scene payloads."""

    def compile(
        self,
        geometry_spec: Optional[Dict[str, Any]] = None,
        geometry_file: Optional[str] = None,
    ) -> Dict[str, Any]:
        if geometry_file:
            return self.load_from_file(geometry_file)
        if not geometry_spec:
            raise CoordinateSceneError(
                "Missing geometry_spec; automatic geometry solving cannot start."
            )
        normalized = self.normalize_geometry_spec(geometry_spec)
        coordinate_scene = self.solve_coordinate_scene(normalized)
        report = self.validate_coordinate_scene(coordinate_scene, normalized)
        if not report["is_valid"]:
            raise CoordinateSceneError(self._validation_error_message(report))
        return report["resolved_scene"]

    def load_from_file(self, geometry_file: str) -> Dict[str, Any]:
        file_path = Path(geometry_file)
        if not file_path.exists():
            raise CoordinateSceneError(f"geometry file does not exist: {geometry_file}")
        try:
            data = json.loads(file_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise CoordinateSceneError(
                f"failed to parse geometry JSON: {exc}"
            ) from exc
        report = self.validate_coordinate_scene(data)
        if not report["is_valid"]:
            raise CoordinateSceneError(self._validation_error_message(report))
        return report["resolved_scene"]

    def normalize_geometry_spec(self, geometry_spec: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(geometry_spec, dict):
            raise CoordinateSceneError("geometry_spec must be an object.")

        raw = self._repair_raw_geometry_spec(copy.deepcopy(geometry_spec))
        roles = self._normalize_roles(raw.get("roles") or {})
        aliases: Dict[str, List[str]] = {}
        point_order: List[str] = []
        point_payloads: Dict[str, Dict[str, Any]] = {}

        def register_point(
            raw_id: Any,
            payload: Optional[Dict[str, Any]] = None,
            label: Optional[str] = None,
        ) -> str:
            point_id = self._canonical_point_id(raw_id)
            if not point_id:
                return ""
            existing = point_payloads.setdefault(point_id, {"id": point_id})
            if point_id not in point_order:
                point_order.append(point_id)
            raw_text = str(raw_id).strip()
            if raw_text and raw_text != point_id:
                aliases.setdefault(point_id, [])
                if raw_text not in aliases[point_id]:
                    aliases[point_id].append(raw_text)
            if payload:
                for key, value in payload.items():
                    if key == "id":
                        continue
                    existing[key] = value
            if label and not existing.get("label"):
                existing["label"] = label
            return point_id

        raw_points = raw.get("points", [])
        if isinstance(raw_points, dict):
            for key, value in raw_points.items():
                if isinstance(value, dict):
                    payload = copy.deepcopy(value)
                    label = payload.pop("label", None) or key
                    register_point(key, payload=payload, label=label)
                else:
                    register_point(key, label=str(key))
        elif isinstance(raw_points, list):
            for item in raw_points:
                if isinstance(item, str):
                    register_point(item, label=item)
                elif isinstance(item, dict):
                    raw_id = item.get("id") or item.get("name") or item.get("label")
                    if not raw_id:
                        continue
                    payload = copy.deepcopy(item)
                    label = str(payload.get("label") or raw_id)
                    payload.pop("label", None)
                    payload["id"] = self._canonical_point_id(raw_id)
                    derived = payload.get("derived")
                    if isinstance(derived, dict):
                        payload["derived"] = self._normalize_derived_payload(derived)
                    register_point(raw_id, payload=payload, label=label)

        primitives: List[Dict[str, Any]] = []
        primitive_ids: set[str] = set()
        for primitive in raw.get("primitives") or []:
            if not isinstance(primitive, dict):
                continue
            primitive_type = str(primitive.get("type", "")).strip().lower()
            if not primitive_type:
                continue
            item = copy.deepcopy(primitive)
            item["type"] = primitive_type
            if primitive_type in {"segment", "polygon", "angle", "right_angle", "arc"}:
                refs = []
                for ref in item.get("points") or []:
                    point_id = register_point(ref, label=str(ref))
                    if point_id:
                        refs.append(point_id)
                item["points"] = refs
            if primitive_type == "circle":
                item["center"] = register_point(item.get("center"), label=str(item.get("center", "")))
                item["radius_point"] = register_point(
                    item.get("radius_point"),
                    label=str(item.get("radius_point", "")),
                )
            if primitive_type == "arc":
                item["center"] = register_point(item.get("center"), label=str(item.get("center", "")))
            primitive_id = str(item.get("id") or "").strip()
            if not primitive_id:
                primitive_id = self._default_primitive_id(item, primitive_ids)
            primitive_id = primitive_id.replace(" ", "_")
            item["id"] = primitive_id
            primitive_ids.add(primitive_id)
            primitives.append(item)

        known_points = set(point_payloads.keys())
        constraints = self._normalize_relation_like_items(
            raw.get("constraints") or [],
            known_points,
            primitive_ids,
        )
        measurements = self._normalize_measurements(
            raw.get("measurements") or [],
            known_points,
            primitive_ids,
        )
        display = self._normalize_display(
            raw.get("display") or {},
            point_payloads,
            primitive_ids,
            aliases,
        )
        primitives, constraints, measurements, display = self._repair_normalized_geometry_spec(
            primitives,
            constraints,
            measurements,
            display,
            point_order,
        )
        self._ensure_segment_source_tags(primitives=primitives, display=display)

        templates = self._ordered_unique(
            [
                str(t).strip().lower()
                for t in (raw.get("templates") or [])
                if str(t).strip()
            ]
            + (
                [str(raw.get("template", "")).strip().lower()]
                if str(raw.get("template", "")).strip()
                else []
            )
        )
        templates = self._ordered_unique(
            templates
            + self._infer_templates(
                points=point_order,
                primitives=primitives,
                constraints=constraints,
                measurements=measurements,
            )
        )
        confidence = self._coerce_float(raw.get("confidence"), default=0.0)
        ambiguities = [
            str(item).strip()
            for item in (raw.get("ambiguities") or [])
            if str(item).strip()
        ]

        points = [point_payloads[point_id] for point_id in point_order if point_id]
        if not points:
            raise CoordinateSceneError("geometry_spec contains no points.")

        return {
            "mode": "2d",
            "templates": templates,
            "roles": roles,
            "aliases": aliases,
            "confidence": confidence,
            "ambiguities": ambiguities,
            "points": points,
            "primitives": primitives,
            "constraints": constraints,
            "measurements": measurements,
            "display": display,
        }

    def _ensure_segment_source_tags(
        self,
        *,
        primitives: Sequence[Dict[str, Any]],
        display: Dict[str, Any],
    ) -> None:
        primitive_display = display.setdefault("primitives", {}) if isinstance(display, dict) else {}
        for primitive in primitives:
            if not isinstance(primitive, dict):
                continue
            if str(primitive.get("type", "")).strip().lower() != "segment":
                continue
            primitive_id = str(primitive.get("id", "")).strip()
            if not primitive_id:
                continue
            payload = primitive_display.setdefault(primitive_id, {})
            source = str(payload.get("source", "")).strip().lower()
            if source:
                continue
            role = str(payload.get("role", "")).strip().lower()
            style = str(payload.get("style", "")).strip().lower()
            payload["source"] = "approved_auxiliary" if role == "construction" or style == "dashed" else "given"

    def _repair_raw_geometry_spec(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        primitives: List[Dict[str, Any]] = []
        constraints: List[Dict[str, Any]] = list(raw.get("constraints") or [])
        measurements: List[Dict[str, Any]] = list(raw.get("measurements") or [])

        for primitive in raw.get("primitives") or []:
            if not isinstance(primitive, dict):
                continue
            item = copy.deepcopy(primitive)
            primitive_type = str(item.get("type", "")).strip().lower()
            if not primitive_type:
                continue

            if primitive_type == "line":
                item["type"] = "segment"
                primitives.append(item)
                continue

            if primitive_type in {"parallel", "perpendicular", "equal_length", "midpoint", "intersect", "point_on_segment", "point_on_circle", "point_in_polygon", "point_outside_polygon", "collinear"}:
                constraints.append(
                    {
                        "type": primitive_type,
                        "entities": list(item.get("entities") or item.get("points") or []),
                    }
                )
                continue

            if primitive_type in {"length", "angle", "ratio"}:
                measurements.append(
                    {
                        "type": primitive_type,
                        "entities": list(item.get("entities") or item.get("points") or []),
                        "value": item.get("value"),
                    }
                )
                continue

            if primitive_type == "arc":
                points = list(item.get("points") or [])
                if not points:
                    start = item.get("start")
                    end = item.get("end")
                    if start and end:
                        points = [start, end]
                elif len(points) > 2:
                    item["through_points"] = points[1:-1]
                    points = [points[0], points[-1]]
                item["points"] = points

            primitives.append(item)

        repaired_constraints: List[Dict[str, Any]] = []
        for raw_constraint in constraints:
            if not isinstance(raw_constraint, dict):
                continue

            constraint = copy.deepcopy(raw_constraint)
            relation_type = str(constraint.get("type", "")).strip().lower()
            entities = list(constraint.get("entities") or [])

            if relation_type in {"length", "angle", "ratio"}:
                measurements.append(
                    {
                        "type": relation_type,
                        "entities": entities,
                        "value": constraint.get("value"),
                    }
                )
                continue

            if relation_type == "point_on_circle" and len(entities) > 2 and constraint.get("circle"):
                circle_ref = constraint.get("circle")
                for entity in entities:
                    repaired_constraints.append(
                        {
                            "type": "point_on_circle",
                            "entities": [entity, circle_ref],
                        }
                    )
                continue

            if relation_type == "divides_arc":
                arc_ref = constraint.get("arc")
                if arc_ref and len(entities) >= 4:
                    for entity in entities:
                        repaired_constraints.append(
                            {
                                "type": "arc_point_order",
                                "entities": [entity, arc_ref],
                            }
                        )
                continue

            repaired_constraints.append(constraint)

        raw["primitives"] = primitives
        raw["constraints"] = repaired_constraints
        raw["measurements"] = measurements
        return raw

    def _repair_normalized_geometry_spec(
        self,
        primitives: List[Dict[str, Any]],
        constraints: List[Dict[str, Any]],
        measurements: List[Dict[str, Any]],
        display: Dict[str, Any],
        point_order: Sequence[str],
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
        primitive_map = {
            str(item.get("id", "")).strip(): item
            for item in primitives
            if isinstance(item, dict) and item.get("id")
        }

        supported_constraints = {
            "point_on_segment",
            "point_on_circle",
            "point_in_polygon",
            "point_outside_polygon",
            "collinear",
            "perpendicular",
            "equal_length",
            "parallel",
            "midpoint",
            "intersect",
        }
        filtered_constraints: List[Dict[str, Any]] = []
        for constraint in constraints:
            relation_type = str(constraint.get("type", "")).strip().lower()
            if relation_type not in supported_constraints:
                continue
            filtered_constraints.append(constraint)

        for primitive in primitives:
            primitive_type = str(primitive.get("type", "")).strip().lower()
            if primitive_type == "circle" and not str(primitive.get("radius_point", "")).strip():
                inferred_radius_point = self._infer_circle_radius_point(primitive, filtered_constraints)
                if inferred_radius_point:
                    primitive["radius_point"] = inferred_radius_point
            elif primitive_type == "arc":
                points = [str(item).strip() for item in (primitive.get("points") or []) if str(item).strip()]
                if len(points) > 2:
                    primitive["through_points"] = points[1:-1]
                    primitive["points"] = [points[0], points[-1]]
                if not points and primitive.get("start") and primitive.get("end"):
                    primitive["points"] = [str(primitive["start"]).strip(), str(primitive["end"]).strip()]

                center = str(primitive.get("center", "")).strip()
                circle_ref = str(primitive.get("circle", "")).strip()
                if not center and circle_ref and circle_ref in primitive_map:
                    center = str(primitive_map[circle_ref].get("center", "")).strip()
                    if center:
                        primitive["center"] = center

        primitives, filtered_constraints, display = self._augment_triangle_scene_topology(
            primitives=primitives,
            constraints=filtered_constraints,
            measurements=measurements,
            display=display,
            point_order=point_order,
        )
        primitives = self._ensure_angle_primitives_from_measurements(primitives, measurements)

        return primitives, filtered_constraints, measurements, display

    def _infer_circle_radius_point(
        self,
        circle: Dict[str, Any],
        constraints: List[Dict[str, Any]],
    ) -> str:
        circle_id = str(circle.get("id", "")).strip()
        center = str(circle.get("center", "")).strip()
        for constraint in constraints:
            if str(constraint.get("type", "")).strip().lower() != "point_on_circle":
                continue
            entities = [str(item).strip() for item in (constraint.get("entities") or [])]
            if len(entities) != 2 or entities[1] != circle_id:
                continue
            if entities[0] and entities[0] != center:
                return entities[0]
        return ""

    def _ensure_angle_primitives_from_measurements(
        self,
        primitives: List[Dict[str, Any]],
        measurements: Sequence[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        existing = {
            (
                str(item.get("type", "")).strip().lower(),
                tuple(str(ref).strip() for ref in (item.get("points") or [])),
            )
            for item in primitives
            if isinstance(item, dict)
        }
        augmented = list(primitives)
        for measurement in measurements:
            if str(measurement.get("type", "")).strip().lower() != "angle":
                continue
            refs = [str(item).strip() for item in (measurement.get("entities") or []) if str(item).strip()]
            if len(refs) != 3:
                continue
            value = self._coerce_float(measurement.get("value"), default=None)
            primitive_type = "right_angle" if value is not None and abs(value - 90.0) <= 1e-2 else "angle"
            signature = (primitive_type, tuple(refs))
            if signature in existing:
                continue
            primitive_id = ("right_" if primitive_type == "right_angle" else "ang_") + "".join(refs)
            payload: Dict[str, Any] = {"id": primitive_id, "type": primitive_type, "points": refs}
            if primitive_type == "angle" and value is not None:
                payload["value"] = value
            augmented.append(payload)
            existing.add(signature)
        return augmented

    def _augment_triangle_scene_topology(
        self,
        *,
        primitives: List[Dict[str, Any]],
        constraints: List[Dict[str, Any]],
        measurements: List[Dict[str, Any]],
        display: Dict[str, Any],
        point_order: Sequence[str],
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
        if any(
            str(item.get("type", "")).strip().lower() == "polygon"
            and len(item.get("points") or []) >= 4
            for item in primitives
        ):
            return primitives, constraints, display

        point_order_index = {point_id: index for index, point_id in enumerate(point_order)}
        polygon_participation: Dict[str, int] = {}
        for primitive in primitives:
            if str(primitive.get("type", "")).strip().lower() != "polygon":
                continue
            for ref in primitive.get("points") or []:
                point_id = str(ref).strip()
                if point_id:
                    polygon_participation[point_id] = polygon_participation.get(point_id, 0) + 1
        primitive_map = {
            str(item.get("id", "")).strip(): item
            for item in primitives
            if isinstance(item, dict) and item.get("id")
        }
        segment_edges: Dict[frozenset[str], str] = {}
        non_construction_neighbors: Dict[str, set[str]] = {}
        construction_neighbors: Dict[str, set[str]] = {}
        all_neighbors: Dict[str, set[str]] = {}

        for primitive in primitives:
            if str(primitive.get("type", "")).strip().lower() != "segment":
                continue
            refs = [str(item).strip() for item in (primitive.get("points") or []) if str(item).strip()]
            if len(refs) != 2:
                continue
            seg_id = str(primitive.get("id", "")).strip()
            pair = frozenset(refs)
            segment_edges[pair] = seg_id
            all_neighbors.setdefault(refs[0], set()).add(refs[1])
            all_neighbors.setdefault(refs[1], set()).add(refs[0])
            if self._is_construction_segment(seg_id, display):
                construction_neighbors.setdefault(refs[0], set()).add(refs[1])
                construction_neighbors.setdefault(refs[1], set()).add(refs[0])
            else:
                non_construction_neighbors.setdefault(refs[0], set()).add(refs[1])
                non_construction_neighbors.setdefault(refs[1], set()).add(refs[0])

        if any(str(item.get("type", "")).strip().lower() == "point_in_polygon" for item in constraints):
            return primitives, constraints, display

        best_candidate: Optional[Tuple[int, str, List[str]]] = None
        for hub, neighbors in non_construction_neighbors.items():
            ordered_neighbors = sorted(
                neighbors,
                key=lambda item: point_order_index.get(item, 10_000),
            )
            if len(ordered_neighbors) < 3:
                continue
            for combo in self._combinations_of_three(ordered_neighbors):
                edge_count = sum(
                    1
                    for first, second in ((combo[0], combo[1]), (combo[1], combo[2]), (combo[0], combo[2]))
                    if frozenset((first, second)) in segment_edges
                    and not self._is_construction_segment(segment_edges[frozenset((first, second))], display)
                )
                outside_support = self._triangle_outside_support(
                    hub_point=hub,
                    triangle_points=list(combo),
                    all_neighbors=all_neighbors,
                    segment_edges=segment_edges,
                    display=display,
                )
                angle_support = self._triangle_hub_angle_support(
                    hub_point=hub,
                    triangle_points=list(combo),
                    measurements=measurements,
                )
                auxiliary_penalty = self._hub_auxiliary_equal_length_penalty(
                    hub_point=hub,
                    triangle_points=list(combo),
                    constraints=constraints,
                    primitive_map=primitive_map,
                )
                if edge_count < 2 and not (edge_count >= 1 and outside_support):
                    continue
                score = (
                    edge_count * 100
                    + outside_support * 40
                    + angle_support * 70
                    - auxiliary_penalty * 120
                    + polygon_participation.get(hub, 0) * 10
                    - point_order_index.get(hub, 0)
                )
                if best_candidate is None or score > best_candidate[0]:
                    best_candidate = (score, hub, list(combo))

        if best_candidate is None:
            return primitives, constraints, display

        _, hub_point, triangle_points = best_candidate
        triangle_points = sorted(triangle_points, key=lambda item: point_order_index.get(item, 10_000))
        polygon_id = f"poly_{''.join(triangle_points)}"
        if polygon_id not in primitive_map:
            primitives.append({"id": polygon_id, "type": "polygon", "points": triangle_points})
            primitive_map[polygon_id] = primitives[-1]
            display.setdefault("primitives", {}).setdefault(polygon_id, {}).setdefault("role", "polygon")

        triangle_edges = (
            (triangle_points[0], triangle_points[1]),
            (triangle_points[1], triangle_points[2]),
            (triangle_points[0], triangle_points[2]),
        )
        for first, second in triangle_edges:
            pair = frozenset((first, second))
            segment_id = segment_edges.get(pair)
            if segment_id is None:
                segment_id = f"seg_{first}{second}"
                primitives.append({"id": segment_id, "type": "segment", "points": [first, second]})
                segment_edges[pair] = segment_id
            payload = display.setdefault("primitives", {}).setdefault(segment_id, {})
            payload.setdefault("style", "solid")
            payload["role"] = "primary_edge"
            payload.setdefault("source", "derived")

        if not any(
            str(item.get("type", "")).strip().lower() == "point_in_polygon"
            and list(item.get("entities") or []) == [hub_point, polygon_id]
            for item in constraints
        ):
            constraints.append({"type": "point_in_polygon", "entities": [hub_point, polygon_id]})

        for vertex in triangle_points:
            pair = frozenset((hub_point, vertex))
            segment_id = segment_edges.get(pair)
            if segment_id:
                payload = display.setdefault("primitives", {}).setdefault(segment_id, {})
                payload.setdefault("style", "solid")
                payload.setdefault("role", "interior_link")
                payload.setdefault("source", "derived")

        triangle_edge_pairs = {frozenset(edge) for edge in triangle_edges}
        for point_id, neighbors in all_neighbors.items():
            if point_id in triangle_points or point_id == hub_point:
                continue
            if not neighbors:
                continue
            relevant_neighbors = [neighbor for neighbor in neighbors if neighbor in triangle_points or neighbor == hub_point]
            polygon_neighbors = [neighbor for neighbor in relevant_neighbors if neighbor in triangle_points]
            if len(polygon_neighbors) < 2 or hub_point not in neighbors:
                continue
            construction_links = 0
            for neighbor in relevant_neighbors:
                seg_id = segment_edges.get(frozenset((point_id, neighbor)), "")
                if seg_id and self._is_construction_segment(seg_id, display):
                    construction_links += 1
            auxiliary_support = self._outside_auxiliary_support(
                point_id=point_id,
                hub_point=hub_point,
                triangle_points=triangle_points,
                constraints=constraints,
                measurements=measurements,
                primitive_map=primitive_map,
            )
            if construction_links < 1 and auxiliary_support < 1:
                continue
            if not any(frozenset((first, second)) in triangle_edge_pairs for first, second in self._combinations_of_two(polygon_neighbors)):
                continue
            if not any(
                str(item.get("type", "")).strip().lower() == "point_outside_polygon"
                and list(item.get("entities") or []) == [point_id, polygon_id]
                for item in constraints
            ):
                constraints.append({"type": "point_outside_polygon", "entities": [point_id, polygon_id]})
            for neighbor in relevant_neighbors:
                seg_id = segment_edges.get(frozenset((point_id, neighbor)), "")
                if not seg_id:
                    continue
                payload = display.setdefault("primitives", {}).setdefault(seg_id, {})
                if frozenset((point_id, neighbor)) in triangle_edge_pairs:
                    continue
                payload["style"] = "dashed"
                payload["role"] = "construction"
                payload["source"] = "derived"
            constraints = [
                item
                for item in constraints
                if not (
                    str(item.get("type", "")).strip().lower() == "point_on_segment"
                    and len(item.get("entities") or []) == 2
                    and str(item.get("entities", [None])[0]).strip() == point_id
                    and frozenset(
                        self._segment_endpoints(
                            str(item.get("entities", [None, None])[1]).strip(),
                            {},
                            {
                                str(primitive.get("id", "")).strip(): primitive
                                for primitive in primitives
                                if isinstance(primitive, dict) and primitive.get("id")
                            },
                        )
                        or ()
                    )
                    in triangle_edge_pairs
                )
            ]

        return primitives, constraints, display

    def _triangle_hub_angle_support(
        self,
        *,
        hub_point: str,
        triangle_points: List[str],
        measurements: List[Dict[str, Any]],
    ) -> int:
        triangle_set = {str(item).strip() for item in triangle_points if str(item).strip()}
        support = 0
        for measurement in measurements or []:
            if str(measurement.get("type", "")).strip().lower() != "angle":
                continue
            entities = [str(item).strip() for item in (measurement.get("entities") or []) if str(item).strip()]
            if len(entities) != 3:
                continue
            if entities[1] != hub_point:
                continue
            if entities[0] not in triangle_set or entities[2] not in triangle_set:
                continue
            try:
                value = float(measurement.get("value"))
            except (TypeError, ValueError):
                value = 0.0
            support += 3 if value >= 120.0 else 1
        return support

    def _outside_auxiliary_support(
        self,
        *,
        point_id: str,
        hub_point: str,
        triangle_points: List[str],
        constraints: List[Dict[str, Any]],
        measurements: List[Dict[str, Any]],
        primitive_map: Dict[str, Dict[str, Any]],
    ) -> int:
        triangle_set = {str(item).strip() for item in triangle_points if str(item).strip()}
        signal = 0

        for measurement in measurements or []:
            measurement_type = str(measurement.get("type", "")).strip().lower()
            entities = [str(item).strip() for item in (measurement.get("entities") or []) if str(item).strip()]
            if len(entities) != 3 or entities[1] != point_id:
                continue
            if hub_point not in {entities[0], entities[2]}:
                continue
            other = entities[0] if entities[2] == hub_point else entities[2]
            if other in triangle_set:
                signal += 1

        for relation in constraints or []:
            if str(relation.get("type", "")).strip().lower() != "equal_length":
                continue
            entities = [str(item).strip() for item in (relation.get("entities") or []) if str(item).strip()]
            if len(entities) != 2:
                continue
            seg1 = self._segment_endpoints(entities[0], {}, primitive_map)
            seg2 = self._segment_endpoints(entities[1], {}, primitive_map)
            if not seg1 or not seg2:
                continue
            segments = (seg1, seg2)
            if not all(point_id in segment for segment in segments):
                continue
            others = {
                segment[0] if segment[1] == point_id else segment[1]
                for segment in segments
            }
            if hub_point in others and len(others & triangle_set) >= 1:
                signal += 1

        return signal

    def _hub_auxiliary_equal_length_penalty(
        self,
        *,
        hub_point: str,
        triangle_points: List[str],
        constraints: List[Dict[str, Any]],
        primitive_map: Dict[str, Dict[str, Any]],
    ) -> int:
        triangle_set = {str(item).strip() for item in triangle_points if str(item).strip()}
        penalty = 0
        for relation in constraints or []:
            if str(relation.get("type", "")).strip().lower() != "equal_length":
                continue
            entities = [str(item).strip() for item in (relation.get("entities") or []) if str(item).strip()]
            if len(entities) != 2:
                continue
            seg1 = self._segment_endpoints(entities[0], {}, primitive_map)
            seg2 = self._segment_endpoints(entities[1], {}, primitive_map)
            if not seg1 or not seg2:
                continue
            if hub_point not in seg1 or hub_point not in seg2:
                continue
            other1 = seg1[0] if seg1[1] == hub_point else seg1[1]
            other2 = seg2[0] if seg2[1] == hub_point else seg2[1]
            if other1 in triangle_set and other2 in triangle_set and other1 != other2:
                penalty += 1
        return penalty

    def _triangle_outside_support(
        self,
        *,
        hub_point: str,
        triangle_points: List[str],
        all_neighbors: Dict[str, set[str]],
        segment_edges: Dict[frozenset[str], str],
        display: Dict[str, Any],
    ) -> int:
        triangle_set = set(triangle_points)
        support = 0
        for point_id, neighbors in all_neighbors.items():
            if point_id == hub_point or point_id in triangle_set:
                continue
            relevant = set(neighbors) & (triangle_set | {hub_point})
            if hub_point not in relevant or len(relevant & triangle_set) < 2:
                continue
            construction_links = 0
            for neighbor in relevant:
                seg_id = segment_edges.get(frozenset((point_id, neighbor)), "")
                if seg_id and self._is_construction_segment(seg_id, display):
                    construction_links += 1
            if construction_links >= 1:
                support += 1
        return support

    def _is_construction_segment(self, segment_id: str, display: Dict[str, Any]) -> bool:
        primitive_display = (display or {}).get("primitives", {}) or {}
        payload = primitive_display.get(segment_id)
        if not isinstance(payload, dict):
            return False
        style = str(payload.get("style", "")).strip().lower()
        role = str(payload.get("role", "")).strip().lower()
        return style == "dashed" or role == "construction"

    def _segment_source(self, primitive_id: str, primitive_display: Dict[str, Any]) -> str:
        payload = primitive_display.get(primitive_id)
        if not isinstance(payload, dict):
            return ""
        source = str(payload.get("source", "")).strip().lower()
        if source:
            return source
        role = str(payload.get("role", "")).strip().lower()
        style = str(payload.get("style", "")).strip().lower()
        if role == "construction" or style == "dashed":
            return "approved_auxiliary"
        return "given"

    def _combinations_of_three(self, items: Sequence[str]) -> List[Tuple[str, str, str]]:
        combos: List[Tuple[str, str, str]] = []
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                for k in range(j + 1, len(items)):
                    combos.append((items[i], items[j], items[k]))
        return combos

    def _combinations_of_two(self, items: Sequence[str]) -> List[Tuple[str, str]]:
        combos: List[Tuple[str, str]] = []
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                combos.append((items[i], items[j]))
        return combos

    def solve_coordinate_scene(self, normalized_spec: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(normalized_spec, dict):
            raise CoordinateSceneError("normalized geometry spec must be an object.")

        templates = self._ordered_unique(
            list(normalized_spec.get("templates") or [])
        ) or ["generic_triangle"]
        solver_trace: List[str] = []
        last_error: Optional[str] = None
        solver_spec = dict(normalized_spec)
        solver_spec["_solver_indexes"] = self._build_solver_indexes(normalized_spec)

        for template in templates:
            try:
                coords = self._solve_template(solver_spec, template, solver_trace)
                self._resolve_dependent_points(solver_spec, coords, solver_trace)
                points = []
                unresolved: List[str] = []
                for point in solver_spec.get("points", []):
                    point_id = str(point.get("id", "")).strip()
                    payload: Dict[str, Any] = {"id": point_id}
                    if "derived" in point and point["derived"]:
                        payload["derived"] = copy.deepcopy(point["derived"])
                    if point_id in coords:
                        payload["coord"] = [
                            round(float(coords[point_id][0]), 6),
                            round(float(coords[point_id][1]), 6),
                        ]
                    elif "derived" not in payload:
                        unresolved.append(point_id)
                    points.append(payload)

                if unresolved:
                    raise CoordinateSceneError(
                        "insufficient information to place points: "
                        + ", ".join(sorted(unresolved))
                    )

                return {
                    "mode": "2d",
                    "points": points,
                    "primitives": copy.deepcopy(normalized_spec.get("primitives") or []),
                    "constraints": copy.deepcopy(normalized_spec.get("constraints") or []),
                    "display": copy.deepcopy(normalized_spec.get("display") or {}),
                    "measurements": copy.deepcopy(normalized_spec.get("measurements") or []),
                    "templates": list(templates),
                    "_solver_trace": list(solver_trace),
                }
            except CoordinateSceneError as exc:
                last_error = str(exc)
                solver_trace.append(f"template {template} failed: {exc}")

        raise CoordinateSceneError(
            last_error or "no supported template could solve the current geometry spec."
        )

    def validate_coordinate_scene(
        self,
        coordinate_scene: Dict[str, Any],
        normalized_spec: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        failed_checks: List[Dict[str, Any]] = []
        missing_entities: List[str] = []
        unsupported_relations: List[str] = []

        try:
            resolved_scene = self._resolve_coordinate_scene_structure(coordinate_scene)
        except CoordinateSceneError as exc:
            return {
                "is_valid": False,
                "failed_checks": [{"type": "structure", "message": str(exc)}],
                "missing_entities": [],
                "unsupported_relations": [],
                "solver_trace": list(coordinate_scene.get("_solver_trace") or []),
                "resolved_scene": {},
            }

        point_lookup = self._point_lookup(resolved_scene)
        primitive_map = {
            str(item.get("id", "")).strip(): item
            for item in resolved_scene.get("primitives", [])
            if isinstance(item, dict) and item.get("id")
        }

        def ensure_entities_exist(entities: Sequence[str], relation_type: str) -> bool:
            ok = True
            for entity in entities:
                if (
                    entity not in point_lookup
                    and entity not in primitive_map
                    and self._segment_endpoints(entity, point_lookup, primitive_map) is None
                ):
                    missing_entities.append(f"{relation_type}:{entity}")
                    ok = False
            return ok

        for constraint in resolved_scene.get("constraints", []):
            relation_type = str(constraint.get("type", "")).strip().lower()
            entities = [str(item) for item in (constraint.get("entities") or [])]
            if not ensure_entities_exist(entities, relation_type):
                continue
            check = self._validate_relation(
                relation_type,
                entities,
                point_lookup,
                primitive_map,
            )
            if check == "unsupported":
                unsupported_relations.append(relation_type)
            elif check:
                failed_checks.append(check)

        for measurement in resolved_scene.get("measurements", []):
            measurement_type = str(measurement.get("type", "")).strip().lower()
            entities = [str(item) for item in (measurement.get("entities") or [])]
            if not ensure_entities_exist(entities, f"measurement:{measurement_type}"):
                continue
            check = self._validate_measurement(
                measurement,
                point_lookup,
                primitive_map,
            )
            if check == "unsupported":
                unsupported_relations.append(f"measurement:{measurement_type}")
            elif check:
                failed_checks.append(check)

        if normalized_spec:
            for point in normalized_spec.get("points", []):
                point_id = str(point.get("id", "")).strip()
                if point_id and point_id not in point_lookup:
                    missing_entities.append(f"point:{point_id}")

        return {
            "is_valid": not failed_checks and not missing_entities and not unsupported_relations,
            "failed_checks": failed_checks,
            "missing_entities": self._ordered_unique(missing_entities),
            "unsupported_relations": self._ordered_unique(unsupported_relations),
            "solver_trace": list(coordinate_scene.get("_solver_trace") or []),
            "resolved_scene": resolved_scene,
        }

    def derive_semantic_graph(self, coordinate_scene: Dict[str, Any]) -> Dict[str, Any]:
        point_lookup = self._point_lookup(coordinate_scene)
        semantic_graph = {
            "points": {pid: {} for pid in point_lookup.keys()},
            "lines": [],
            "objects": [],
            "incidence": [],
            "angles": [],
            "relations": [],
            "primitives": copy.deepcopy(coordinate_scene.get("primitives") or []),
            "display": copy.deepcopy(coordinate_scene.get("display") or {}),
        }
        self._populate_graph_entities(
            graph=semantic_graph,
            primitives=coordinate_scene.get("primitives", []),
            constraints=coordinate_scene.get("constraints", []),
            display=coordinate_scene.get("display", {}),
        )
        return semantic_graph

    def derive_drawable_scene(self, coordinate_scene: Dict[str, Any]) -> Dict[str, Any]:
        point_lookup = self._point_lookup(coordinate_scene)
        normalized_points = self._normalize_points_for_scene_graph(point_lookup)

        drawable_scene = {
            "points": {
                pid: {"pos": normalized_points.get(pid, coord), "coord": coord}
                for pid, coord in point_lookup.items()
            },
            "lines": [],
            "objects": [],
            "incidence": [],
            "angles": [],
            "relations": [],
            "primitives": copy.deepcopy(coordinate_scene.get("primitives") or []),
            "display": copy.deepcopy(coordinate_scene.get("display") or {}),
            "layout_mode": "solved_coordinate_scene",
        }
        self._populate_graph_entities(
            graph=drawable_scene,
            primitives=coordinate_scene.get("primitives", []),
            constraints=coordinate_scene.get("constraints", []),
            display=coordinate_scene.get("display", {}),
        )
        return drawable_scene

    def derive_scene_graph(self, coordinate_scene: Dict[str, Any]) -> Dict[str, Any]:
        return self.derive_drawable_scene(coordinate_scene)

    def _populate_graph_entities(
        self,
        *,
        graph: Dict[str, Any],
        primitives: Sequence[Dict[str, Any]],
        constraints: Sequence[Dict[str, Any]],
        display: Optional[Dict[str, Any]] = None,
    ) -> None:
        primitive_display = ((display or {}).get("primitives") or {}) if isinstance(display, dict) else {}
        for primitive in primitives:
            primitive_type = str(primitive.get("type", "")).lower()
            primitive_id = str(primitive.get("id", "")).strip()
            refs = [str(p) for p in (primitive.get("points") or [])]
            style_payload = primitive_display.get(primitive_id, {}) if isinstance(primitive_display.get(primitive_id), dict) else {}

            if primitive_type == "segment" and len(refs) == 2:
                graph["lines"].append(
                    {
                        "id": primitive_id,
                        "type": "segment",
                        "points": refs,
                        "style": str(style_payload.get("style", "solid")).strip().lower() or "solid",
                        "role": str(style_payload.get("role", "interior_link")).strip().lower() or "interior_link",
                    }
                )
            elif primitive_type == "polygon" and len(refs) >= 3:
                graph["objects"].append(
                    {
                        "id": primitive_id,
                        "type": "polygon" if len(refs) > 3 else "triangle",
                        "points": refs,
                    }
                )
            elif primitive_type == "circle":
                graph["objects"].append(
                    {
                        "id": primitive_id,
                        "type": "circle",
                        "center": primitive.get("center"),
                        "radius_point": primitive.get("radius_point"),
                    }
                )
            elif primitive_type == "arc":
                graph["objects"].append(
                    {
                        "id": primitive_id,
                        "type": "arc",
                        "points": refs,
                        "center": primitive.get("center"),
                    }
                )
            elif primitive_type in {"angle", "right_angle"} and len(refs) == 3:
                value = primitive.get("value")
                if primitive_type == "right_angle":
                    value = 90
                graph["angles"].append({"id": primitive_id, "points": refs, "value": value})

        for constraint in constraints:
            relation_type = str(constraint.get("type", "")).lower()
            entities = [str(item) for item in (constraint.get("entities") or [])]
            if relation_type == "point_on_segment" and len(entities) == 2:
                graph["incidence"].append({"type": "point_on_line", "entities": entities})
            elif relation_type == "point_on_circle" and len(entities) == 2:
                graph["incidence"].append({"type": "point_on_object", "entities": entities})
            else:
                graph["relations"].append({"type": relation_type, "entities": entities})

    def export_ggb_commands(self, coordinate_scene: Dict[str, Any]) -> List[str]:
        commands: List[str] = ["MODE: 2D"]
        display = coordinate_scene.get("display", {}) or {}
        point_display = display.get("points", {}) or {}
        primitive_display = display.get("primitives", {}) or {}
        point_lookup = self._point_lookup(coordinate_scene)
        allowed_segment_sources = {"given", "approved_auxiliary"}

        for point in coordinate_scene.get("points", []):
            point_id = str(point.get("id", "")).strip()
            coord = point_lookup.get(point_id)
            if coord is None:
                continue
            commands.append(f"{point_id} = ({self._fmt_num(coord[0])}, {self._fmt_num(coord[1])})")

        for primitive in coordinate_scene.get("primitives", []):
            primitive_id = str(primitive.get("id", "")).strip()
            primitive_type = str(primitive.get("type", "")).lower()
            refs = [str(item) for item in (primitive.get("points") or [])]
            if primitive_type == "segment" and len(refs) == 2:
                source = self._segment_source(primitive_id, primitive_display)
                if source and source not in allowed_segment_sources:
                    continue
                if self._is_construction_segment(primitive_id, display) and source != "approved_auxiliary":
                    continue
                commands.append(f"{primitive_id} = Segment({refs[0]}, {refs[1]})")
            elif primitive_type == "polygon" and len(refs) >= 3:
                commands.append(f"{primitive_id} = Polygon({', '.join(refs)})")
            elif primitive_type == "angle" and len(refs) == 3:
                commands.append(f"{primitive_id} = Angle({refs[0]}, {refs[1]}, {refs[2]})")
            elif primitive_type == "right_angle" and len(refs) == 3:
                commands.append(f"{primitive_id} = Angle({refs[0]}, {refs[1]}, {refs[2]})")
            elif primitive_type == "circle":
                center = str(primitive.get("center", "")).strip()
                radius_point = str(primitive.get("radius_point", "")).strip()
                if center and radius_point:
                    commands.append(f"{primitive_id} = Circle({center}, {radius_point})")
            elif primitive_type == "arc" and len(refs) == 2:
                center = str(primitive.get("center", "")).strip()
                if center:
                    commands.append(f"{primitive_id} = CircularArc({center}, {refs[0]}, {refs[1]})")

        for point_id in point_lookup:
            show_label = self._display_bool(point_display, point_id, "show_label", True)
            fixed = self._display_bool(point_display, point_id, "fixed", True)
            label_mode = int(self._display_value(point_display, point_id, "label_mode", 1))
            commands.append(f"SetFixed({point_id}, {'true' if fixed else 'false'})")
            commands.append(f"ShowLabel({point_id}, {'true' if show_label else 'false'})")
            commands.append(f"SetLabelMode({point_id}, {label_mode})")

        for primitive in coordinate_scene.get("primitives", []):
            primitive_id = str(primitive.get("id", "")).strip()
            color = self._display_value(primitive_display, primitive_id, "color")
            fill_opacity = self._display_value(primitive_display, primitive_id, "fill_opacity")
            if color is not None:
                commands.append(f'SetColor({primitive_id}, "{color}")')
            if fill_opacity is not None:
                commands.append(f"SetFilling({primitive_id}, {self._fmt_num(float(fill_opacity))})")

        return commands

    def write_debug_exports(
        self,
        coordinate_scene: Optional[Dict[str, Any]],
        output_dir: str,
        export_ggb: bool = True,
        extra_payloads: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, str]:
        debug_dir = Path(output_dir) / "debug"
        debug_dir.mkdir(parents=True, exist_ok=True)
        paths: Dict[str, str] = {}

        if coordinate_scene:
            coordinate_scene_path = debug_dir / "coordinate_scene.json"
            coordinate_scene_path.write_text(
                json.dumps(coordinate_scene, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            paths["coordinate_scene_json"] = str(coordinate_scene_path)

            if export_ggb:
                commands = self.export_ggb_commands(coordinate_scene)
                ggb_path = debug_dir / "coordinate_scene.ggb.txt"
                ggb_path.write_text("\n".join(commands), encoding="utf-8")
                paths["ggb_commands"] = str(ggb_path)

        for name, payload in (extra_payloads or {}).items():
            if payload is None:
                continue
            file_path = debug_dir / f"{name}.json"
            file_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            paths[name] = str(file_path)

        return paths

    def _normalize_roles(self, roles: Dict[str, Any]) -> Dict[str, Any]:
        normalized: Dict[str, Any] = {}
        for key, value in roles.items():
            if isinstance(value, list):
                normalized[str(key)] = [
                    self._canonical_point_id(item)
                    for item in value
                    if self._canonical_point_id(item)
                ]
            elif isinstance(value, str):
                normalized[str(key)] = self._canonical_point_id(value)
            else:
                normalized[str(key)] = value
        return normalized

    def _normalize_derived_payload(self, derived: Dict[str, Any]) -> Dict[str, Any]:
        item = copy.deepcopy(derived)
        derived_type = str(item.get("type", "")).strip().lower()
        item["type"] = derived_type
        if derived_type == "reflect_point":
            item["source"] = self._canonical_point_id(item.get("source"))
            item["axis"] = [
                self._canonical_point_id(ref)
                for ref in (item.get("axis") or [])
                if self._canonical_point_id(ref)
            ]
        return item

    def _normalize_relation_like_items(
        self,
        items: Iterable[Any],
        known_points: set[str],
        primitive_ids: set[str],
    ) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        seen: set[Tuple[str, Tuple[str, ...]]] = set()
        for raw in items:
            if not isinstance(raw, dict):
                continue
            relation_type = str(raw.get("type", "")).strip().lower()
            if not relation_type:
                continue
            entities = [
                self._normalize_entity_ref(entity, known_points, primitive_ids)
                for entity in (raw.get("entities") or [])
            ]
            signature = (relation_type, tuple(entities))
            if signature in seen:
                continue
            seen.add(signature)
            item = copy.deepcopy(raw)
            item["type"] = relation_type
            item["entities"] = entities
            normalized.append(item)
        return normalized

    def _normalize_measurements(
        self,
        items: Iterable[Any],
        known_points: set[str],
        primitive_ids: set[str],
    ) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        seen: set[Tuple[str, Tuple[str, ...], str]] = set()
        for raw in items:
            if not isinstance(raw, dict):
                continue
            measurement_type = str(raw.get("type", "")).strip().lower()
            if not measurement_type:
                continue
            entities = [
                self._normalize_entity_ref(entity, known_points, primitive_ids)
                for entity in (raw.get("entities") or [])
            ]
            value_repr = json.dumps(raw.get("value"), ensure_ascii=False, sort_keys=True)
            signature = (measurement_type, tuple(entities), value_repr)
            if signature in seen:
                continue
            seen.add(signature)
            item = copy.deepcopy(raw)
            item["type"] = measurement_type
            item["entities"] = entities
            normalized.append(item)
        return normalized

    def _normalize_display(
        self,
        raw_display: Dict[str, Any],
        point_payloads: Dict[str, Dict[str, Any]],
        primitive_ids: set[str],
        aliases: Dict[str, List[str]],
    ) -> Dict[str, Any]:
        display = {"points": {}, "primitives": {}}
        if isinstance(raw_display.get("points"), dict):
            for raw_id, payload in raw_display["points"].items():
                point_id = self._canonical_point_id(raw_id)
                if point_id and isinstance(payload, dict):
                    display["points"][point_id] = copy.deepcopy(payload)
        if isinstance(raw_display.get("primitives"), dict):
            for primitive_id, payload in raw_display["primitives"].items():
                if primitive_id in primitive_ids and isinstance(payload, dict):
                    display["primitives"][primitive_id] = copy.deepcopy(payload)

        for point_id, payload in point_payloads.items():
            point_display = display["points"].setdefault(point_id, {})
            point_display.setdefault("show_label", True)
            point_display.setdefault("fixed", True)
            point_display.setdefault("label_mode", 1)
            if payload.get("label"):
                point_display.setdefault("label", str(payload["label"]))
            elif aliases.get(point_id):
                point_display.setdefault("label", aliases[point_id][0])
        return display

    def _infer_templates(
        self,
        points: List[str],
        primitives: List[Dict[str, Any]],
        constraints: List[Dict[str, Any]],
        measurements: List[Dict[str, Any]],
    ) -> List[str]:
        templates: List[str] = []
        primitive_types = {str(item.get("type", "")).lower() for item in primitives}
        polygon_sizes = [
            len(item.get("points") or [])
            for item in primitives
            if str(item.get("type", "")).lower() == "polygon"
        ]
        primary_triangle = self._primary_triangle_candidate(primitives, constraints)

        if "circle" in primitive_types:
            if self._has_circle_parallel_extension(primitives, constraints):
                templates.append("circle_parallel_extension")
            templates.append("circle_basic")

        if primary_triangle:
            is_right = self._triangle_has_right_hint(primary_triangle, primitives, constraints, measurements)
            is_isosceles = self._triangle_has_equal_length_pair(primary_triangle, primitives, constraints, measurements)
            is_equilateral = self._triangle_has_equilateral_hint(primary_triangle, primitives, constraints, measurements)
        else:
            is_right = self._has_right_angle(primitives, constraints, measurements)
            is_isosceles = self._has_equal_length_pair(constraints, measurements)
            is_equilateral = self._has_equilateral_hint(constraints, measurements)

        if 3 in polygon_sizes or len(points) == 3:
            if is_right:
                templates.append("right_triangle")
            if is_equilateral:
                templates.append("equilateral_triangle")
            elif is_isosceles:
                templates.append("isosceles_triangle")
            templates.append("generic_triangle")
        if 4 in polygon_sizes or len(points) == 4:
            quad_template = self._infer_quadrilateral_template(constraints)
            templates.append(quad_template)
            if quad_template != "generic_quadrilateral":
                templates.append("generic_quadrilateral")

        if not templates:
            templates.append("generic_triangle")
        return self._ordered_unique(templates)

    def _primary_triangle_candidate(
        self,
        primitives: List[Dict[str, Any]],
        constraints: List[Dict[str, Any]],
    ) -> List[str]:
        primitive_map = {
            str(item.get("id", "")).strip(): item
            for item in primitives
            if isinstance(item, dict) and item.get("id")
        }
        preferred_polygon_ids = [
            str(item.get("entities", [None, None])[1]).strip()
            for item in constraints
            if str(item.get("type", "")).strip().lower() in {"point_in_polygon", "point_outside_polygon"}
            and len(item.get("entities") or []) == 2
        ]
        for polygon_id in preferred_polygon_ids:
            primitive = primitive_map.get(polygon_id)
            if not primitive:
                continue
            refs = [str(item).strip() for item in (primitive.get("points") or []) if str(item).strip()]
            if len(refs) == 3:
                return refs
        for primitive in primitives:
            if str(primitive.get("type", "")).strip().lower() != "polygon":
                continue
            refs = [str(item).strip() for item in (primitive.get("points") or []) if str(item).strip()]
            if len(refs) == 3:
                return refs
        return []

    def _triangle_has_right_hint(
        self,
        triangle: Sequence[str],
        primitives: List[Dict[str, Any]],
        constraints: List[Dict[str, Any]],
        measurements: List[Dict[str, Any]],
    ) -> bool:
        triangle_set = set(triangle)
        for primitive in primitives:
            if str(primitive.get("type", "")).strip().lower() != "right_angle":
                continue
            refs = [str(item).strip() for item in (primitive.get("points") or []) if str(item).strip()]
            if len(refs) == 3 and set(refs).issubset(triangle_set):
                return True
        for item in measurements:
            if str(item.get("type", "")).strip().lower() != "angle":
                continue
            try:
                value = float(item.get("value"))
            except (TypeError, ValueError):
                continue
            refs = [str(entity).strip() for entity in (item.get("entities") or []) if str(entity).strip()]
            if len(refs) == 3 and set(refs).issubset(triangle_set) and abs(value - 90.0) <= 1e-2:
                return True
        for relation in constraints:
            if str(relation.get("type", "")).strip().lower() != "perpendicular":
                continue
            entities = [str(entity).strip() for entity in (relation.get("entities") or []) if str(entity).strip()]
            if len(entities) != 2:
                continue
            primitive_map = {
                str(item.get("id", "")).strip(): item
                for item in primitives
                if isinstance(item, dict) and item.get("id")
            }
            seg1 = self._segment_endpoints(entities[0], {}, primitive_map)
            seg2 = self._segment_endpoints(entities[1], {}, primitive_map)
            if seg1 and seg2 and set(seg1).issubset(triangle_set) and set(seg2).issubset(triangle_set):
                return True
        return False

    def _triangle_has_equal_length_pair(
        self,
        triangle: Sequence[str],
        primitives: List[Dict[str, Any]],
        constraints: List[Dict[str, Any]],
        measurements: List[Dict[str, Any]],
    ) -> bool:
        triangle_edges = {frozenset(edge) for edge in self._polygon_edges(triangle)}
        primitive_map = {
            str(item.get("id", "")).strip(): item
            for item in primitives
            if isinstance(item, dict) and item.get("id")
        }
        for relation in constraints:
            if str(relation.get("type", "")).strip().lower() != "equal_length":
                continue
            entities = [str(entity).strip() for entity in (relation.get("entities") or []) if str(entity).strip()]
            if len(entities) != 2:
                continue
            seg_pairs = [self._segment_endpoints(entity, {}, primitive_map) for entity in entities]
            if all(seg_pairs) and all(frozenset(pair) in triangle_edges for pair in seg_pairs if pair):
                return True
        length_values = []
        for item in measurements:
            if str(item.get("type", "")).strip().lower() != "length":
                continue
            entities = [str(entity).strip() for entity in (item.get("entities") or []) if str(entity).strip()]
            if len(entities) != 2:
                continue
            segment = frozenset(entities)
            if segment in triangle_edges:
                length_values.append(round(self._coerce_float(item.get("value"), default=-1.0), 6))
        return len(length_values) != len(set(length_values))

    def _triangle_has_equilateral_hint(
        self,
        triangle: Sequence[str],
        primitives: List[Dict[str, Any]],
        constraints: List[Dict[str, Any]],
        measurements: List[Dict[str, Any]],
    ) -> bool:
        triangle_edges = {frozenset(edge) for edge in self._polygon_edges(triangle)}
        primitive_map = {
            str(item.get("id", "")).strip(): item
            for item in primitives
            if isinstance(item, dict) and item.get("id")
        }
        equal_length_count = 0
        for relation in constraints:
            if str(relation.get("type", "")).strip().lower() != "equal_length":
                continue
            entities = [str(entity).strip() for entity in (relation.get("entities") or []) if str(entity).strip()]
            if len(entities) != 2:
                continue
            seg_pairs = [self._segment_endpoints(entity, {}, primitive_map) for entity in entities]
            if all(seg_pairs) and all(frozenset(pair) in triangle_edges for pair in seg_pairs if pair):
                equal_length_count += 1
        if equal_length_count >= 2:
            return True
        length_values = []
        for item in measurements:
            if str(item.get("type", "")).strip().lower() != "length":
                continue
            entities = [str(entity).strip() for entity in (item.get("entities") or []) if str(entity).strip()]
            if len(entities) != 2:
                continue
            if frozenset(entities) in triangle_edges:
                length_values.append(round(self._coerce_float(item.get("value"), default=-1.0), 6))
        return len(length_values) >= 3 and len(set(length_values[:3])) == 1

    def _infer_quadrilateral_template(
        self,
        constraints: List[Dict[str, Any]],
    ) -> str:
        parallel_count = sum(
            1 for item in constraints if str(item.get("type", "")).lower() == "parallel"
        )
        perpendicular_count = sum(
            1
            for item in constraints
            if str(item.get("type", "")).lower() == "perpendicular"
        )
        equal_length_count = sum(
            1
            for item in constraints
            if str(item.get("type", "")).lower() == "equal_length"
        )
        if perpendicular_count >= 2 and equal_length_count >= 2:
            return "square"
        if perpendicular_count >= 1 and parallel_count >= 2:
            return "rectangle"
        if parallel_count >= 2:
            return "parallelogram"
        if parallel_count >= 1:
            return "trapezoid"
        return "generic_quadrilateral"

    def _has_right_angle(
        self,
        primitives: List[Dict[str, Any]],
        constraints: List[Dict[str, Any]],
        measurements: List[Dict[str, Any]],
    ) -> bool:
        if any(str(item.get("type", "")).lower() == "right_angle" for item in primitives):
            return True
        if any(str(item.get("type", "")).lower() == "perpendicular" for item in constraints):
            return True
        for item in measurements:
            if (
                str(item.get("type", "")).lower() == "angle"
                and abs(self._coerce_float(item.get("value"), default=0.0) - 90.0) <= 1e-2
            ):
                return True
        return False

    def _has_equal_length_pair(
        self,
        constraints: List[Dict[str, Any]],
        measurements: List[Dict[str, Any]],
    ) -> bool:
        if any(str(item.get("type", "")).lower() == "equal_length" for item in constraints):
            return True
        length_values = [
            round(self._coerce_float(item.get("value"), default=-1.0), 6)
            for item in measurements
            if str(item.get("type", "")).lower() == "length"
        ]
        return len(length_values) != len(set(length_values))

    def _has_equilateral_hint(
        self,
        constraints: List[Dict[str, Any]],
        measurements: List[Dict[str, Any]],
    ) -> bool:
        equal_length_count = sum(
            1
            for item in constraints
            if str(item.get("type", "")).lower() == "equal_length"
        )
        if equal_length_count >= 2:
            return True
        length_values = [
            round(self._coerce_float(item.get("value"), default=-1.0), 6)
            for item in measurements
            if str(item.get("type", "")).lower() == "length"
        ]
        return len(length_values) >= 3 and len(set(length_values[:3])) == 1

    def _has_circle_parallel_extension(
        self,
        primitives: List[Dict[str, Any]],
        constraints: List[Dict[str, Any]],
    ) -> bool:
        primitive_map = {
            str(item.get("id", "")).strip(): item
            for item in primitives
            if isinstance(item, dict) and item.get("id")
        }
        for circle in primitives:
            if str(circle.get("type", "")).strip().lower() != "circle":
                continue
            circle_id = str(circle.get("id", "")).strip()
            members = set(self._circle_members(circle_id, circle, constraints))
            if len(members) < 3:
                continue
            for relation in constraints:
                if str(relation.get("type", "")).strip().lower() != "parallel":
                    continue
                entities = [str(item).strip() for item in (relation.get("entities") or []) if str(item).strip()]
                if len(entities) != 2:
                    continue
                seg1 = self._segment_endpoints(entities[0], {}, primitive_map)
                seg2 = self._segment_endpoints(entities[1], {}, primitive_map)
                if not seg1 or not seg2:
                    continue
                if self._classify_circle_parallel_layout(seg1, seg2, members):
                    return True
        return False

    def _solve_template(
        self,
        spec: Dict[str, Any],
        template: str,
        solver_trace: List[str],
    ) -> Dict[str, List[float]]:
        explicit_coords = self._explicit_coord_map(spec)
        if self._all_non_derived_points_have_coords(spec, explicit_coords):
            solver_trace.append("using explicit coordinates from normalized spec")
            return explicit_coords
        if template in {"right_triangle_fold", "right_triangle"}:
            coords = self._solve_right_triangle(spec, solver_trace)
            solver_trace.append(f"applied {template} base layout")
            return coords
        if template == "equilateral_triangle":
            return self._solve_equilateral_triangle(spec, solver_trace)
        if template == "isosceles_triangle":
            return self._solve_isosceles_triangle(spec, solver_trace)
        if template == "generic_triangle":
            return self._solve_generic_triangle(spec, solver_trace)
        if template == "square":
            return self._solve_square(spec, solver_trace)
        if template == "rectangle":
            return self._solve_rectangle(spec, solver_trace)
        if template == "rhombus":
            return self._solve_rhombus(spec, solver_trace)
        if template == "parallelogram":
            return self._solve_parallelogram(spec, solver_trace)
        if template == "trapezoid":
            return self._solve_trapezoid(spec, solver_trace)
        if template == "generic_quadrilateral":
            return self._solve_generic_quadrilateral(spec, solver_trace)
        if template == "circle_parallel_extension":
            return self._solve_circle_parallel_extension(spec, solver_trace)
        if template == "circle_basic":
            return self._solve_circle_basic(spec, solver_trace)
        raise CoordinateSceneError(f"unsupported template: {template}")

    def _solve_right_triangle(
        self,
        spec: Dict[str, Any],
        solver_trace: List[str],
    ) -> Dict[str, List[float]]:
        coords = self._explicit_coord_map(spec)
        triangle = self._primary_polygon_points(spec, expected_size=3)
        if len(triangle) < 3:
            triangle = [point["id"] for point in spec.get("points", [])[:3]]
        if len(triangle) < 3:
            raise CoordinateSceneError("right_triangle requires three points.")

        roles = spec.get("roles", {})
        right_vertex = roles.get("right_vertex") or self._detect_right_vertex(spec, triangle)
        if not right_vertex:
            raise CoordinateSceneError("unable to detect right-angle vertex.")
        right_vertex = str(right_vertex)
        if right_vertex not in triangle:
            raise CoordinateSceneError("right-angle vertex is not on the primary triangle.")
        horizontal_point = roles.get("horizontal_point")
        vertical_point = roles.get("vertical_point")
        if not horizontal_point or not vertical_point:
            p1, p2 = self._points_adjacent_to_vertex(triangle, right_vertex)
            horizontal_point = horizontal_point or p1
            vertical_point = vertical_point or p2

        horizontal_len = self._find_length_between(spec, right_vertex, horizontal_point) or 8.0
        vertical_len = self._find_length_between(spec, right_vertex, vertical_point) or 6.0

        coords.setdefault(right_vertex, [0.0, 0.0])
        coords.setdefault(horizontal_point, [float(horizontal_len), 0.0])
        coords.setdefault(vertical_point, [0.0, float(vertical_len)])
        solver_trace.append(
            f"right triangle anchors: {right_vertex}=(0,0), "
            f"{horizontal_point}=({horizontal_len},0), {vertical_point}=(0,{vertical_len})"
        )
        return coords

    def _solve_equilateral_triangle(
        self,
        spec: Dict[str, Any],
        solver_trace: List[str],
    ) -> Dict[str, List[float]]:
        coords = self._explicit_coord_map(spec)
        a, b, c = self._primary_polygon_points(spec, expected_size=3)
        if self._triangle_equal_length_count(spec, (a, b, c)) < 2:
            raise CoordinateSceneError("equilateral hints do not apply to the primary triangle.")
        side = (
            self._find_length_between(spec, a, b)
            or self._find_length_between(spec, b, c)
            or self._find_length_between(spec, a, c)
            or 6.0
        )
        coords.setdefault(a, [0.0, 0.0])
        coords.setdefault(b, [float(side), 0.0])
        coords.setdefault(c, [float(side) / 2.0, float(side) * math.sqrt(3.0) / 2.0])
        solver_trace.append(f"equilateral triangle side={side}")
        return coords

    def _solve_isosceles_triangle(
        self,
        spec: Dict[str, Any],
        solver_trace: List[str],
    ) -> Dict[str, List[float]]:
        coords = self._explicit_coord_map(spec)
        a, b, c = self._primary_polygon_points(spec, expected_size=3)
        if self._triangle_equal_length_count(spec, (a, b, c)) < 1:
            raise CoordinateSceneError("isosceles hints do not apply to the primary triangle.")
        base = self._find_length_between(spec, a, b) or 8.0
        side = (
            self._find_length_between(spec, a, c)
            or self._find_length_between(spec, b, c)
            or max(base * 0.75, 4.0)
        )
        half = float(base) / 2.0
        height_sq = max(float(side) ** 2 - half ** 2, 4.0)
        height = math.sqrt(height_sq)
        coords.setdefault(a, [0.0, 0.0])
        coords.setdefault(b, [float(base), 0.0])
        coords.setdefault(c, [half, height])
        solver_trace.append(f"isosceles triangle base={base}, side={side}")
        return coords

    def _solve_generic_triangle(
        self,
        spec: Dict[str, Any],
        solver_trace: List[str],
    ) -> Dict[str, List[float]]:
        coords = self._explicit_coord_map(spec)
        a, b, c = self._primary_polygon_points(spec, expected_size=3)
        preferred_base = self._preferred_triangle_base(spec, (a, b, c))
        if preferred_base:
            remaining = [point_id for point_id in (a, b, c) if point_id not in preferred_base]
            if len(remaining) == 1:
                a, b, c = preferred_base[0], preferred_base[1], remaining[0]
        ab = self._find_length_between(spec, a, b) or 8.0
        ac = self._find_length_between(spec, a, c)
        bc = self._find_length_between(spec, b, c)
        coords.setdefault(a, [0.0, 0.0])
        coords.setdefault(b, [float(ab), 0.0])

        if ac and bc:
            x_coord, y_coord = self._solve_triangle_third_point(float(ab), float(ac), float(bc))
            coords.setdefault(c, [x_coord, y_coord])
            solver_trace.append(
                f"generic triangle solved by side lengths AB={ab}, AC={ac}, BC={bc}"
            )
            return coords

        coords.setdefault(c, [max(float(ab) * 0.35, 2.0), max(float(ab) * 0.7, 3.0)])
        solver_trace.append("generic triangle fell back to canonical layout")
        return coords

    def _solve_square(self, spec: Dict[str, Any], solver_trace: List[str]) -> Dict[str, List[float]]:
        coords = self._explicit_coord_map(spec)
        a, b, c, d = self._primary_polygon_points(spec, expected_size=4)
        side = self._find_length_between(spec, a, b) or 6.0
        coords.setdefault(a, [0.0, 0.0])
        coords.setdefault(b, [float(side), 0.0])
        coords.setdefault(c, [float(side), float(side)])
        coords.setdefault(d, [0.0, float(side)])
        solver_trace.append(f"square side={side}")
        return coords

    def _solve_rectangle(self, spec: Dict[str, Any], solver_trace: List[str]) -> Dict[str, List[float]]:
        coords = self._explicit_coord_map(spec)
        a, b, c, d = self._primary_polygon_points(spec, expected_size=4)
        width = self._find_length_between(spec, a, b) or self._find_length_between(spec, c, d) or 8.0
        height = self._find_length_between(spec, b, c) or self._find_length_between(spec, a, d) or 5.0
        coords.setdefault(a, [0.0, 0.0])
        coords.setdefault(b, [float(width), 0.0])
        coords.setdefault(c, [float(width), float(height)])
        coords.setdefault(d, [0.0, float(height)])
        solver_trace.append(f"rectangle width={width}, height={height}")
        return coords

    def _solve_rhombus(self, spec: Dict[str, Any], solver_trace: List[str]) -> Dict[str, List[float]]:
        coords = self._explicit_coord_map(spec)
        a, b, c, d = self._primary_polygon_points(spec, expected_size=4)
        side = (
            self._find_length_between(spec, a, b)
            or self._find_length_between(spec, b, c)
            or self._find_length_between(spec, c, d)
            or self._find_length_between(spec, a, d)
            or 5.0
        )

        tangent = self._find_tangent_for_vertex(spec, b, a, c)
        if tangent is None or abs(tangent) <= EPSILON:
            tangent = 1.6
        theta = math.atan(abs(tangent))
        horizontal = float(side)
        offset_x = float(side) * math.cos(theta)
        height = float(side) * math.sin(theta)

        coords.setdefault(b, [0.0, 0.0])
        coords.setdefault(c, [horizontal, 0.0])
        coords.setdefault(a, [offset_x, height])
        coords.setdefault(d, [horizontal + offset_x, height])
        solver_trace.append(
            f"rhombus side={side}, tan(vertex {b})={round(float(tangent), 6)}"
        )
        return coords

    def _solve_parallelogram(self, spec: Dict[str, Any], solver_trace: List[str]) -> Dict[str, List[float]]:
        coords = self._explicit_coord_map(spec)
        a, b, c, d = self._primary_polygon_points(spec, expected_size=4)
        if "rhombus" in set(spec.get("templates") or []):
            rhombus_coords = self._solve_rhombus(spec, solver_trace)
            for point_id, coord in rhombus_coords.items():
                coords.setdefault(point_id, coord)
            return coords
        width = self._find_length_between(spec, a, b) or 8.0
        height = self._find_length_between(spec, a, d) or 4.5
        offset = min(float(width) * 0.35, 2.5)
        coords.setdefault(a, [offset, float(height)])
        coords.setdefault(b, [0.0, 0.0])
        coords.setdefault(c, [float(width), 0.0])
        coords.setdefault(d, [float(width) + offset, float(height)])
        solver_trace.append(f"parallelogram width={width}, height={height}, offset={offset}")
        return coords

    def _solve_trapezoid(self, spec: Dict[str, Any], solver_trace: List[str]) -> Dict[str, List[float]]:
        coords = self._explicit_coord_map(spec)
        a, b, c, d = self._primary_polygon_points(spec, expected_size=4)
        bottom = self._find_length_between(spec, a, b) or 8.0
        top = self._find_length_between(spec, c, d) or 5.0
        height = 4.5
        left_offset = 1.2
        coords.setdefault(a, [0.0, 0.0])
        coords.setdefault(b, [float(bottom), 0.0])
        coords.setdefault(d, [left_offset, float(height)])
        coords.setdefault(c, [left_offset + float(top), float(height)])
        solver_trace.append(f"trapezoid bottom={bottom}, top={top}")
        return coords

    def _solve_generic_quadrilateral(
        self,
        spec: Dict[str, Any],
        solver_trace: List[str],
    ) -> Dict[str, List[float]]:
        coords = self._explicit_coord_map(spec)
        a, b, c, d = self._primary_polygon_points(spec, expected_size=4)
        coords.setdefault(a, [1.6, 4.6])
        coords.setdefault(b, [0.0, 0.0])
        coords.setdefault(c, [7.4, 0.0])
        coords.setdefault(d, [8.6, 4.2])
        solver_trace.append("generic quadrilateral used canonical layout")
        return coords

    def _solve_circle_basic(
        self,
        spec: Dict[str, Any],
        solver_trace: List[str],
    ) -> Dict[str, List[float]]:
        coords = self._explicit_coord_map(spec)
        circle = self._first_primitive_of_type(spec, "circle")
        if not circle:
            raise CoordinateSceneError("circle_basic requires a circle primitive.")
        center = str(circle.get("center", "")).strip()
        radius_point = str(circle.get("radius_point", "")).strip()
        if not center or not radius_point:
            raise CoordinateSceneError("circle primitive requires center and radius_point.")
        radius = self._find_length_between(spec, center, radius_point) or 4.0
        coords.setdefault(center, [0.0, 0.0])
        coords.setdefault(radius_point, [float(radius), 0.0])
        solver_trace.append(f"circle center={center}, radius={radius}")
        return coords

    def _solve_circle_parallel_extension(
        self,
        spec: Dict[str, Any],
        solver_trace: List[str],
    ) -> Dict[str, List[float]]:
        coords = self._explicit_coord_map(spec)
        primitive_map = {
            str(item.get("id", "")).strip(): item
            for item in spec.get("primitives", [])
            if isinstance(item, dict) and item.get("id")
        }
        circle = self._first_primitive_of_type(spec, "circle")
        if not circle:
            raise CoordinateSceneError("circle_parallel_extension requires a circle primitive.")

        circle_id = str(circle.get("id", "")).strip()
        center = str(circle.get("center", "")).strip()
        if not center:
            raise CoordinateSceneError("circle_parallel_extension requires a circle center.")
        members = self._circle_members(circle_id, circle, spec.get("constraints", []))
        if len(members) < 3:
            raise CoordinateSceneError("circle_parallel_extension requires at least three circle points.")

        layout: Optional[Tuple[str, str, str, str]] = None
        for relation in spec.get("constraints", []):
            if str(relation.get("type", "")).strip().lower() != "parallel":
                continue
            entities = [str(item).strip() for item in (relation.get("entities") or []) if str(item).strip()]
            if len(entities) != 2:
                continue
            seg1 = self._segment_endpoints(entities[0], {}, primitive_map)
            seg2 = self._segment_endpoints(entities[1], {}, primitive_map)
            if not seg1 or not seg2:
                continue
            layout = self._classify_circle_parallel_layout(seg1, seg2, set(members), primitive_map)
            if layout:
                break
        if not layout:
            raise CoordinateSceneError("unable to classify parallel extension on circle.")

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

        radius = self._infer_circle_layout_radius(angle_map, spec)
        coords.setdefault(center, [0.0, 0.0])
        cx, cy = coords[center]
        for point_id, angle_deg in angle_map.items():
            angle = math.radians(angle_deg)
            coords[point_id] = [
                round(cx + radius * math.cos(angle), 6),
                round(cy + radius * math.sin(angle), 6),
            ]

        ext_length = self._find_length_between(spec, anchor_b, external_point) or (radius * 1.9)
        direction = [
            coords[chord_c][0] - coords[chord_a][0],
            coords[chord_c][1] - coords[chord_a][1],
        ]
        direction_norm = math.hypot(direction[0], direction[1]) or 1.0
        coords[external_point] = [
            round(coords[anchor_b][0] + direction[0] / direction_norm * ext_length, 6),
            round(coords[anchor_b][1] + direction[1] / direction_norm * ext_length, 6),
        ]
        solver_trace.append(
            "circle parallel-extension layout "
            f"({chord_a}, {chord_c}) // ({anchor_b}, {external_point})"
        )
        return coords

    def _resolve_dependent_points(
        self,
        spec: Dict[str, Any],
        coords: Dict[str, List[float]],
        solver_trace: List[str],
    ) -> None:
        primitive_map = {
            str(item.get("id", "")).strip(): item
            for item in spec.get("primitives", [])
            if isinstance(item, dict) and item.get("id")
        }
        indexes = self._build_solver_indexes(spec, primitive_map=primitive_map)
        circular_points = self._ordered_unique(
            self._point_on_circle_targets(spec, indexes=indexes)
        )
        circle_angle_state = {pid: index for index, pid in enumerate(circular_points)}

        for _ in range(len(spec.get("points", [])) + 3):
            progress = False
            for point_id in self._midpoint_targets(spec, indexes=indexes):
                if point_id in coords:
                    continue
                endpoints = self._midpoint_endpoints(point_id, spec, primitive_map, indexes=indexes)
                if endpoints and endpoints[0] in coords and endpoints[1] in coords:
                    coords[point_id] = self._midpoint(coords[endpoints[0]], coords[endpoints[1]])
                    solver_trace.append(f"resolved midpoint {point_id}")
                    progress = True

            for point_id in self._point_on_segment_targets(spec, indexes=indexes):
                if point_id in coords:
                    continue
                position = self._solve_point_on_segment(point_id, spec, coords, primitive_map, indexes=indexes)
                if position is not None:
                    coords[point_id] = position
                    solver_trace.append(f"resolved point_on_segment {point_id}")
                    progress = True

            for point_id in self._point_on_circle_targets(spec, indexes=indexes):
                if point_id in coords:
                    continue
                position = self._solve_point_on_circle(
                    point_id,
                    spec,
                    coords,
                    primitive_map,
                    circle_angle_state,
                    indexes=indexes,
                )
                if position is not None:
                    coords[point_id] = position
                    solver_trace.append(f"resolved point_on_circle {point_id}")
                    progress = True

            for point_id in self._point_in_polygon_targets(spec, indexes=indexes):
                if point_id in coords:
                    continue
                position = self._solve_point_in_polygon(point_id, spec, coords, primitive_map, indexes=indexes)
                if position is not None:
                    coords[point_id] = position
                    solver_trace.append(f"resolved point_in_polygon {point_id}")
                    progress = True

            for point_id in self._point_outside_polygon_targets(spec, indexes=indexes):
                if point_id in coords:
                    continue
                position = self._solve_point_outside_polygon(point_id, spec, coords, primitive_map, indexes=indexes)
                if position is not None:
                    coords[point_id] = position
                    solver_trace.append(f"resolved point_outside_polygon {point_id}")
                    progress = True

            for point in spec.get("points", []):
                point_id = str(point.get("id", "")).strip()
                if not point_id or point_id in coords:
                    continue
                position = self._solve_parallel_endpoint(point_id, spec, coords, primitive_map, indexes=indexes)
                if position is not None:
                    coords[point_id] = position
                    solver_trace.append(f"resolved parallel endpoint {point_id}")
                    progress = True

            for point_id in self._intersection_targets(spec, indexes=indexes):
                if point_id in coords:
                    continue
                position = self._solve_intersection_point(point_id, spec, coords, primitive_map, indexes=indexes)
                if position is not None:
                    coords[point_id] = position
                    solver_trace.append(f"resolved intersection {point_id}")
                    progress = True

            if not progress:
                break

        unresolved_segment_points = [
            point_id
            for point_id in self._point_on_segment_targets(spec, indexes=indexes)
            if point_id not in coords
        ]
        if unresolved_segment_points:
            raise CoordinateSceneError(
                "insufficient information for points on segment: "
                + ", ".join(sorted(unresolved_segment_points))
            )

        unresolved_outside_points = [
            point_id
            for point_id in self._point_outside_polygon_targets(spec, indexes=indexes)
            if point_id not in coords
        ]
        if unresolved_outside_points:
            raise CoordinateSceneError(
                "insufficient information for points outside polygon: "
                + ", ".join(sorted(unresolved_outside_points))
            )

        remaining_non_derived = [
            str(point.get("id", "")).strip()
            for point in spec.get("points", [])
            if point.get("id")
            and str(point.get("id", "")).strip() not in coords
            and not point.get("derived")
        ]
        if remaining_non_derived:
            raise CoordinateSceneError(
                "failed to solve points: " + ", ".join(sorted(remaining_non_derived))
            )

    def _solve_triangle_third_point(self, ab: float, ac: float, bc: float) -> Tuple[float, float]:
        if sp is not None:
            x, y = sp.symbols("x y", real=True)
            equations = [
                sp.Eq(x ** 2 + y ** 2, ac ** 2),
                sp.Eq((x - ab) ** 2 + y ** 2, bc ** 2),
            ]
            solutions = sp.solve(equations, (x, y), dict=True)
            for item in solutions:
                sx = complex(item[x])
                sy = complex(item[y])
                if abs(sx.imag) <= 1e-8 and abs(sy.imag) <= 1e-8 and sy.real >= 0:
                    return (float(sx.real), float(sy.real))
        x_coord = (ac ** 2 - bc ** 2 + ab ** 2) / (2 * ab)
        y_sq = max(ac ** 2 - x_coord ** 2, 1.0)
        return (float(x_coord), float(math.sqrt(y_sq)))

    def _resolve_coordinate_scene_structure(self, coordinate_scene: Dict[str, Any]) -> Dict[str, Any]:
        data = copy.deepcopy(coordinate_scene or {})
        if not isinstance(data, dict):
            raise CoordinateSceneError("coordinate_scene must be an object.")
        mode = str(data.get("mode", "2d")).lower()
        if mode != "2d":
            raise CoordinateSceneError("coordinate_scene.mode currently supports only '2d'.")
        points = data.get("points")
        if not isinstance(points, list) or not points:
            raise CoordinateSceneError("coordinate_scene.points must be a non-empty list.")
        primitives = data.get("primitives", [])
        constraints = data.get("constraints", [])
        display = data.get("display", {})
        measurements = data.get("measurements", [])
        if not isinstance(primitives, list):
            raise CoordinateSceneError("coordinate_scene.primitives must be a list.")
        if not isinstance(constraints, list):
            raise CoordinateSceneError("coordinate_scene.constraints must be a list.")
        if not isinstance(display, dict):
            raise CoordinateSceneError("coordinate_scene.display must be an object.")
        if not isinstance(measurements, list):
            raise CoordinateSceneError("coordinate_scene.measurements must be a list.")

        resolved_points: Dict[str, Dict[str, Any]] = {}
        pending = [copy.deepcopy(item) for item in points]
        for _ in range(len(pending) + 1):
            remaining: List[Dict[str, Any]] = []
            progress = False
            for item in pending:
                point_id = str(item.get("id", "")).strip()
                if not point_id:
                    raise CoordinateSceneError("point is missing id.")
                if point_id in resolved_points:
                    raise CoordinateSceneError(f"duplicate point id: {point_id}")
                coord = item.get("coord")
                if isinstance(coord, list) and len(coord) == 2:
                    resolved_points[point_id] = {"id": point_id, "coord": [float(coord[0]), float(coord[1])]}
                    if item.get("derived"):
                        resolved_points[point_id]["derived"] = copy.deepcopy(item["derived"])
                    progress = True
                    continue
                derived = item.get("derived")
                if not isinstance(derived, dict):
                    raise CoordinateSceneError(f"point {point_id} has neither coord nor derived payload.")
                resolved = self._resolve_derived_point(point_id, derived, resolved_points)
                if resolved is None:
                    remaining.append(item)
                    continue
                resolved_points[point_id] = {"id": point_id, "coord": resolved, "derived": copy.deepcopy(derived)}
                progress = True

            if not remaining:
                break
            if not progress:
                unresolved_ids = ", ".join(str(item.get("id", "?")) for item in remaining)
                raise CoordinateSceneError("unable to resolve derived points: " + unresolved_ids)
            pending = remaining

        data["mode"] = "2d"
        data["points"] = [resolved_points[pid] for pid in resolved_points]
        point_ids = set(resolved_points.keys())
        primitive_ids = set()
        for primitive in primitives:
            if not isinstance(primitive, dict):
                raise CoordinateSceneError("primitive must be an object.")
            primitive_id = str(primitive.get("id", "")).strip()
            if not primitive_id:
                raise CoordinateSceneError("primitive is missing id.")
            if primitive_id in primitive_ids:
                raise CoordinateSceneError(f"duplicate primitive id: {primitive_id}")
            primitive_ids.add(primitive_id)
            self._validate_primitive_structure(primitive, point_ids)
        for constraint in constraints:
            if not isinstance(constraint, dict):
                raise CoordinateSceneError("constraint must be an object.")
            self._validate_constraint_structure(constraint, point_ids, primitive_ids)
        self._validate_measurement_structure(measurements, point_ids, primitive_ids)
        return data

    def _resolve_derived_point(
        self,
        point_id: str,
        derived: Dict[str, Any],
        resolved_points: Dict[str, Dict[str, Any]],
    ) -> Optional[List[float]]:
        derived_type = str(derived.get("type", "")).strip().lower()
        if derived_type == "reflect_point":
            source_id = str(derived.get("source", "")).strip()
            axis = [str(item) for item in (derived.get("axis") or [])]
            if len(axis) != 2:
                raise CoordinateSceneError(f"point {point_id} reflect_point axis must have two endpoints.")
            source = resolved_points.get(source_id)
            axis_a = resolved_points.get(axis[0])
            axis_b = resolved_points.get(axis[1])
            if not source or not axis_a or not axis_b:
                return None
            return self._reflect_point(source["coord"], axis_a["coord"], axis_b["coord"])
        raise CoordinateSceneError(f"point {point_id} uses unsupported derived type: {derived_type}")

    def _validate_relation(
        self,
        relation_type: str,
        entities: Sequence[str],
        point_lookup: Dict[str, List[float]],
        primitive_map: Dict[str, Dict[str, Any]],
    ) -> Any:
        if relation_type == "point_on_segment":
            if len(entities) != 2:
                return {"type": relation_type, "message": "expected [point, segment]"}
            point_id, segment_id = entities
            endpoints = self._segment_endpoints(segment_id, point_lookup, primitive_map)
            if not endpoints:
                return {"type": relation_type, "entities": list(entities), "message": "segment not found"}
            if not self._point_on_segment(point_lookup[point_id], point_lookup[endpoints[0]], point_lookup[endpoints[1]]):
                return {"type": relation_type, "entities": list(entities), "message": "point is not on segment"}
            return None
        if relation_type == "point_on_circle":
            if len(entities) != 2:
                return {"type": relation_type, "message": "expected [point, circle]"}
            point_id, circle_id = entities
            circle = primitive_map.get(circle_id)
            if not circle:
                return {"type": relation_type, "entities": list(entities), "message": "circle not found"}
            center = str(circle.get("center", "")).strip()
            radius_point = str(circle.get("radius_point", "")).strip()
            radius = self._distance(point_lookup[center], point_lookup[radius_point])
            if abs(self._distance(point_lookup[center], point_lookup[point_id]) - radius) > 1e-3:
                return {"type": relation_type, "entities": list(entities), "message": "point is not on circle"}
            return None
        if relation_type == "point_in_polygon":
            if len(entities) != 2:
                return {"type": relation_type, "message": "expected [point, polygon]"}
            point_id, polygon_id = entities
            polygon = primitive_map.get(polygon_id)
            if not polygon:
                return {"type": relation_type, "entities": list(entities), "message": "polygon not found"}
            refs = [str(item).strip() for item in (polygon.get("points") or []) if str(item).strip()]
            if len(refs) < 3:
                return {"type": relation_type, "entities": list(entities), "message": "polygon has too few points"}
            if not self._point_in_polygon(point_lookup[point_id], [point_lookup[item] for item in refs]):
                return {"type": relation_type, "entities": list(entities), "message": "point is not inside polygon"}
            return None
        if relation_type == "point_outside_polygon":
            if len(entities) != 2:
                return {"type": relation_type, "message": "expected [point, polygon]"}
            point_id, polygon_id = entities
            polygon = primitive_map.get(polygon_id)
            if not polygon:
                return {"type": relation_type, "entities": list(entities), "message": "polygon not found"}
            refs = [str(item).strip() for item in (polygon.get("points") or []) if str(item).strip()]
            if len(refs) < 3:
                return {"type": relation_type, "entities": list(entities), "message": "polygon has too few points"}
            if self._point_in_polygon(point_lookup[point_id], [point_lookup[item] for item in refs]):
                return {"type": relation_type, "entities": list(entities), "message": "point is not outside polygon"}
            return None
        if relation_type == "collinear":
            if len(entities) < 3:
                return {"type": relation_type, "message": "expected at least 3 points"}
            if not self._are_collinear([point_lookup[item] for item in entities]):
                return {"type": relation_type, "entities": list(entities), "message": "points are not collinear"}
            return None
        if relation_type == "parallel":
            if len(entities) != 2:
                return {"type": relation_type, "message": "expected two segments"}
            seg1 = self._segment_endpoints(entities[0], point_lookup, primitive_map)
            seg2 = self._segment_endpoints(entities[1], point_lookup, primitive_map)
            if not seg1 or not seg2:
                return {"type": relation_type, "entities": list(entities), "message": "segment not found"}
            if not self._is_parallel(point_lookup[seg1[0]], point_lookup[seg1[1]], point_lookup[seg2[0]], point_lookup[seg2[1]]):
                return {"type": relation_type, "entities": list(entities), "message": "segments are not parallel"}
            return None
        if relation_type == "perpendicular":
            if len(entities) != 2:
                return {"type": relation_type, "message": "expected two segments"}
            seg1 = self._segment_endpoints(entities[0], point_lookup, primitive_map)
            seg2 = self._segment_endpoints(entities[1], point_lookup, primitive_map)
            if not seg1 or not seg2:
                return {"type": relation_type, "entities": list(entities), "message": "segment not found"}
            if not self._is_perpendicular(point_lookup[seg1[0]], point_lookup[seg1[1]], point_lookup[seg2[0]], point_lookup[seg2[1]]):
                return {"type": relation_type, "entities": list(entities), "message": "segments are not perpendicular"}
            return None
        if relation_type == "equal_length":
            if len(entities) != 2:
                return {"type": relation_type, "message": "expected two segments"}
            seg1 = self._segment_endpoints(entities[0], point_lookup, primitive_map)
            seg2 = self._segment_endpoints(entities[1], point_lookup, primitive_map)
            if not seg1 or not seg2:
                return {"type": relation_type, "entities": list(entities), "message": "segment not found"}
            length1 = self._distance(point_lookup[seg1[0]], point_lookup[seg1[1]])
            length2 = self._distance(point_lookup[seg2[0]], point_lookup[seg2[1]])
            if abs(length1 - length2) > 1e-3:
                return {"type": relation_type, "entities": list(entities), "message": "segment lengths differ"}
            return None
        if relation_type == "midpoint":
            if len(entities) != 2:
                return {"type": relation_type, "message": "expected [point, segment]"}
            point_id, segment_id = entities
            endpoints = self._segment_endpoints(segment_id, point_lookup, primitive_map)
            if not endpoints:
                return {"type": relation_type, "entities": list(entities), "message": "segment not found"}
            midpoint = self._midpoint(point_lookup[endpoints[0]], point_lookup[endpoints[1]])
            if self._distance(midpoint, point_lookup[point_id]) > 1e-3:
                return {"type": relation_type, "entities": list(entities), "message": "point is not midpoint"}
            return None
        if relation_type == "intersect":
            if len(entities) != 3:
                return {"type": relation_type, "message": "expected [point, segment, segment]"}
            point_id, seg1_id, seg2_id = entities
            seg1 = self._segment_endpoints(seg1_id, point_lookup, primitive_map)
            seg2 = self._segment_endpoints(seg2_id, point_lookup, primitive_map)
            if not seg1 or not seg2:
                return {"type": relation_type, "entities": list(entities), "message": "segment not found"}
            inter = self._line_intersection(point_lookup[seg1[0]], point_lookup[seg1[1]], point_lookup[seg2[0]], point_lookup[seg2[1]])
            if inter is None or self._distance(inter, point_lookup[point_id]) > 1e-3:
                return {"type": relation_type, "entities": list(entities), "message": "point is not the intersection"}
            return None
        if relation_type in {"equal_angle", "angle_bisector"}:
            return "unsupported"
        return "unsupported"

    def _validate_measurement(
        self,
        measurement: Dict[str, Any],
        point_lookup: Dict[str, List[float]],
        primitive_map: Dict[str, Dict[str, Any]],
    ) -> Any:
        measurement_type = str(measurement.get("type", "")).lower()
        entities = [str(item) for item in (measurement.get("entities") or [])]
        value = measurement.get("value")
        if measurement_type == "length":
            if len(entities) != 2:
                return {"type": measurement_type, "message": "length expects two entities"}
            points = self._measurement_points(entities, point_lookup, primitive_map)
            if not points:
                return "unsupported"
            actual = self._distance(point_lookup[points[0]], point_lookup[points[1]])
            if abs(actual - self._coerce_float(value, default=actual)) > 1e-3:
                return {"type": "measurement:length", "entities": entities, "expected": value, "actual": round(actual, 6)}
            return None
        if measurement_type == "angle":
            if len(entities) != 3:
                return {"type": measurement_type, "message": "angle expects three points"}
            actual = self._angle_degrees(point_lookup[entities[0]], point_lookup[entities[1]], point_lookup[entities[2]])
            expected = self._coerce_float(value, default=actual)
            if abs(actual - expected) > 1e-2:
                return {"type": "measurement:angle", "entities": entities, "expected": value, "actual": round(actual, 6)}
            return None
        if measurement_type == "ratio":
            return None
        return "unsupported"

    def _validate_primitive_structure(self, primitive: Dict[str, Any], point_ids: set[str]) -> None:
        primitive_type = str(primitive.get("type", "")).strip().lower()
        refs = [str(item) for item in (primitive.get("points") or [])]
        if primitive_type == "segment":
            if len(refs) != 2:
                raise CoordinateSceneError(f"segment {primitive.get('id')} requires 2 points.")
        elif primitive_type == "polygon":
            if len(refs) < 3:
                raise CoordinateSceneError(f"polygon {primitive.get('id')} requires at least 3 points.")
        elif primitive_type in {"angle", "right_angle"}:
            if len(refs) != 3:
                raise CoordinateSceneError(f"{primitive_type} {primitive.get('id')} requires 3 points.")
        elif primitive_type == "circle":
            center = str(primitive.get("center", "")).strip()
            radius_point = str(primitive.get("radius_point", "")).strip()
            if not center or not radius_point:
                raise CoordinateSceneError(f"circle {primitive.get('id')} requires center and radius_point.")
            refs = [center, radius_point]
        elif primitive_type == "arc":
            center = str(primitive.get("center", "")).strip()
            if not center or len(refs) != 2:
                raise CoordinateSceneError(f"arc {primitive.get('id')} requires center and 2 points.")
            refs = [center] + refs
        else:
            raise CoordinateSceneError(f"unsupported primitive type: {primitive_type}")
        for ref in refs:
            if ref not in point_ids:
                raise CoordinateSceneError(f"primitive {primitive.get('id')} references missing point: {ref}")

    def _validate_constraint_structure(
        self,
        constraint: Dict[str, Any],
        point_ids: set[str],
        primitive_ids: set[str],
    ) -> None:
        relation_type = str(constraint.get("type", "")).strip().lower()
        entities = [str(item) for item in (constraint.get("entities") or [])]
        if relation_type == "point_on_segment":
            if len(entities) != 2:
                raise CoordinateSceneError("point_on_segment expects [point_id, segment_id].")
            if entities[0] not in point_ids:
                raise CoordinateSceneError(f"point_on_segment references missing point: {entities[0]}")
            if entities[1] not in primitive_ids and not entities[1].startswith("seg_"):
                raise CoordinateSceneError(f"point_on_segment references missing segment: {entities[1]}")
            return
        if relation_type == "point_on_circle":
            if len(entities) != 2:
                raise CoordinateSceneError("point_on_circle expects [point_id, circle_id].")
            if entities[0] not in point_ids:
                raise CoordinateSceneError(f"point_on_circle references missing point: {entities[0]}")
            if entities[1] not in primitive_ids:
                raise CoordinateSceneError(f"point_on_circle references missing circle: {entities[1]}")
            return
        if relation_type == "point_in_polygon":
            if len(entities) != 2:
                raise CoordinateSceneError("point_in_polygon expects [point_id, polygon_id].")
            if entities[0] not in point_ids:
                raise CoordinateSceneError(f"point_in_polygon references missing point: {entities[0]}")
            if entities[1] not in primitive_ids:
                raise CoordinateSceneError(f"point_in_polygon references missing polygon: {entities[1]}")
            return
        if relation_type == "point_outside_polygon":
            if len(entities) != 2:
                raise CoordinateSceneError("point_outside_polygon expects [point_id, polygon_id].")
            if entities[0] not in point_ids:
                raise CoordinateSceneError(f"point_outside_polygon references missing point: {entities[0]}")
            if entities[1] not in primitive_ids:
                raise CoordinateSceneError(f"point_outside_polygon references missing polygon: {entities[1]}")
            return
        if relation_type in {"collinear", "perpendicular", "equal_length", "equal_angle", "parallel", "midpoint", "angle_bisector", "intersect"}:
            return
        raise CoordinateSceneError(f"unsupported constraint type: {relation_type}")

    def _validate_measurement_structure(
        self,
        measurements: List[Dict[str, Any]],
        point_ids: set[str],
        primitive_ids: set[str],
    ) -> None:
        for item in measurements:
            if not isinstance(item, dict):
                raise CoordinateSceneError("measurement must be an object.")
            for entity in item.get("entities") or []:
                if entity not in point_ids and entity not in primitive_ids and not str(entity).startswith("seg_"):
                    raise CoordinateSceneError(f"measurement references missing entity: {entity}")

    def _default_primitive_id(self, primitive: Dict[str, Any], existing_ids: set[str]) -> str:
        primitive_type = str(primitive.get("type", "")).lower()
        if primitive_type == "segment":
            base = "seg_" + "".join(str(item) for item in (primitive.get("points") or []))
        elif primitive_type == "polygon":
            base = "poly_" + "".join(str(item) for item in (primitive.get("points") or []))
        elif primitive_type == "circle":
            base = f"circle_{primitive.get('center', '')}{primitive.get('radius_point', '')}"
        elif primitive_type == "arc":
            base = "arc_" + "".join(str(item) for item in (primitive.get("points") or []))
        else:
            base = primitive_type or "primitive"
        candidate = base
        suffix = 1
        while candidate in existing_ids:
            suffix += 1
            candidate = f"{base}_{suffix}"
        return candidate

    def _normalize_entity_ref(self, entity: Any, known_points: set[str], primitive_ids: set[str]) -> str:
        text = str(entity).strip()
        if not text:
            return text
        if text in primitive_ids:
            return text
        candidate = self._canonical_point_id(text)
        if candidate in known_points:
            return candidate
        return text

    def _canonical_point_id(self, raw_id: Any) -> str:
        if raw_id is None:
            return ""
        text = str(raw_id).strip()
        if not text:
            return ""
        text = text.replace("′", "'").replace("’", "'").replace(" ", "")
        prime_count = text.count("'")
        text = text.replace("'", "")
        text = "".join(ch for ch in text if ch.isalnum() or ch == "_")
        if not text:
            return ""
        if prime_count > 0:
            text = f"{text}{prime_count}"
        return text

    def _ordered_unique(self, values: Iterable[str]) -> List[str]:
        seen: set[str] = set()
        ordered: List[str] = []
        for value in values:
            if not value or value in seen:
                continue
            seen.add(value)
            ordered.append(value)
        return ordered

    def _build_solver_indexes(
        self,
        spec: Dict[str, Any],
        primitive_map: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        primitive_map = primitive_map or {
            str(item.get("id", "")).strip(): item
            for item in spec.get("primitives", [])
            if isinstance(item, dict) and item.get("id")
        }

        neighbors: Dict[str, set[str]] = {}
        for primitive in primitive_map.values():
            if str(primitive.get("type", "")).strip().lower() != "segment":
                continue
            refs = [str(item).strip() for item in (primitive.get("points") or []) if str(item).strip()]
            if len(refs) != 2:
                continue
            first, second = refs
            neighbors.setdefault(first, set()).add(second)
            neighbors.setdefault(second, set()).add(first)

        constraint_targets: Dict[str, List[str]] = {}
        midpoint_segments_by_point: Dict[str, str] = {}
        point_on_segment_by_point: Dict[str, str] = {}
        point_on_circle_by_point: Dict[str, str] = {}
        point_in_polygon_by_point: Dict[str, str] = {}
        point_outside_polygon_by_point: Dict[str, str] = {}
        intersection_segments_by_point: Dict[str, Tuple[str, str]] = {}
        parallel_segment_pairs: List[Tuple[str, str]] = []

        for relation in spec.get("constraints", []):
            if not isinstance(relation, dict):
                continue
            relation_type = str(relation.get("type", "")).strip().lower()
            entities = [str(item).strip() for item in (relation.get("entities") or []) if str(item).strip()]
            if not relation_type:
                continue
            if entities:
                constraint_targets.setdefault(relation_type, []).append(entities[0])
            if relation_type == "midpoint" and len(entities) == 2:
                midpoint_segments_by_point[entities[0]] = entities[1]
            elif relation_type == "point_on_segment" and len(entities) == 2:
                point_on_segment_by_point[entities[0]] = entities[1]
            elif relation_type == "point_on_circle" and len(entities) == 2:
                point_on_circle_by_point[entities[0]] = entities[1]
            elif relation_type == "point_in_polygon" and len(entities) == 2:
                point_in_polygon_by_point[entities[0]] = entities[1]
            elif relation_type == "point_outside_polygon" and len(entities) == 2:
                point_outside_polygon_by_point[entities[0]] = entities[1]
            elif relation_type == "intersect" and len(entities) == 3:
                intersection_segments_by_point[entities[0]] = (entities[1], entities[2])
            elif relation_type == "parallel" and len(entities) == 2:
                parallel_segment_pairs.append((entities[0], entities[1]))

        for relation_type, targets in list(constraint_targets.items()):
            constraint_targets[relation_type] = self._ordered_unique(targets)

        length_index: Dict[frozenset[str], float] = {}
        length_measurements_by_point: Dict[str, List[Tuple[str, float]]] = {}
        for measurement in spec.get("measurements", []):
            if str(measurement.get("type", "")).strip().lower() != "length":
                continue
            entities = [str(item).strip() for item in (measurement.get("entities") or []) if str(item).strip()]
            if len(entities) != 2:
                continue
            value = self._coerce_float(measurement.get("value"), default=None)
            if value is None:
                continue
            first, second = entities
            pair = frozenset((first, second))
            length_index.setdefault(pair, value)
            length_measurements_by_point.setdefault(first, []).append((second, value))
            length_measurements_by_point.setdefault(second, []).append((first, value))

        return {
            "primitive_map": primitive_map,
            "neighbors": neighbors,
            "constraint_targets": constraint_targets,
            "midpoint_segments_by_point": midpoint_segments_by_point,
            "point_on_segment_by_point": point_on_segment_by_point,
            "point_on_circle_by_point": point_on_circle_by_point,
            "point_in_polygon_by_point": point_in_polygon_by_point,
            "point_outside_polygon_by_point": point_outside_polygon_by_point,
            "intersection_segments_by_point": intersection_segments_by_point,
            "parallel_segment_pairs": parallel_segment_pairs,
            "length_index": length_index,
            "length_measurements_by_point": length_measurements_by_point,
        }

    def _explicit_coord_map(self, spec: Dict[str, Any]) -> Dict[str, List[float]]:
        coords: Dict[str, List[float]] = {}
        for point in spec.get("points", []):
            point_id = str(point.get("id", "")).strip()
            coord = point.get("coord")
            if point_id and isinstance(coord, list) and len(coord) == 2:
                coords[point_id] = [float(coord[0]), float(coord[1])]
        return coords

    def _all_non_derived_points_have_coords(self, spec: Dict[str, Any], explicit_coords: Dict[str, List[float]]) -> bool:
        for point in spec.get("points", []):
            point_id = str(point.get("id", "")).strip()
            if point.get("derived"):
                continue
            if point_id not in explicit_coords:
                return False
        return True

    def _primary_polygon_points(self, spec: Dict[str, Any], expected_size: int) -> List[str]:
        preferred_polygon_ids = [
            str(item.get("entities", [None, None])[1]).strip()
            for item in spec.get("constraints", [])
            if str(item.get("type", "")).strip().lower() in {"point_in_polygon", "point_outside_polygon"}
            and len(item.get("entities") or []) == 2
        ]
        for polygon_id in preferred_polygon_ids:
            for primitive in spec.get("primitives", []):
                if str(primitive.get("id", "")).strip() != polygon_id:
                    continue
                refs = [str(item) for item in (primitive.get("points") or [])]
                if len(refs) == expected_size:
                    return refs
        for primitive in spec.get("primitives", []):
            if str(primitive.get("type", "")).lower() != "polygon":
                continue
            refs = [str(item) for item in (primitive.get("points") or [])]
            if len(refs) == expected_size:
                return refs
        point_ids = [str(point.get("id", "")).strip() for point in spec.get("points", [])]
        return point_ids[:expected_size]

    def _polygon_edges(self, refs: Sequence[str]) -> List[Tuple[str, str]]:
        edges: List[Tuple[str, str]] = []
        if len(refs) < 2:
            return edges
        for index, start in enumerate(refs):
            edges.append((start, refs[(index + 1) % len(refs)]))
        return edges

    def _point_neighbors_from_primitives(
        self,
        spec: Dict[str, Any],
        point_id: str,
        indexes: Optional[Dict[str, Any]] = None,
    ) -> set[str]:
        if isinstance(indexes, dict):
            indexed_neighbors = indexes.get("neighbors") or {}
            if isinstance(indexed_neighbors, dict):
                values = indexed_neighbors.get(point_id)
                if isinstance(values, set):
                    return set(values)
        neighbors: set[str] = set()
        for primitive in spec.get("primitives", []):
            if str(primitive.get("type", "")).strip().lower() != "segment":
                continue
            refs = [str(item).strip() for item in (primitive.get("points") or []) if str(item).strip()]
            if len(refs) != 2 or point_id not in refs:
                continue
            neighbors.add(refs[0] if refs[1] == point_id else refs[1])
        return neighbors

    def _first_primitive_of_type(self, spec: Dict[str, Any], primitive_type: str) -> Optional[Dict[str, Any]]:
        for primitive in spec.get("primitives", []):
            if str(primitive.get("type", "")).lower() == primitive_type:
                return primitive
        return None

    def _triangle_equal_length_count(self, spec: Dict[str, Any], triangle: Sequence[str]) -> int:
        triangle_edges = {
            frozenset((triangle[0], triangle[1])),
            frozenset((triangle[1], triangle[2])),
            frozenset((triangle[0], triangle[2])),
        }
        count = 0
        for constraint in spec.get("constraints", []):
            if str(constraint.get("type", "")).strip().lower() != "equal_length":
                continue
            entities = [str(item).strip() for item in (constraint.get("entities") or []) if str(item).strip()]
            if len(entities) != 2:
                continue
            segment_pairs: List[frozenset[str]] = []
            for entity in entities:
                refs = self._segment_endpoints(entity, {}, {
                    str(item.get("id", "")).strip(): item
                    for item in spec.get("primitives", [])
                    if isinstance(item, dict) and item.get("id")
                })
                if refs:
                    segment_pairs.append(frozenset(refs))
            if len(segment_pairs) == 2 and all(pair in triangle_edges for pair in segment_pairs):
                count += 1
        return count

    def _preferred_triangle_base(
        self,
        spec: Dict[str, Any],
        triangle: Sequence[str],
    ) -> Optional[Tuple[str, str]]:
        triangle_set = set(triangle)
        triangle_index = {point_id: index for index, point_id in enumerate(triangle)}
        for relation in spec.get("constraints", []):
            if str(relation.get("type", "")).strip().lower() != "point_outside_polygon":
                continue
            entities = [str(item).strip() for item in (relation.get("entities") or []) if str(item).strip()]
            if len(entities) != 2:
                continue
            point_id = entities[0]
            neighbors = [item for item in self._point_neighbors_from_primitives(spec, point_id) if item in triangle_set]
            neighbors = sorted(neighbors, key=lambda item: triangle_index.get(item, 10_000))
            for first, second in self._combinations_of_two(neighbors):
                if frozenset((first, second)) in {frozenset(edge) for edge in self._polygon_edges(triangle)}:
                    return first, second
        return None

    def _detect_right_vertex(self, spec: Dict[str, Any], triangle: Sequence[str]) -> Optional[str]:
        for primitive in spec.get("primitives", []):
            if str(primitive.get("type", "")).lower() == "right_angle":
                refs = primitive.get("points") or []
                if len(refs) == 3:
                    return str(refs[1])
        for measurement in spec.get("measurements", []):
            if str(measurement.get("type", "")).lower() == "angle":
                if abs(self._coerce_float(measurement.get("value"), default=0.0) - 90.0) <= 1e-2:
                    entities = measurement.get("entities") or []
                    if len(entities) == 3:
                        return str(entities[1])
        return triangle[1] if len(triangle) >= 3 else None

    def _points_adjacent_to_vertex(self, triangle: Sequence[str], vertex: str) -> Tuple[str, str]:
        others = [item for item in triangle if item != vertex]
        if len(others) < 2:
            raise CoordinateSceneError("triangle is missing adjacent points.")
        return others[0], others[1]

    def _measurement_points(
        self,
        entities: Sequence[str],
        point_lookup: Dict[str, List[float]],
        primitive_map: Dict[str, Dict[str, Any]],
    ) -> Optional[Tuple[str, str]]:
        if len(entities) == 2 and entities[0] in point_lookup and entities[1] in point_lookup:
            return entities[0], entities[1]
        if len(entities) == 1:
            segment = self._segment_endpoints(entities[0], point_lookup, primitive_map)
            if segment:
                return segment[0], segment[1]
        return None

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
        return self._ordered_unique(members)

    def _classify_circle_parallel_layout(
        self,
        seg1: Tuple[str, str],
        seg2: Tuple[str, str],
        members: set[str],
        primitive_map: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> Optional[Tuple[str, str, str, str]]:
        primitive_map = primitive_map or {}
        for chord_seg, ext_seg in ((seg1, seg2), (seg2, seg1)):
            if not all(point in members for point in chord_seg):
                continue
            circle_points = [point for point in ext_seg if point in members]
            external_points = [point for point in ext_seg if point not in members]
            if len(circle_points) != 1 or len(external_points) != 1:
                continue

            anchor_b = circle_points[0]
            external_point = external_points[0]
            chord_a, chord_c = chord_seg

            linked_candidates: List[str] = []
            for primitive in primitive_map.values():
                if str(primitive.get("type", "")).strip().lower() != "segment":
                    continue
                refs = [str(item).strip() for item in (primitive.get("points") or []) if str(item).strip()]
                if len(refs) != 2 or external_point not in refs:
                    continue
                other = refs[0] if refs[1] == external_point else refs[1]
                if other in chord_seg:
                    linked_candidates.append(other)
            if linked_candidates:
                chord_c = linked_candidates[0]
                chord_a = chord_seg[0] if chord_seg[1] == chord_c else chord_seg[1]

            return chord_a, chord_c, anchor_b, external_point
        return None

    def _infer_circle_layout_radius(
        self,
        angle_map: Dict[str, float],
        spec: Dict[str, Any],
    ) -> float:
        for measurement in spec.get("measurements", []):
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
            if delta <= EPSILON:
                continue
            radius = value / (2 * math.sin(math.radians(delta) / 2))
            if radius > EPSILON:
                return radius
        return 3.0

    def _find_length_between(
        self,
        spec: Dict[str, Any],
        a: str,
        b: str,
        indexes: Optional[Dict[str, Any]] = None,
    ) -> Optional[float]:
        if indexes is None:
            maybe_indexes = spec.get("_solver_indexes") if isinstance(spec, dict) else None
            if isinstance(maybe_indexes, dict):
                indexes = maybe_indexes
        if isinstance(indexes, dict):
            pair = frozenset((a, b))
            indexed_value = (indexes.get("length_index") or {}).get(pair)
            if indexed_value is not None:
                return float(indexed_value)
        pair = {a, b}
        for measurement in spec.get("measurements", []):
            if str(measurement.get("type", "")).lower() != "length":
                continue
            entities = [str(item) for item in (measurement.get("entities") or [])]
            if len(entities) == 2 and set(entities) == pair:
                return self._coerce_float(measurement.get("value"), default=None)
        return None

    def _constraint_targets(
        self,
        spec: Dict[str, Any],
        relation_type: str,
        expected_len: Optional[int] = None,
        indexes: Optional[Dict[str, Any]] = None,
    ) -> List[str]:
        if isinstance(indexes, dict):
            if relation_type == "midpoint":
                return list((indexes.get("midpoint_segments_by_point") or {}).keys())
            if relation_type == "point_on_segment":
                return list((indexes.get("point_on_segment_by_point") or {}).keys())
            if relation_type == "point_on_circle":
                return list((indexes.get("point_on_circle_by_point") or {}).keys())
            if relation_type == "point_in_polygon":
                return list((indexes.get("point_in_polygon_by_point") or {}).keys())
            if relation_type == "point_outside_polygon":
                return list((indexes.get("point_outside_polygon_by_point") or {}).keys())
            if relation_type == "intersect":
                return list((indexes.get("intersection_segments_by_point") or {}).keys())
            targets = (indexes.get("constraint_targets") or {}).get(relation_type)
            if isinstance(targets, list):
                return list(targets)
        return [
            str(item.get("entities", [None])[0])
            for item in spec.get("constraints", [])
            if str(item.get("type", "")).lower() == relation_type
            and (
                len(item.get("entities") or []) >= 2
                if expected_len is None
                else len(item.get("entities") or []) == expected_len
            )
        ]

    def _find_tangent_for_vertex(
        self,
        spec: Dict[str, Any],
        vertex: str,
        first: str,
        second: str,
    ) -> Optional[float]:
        pair = {first, second}
        for measurement in spec.get("measurements", []):
            if str(measurement.get("type", "")).strip().lower() != "angle":
                continue
            entities = [str(item).strip() for item in (measurement.get("entities") or []) if str(item).strip()]
            if len(entities) != 3 or entities[1] != vertex or {entities[0], entities[2]} != pair:
                continue
            tangent = self._parse_tangent_value(measurement.get("value"))
            if tangent is not None:
                return tangent
            tangent = self._parse_tangent_value(measurement.get("description"))
            if tangent is not None:
                return tangent
            tangent = self._parse_tangent_value(measurement.get("name"))
            if tangent is not None:
                return tangent
        return None

    def _parse_tangent_value(self, raw_value: Any) -> Optional[float]:
        text = str(raw_value or "").strip().lower().replace(" ", "")
        if not text:
            return None

        def _parse_numeric_token(token: str) -> Optional[float]:
            if "/" in token:
                numerator, denominator = token.split("/", 1)
                num_value = self._coerce_float(numerator, default=None)
                den_value = self._coerce_float(denominator, default=None)
                if num_value is None or den_value is None or abs(den_value) <= EPSILON:
                    return None
                return num_value / den_value
            return self._coerce_float(token, default=None)

        arctan_match = re.search(r"arctan\(([-+]?\d+(?:\.\d+)?(?:/[-+]?\d+(?:\.\d+)?)?)\)", text)
        if arctan_match:
            return _parse_numeric_token(arctan_match.group(1))

        tan_match = re.search(r"tan[^=]*=([-+]?\d+(?:\.\d+)?(?:/[-+]?\d+(?:\.\d+)?)?)", text)
        if tan_match:
            return _parse_numeric_token(tan_match.group(1))

        trailing_numeric = re.search(r"([-+]?\d+(?:\.\d+)?(?:/[-+]?\d+(?:\.\d+)?)?)", text)
        if "tan" in text and trailing_numeric:
            return _parse_numeric_token(trailing_numeric.group(1))
        return None

    def _midpoint_targets(self, spec: Dict[str, Any], indexes: Optional[Dict[str, Any]] = None) -> List[str]:
        return self._constraint_targets(spec, "midpoint", indexes=indexes)

    def _midpoint_endpoints(
        self,
        point_id: str,
        spec: Dict[str, Any],
        primitive_map: Dict[str, Dict[str, Any]],
        indexes: Optional[Dict[str, Any]] = None,
    ) -> Optional[Tuple[str, str]]:
        if isinstance(indexes, dict):
            segment_id = (indexes.get("midpoint_segments_by_point") or {}).get(point_id)
            if segment_id:
                return self._segment_endpoints(segment_id, {}, primitive_map)
        for relation in spec.get("constraints", []):
            if str(relation.get("type", "")).lower() != "midpoint":
                continue
            entities = [str(item) for item in (relation.get("entities") or [])]
            if len(entities) == 2 and entities[0] == point_id:
                return self._segment_endpoints(entities[1], {}, primitive_map)
        return None

    def _point_on_segment_targets(self, spec: Dict[str, Any], indexes: Optional[Dict[str, Any]] = None) -> List[str]:
        return self._constraint_targets(spec, "point_on_segment", expected_len=2, indexes=indexes)

    def _point_on_circle_targets(self, spec: Dict[str, Any], indexes: Optional[Dict[str, Any]] = None) -> List[str]:
        return self._constraint_targets(spec, "point_on_circle", expected_len=2, indexes=indexes)

    def _point_in_polygon_targets(self, spec: Dict[str, Any], indexes: Optional[Dict[str, Any]] = None) -> List[str]:
        return self._constraint_targets(spec, "point_in_polygon", expected_len=2, indexes=indexes)

    def _point_outside_polygon_targets(self, spec: Dict[str, Any], indexes: Optional[Dict[str, Any]] = None) -> List[str]:
        return self._constraint_targets(spec, "point_outside_polygon", expected_len=2, indexes=indexes)

    def _intersection_targets(self, spec: Dict[str, Any], indexes: Optional[Dict[str, Any]] = None) -> List[str]:
        return self._constraint_targets(spec, "intersect", expected_len=3, indexes=indexes)

    def _solve_point_on_segment(
        self,
        point_id: str,
        spec: Dict[str, Any],
        coords: Dict[str, List[float]],
        primitive_map: Dict[str, Dict[str, Any]],
        indexes: Optional[Dict[str, Any]] = None,
    ) -> Optional[List[float]]:
        segment_id = None
        if isinstance(indexes, dict):
            segment_id = (indexes.get("point_on_segment_by_point") or {}).get(point_id)
        if not segment_id:
            for relation in spec.get("constraints", []):
                if str(relation.get("type", "")).lower() == "point_on_segment":
                    entities = [str(item) for item in (relation.get("entities") or [])]
                    if len(entities) == 2 and entities[0] == point_id:
                        segment_id = entities[1]
                        break
        if not segment_id:
            return None
        endpoints = self._segment_endpoints(segment_id, coords, primitive_map)
        if not endpoints or endpoints[0] not in coords or endpoints[1] not in coords:
            return None
        a, b = endpoints
        midpoint_targets = set(self._midpoint_targets(spec, indexes=indexes))
        if point_id in midpoint_targets:
            return self._midpoint(coords[a], coords[b])
        total = self._find_length_between(spec, a, b, indexes=indexes)
        from_a = self._find_length_between(spec, a, point_id, indexes=indexes)
        from_b = self._find_length_between(spec, b, point_id, indexes=indexes)
        if total and from_a is not None:
            return self._lerp(coords[a], coords[b], from_a / total)
        if total and from_b is not None:
            return self._lerp(coords[a], coords[b], 1.0 - (from_b / total))
        fold_position = self._solve_fold_point_on_segment(point_id, segment_id, spec, coords)
        if fold_position is not None:
            return fold_position
        return None

    def _solve_fold_point_on_segment(
        self,
        point_id: str,
        segment_id: str,
        spec: Dict[str, Any],
        coords: Dict[str, List[float]],
    ) -> Optional[List[float]]:
        templates = {str(item).strip().lower() for item in (spec.get("templates") or []) if str(item).strip()}
        if "fold" not in templates:
            return None
        segment = self._segment_ref_from_id(segment_id)
        if segment is None:
            return None
        seg_a, seg_b = segment
        if seg_a not in coords or seg_b not in coords:
            return None
        axis_anchor = self._find_fold_axis_anchor_for_point(spec, point_id)
        if axis_anchor is None or axis_anchor not in coords:
            return None
        fold_angle = self._find_reflection_fold_angle(spec, point_id)
        if fold_angle is None:
            return None

        base_start = coords[seg_a]
        base_end = coords[seg_b]
        axis_point = coords[axis_anchor]
        direction = [base_end[0] - base_start[0], base_end[1] - base_start[1]]
        norm = math.hypot(direction[0], direction[1])
        if norm <= EPSILON:
            return None
        unit = [direction[0] / norm, direction[1] / norm]
        candidates: List[List[float]] = []
        for sign in (-1.0, 1.0):
            rotated = self._rotate_vector(unit, sign * fold_angle / 2.0)
            intersection = self._line_intersection(
                axis_point,
                [axis_point[0] + rotated[0], axis_point[1] + rotated[1]],
                base_start,
                base_end,
            )
            if intersection is None:
                continue
            if self._point_on_segment(intersection, base_start, base_end):
                candidates.append([round(intersection[0], 6), round(intersection[1], 6)])

        if not candidates:
            return None
        candidates.sort(key=lambda item: self._segment_ratio(item, base_start, base_end))
        for candidate in candidates:
            ratio = self._segment_ratio(candidate, base_start, base_end)
            if 0.1 <= ratio <= 0.9:
                return candidate
        return candidates[0]

    def _find_fold_axis_anchor_for_point(self, spec: Dict[str, Any], point_id: str) -> Optional[str]:
        for point in spec.get("points", []):
            if str(point.get("id", "")).strip() == point_id:
                continue
            derived = point.get("derived")
            if not isinstance(derived, dict):
                continue
            if str(derived.get("type", "")).strip().lower() != "reflect_point":
                continue
            axis = [str(item).strip() for item in (derived.get("axis") or []) if str(item).strip()]
            if point_id in axis and len(axis) == 2:
                return axis[0] if axis[1] == point_id else axis[1]
        return None

    def _find_reflection_fold_angle(self, spec: Dict[str, Any], axis_point: str) -> Optional[float]:
        for primitive in spec.get("primitives", []):
            primitive_type = str(primitive.get("type", "")).strip().lower()
            if primitive_type not in {"right_angle", "angle"}:
                continue
            refs = [str(item).strip() for item in (primitive.get("points") or []) if str(item).strip()]
            if len(refs) != 3 or refs[1] != axis_point:
                continue
            if self._is_reflection_pair(spec, axis_point, refs[0], refs[2]):
                return math.pi / 2.0 if primitive_type == "right_angle" else None

        for measurement in spec.get("measurements", []):
            if str(measurement.get("type", "")).strip().lower() != "angle":
                continue
            refs = [str(item).strip() for item in (measurement.get("entities") or []) if str(item).strip()]
            if len(refs) != 3 or refs[1] != axis_point:
                continue
            if not self._is_reflection_pair(spec, axis_point, refs[0], refs[2]):
                continue
            angle_value = self._coerce_float(measurement.get("value"), default=None)
            if angle_value is not None:
                return math.radians(angle_value)
        return None

    def _is_reflection_pair(self, spec: Dict[str, Any], axis_point: str, first: str, second: str) -> bool:
        for point in spec.get("points", []):
            point_id = str(point.get("id", "")).strip()
            if point_id not in {first, second}:
                continue
            derived = point.get("derived")
            if not isinstance(derived, dict):
                continue
            if str(derived.get("type", "")).strip().lower() != "reflect_point":
                continue
            source = str(derived.get("source", "")).strip()
            axis = [str(item).strip() for item in (derived.get("axis") or []) if str(item).strip()]
            if axis_point in axis and {point_id, source} == {first, second}:
                return True
        return False

    def _segment_ref_from_id(self, segment_id: str) -> Optional[Tuple[str, str]]:
        token = str(segment_id or "").strip()
        if token.startswith("seg_"):
            token = token[4:]
        refs = re.findall(r"[A-Za-z]\d*", token)
        if len(refs) == 2 and "".join(refs) == token:
            return refs[0], refs[1]
        return None

    def _rotate_vector(self, vector: Sequence[float], angle_radians: float) -> List[float]:
        cos_theta = math.cos(angle_radians)
        sin_theta = math.sin(angle_radians)
        return [
            vector[0] * cos_theta - vector[1] * sin_theta,
            vector[0] * sin_theta + vector[1] * cos_theta,
        ]

    def _segment_ratio(
        self,
        point: Sequence[float],
        start: Sequence[float],
        end: Sequence[float],
    ) -> float:
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        denom = dx * dx + dy * dy
        if denom <= EPSILON:
            return 0.0
        return ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / denom

    def _solve_point_on_circle(
        self,
        point_id: str,
        spec: Dict[str, Any],
        coords: Dict[str, List[float]],
        primitive_map: Dict[str, Dict[str, Any]],
        circle_angle_state: Dict[str, int],
        indexes: Optional[Dict[str, Any]] = None,
    ) -> Optional[List[float]]:
        circle_id = None
        if isinstance(indexes, dict):
            circle_id = (indexes.get("point_on_circle_by_point") or {}).get(point_id)
        if not circle_id:
            for relation in spec.get("constraints", []):
                if str(relation.get("type", "")).lower() == "point_on_circle":
                    entities = [str(item) for item in (relation.get("entities") or [])]
                    if len(entities) == 2 and entities[0] == point_id:
                        circle_id = entities[1]
                        break
        if not circle_id:
            return None
        circle = primitive_map.get(circle_id)
        if not circle:
            return None
        center = str(circle.get("center", "")).strip()
        radius_point = str(circle.get("radius_point", "")).strip()
        if center not in coords or radius_point not in coords:
            return None
        center_coord = coords[center]
        radius = self._distance(center_coord, coords[radius_point])
        indexed_lengths = None
        if isinstance(indexes, dict):
            indexed_lengths = (indexes.get("length_measurements_by_point") or {}).get(point_id)

        if indexed_lengths is None:
            indexed_lengths = []
            for measurement in spec.get("measurements", []):
                if str(measurement.get("type", "")).lower() != "length":
                    continue
                entities = [str(item) for item in (measurement.get("entities") or [])]
                if len(entities) != 2 or point_id not in entities:
                    continue
                other_point = entities[0] if entities[1] == point_id else entities[1]
                chord_length = self._coerce_float(measurement.get("value"), default=None)
                if chord_length is None:
                    continue
                indexed_lengths.append((other_point, chord_length))

        for other_point, chord_length in indexed_lengths:
            if other_point not in coords:
                continue
            intersections = self._circle_circle_intersections(
                center_coord,
                radius,
                coords[other_point],
                chord_length,
            )
            if intersections:
                choice_index = circle_angle_state.get(point_id, 0) % len(intersections)
                return intersections[choice_index]
        angle_deg = 50.0 + circle_angle_state.get(point_id, 0) * 65.0
        radians = math.radians(angle_deg)
        return [round(center_coord[0] + radius * math.cos(radians), 6), round(center_coord[1] + radius * math.sin(radians), 6)]

    def _solve_point_in_polygon(
        self,
        point_id: str,
        spec: Dict[str, Any],
        coords: Dict[str, List[float]],
        primitive_map: Dict[str, Dict[str, Any]],
        indexes: Optional[Dict[str, Any]] = None,
    ) -> Optional[List[float]]:
        polygon_id = None
        if isinstance(indexes, dict):
            polygon_id = (indexes.get("point_in_polygon_by_point") or {}).get(point_id)
        if not polygon_id:
            for relation in spec.get("constraints", []):
                if str(relation.get("type", "")).lower() != "point_in_polygon":
                    continue
                entities = [str(item) for item in (relation.get("entities") or [])]
                if len(entities) == 2 and entities[0] == point_id:
                    polygon_id = entities[1]
                    break
        if not polygon_id:
            return None
        polygon = primitive_map.get(polygon_id)
        if not polygon:
            return None
        refs = [str(item).strip() for item in (polygon.get("points") or []) if str(item).strip()]
        if len(refs) < 3 or any(ref not in coords for ref in refs):
            return None
        polygon_coords = [coords[ref] for ref in refs]
        centroid_x = sum(float(coord[0]) for coord in polygon_coords) / len(polygon_coords)
        centroid_y = sum(float(coord[1]) for coord in polygon_coords) / len(polygon_coords)
        anchor = polygon_coords[0]
        position = [
            round(centroid_x * 0.72 + float(anchor[0]) * 0.28, 6),
            round(centroid_y * 0.72 + float(anchor[1]) * 0.28, 6),
        ]
        if self._point_in_polygon(position, polygon_coords):
            return position
        return [round(centroid_x, 6), round(centroid_y, 6)]

    def _solve_point_outside_polygon(
        self,
        point_id: str,
        spec: Dict[str, Any],
        coords: Dict[str, List[float]],
        primitive_map: Dict[str, Dict[str, Any]],
        indexes: Optional[Dict[str, Any]] = None,
    ) -> Optional[List[float]]:
        polygon_id = None
        if isinstance(indexes, dict):
            polygon_id = (indexes.get("point_outside_polygon_by_point") or {}).get(point_id)
        if not polygon_id:
            for relation in spec.get("constraints", []):
                if str(relation.get("type", "")).lower() != "point_outside_polygon":
                    continue
                entities = [str(item) for item in (relation.get("entities") or [])]
                if len(entities) == 2 and entities[0] == point_id:
                    polygon_id = entities[1]
                    break
        if not polygon_id:
            return None
        polygon = primitive_map.get(polygon_id)
        if not polygon:
            return None
        refs = [str(item).strip() for item in (polygon.get("points") or []) if str(item).strip()]
        if len(refs) < 3 or any(ref not in coords for ref in refs):
            return None
        polygon_coords = [coords[ref] for ref in refs]
        centroid = [
            sum(float(coord[0]) for coord in polygon_coords) / len(polygon_coords),
            sum(float(coord[1]) for coord in polygon_coords) / len(polygon_coords),
        ]

        best_edge: Optional[Tuple[str, str]] = None
        best_score = -1
        point_neighbors = self._point_neighbors_from_primitives(spec, point_id, indexes=indexes)
        for first, second in self._polygon_edges(refs):
            score = int(first in point_neighbors) + int(second in point_neighbors)
            if score > best_score:
                best_score = score
                best_edge = (first, second)
        if best_edge is None:
            return None

        edge_midpoint = self._midpoint(coords[best_edge[0]], coords[best_edge[1]])
        outward = [
            edge_midpoint[0] - centroid[0],
            edge_midpoint[1] - centroid[1],
        ]
        outward_norm = math.hypot(outward[0], outward[1]) or 1.0
        edge_length = self._distance(coords[best_edge[0]], coords[best_edge[1]]) or 1.0
        distance = max(edge_length * 0.45, 1.2)
        candidate = [
            round(edge_midpoint[0] + outward[0] / outward_norm * distance, 6),
            round(edge_midpoint[1] + outward[1] / outward_norm * distance, 6),
        ]
        if not self._point_in_polygon(candidate, polygon_coords):
            return candidate
        return [
            round(edge_midpoint[0] + outward[0] / outward_norm * (distance * 1.6), 6),
            round(edge_midpoint[1] + outward[1] / outward_norm * (distance * 1.6), 6),
        ]

    def _solve_intersection_point(
        self,
        point_id: str,
        spec: Dict[str, Any],
        coords: Dict[str, List[float]],
        primitive_map: Dict[str, Dict[str, Any]],
        indexes: Optional[Dict[str, Any]] = None,
    ) -> Optional[List[float]]:
        candidates: List[Tuple[str, str]] = []
        if isinstance(indexes, dict):
            pair = (indexes.get("intersection_segments_by_point") or {}).get(point_id)
            if isinstance(pair, tuple) and len(pair) == 2:
                candidates.append(pair)
        if not candidates:
            for relation in spec.get("constraints", []):
                if str(relation.get("type", "")).lower() != "intersect":
                    continue
                entities = [str(item) for item in (relation.get("entities") or [])]
                if len(entities) != 3 or entities[0] != point_id:
                    continue
                candidates.append((entities[1], entities[2]))

        for seg_a, seg_b in candidates:
            seg1 = self._segment_endpoints(seg_a, coords, primitive_map)
            seg2 = self._segment_endpoints(seg_b, coords, primitive_map)
            if not seg1 or not seg2:
                continue
            if seg1[0] not in coords or seg1[1] not in coords or seg2[0] not in coords or seg2[1] not in coords:
                continue
            return self._line_intersection(coords[seg1[0]], coords[seg1[1]], coords[seg2[0]], coords[seg2[1]])
        return None

    def _solve_parallel_endpoint(
        self,
        point_id: str,
        spec: Dict[str, Any],
        coords: Dict[str, List[float]],
        primitive_map: Dict[str, Dict[str, Any]],
        indexes: Optional[Dict[str, Any]] = None,
    ) -> Optional[List[float]]:
        parallel_pairs = None
        if isinstance(indexes, dict):
            parallel_pairs = indexes.get("parallel_segment_pairs")
        if not isinstance(parallel_pairs, list):
            parallel_pairs = [
                tuple(str(item).strip() for item in (relation.get("entities") or [])[:2])
                for relation in spec.get("constraints", [])
                if str(relation.get("type", "")).lower() == "parallel"
                and len(relation.get("entities") or []) == 2
            ]

        for seg1_id, seg2_id in parallel_pairs:
            seg1 = self._segment_endpoints(seg1_id, coords, primitive_map)
            seg2 = self._segment_endpoints(seg2_id, coords, primitive_map)
            if not seg1 or not seg2:
                continue

            for target_seg, ref_seg in ((seg1, seg2), (seg2, seg1)):
                if point_id not in target_seg:
                    continue
                anchor = target_seg[0] if target_seg[1] == point_id else target_seg[1]
                if anchor not in coords or ref_seg[0] not in coords or ref_seg[1] not in coords:
                    continue

                target_length = self._find_length_between(spec, anchor, point_id, indexes=indexes)
                if target_length is None:
                    continue

                ref_start = coords[ref_seg[0]]
                ref_end = coords[ref_seg[1]]
                dx = ref_end[0] - ref_start[0]
                dy = ref_end[1] - ref_start[1]
                ref_len = math.hypot(dx, dy)
                if ref_len <= EPSILON:
                    continue

                return [
                    round(coords[anchor][0] + dx / ref_len * target_length, 6),
                    round(coords[anchor][1] + dy / ref_len * target_length, 6),
                ]
        return None

    def _segment_endpoints(self, entity: str, point_lookup_or_coords: Dict[str, Any], primitive_map: Dict[str, Dict[str, Any]]) -> Optional[Tuple[str, str]]:
        primitive = primitive_map.get(entity)
        if primitive and str(primitive.get("type", "")).lower() == "segment":
            refs = [str(item) for item in (primitive.get("points") or [])]
            if len(refs) == 2:
                return refs[0], refs[1]
        known_points = list(point_lookup_or_coords.keys())
        suffix = entity[4:] if entity.startswith("seg_") else entity
        for first in known_points:
            for second in known_points:
                if first == second:
                    continue
                if suffix == f"{first}{second}":
                    return first, second
        return None

    def _point_lookup(self, coordinate_scene: Dict[str, Any]) -> Dict[str, List[float]]:
        lookup: Dict[str, List[float]] = {}
        for point in coordinate_scene.get("points", []):
            point_id = str(point.get("id", "")).strip()
            coord = point.get("coord")
            if point_id and isinstance(coord, list) and len(coord) == 2:
                lookup[point_id] = [float(coord[0]), float(coord[1])]
        return lookup

    def _normalize_points_for_scene_graph(self, point_lookup: Dict[str, List[float]]) -> Dict[str, List[float]]:
        if not point_lookup:
            return {}
        xs = [coord[0] for coord in point_lookup.values()]
        ys = [coord[1] for coord in point_lookup.values()]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        width = max(max_x - min_x, 1.0)
        height = max(max_y - min_y, 1.0)
        padding = 0.08
        normalized: Dict[str, List[float]] = {}
        for point_id, coord in point_lookup.items():
            nx = padding + ((coord[0] - min_x) / width) * (1.0 - 2 * padding)
            ny = 1.0 - (padding + ((coord[1] - min_y) / height) * (1.0 - 2 * padding))
            normalized[point_id] = [round(nx, 6), round(ny, 6)]
        return normalized

    def _display_bool(self, display_block: Dict[str, Any], entity_id: str, key: str, default: bool) -> bool:
        return bool(self._display_value(display_block, entity_id, key, default))

    def _display_value(self, display_block: Dict[str, Any], entity_id: str, key: str, default: Any = None) -> Any:
        payload = display_block.get(entity_id)
        if not isinstance(payload, dict):
            return default
        return payload.get(key, default)

    def _validation_error_message(self, report: Dict[str, Any]) -> str:
        parts: List[str] = []
        if report.get("missing_entities"):
            parts.append("missing entities: " + ", ".join(report["missing_entities"]))
        if report.get("unsupported_relations"):
            parts.append("unsupported relations: " + ", ".join(report["unsupported_relations"]))
        if report.get("failed_checks"):
            snippets = []
            for item in report["failed_checks"][:4]:
                snippets.append(str(item.get("message") or item.get("type") or item))
            parts.append("failed checks: " + "; ".join(snippets))
        if report.get("solver_trace"):
            parts.append("solver trace: " + " | ".join(report["solver_trace"][-4:]))
        return " ; ".join(parts) if parts else "coordinate scene validation failed."

    def _fmt_num(self, value: float) -> str:
        if abs(value - round(value)) < 1e-9:
            return str(int(round(value)))
        return f"{value:.6f}".rstrip("0").rstrip(".")

    def _coerce_float(self, value: Any, default: Optional[float]) -> Optional[float]:
        try:
            if value is None:
                return default
            return float(value)
        except (TypeError, ValueError):
            return default

    def _distance(self, a: Sequence[float], b: Sequence[float]) -> float:
        return math.hypot(float(a[0]) - float(b[0]), float(a[1]) - float(b[1]))

    def _midpoint(self, a: Sequence[float], b: Sequence[float]) -> List[float]:
        return [round((float(a[0]) + float(b[0])) / 2.0, 6), round((float(a[1]) + float(b[1])) / 2.0, 6)]

    def _lerp(self, a: Sequence[float], b: Sequence[float], t: float) -> List[float]:
        return [round(float(a[0]) + (float(b[0]) - float(a[0])) * float(t), 6), round(float(a[1]) + (float(b[1]) - float(a[1])) * float(t), 6)]

    def _line_intersection(self, a1: Sequence[float], a2: Sequence[float], b1: Sequence[float], b2: Sequence[float]) -> Optional[List[float]]:
        x1, y1 = a1
        x2, y2 = a2
        x3, y3 = b1
        x4, y4 = b2
        denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        if abs(denom) <= EPSILON:
            return None
        px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom
        py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom
        return [round(float(px), 6), round(float(py), 6)]

    def _circle_circle_intersections(
        self,
        center_a: Sequence[float],
        radius_a: float,
        center_b: Sequence[float],
        radius_b: float,
    ) -> List[List[float]]:
        x0, y0 = float(center_a[0]), float(center_a[1])
        x1, y1 = float(center_b[0]), float(center_b[1])
        dx = x1 - x0
        dy = y1 - y0
        distance = math.hypot(dx, dy)
        if distance <= EPSILON:
            return []
        if distance > radius_a + radius_b + EPSILON:
            return []
        if distance < abs(radius_a - radius_b) - EPSILON:
            return []

        a = (radius_a ** 2 - radius_b ** 2 + distance ** 2) / (2.0 * distance)
        h_sq = radius_a ** 2 - a ** 2
        if h_sq < -EPSILON:
            return []
        h = math.sqrt(max(h_sq, 0.0))

        xm = x0 + a * dx / distance
        ym = y0 + a * dy / distance
        rx = -dy * (h / distance)
        ry = dx * (h / distance)

        intersections = [
            [round(xm + rx, 6), round(ym + ry, 6)],
        ]
        second = [round(xm - rx, 6), round(ym - ry, 6)]
        if second != intersections[0]:
            intersections.append(second)
        return intersections

    def _point_on_segment(self, p: Sequence[float], a: Sequence[float], b: Sequence[float]) -> bool:
        cross = (float(p[0]) - float(a[0])) * (float(b[1]) - float(a[1])) - (float(p[1]) - float(a[1])) * (float(b[0]) - float(a[0]))
        if abs(cross) > 1e-3:
            return False
        dot = (float(p[0]) - float(a[0])) * (float(b[0]) - float(a[0])) + (float(p[1]) - float(a[1])) * (float(b[1]) - float(a[1]))
        if dot < -1e-3:
            return False
        sq_len = (float(b[0]) - float(a[0])) ** 2 + (float(b[1]) - float(a[1])) ** 2
        return dot - sq_len <= 1e-3

    def _point_in_polygon(self, p: Sequence[float], polygon: Sequence[Sequence[float]]) -> bool:
        if len(polygon) < 3:
            return False
        sign = None
        px, py = float(p[0]), float(p[1])
        for index in range(len(polygon)):
            a = polygon[index]
            b = polygon[(index + 1) % len(polygon)]
            cross = (float(b[0]) - float(a[0])) * (py - float(a[1])) - (float(b[1]) - float(a[1])) * (px - float(a[0]))
            if abs(cross) <= 1e-6:
                continue
            current = cross > 0
            if sign is None:
                sign = current
            elif sign != current:
                return False
        return True

    def _are_collinear(self, points: Sequence[Sequence[float]]) -> bool:
        if len(points) < 3:
            return True
        a, b = points[0], points[1]
        for point in points[2:]:
            area = (float(b[0]) - float(a[0])) * (float(point[1]) - float(a[1])) - (float(b[1]) - float(a[1])) * (float(point[0]) - float(a[0]))
            if abs(area) > 1e-3:
                return False
        return True

    def _is_parallel(self, a1: Sequence[float], a2: Sequence[float], b1: Sequence[float], b2: Sequence[float]) -> bool:
        ax, ay = float(a2[0]) - float(a1[0]), float(a2[1]) - float(a1[1])
        bx, by = float(b2[0]) - float(b1[0]), float(b2[1]) - float(b1[1])
        return abs(ax * by - ay * bx) <= 1e-3

    def _is_perpendicular(self, a1: Sequence[float], a2: Sequence[float], b1: Sequence[float], b2: Sequence[float]) -> bool:
        ax, ay = float(a2[0]) - float(a1[0]), float(a2[1]) - float(a1[1])
        bx, by = float(b2[0]) - float(b1[0]), float(b2[1]) - float(b1[1])
        return abs(ax * bx + ay * by) <= 1e-3

    def _angle_degrees(self, a: Sequence[float], vertex: Sequence[float], b: Sequence[float]) -> float:
        va = (float(a[0]) - float(vertex[0]), float(a[1]) - float(vertex[1]))
        vb = (float(b[0]) - float(vertex[0]), float(b[1]) - float(vertex[1]))
        norm_a = math.hypot(*va)
        norm_b = math.hypot(*vb)
        if norm_a <= EPSILON or norm_b <= EPSILON:
            return 0.0
        cos_theta = max(-1.0, min(1.0, (va[0] * vb[0] + va[1] * vb[1]) / (norm_a * norm_b)))
        return math.degrees(math.acos(cos_theta))

    def _reflect_point(self, point: Sequence[float], axis_a: Sequence[float], axis_b: Sequence[float]) -> List[float]:
        ax, ay = float(axis_a[0]), float(axis_a[1])
        bx, by = float(axis_b[0]), float(axis_b[1])
        px, py = float(point[0]), float(point[1])
        vx, vy = bx - ax, by - ay
        denom = vx * vx + vy * vy
        if denom <= EPSILON:
            raise CoordinateSceneError("reflection axis has zero length.")
        t = ((px - ax) * vx + (py - ay) * vy) / denom
        proj_x = ax + t * vx
        proj_y = ay + t * vy
        return [round(2 * proj_x - px, 6), round(2 * proj_y - py, 6)]
