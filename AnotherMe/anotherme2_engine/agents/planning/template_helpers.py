"""
Canonical Manim helper snippets used as retrieval references.

These helpers are prompt/reference assets. Generated Manim code may inline or
adapt them, but should not import this module at runtime.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List


def helper_catalog() -> List[Dict[str, Any]]:
    helper_path = str(Path(__file__).resolve())
    return [
        {
            "template_id": "helper.make_angle_mark",
            "file_path": helper_path,
            "scene_name": "make_angle_mark",
            "summary": "Create a reusable angle marker with optional MathTex label.",
            "tags": ["angle", "angle-mark", "label", "geometry"],
            "primitives": ["segment", "angle"],
            "motions": ["highlight"],
            "helpers": ["make_angle_mark"],
            "applicable_when": "Use when the scene needs a labeled angle arc or two equal angle markers.",
            "avoid_copying": "Do not copy example points, labels, or scene flow; adapt only the helper logic.",
            "snippet_regions": [{"name": "make_angle_mark", "kind": "helper"}],
            "excerpt": """def make_angle_mark(a, o, b, radius=0.45, color=YELLOW, label_text=None, label_buff=0.16):
    line1 = Line(o, a)
    line2 = Line(o, b)
    angle = Angle(line1, line2, radius=radius, color=color)
    if label_text is None:
        return angle, None
    theta1 = np.arctan2((a - o)[1], (a - o)[0])
    theta2 = np.arctan2((b - o)[1], (b - o)[0])
    if theta2 < theta1:
        theta2 += TAU
    mid_theta = (theta1 + theta2) / 2
    label = MathTex(label_text, color=color).scale(0.8)
    label.move_to(o + np.array([np.cos(mid_theta), np.sin(mid_theta), 0]) * (radius + label_buff))
    return angle, label""",
        },
        {
            "template_id": "helper.right_angle_marker",
            "file_path": helper_path,
            "scene_name": "right_angle_marker",
            "summary": "Create a stable custom right-angle marker from three points.",
            "tags": ["right-angle", "perpendicular", "marker", "geometry"],
            "primitives": ["segment", "right_angle"],
            "motions": ["highlight"],
            "helpers": ["right_angle_marker"],
            "applicable_when": "Use when RightAngle placement is unstable or when the foot point must be explicit.",
            "avoid_copying": "Only reuse the marker construction pattern; compute the target points from the current problem.",
            "snippet_regions": [{"name": "right_angle_marker", "kind": "helper"}],
            "excerpt": """def right_angle_marker(vertex, point_a, point_b, size=0.18, color=YELLOW):
    direction_a = normalize(point_a - vertex)
    direction_b = normalize(point_b - vertex)
    return VMobject(color=color, stroke_width=4).set_points_as_corners(
        [
            vertex + direction_a * size,
            vertex + (direction_a + direction_b) * size,
            vertex + direction_b * size,
        ]
    )""",
        },
        {
            "template_id": "helper.segment_tick",
            "file_path": helper_path,
            "scene_name": "segment_tick",
            "summary": "Create a midpoint tick mark for equal-length segments.",
            "tags": ["equal-length", "segment", "tick", "geometry"],
            "primitives": ["segment"],
            "motions": ["highlight"],
            "helpers": ["segment_tick"],
            "applicable_when": "Use when showing congruent sides, equal tangents, or equal constructed lengths.",
            "avoid_copying": "Only reuse the tick-mark construction; recompute midpoint and direction from the active segment.",
            "snippet_regions": [{"name": "segment_tick", "kind": "helper"}],
            "excerpt": """def segment_tick(point_a, point_b, tick_size=0.14, color=YELLOW):
    midpoint = (point_a + point_b) / 2
    direction = normalize(point_b - point_a)
    normal = np.array([-direction[1], direction[0], 0])
    return Line(
        midpoint - normal * tick_size / 2,
        midpoint + normal * tick_size / 2,
        color=color,
        stroke_width=4,
    )""",
        },
        {
            "template_id": "helper.tangent_points",
            "file_path": helper_path,
            "scene_name": "tangent_points",
            "summary": "Compute the two tangent points from an exterior point to a circle.",
            "tags": ["circle", "tangent", "exterior-point", "geometry"],
            "primitives": ["circle", "segment"],
            "motions": ["highlight"],
            "helpers": ["tangent_points"],
            "applicable_when": "Use when scenes involve tangent-length theorem or angle between two tangents.",
            "avoid_copying": "Only reuse the computation pattern; current center, radius, and exterior point must come from the active problem.",
            "snippet_regions": [{"name": "tangent_points", "kind": "helper"}],
            "excerpt": """def tangent_points(center, radius, point):
    vector = point - center
    distance = np.linalg.norm(vector)
    theta = np.arctan2(vector[1], vector[0])
    phi = np.arccos(radius / distance)
    return (
        center + radius * np.array([np.cos(theta + phi), np.sin(theta + phi), 0]),
        center + radius * np.array([np.cos(theta - phi), np.sin(theta - phi), 0]),
    )""",
        },
        {
            "template_id": "helper.reflection_rotation_scale",
            "file_path": helper_path,
            "scene_name": "transformation_helpers",
            "summary": "Reference formulas for reflection, rotation, translation, and homothety point updates.",
            "tags": ["reflection", "rotation", "translation", "homothety", "transform"],
            "primitives": ["segment", "polygon"],
            "motions": ["reflection", "rotation", "translation", "homothety", "transform"],
            "helpers": ["reflect_point", "rotate_point", "translate_point", "homothety_point"],
            "applicable_when": "Use when a construction changes point positions instead of only highlighting static geometry.",
            "avoid_copying": "Reuse only the point-update formulas and helper naming style; preserve the current problem's coordinates and step order.",
            "snippet_regions": [{"name": "transformation_helpers", "kind": "helper"}],
            "excerpt": """reflected = np.array([x, -y, 0])
rotated = np.array([
    ox + (px - ox) * np.cos(theta) - (py - oy) * np.sin(theta),
    oy + (px - ox) * np.sin(theta) + (py - oy) * np.cos(theta),
    0,
])
translated = point + vector
scaled = center + k * (point - center)""",
        },
    ]
