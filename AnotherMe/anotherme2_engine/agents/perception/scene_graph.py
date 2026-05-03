"""
场景图数据结构 - 定义几何场景的点、线、对象、角度等数据结构
"""
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass
class Point:
    id: str
    pos: List[float]


@dataclass
class Line:
    id: str
    type: str
    points: List[str]
    attrs: Dict[str, Any]


@dataclass
class Object:
    id: str
    type: str
    points: Optional[List[str]] = None
    center: Optional[str] = None
    radius_point: Optional[str] = None
    attrs: Optional[Dict[str, Any]] = None


@dataclass
class Angle:
    id: str
    points: List[str]
    value: Optional[float]
    attrs: Dict[str, Any]


@dataclass
class Incidence:
    type: str
    entities: List[str]
    attrs: Dict[str, Any]


@dataclass
class Relation:
    type: str
    entities: List[str]
    attrs: Dict[str, Any]


class SceneGraph:

    def __init__(self, data: dict):

        self.points: Dict[str, Point] = {
            k: Point(k, v["pos"])
            for k, v in data.get("points", {}).items()
        }

        self.lines: Dict[str, Line] = {
            l["id"]: Line(
                l["id"],
                l["type"],
                l["points"],
                {
                    k: v for k, v in l.items()
                    if k not in {"id", "type", "points"}
                }
            )
            for l in data.get("lines", [])
        }

        self.objects: Dict[str, Object] = {
            o["id"]: Object(
                id=o["id"],
                type=o["type"],
                points=o.get("points"),
                center=o.get("center"),
                radius_point=o.get("radius_point"),
                attrs={
                    k: v for k, v in o.items()
                    if k not in {"id", "type", "points", "center", "radius_point"}
                },
            )
            for o in data.get("objects", [])
        }

        self.angles: Dict[str, Angle] = {
            a["id"]: Angle(
                a["id"],
                a["points"],
                a.get("value"),
                {
                    k: v for k, v in a.items()
                    if k not in {"id", "points", "value"}
                }
            )
            for a in data.get("angles", [])
        }

        self.incidence: List[Incidence] = [
            Incidence(
                i["type"],
                i["entities"],
                {
                    k: v for k, v in i.items()
                    if k not in {"type", "entities"}
                }
            )
            for i in data.get("incidence", [])
        ]

        self.relations: List[Relation] = [
            Relation(
                r["type"],
                r["entities"],
                {
                    k: v for k, v in r.items()
                    if k not in {"type", "entities"}
                }
            )
            for r in data.get("relations", [])
        ]
