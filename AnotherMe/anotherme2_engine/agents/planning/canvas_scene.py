"""
画布场景管理 - 管理几何区和公式区布局，输出稳定布局快照
"""
from dataclasses import dataclass, asdict
from typing import Dict, List, Optional


@dataclass
class CanvasElement:
    id: str
    kind: str
    content: str
    area: str
    x: float
    y: float
    width: float
    height: float
    order: int = 0
    visible: bool = True


class FormulaLayoutManager:
    """管理右侧公式区布局，避免公式互相覆盖。"""

    def __init__(self, formula_area: List[float], vertical_gap: float = 0.02, max_slots: int = 8):
        self.formula_area = formula_area
        self.vertical_gap = vertical_gap
        self.max_slots = max(1, int(max_slots))

    def _slot_box(self, slot_index: int) -> List[float]:
        left, top, right, bottom = self.formula_area
        slot_index = max(0, min(slot_index, self.max_slots - 1))
        total_height = max(bottom - top, 0.24)
        total_gap = self.vertical_gap * (self.max_slots - 1)
        slot_height = max((total_height - total_gap) / self.max_slots, 0.06)
        slot_top = top + slot_index * (slot_height + self.vertical_gap)
        slot_bottom = min(slot_top + slot_height, bottom)
        return [left, slot_top, right, slot_bottom]

    def place_formula(
        self,
        existing_elements: List[CanvasElement],
        element_id: str,
        content: str,
        preferred_height: float = 0.08,
        slot_index: int = 0,
    ) -> CanvasElement:
        left, slot_top, right, slot_bottom = self._slot_box(slot_index)
        height = min(preferred_height, max(slot_bottom - slot_top, 0.06))

        return CanvasElement(
            id=element_id,
            kind="formula",
            content=content,
            area="formula",
            x=left,
            y=slot_top,
            width=right - left,
            height=height,
            order=slot_index,
        )


class CanvasScene:
    """用于几何区/公式区布局管理，并输出稳定布局快照。"""

    def __init__(
        self,
        max_formula_slots: int = 8,
        geometry_area: Optional[List[float]] = None,
        formula_area: Optional[List[float]] = None,
    ):
        self.elements: Dict[str, CanvasElement] = {}
        # 左侧题图区稍微缩小，放在左侧中间；右侧公式区加宽以承载更多公式。
        self.geometry_area = geometry_area or [0.02, 0.08, 0.56, 0.92]
        self.formula_area = formula_area or [0.60, 0.08, 0.96, 0.92]
        self.formula_layout = FormulaLayoutManager(self.formula_area, max_slots=max_formula_slots)

    def add_element(self, element: CanvasElement) -> None:
        self.elements[element.id] = element

    def delete_element(self, element_id: str) -> None:
        if element_id in self.elements:
            del self.elements[element_id]

    def clear_formula_elements(self) -> None:
        for element_id in [e.id for e in self.elements.values() if e.area == "formula"]:
            del self.elements[element_id]

    def reserve_formula_block(
        self,
        element_id: str,
        content: str,
        preferred_height: float = 0.08,
        slot_index: int = 0,
    ) -> CanvasElement:
        element = self.formula_layout.place_formula(
            existing_elements=list(self.elements.values()),
            element_id=element_id,
            content=content,
            preferred_height=preferred_height,
            slot_index=slot_index,
        )
        self.add_element(element)
        return element

    def reserve_step_formula_blocks(
        self,
        step_id: int,
        formula_items: List[str],
        reset_formula_area: bool = False,
    ) -> List[CanvasElement]:
        """为每个步骤预留固定槽位，并替换旧公式避免重叠累积。"""
        # 每个步骤都按固定槽位重建右侧公式区，保证“新公式上来即替换旧公式”。
        if reset_formula_area:
            self.clear_formula_elements()

        elements: List[CanvasElement] = []
        slot_count = self.formula_layout.max_slots
        for index, item in enumerate(formula_items[:slot_count], start=1):
            safe_item = item.strip() or f"step_{step_id}_formula_{index}"
            element_id = f"formula_slot_{index}"
            element = self.formula_layout.place_formula(
                existing_elements=list(self.elements.values()),
                element_id=element_id,
                content=safe_item,
                slot_index=index - 1,
            )
            self.add_element(element)
            elements.append(element)
        return elements

    def get_layout_snapshot(self) -> Dict[str, object]:
        """返回当前布局快照，供动画渲染使用。"""
        sorted_elements = sorted(self.elements.values(), key=lambda e: (e.area, e.order, e.id))
        return {
            "geometry_area": self.geometry_area,
            "formula_area": self.formula_area,
            "elements": [asdict(element) for element in sorted_elements],
        }

    def get_formula_snapshot(self) -> List[Dict[str, object]]:
        sorted_formulas = sorted(
            (e for e in self.elements.values() if e.area == "formula"),
            key=lambda e: (e.order, e.id),
        )
        return [asdict(element) for element in sorted_formulas]
