"""
代码修复智能体 - 负责在渲染前修复常见 Manim 代码问题
"""
import re
from typing import Dict, Any, Optional, List, Tuple

from ..foundation.base_agent import BaseAgent


class RepairAgent(BaseAgent):
    """代码修复智能体"""

    def __init__(self, config: Dict[str, Any], llm: Optional[Any] = None):
        super().__init__(config, llm)
        self.color_fallback_map = config.get(
            "color_fallback_map",
            {
                "CYAN": "BLUE",
                "LIGHTBLUE": "BLUE",
                "ORANGE_RED": "ORANGE",
            },
        )
        self.frame_width = float(config.get("frame_width", 14.222))
        self.frame_height = float(config.get("frame_height", 8.0))
        self.safe_margin = float(config.get("safe_margin", 0.4))
        self.right_panel_x_min = float(config.get("right_panel_x_min", 1.8))

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """修复生成的 Manim 代码中的常见错误"""
        project = state.get("project")
        if project is not None and getattr(project, "status", "") == "failed":
            return state

        manim_code = state.get("metadata", {}).get("manim_code", "")
        if not manim_code:
            state["messages"].append({
                "role": "assistant",
                "content": "警告：RepairAgent 未找到可修复的 Manim 代码"
            })
            state["current_step"] = "repair_skipped"
            return state

        fixed_code, fixes = self._apply_rule_based_fixes(manim_code)

        # 可选 LLM 修复（默认关闭，避免不稳定改写）
        if self.llm and self.config.get("use_llm_repair", False):
            llm_fixed = self._try_llm_repair(fixed_code, "", [])
            if llm_fixed:
                fixed_code = llm_fixed
                fixes.append("应用了 LLM 二次修复")

        state.setdefault("metadata", {})["manim_code"] = fixed_code
        state["current_step"] = "repair_completed"

        if fixes:
            state["messages"].append({
                "role": "assistant",
                "content": "RepairAgent 已自动修复代码：" + "；".join(fixes)
            })
        else:
            state["messages"].append({
                "role": "assistant",
                "content": "RepairAgent 检查完成：未发现可自动修复的问题"
            })

        return state

    def repair_with_error(
        self,
        code: str,
        render_error: str,
        template_references: Optional[List[Dict[str, Any]]] = None,
    ) -> Tuple[str, List[str]]:
        """基于渲染报错进行定向修复（用于多轮修复场景）。"""
        fixed, fixes = self._apply_error_driven_fixes(
            code,
            render_error,
            template_references=template_references,
        )
        # 如果错误驱动没有命中，再走通用规则兜底
        if not fixes:
            fixed, fixes = self._apply_rule_based_fixes(code)
        return fixed, fixes

    def _apply_rule_based_fixes(self, code: str) -> Tuple[str, List[str]]:
        """规则修复，保证可解释和稳定。"""
        fixed = code
        fixes: List[str] = []

        # 1) 确保存在 manim 导入
        if "from manim import *" not in fixed and "import manim" not in fixed:
            fixed = "from manim import *\n\n" + fixed
            fixes.append("补全 from manim import * 导入")

        # 2) self.play 中裸 Mobject 参数 -> FadeIn(Mobject)
        before = fixed
        pattern = re.compile(
            r'^(\s*)((?:Polygon|Line|Dot|Circle|Square|Triangle|VGroup)\([^\n]*\)(?:\.[^\n,]+)?)\s*,\s*$',
            re.MULTILINE,
        )
        fixed = pattern.sub(r'\1FadeIn(\2),', fixed)
        if fixed != before:
            fixes.append("修复 self.play 中裸 Mobject 参数")

        # 3) 未定义颜色常量替换为安全颜色
        for bad_color, good_color in self.color_fallback_map.items():
            color_pattern = rf'\b{re.escape(bad_color)}\b'
            if re.search(color_pattern, fixed):
                fixed = re.sub(color_pattern, good_color, fixed)
                fixes.append(f"颜色常量 {bad_color} -> {good_color}")

        # 4) 静态兜底：将明显非法的 run_time<=0 替换为极小正值
        before = fixed
        fixed = self._normalize_invalid_run_time(fixed)
        if fixed != before:
            fixes.append("修复 run_time<=0 为最小正数 0.01")

        # 5) 静态兜底：将 Point(location=[...]) 替换为隐藏 Dot(point=[...])
        before = fixed
        fixed = self._replace_point_location_with_hidden_dot(fixed)
        if fixed != before:
            fixes.append("将 Point(location=[...]) 替换为隐藏 Dot(point=[...])")

        # 6) 渲染前硬校验：公式区 Text 坐标钳制到右侧安全区域
        before = fixed
        fixed = self._clamp_formula_text_positions(fixed)
        if fixed != before:
            fixes.append("将公式 Text 坐标钳制到右侧公式区安全范围")

        return fixed, fixes

    def _normalize_invalid_run_time(self, code: str) -> str:
        """将 run_time<=0 或畸形浮点统一修正，避免 Manim 拒绝渲染。"""
        fixed = code
        # 优先修复多小数点畸形浮点，如 run_time=0.01.5 → run_time=1.5
        def _fix_malformed(m):
            raw = m.group(1)
            parts = raw.split('.')
            try:
                val = float(parts[-2] + '.' + parts[-1])
                return f'run_time={val}'
            except (ValueError, IndexError):
                return 'run_time=1.0'
        fixed = re.sub(r'run_time\s*=\s*([0-9]+(?:\.[0-9]+){2,})', _fix_malformed, fixed)
        # 再处理负值和零值
        fixed = re.sub(r'run_time\s*=\s*-\s*[0-9]+(?:\.[0-9]+)?', 'run_time=0.01', fixed)
        fixed = re.sub(r'run_time\s*=\s*0(?:\.0+)?(?![\d.])', 'run_time=0.01', fixed)
        return fixed

    def _replace_point_location_with_hidden_dot(self, code: str) -> str:
        """把 Point(location=[...]) 转成不可见 Dot(point=[...])，保留 get_center/next_to 兼容性。"""
        return re.sub(
            r'Point\(\s*location\s*=\s*(\[[^\]]+\])\s*\)',
            r'Dot(point=\1, radius=0.01, fill_opacity=0, stroke_opacity=0)',
            code,
        )

    def _clamp_formula_text_positions(self, code: str) -> str:
        """将公式文本（黄色 Text）的 move_to 坐标钳制到右侧公式区，避免越界和覆盖风险。"""
        half_w = self.frame_width / 2.0
        half_h = self.frame_height / 2.0
        x_min = self.right_panel_x_min
        x_max = half_w - self.safe_margin
        y_min = -half_h + self.safe_margin
        y_max = half_h - self.safe_margin

        pattern = re.compile(
            r"(Text\([^\n]*?color\s*=\s*YELLOW[^\n]*?\)\.move_to\(np\.array\(\[)"
            r"\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*0\s*"
            r"(\]\)\) )"
        )

        # 兼容没有末尾空格的常见写法
        if not pattern.search(code):
            pattern = re.compile(
                r"(Text\([^\n]*?color\s*=\s*YELLOW[^\n]*?\)\.move_to\(np\.array\(\[)"
                r"\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*0\s*"
                r"(\]\)\))"
            )

        def _repl(match):
            prefix = match.group(1)
            x = float(match.group(2))
            y = float(match.group(3))
            suffix = match.group(4)
            cx = min(max(x, x_min), x_max)
            cy = min(max(y, y_min), y_max)
            return f"{prefix}{cx:.3f}, {cy:.3f}, 0{suffix}"

        return pattern.sub(_repl, code)

    def _format_template_references_for_prompt(
        self,
        references: Optional[List[Dict[str, Any]]],
    ) -> str:
        refs = list(references or [])
        if not refs:
            return "无"
        lines: List[str] = []
        for item in refs[:3]:
            lines.append(
                "\n".join(
                    [
                        f"- 模板ID: {item.get('id', '')}",
                        f"  命中原因: {item.get('reason', '')}",
                        f"  helper: {', '.join(item.get('helpers', []) or []) or '无'}",
                        f"  代码片段:\n```python\n{item.get('excerpt', '')}\n```",
                    ]
                )
            )
        return "\n\n".join(lines)

    def _select_relevant_template_references(
        self,
        render_error: str,
        template_references: Optional[List[Dict[str, Any]]],
    ) -> List[Dict[str, Any]]:
        refs = list(template_references or [])
        if not refs:
            return []
        lowered = str(render_error or "").lower()
        keywords = set()
        if "angle" in lowered:
            keywords.add("angle")
        if "rightangle" in lowered or "right angle" in lowered or "perpendicular" in lowered:
            keywords.add("right_angle")
        if "arc" in lowered:
            keywords.add("arc")
        if "rotate" in lowered or "rotation" in lowered:
            keywords.add("rotation")
        if "reflect" in lowered or "fold" in lowered:
            keywords.add("reflection")
        if "transform" in lowered:
            keywords.add("transform")
        if not keywords:
            return refs[:2]
        matched = []
        for item in refs:
            haystack = set(item.get("tags", [])) | set(item.get("primitives", [])) | set(item.get("motions", []))
            if haystack & keywords:
                matched.append(item)
        return matched[:3] or refs[:2]

    def _try_llm_repair(
        self,
        code: str,
        render_error: str,
        template_references: Optional[List[Dict[str, Any]]] = None,
    ) -> Optional[str]:
        """可选 LLM 修复，返回修复后的完整代码。"""
        prompt = f"""请修复以下 Manim 代码，要求：
1. 保留原有动画语义
2. 修复所有语法/运行时错误
3. 输出完整可运行代码，不得省略
4. 只允许做局部修复，不允许重写整个场景结构
5. 只输出 python 代码块

当前渲染错误：
{render_error}

可参考的模板片段（只学习写法，不允许照搬题设和坐标）：
{self._format_template_references_for_prompt(template_references)}

代码：
```python
{code}
```"""

        messages = self._format_messages(
            system_prompt="你是严谨的 Manim 代码修复工程师。",
            user_prompt=prompt,
        )
        try:
            content = self._invoke_llm(messages).strip()
            match = re.search(r'```python\s*([\s\S]*?)\s*```', content)
            if match:
                return match.group(1).strip()
            if "from manim" in content or "class " in content:
                return content
        except Exception:
            return None
        return None

    def _fallback_invalid_mathtex_to_text(self, code: str) -> str:
        pattern = re.compile(
            r"MathTex\((?P<quote>['\"])(?P<content>.*?)(?P=quote),\s*font_size=(?P<font_size>\d+),\s*color=(?P<color>[A-Z_]+)\)",
            re.DOTALL,
        )

        def _needs_text_fallback(content: str) -> bool:
            suspicious_markers = ["鈭", "锛", "銆", "∵", "∴"]
            return any(marker in content for marker in suspicious_markers)

        def _repl(match: re.Match) -> str:
            content = match.group("content")
            if not _needs_text_fallback(content):
                return match.group(0)
            safe = content.replace("\\\\", "\\").replace("\\'", "'").replace("\\n", " ")
            safe = safe.replace("'", "\\'")
            return (
                f"Text('{safe}', font_size={match.group('font_size')}, "
                f"color={match.group('color')}, line_spacing=0.85)"
            )

        return pattern.sub(_repl, code)

    def _disable_invalid_add_sound_calls(self, code: str, render_error: str) -> str:
        error_text = str(render_error or "")
        paths = re.findall(r"'([^']+\.(?:mp3|wav|m4a))'", error_text, flags=re.IGNORECASE)
        if not paths:
            return code
        fixed = code
        for raw_path in paths:
            normalized = raw_path.replace("\\", "/")
            escaped = re.escape(normalized)
            fixed = re.sub(
                rf"^\s*self\.add_sound\(r?['\"]{escaped}['\"],\s*time_offset\s*=\s*[0-9.]+\)\s*$",
                "        # invalid audio skipped during repair",
                fixed,
                flags=re.MULTILINE,
            )
            fixed = re.sub(
                rf"^\s*_safe_add_sound\(r?['\"]{escaped}['\"],\s*time_offset\s*=\s*[0-9.]+\)\s*$",
                "        # invalid audio skipped during repair",
                fixed,
                flags=re.MULTILINE,
            )
        return fixed

    def _apply_error_driven_fixes(
        self,
        code: str,
        render_error: str,
        template_references: Optional[List[Dict[str, Any]]] = None,
    ) -> Tuple[str, List[str]]:
        fixed = code
        fixes: List[str] = []
        error_text = render_error or ""

        if "cannot be converted to an animation" in error_text or "Unexpected argument" in error_text:
            before = fixed
            pattern = re.compile(
                r'^(\s*)((?:Polygon|Line|Dot|Circle|Square|Triangle|VGroup)\([^\n]*\)(?:\.[^\n,]+)?)\s*,\s*$',
                re.MULTILINE,
            )
            fixed = pattern.sub(r'\1FadeIn(\2),', fixed)
            if fixed != before:
                fixes.append("修复 self.play 中裸 Mobject 参数")

        if "NameError" in error_text and "is not defined" in error_text:
            match = re.search(r"name '([A-Za-z_][A-Za-z0-9_]*)' is not defined", error_text)
            if match:
                missing_name = match.group(1)
                replacement = self.color_fallback_map.get(missing_name, "WHITE")
                before = fixed
                fixed = re.sub(rf"\b{re.escape(missing_name)}\b", replacement, fixed)
                if fixed != before:
                    fixes.append(f"修复未定义符号 {missing_name} -> {replacement}")

        if "run_time of 0 <= 0 seconds" in error_text or "must be a positive number" in error_text:
            before = fixed
            fixed = self._normalize_invalid_run_time(fixed)
            if fixed != before:
                fixes.append("修复非法 run_time")

        if "Point" in error_text and ("is not defined" in error_text or "unexpected keyword argument 'location'" in error_text):
            before = fixed
            fixed = self._replace_point_location_with_hidden_dot(fixed)
            if fixed != before:
                fixes.append("将 Point(location=...) 替换为隐藏 Dot")

        if "SyntaxError" in error_text:
            before = fixed
            fixed = self._normalize_invalid_run_time(fixed)
            if fixed != before:
                fixes.append("修复 SyntaxError 相关的 run_time")

        if (
            "latex error converting to dvi" in error_text.lower()
            or "unicode character" in error_text.lower()
            or "tex_mobject" in error_text.lower()
        ):
            before = fixed
            fixed = self._fallback_invalid_mathtex_to_text(fixed)
            if fixed != before:
                fixes.append("将可疑 MathTex 回退为 Text")

        if "invalid data found when processing input" in error_text.lower() and ".mp3" in error_text.lower():
            before = fixed
            fixed = self._disable_invalid_add_sound_calls(fixed, error_text)
            if fixed != before:
                fixes.append("禁用损坏音频对应的 add_sound 调用")

        if not fixes:
            fixed, fixes = self._apply_rule_based_fixes(code)

        if (
            self.llm
            and self.config.get("use_llm_repair", False)
            and not fixes
        ):
            relevant_refs = self._select_relevant_template_references(render_error, template_references)
            llm_fixed = self._try_llm_repair(code, render_error, relevant_refs)
            if llm_fixed and llm_fixed != code:
                return llm_fixed, ["应用了带模板参考的 LLM 定向修复"]
        return fixed, fixes
