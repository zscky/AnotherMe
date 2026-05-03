"""
教学讲解 Skill 系统
用于提升讲解质量：术语统一、表达细致、逻辑清晰

设计原则：
1. 正确性不依赖 skill - 硬约束和语义校验已保证正确性
2. Skill 只用于提升表达质量
3. 支持多种教学场景和题型
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Set


@dataclass
class NarrationContext:
    """讲解上下文"""
    step_type: str = ""  # fold, proof, construction, explanation
    problem_pattern: str = ""  # fold_transform, shortest_path, etc.
    geometry_objects: List[str] = field(default_factory=list)
    action_sequence: List[str] = field(default_factory=list)
    audience_level: str = "middle_school"  # elementary, middle_school, high_school
    language_style: str = "formal"  # formal, casual, rigorous


@dataclass
class NarrationTemplate:
    """讲解模板"""
    name: str
    description: str
    prompt_template: str
    applicable_when: List[str]
    priority: int = 0


class GeometryTerminologyStandard:
    """
    几何术语统一标准
    确保讲解中术语使用一致、准确
    """

    # 点相关术语
    POINT_TERMS = {
        "顶点": ["顶点", "夹角顶点", "交点"],
        "端点": ["端点", "线段端点"],
        "像点": ["像点", "对称点", "折叠后的点", "对应点"],
        "垂足": ["垂足", "垂直交点"],
        "圆心": ["圆心", "中心点"],
        "切点": ["切点", "切线接触点"],
    }

    # 线相关术语
    LINE_TERMS = {
        "线段": ["线段", "边", "棱"],
        "直线": ["直线", "无限延长线"],
        "射线": ["射线", "半直线"],
        "折痕": ["折痕", "折叠轴", "对称轴", "折叠线"],
        "垂线": ["垂线", "垂直线", "高线"],
        "中线": ["中线", "中位线"],
        "角平分线": ["角平分线", "分角线"],
        "切线": ["切线", "切触线"],
    }

    # 图形相关术语
    SHAPE_TERMS = {
        "三角形": ["三角形", "三边形"],
        "等腰三角形": ["等腰三角形", "等腰△"],
        "等边三角形": ["等边三角形", "正三角形", "等边△"],
        "直角三角形": ["直角三角形", "Rt△"],
        "四边形": ["四边形", "四边图形"],
        "平行四边形": ["平行四边形", "平行四边图形"],
        "矩形": ["矩形", "长方形"],
        "菱形": ["菱形", "斜方形"],
        "正方形": ["正方形", "正四边形"],
        "梯形": ["梯形", "梯形状"],
        "圆": ["圆", "圆形", "圆周"],
        "扇形": ["扇形", "扇状图形"],
    }

    # 变换相关术语
    TRANSFORM_TERMS = {
        "折叠": ["折叠", "翻折", "轴对称"],
        "对称": ["对称", "轴对称", "镜像对称"],
        "平移": ["平移", "平行移动", "滑动"],
        "旋转": ["旋转", "转动", "周转"],
        "位似": ["位似", "相似变换", "缩放"],
        "投影": ["投影", "射影"],
    }

    # 关系相关术语
    RELATION_TERMS = {
        "垂直": ["垂直", "正交", "成90度"],
        "平行": ["平行", "不相交"],
        "相交": ["相交", "交叉", "穿过"],
        "重合": ["重合", "重叠", "完全重合"],
        "共线": ["共线", "在同一直线上"],
        "共点": ["共点", "交于一点"],
    }

    @classmethod
    def standardize_term(cls, term: str, category: str = "") -> str:
        """
        将术语标准化为统一表达
        
        Args:
            term: 输入术语
            category: 类别提示 (point, line, shape, transform, relation)
        
        Returns:
            标准化后的术语
        """
        term = str(term).strip()
        
        categories = {
            "point": cls.POINT_TERMS,
            "line": cls.LINE_TERMS,
            "shape": cls.SHAPE_TERMS,
            "transform": cls.TRANSFORM_TERMS,
            "relation": cls.RELATION_TERMS,
        }
        
        # 如果指定了类别，只在对应类别中查找
        if category and category in categories:
            for standard, variants in categories[category].items():
                if term in variants:
                    return standard
            return term
        
        # 否则在所有类别中查找
        for cat_terms in categories.values():
            for standard, variants in cat_terms.items():
                if term in variants:
                    return standard
        
        return term

    @classmethod
    def get_preferred_term(cls, concept: str) -> str:
        """获取概念的首选术语"""
        all_terms = {
            **cls.POINT_TERMS,
            **cls.LINE_TERMS,
            **cls.SHAPE_TERMS,
            **cls.TRANSFORM_TERMS,
            **cls.RELATION_TERMS,
        }
        return all_terms.get(concept, [concept])[0]


class FoldProblemNarrationTemplates:
    """
    折叠题专用讲解模板
    提供结构化、细致的折叠过程讲解
    """

    # 折叠前准备阶段
    PRE_FOLD_INTRO = NarrationTemplate(
        name="pre_fold_intro",
        description="折叠前的引入和准备",
        prompt_template="""
请按照以下结构讲解折叠前的准备：

1. 问题背景说明：
   - 说明当前几何图形的构成
   - 指出需要解决的问题目标

2. 折叠策略预告：
   - 说明将要沿哪条线折叠（使用术语：折痕/折叠轴）
   - 简要说明折叠的目的（如：构造对称关系、转化线段位置）

3. 关键元素提示：
   - 指出折叠涉及的关键点
   - 预告折叠后会产生的新元素（像点）

术语要求：
- 使用"折痕"而非"折叠线"
- 使用"像点"而非"对称点"或"对应点"
- 使用"原像"和"像"描述对应关系

示例：
"观察三角形ABC，我们需要求点P到边AB和AC的距离之和。接下来，我们将沿直线AD进行折叠，
使得点C落在AB边上的点C'处。这里的AD就是折痕，C'是C的像点。"
""",
        applicable_when=["fold_transform", "preparation"],
        priority=10,
    )

    # 折叠轴定义阶段
    AXIS_DEFINITION = NarrationTemplate(
        name="axis_definition",
        description="定义折叠轴的讲解",
        prompt_template="""
请按照以下结构讲解折叠轴的定义：

1. 折叠轴的几何特征：
   - 说明折叠轴的位置（经过哪些点、与哪些线有关）
   - 说明折叠轴的性质（垂直平分线、角平分线等）

2. 折叠轴的作用：
   - 解释为什么选这条线作为折痕
   - 说明折叠轴与对称性的关系

3. 视觉强调：
   - 建议用不同线型（虚线/实线）突出折痕
   - 建议标注关键角度或长度关系

术语要求：
- 统一使用"折痕"作为折叠轴的称呼
- 使用"垂直平分"而非"中垂线"
- 使用"对称关系"描述轴对称性质

示例：
"直线AD是折痕。注意到AD垂直平分线段CC'，这意味着AD上的任意一点到C和C'的距离相等。
这种对称关系将帮助我们转化问题的求解路径。"
""",
        applicable_when=["fold_transform", "axis_definition"],
        priority=9,
    )

    # 折叠部分确定阶段
    FOLD_PARTS_IDENTIFICATION = NarrationTemplate(
        name="fold_parts_identification",
        description="确定折叠部分的讲解",
        prompt_template="""
请按照以下结构讲解折叠部分的确定：

1. 固定部分说明：
   - 说明哪些图形元素保持不动
   - 解释为什么这部分不需要移动

2. 移动部分说明：
   - 说明哪些图形元素将随折叠移动
   - 描述移动部分与折痕的关系

3. 对应关系建立：
   - 逐一说明原像点与像点的对应关系
   - 强调对应线段长度相等、对应角度相等

术语要求：
- 使用"固定部分"和"移动部分"
- 使用"原像"和"像"描述对应关系
- 使用"对应线段相等"而非"长度一样"

示例：
"在折叠过程中，三角形ADC是移动部分，它将绕折痕AD翻转到三角形ADC'的位置。
三角形ABD是固定部分，保持不动。点C是原像，点C'是它的像。
根据轴对称的性质，对应线段AC与AC'相等，对应角∠CAD与∠C'AD相等。"
""",
        applicable_when=["fold_transform", "parts_identification"],
        priority=9,
    )

    # 折叠执行阶段
    FOLD_EXECUTION = NarrationTemplate(
        name="fold_execution",
        description="执行折叠动画的讲解",
        prompt_template="""
请按照以下结构讲解折叠的执行过程：

1. 折叠动作描述：
   - 描述移动部分绕折痕旋转的过程
   - 说明旋转方向和角度（通常是180度翻转）

2. 关键位置提示：
   - 指出折叠过程中的关键中间位置
   - 说明何时移动部分与固定部分重合或接触

3. 最终位置确认：
   - 确认移动部分到达的最终位置
   - 验证像点的位置是否符合预期

术语要求：
- 使用"翻折"描述折叠动作
- 使用"绕...旋转"描述运动方式
- 使用"最终位置"描述折叠后的状态

示例：
"现在执行折叠操作。三角形ADC将绕折痕AD翻折180度，点C沿着垂直于AD的方向运动，
最终落在AB边上的C'点。注意折叠过程中，AD上的点保持不动，这是轴对称的核心特征。"
""",
        applicable_when=["fold_transform", "fold_execution"],
        priority=10,
    )

    # 折叠后分析阶段
    POST_FOLD_ANALYSIS = NarrationTemplate(
        name="post_fold_analysis",
        description="折叠后的性质分析",
        prompt_template="""
请按照以下结构讲解折叠后的几何性质：

1. 不变量总结：
   - 列举折叠前后保持不变的量（长度、角度、面积）
   - 说明这些不变量的几何意义

2. 新产生的关系：
   - 说明折叠后产生的新线段、新角度
   - 分析这些新元素与原图形的关系

3. 问题转化说明：
   - 解释折叠如何帮助解决问题
   - 指出现在可以利用的新性质或定理

术语要求：
- 使用"不变量"描述保持不变的量
- 使用"新产生的"描述折叠后的新元素
- 使用"问题转化"而非"问题变了"

示例：
"折叠后，我们得到以下不变量：AC = AC'，∠CAD = ∠C'AD，三角形ADC与三角形ADC'全等。
新产生的线段C'B连接了像点与固定部分。通过折叠，我们将求PC + PB的问题转化为求PC' + PB的问题，
根据两点之间线段最短，当P位于线段C'B上时，和最小。"
""",
        applicable_when=["fold_transform", "post_analysis"],
        priority=9,
    )

    @classmethod
    def get_template_for_stage(cls, stage: str) -> Optional[NarrationTemplate]:
        """根据折叠阶段获取对应模板"""
        templates = {
            "pre_fold": cls.PRE_FOLD_INTRO,
            "axis_definition": cls.AXIS_DEFINITION,
            "parts_identification": cls.FOLD_PARTS_IDENTIFICATION,
            "fold_execution": cls.FOLD_EXECUTION,
            "post_analysis": cls.POST_FOLD_ANALYSIS,
        }
        return templates.get(stage)


class DetailedExplanationTemplates:
    """
    讲解细致度提升模板
    提供更详细、更易懂的教学表达
    """

    # 概念解释模板
    CONCEPT_EXPLANATION = NarrationTemplate(
        name="concept_explanation",
        description="详细解释几何概念",
        prompt_template="""
请按照以下层次解释几何概念：

第一层：直观描述
- 用日常语言描述概念的外观特征
- 使用比喻或类比帮助理解

第二层：数学定义
- 给出准确的数学定义
- 使用标准几何术语

第三层：性质说明
- 列举该概念的重要性质
- 说明这些性质的应用场景

第四层：示例展示
- 给出具体例子
- 说明如何识别或构造该概念

要求：
- 每一层之间要有过渡语句
- 避免跳跃式讲解
- 关键术语首次出现时要解释
""",
        applicable_when=["concept_introduction", "new_term"],
        priority=8,
    )

    # 推理过程模板
    REASONING_PROCESS = NarrationTemplate(
        name="reasoning_process",
        description="展示完整的推理过程",
        prompt_template="""
请按照以下结构展示几何推理过程：

1. 已知条件陈述：
   - 清晰列出所有已知条件
   - 说明条件的来源（题目给定、图形性质、已证结论）

2. 推理目标明确：
   - 说明需要证明或求解的目标
   - 解释目标的意义

3. 中间步骤展开：
   - 每一步都要有依据（定理、定义、已知条件）
   - 说明为什么选择这条推理路径
   - 解释每一步的结论

4. 最终结论总结：
   - 重申最终结论
   - 说明结论的应用价值

要求：
- 使用"因为...所以..."的句式
- 明确标注每一步的依据
- 避免省略中间推理步骤
""",
        applicable_when=["proof", "derivation", "reasoning"],
        priority=9,
    )

    # 视觉引导模板
    VISUAL_GUIDANCE = NarrationTemplate(
        name="visual_guidance",
        description="配合视觉的讲解",
        prompt_template="""
请按照以下方式编写配合视觉的讲解：

1. 视线引导：
   - 明确指示学生应该看哪里
   - 使用"请注意"、"观察"等引导词

2. 图形元素指代：
   - 清晰指代图形中的点、线、面
   - 使用标准记法（如：点A、线段AB、三角形ABC）

3. 动态过程描述：
   - 描述动画或变化过程
   - 说明变化前后的对比

4. 重点突出：
   - 指出图形中的关键元素
   - 说明为什么这些元素重要

要求：
- 讲解要与视觉同步
- 避免讲解与显示内容不一致
- 重要元素要多次强调
""",
        applicable_when=["animation", "visualization", "demonstration"],
        priority=8,
    )

    # 常见错误提示模板
    COMMON_MISTAKE_WARNING = NarrationTemplate(
        name="common_mistake_warning",
        description="提示常见错误和注意事项",
        prompt_template="""
请按照以下方式提示常见错误：

1. 错误类型说明：
   - 描述常见的错误理解或操作
   - 解释为什么会犯这个错误

2. 正确做法对比：
   - 说明正确的理解或操作
   - 对比正确与错误的区别

3. 验证方法提供：
   - 给出检验是否正确的方法
   - 提供自我检查的问题

4. 记忆技巧分享：
   - 提供避免错误的记忆方法
   - 使用口诀或规律总结

要求：
- 语气要友善，不要指责
- 解释要清晰，避免模糊
- 提供实用的检查方法
""",
        applicable_when=["warning", "tip", "common_error"],
        priority=7,
    )


class NarrationSkillEngine:
    """
    讲解 Skill 引擎
    整合各种模板，生成高质量讲解
    """

    def __init__(self):
        self.terminology = GeometryTerminologyStandard()
        self.fold_templates = FoldProblemNarrationTemplates()
        self.detailed_templates = DetailedExplanationTemplates()
        self._init_template_registry()

    def _init_template_registry(self):
        """初始化模板注册表"""
        self.template_registry: Dict[str, NarrationTemplate] = {}
        
        # 注册折叠模板
        for template in [
            self.fold_templates.PRE_FOLD_INTRO,
            self.fold_templates.AXIS_DEFINITION,
            self.fold_templates.FOLD_PARTS_IDENTIFICATION,
            self.fold_templates.FOLD_EXECUTION,
            self.fold_templates.POST_FOLD_ANALYSIS,
        ]:
            self.template_registry[template.name] = template
        
        # 注册细致讲解模板
        for template in [
            self.detailed_templates.CONCEPT_EXPLANATION,
            self.detailed_templates.REASONING_PROCESS,
            self.detailed_templates.VISUAL_GUIDANCE,
            self.detailed_templates.COMMON_MISTAKE_WARNING,
        ]:
            self.template_registry[template.name] = template

    def select_templates(self, context: NarrationContext) -> List[NarrationTemplate]:
        """
        根据上下文选择合适的模板
        
        Args:
            context: 讲解上下文
            
        Returns:
            适用的模板列表（按优先级排序）
        """
        selected: List[NarrationTemplate] = []
        
        # 根据步骤类型选择
        if context.step_type == "fold":
            # 折叠步骤使用折叠专用模板
            for template_name in [
                "pre_fold_intro",
                "axis_definition",
                "parts_identification",
                "fold_execution",
                "post_fold_analysis",
            ]:
                if template_name in self.template_registry:
                    selected.append(self.template_registry[template_name])
        
        elif context.step_type == "proof":
            selected.append(self.detailed_templates.REASONING_PROCESS)
        
        elif context.step_type == "concept":
            selected.append(self.detailed_templates.CONCEPT_EXPLANATION)
        
        # 根据问题模式补充
        if context.problem_pattern == "fold_transform":
            # 确保折叠模板都被包含
            fold_template_names = [
                "axis_definition",
                "parts_identification",
                "fold_execution",
            ]
            for name in fold_template_names:
                if name in self.template_registry:
                    template = self.template_registry[name]
                    if template not in selected:
                        selected.append(template)
        
        # 按优先级排序
        selected.sort(key=lambda t: t.priority, reverse=True)
        
        return selected

    def apply_terminology_standard(self, text: str) -> str:
        """
        应用术语标准，统一术语表达
        
        Args:
            text: 原始文本
            
        Returns:
            术语标准化后的文本
        """
        result = text
        
        # 统一各类术语
        all_terms = {
            **self.terminology.POINT_TERMS,
            **self.terminology.LINE_TERMS,
            **self.terminology.SHAPE_TERMS,
            **self.terminology.TRANSFORM_TERMS,
            **self.terminology.RELATION_TERMS,
        }
        
        # 替换非标准术语为标准术语
        for standard, variants in all_terms.items():
            for variant in variants:
                if variant != standard and variant in result:
                    # 使用简单的字符串替换
                    result = result.replace(variant, standard)
        
        return result

    def build_enhanced_prompt(self, context: NarrationContext) -> str:
        """
        构建增强的讲解 prompt
        
        Args:
            context: 讲解上下文
            
        Returns:
            增强后的 prompt
        """
        templates = self.select_templates(context)
        
        prompt_parts = [
            "你是一位专业的数学教师，请按照以下要求生成教学讲解：\n",
            "=== 术语规范 ===",
            "请严格使用以下标准术语：",
            "- 折叠相关：折痕（不用折叠线）、像点（不用对称点）、原像、翻折",
            "- 点相关：顶点、端点、垂足、圆心、切点",
            "- 线相关：线段、直线、射线、垂线、中线、角平分线",
            "- 关系相关：垂直、平行、相交、重合、共线",
            "\n=== 讲解结构 ===",
        ]
        
        # 添加适用的模板说明
        for template in templates:
            prompt_parts.append(f"\n【{template.description}】")
            prompt_parts.append(template.prompt_template)
        
        # 添加通用要求
        prompt_parts.extend([
            "\n=== 通用要求 ===",
            "1. 讲解要循序渐进，不要跳跃",
            "2. 关键概念首次出现时要解释",
            "3. 使用'因为...所以...'展示推理过程",
            "4. 配合视觉，明确指示图形元素",
            "5. 语气友好，鼓励学生思考",
            "6. 句子长度适中，适合语音播报",
        ])
        
        return "\n".join(prompt_parts)

    def enhance_narration(
        self,
        original_narration: str,
        context: NarrationContext,
    ) -> Dict[str, Any]:
        """
        增强讲解内容
        
        Args:
            original_narration: 原始讲解
            context: 讲解上下文
            
        Returns:
            包含增强后讲解和元信息的字典
        """
        # 应用术语标准化
        standardized = self.apply_terminology_standard(original_narration)
        
        # 选择适用的模板
        templates = self.select_templates(context)
        
        # 构建增强 prompt
        enhanced_prompt = self.build_enhanced_prompt(context)
        
        return {
            "original": original_narration,
            "standardized": standardized,
            "enhanced_prompt": enhanced_prompt,
            "applicable_templates": [t.name for t in templates],
            "context": {
                "step_type": context.step_type,
                "problem_pattern": context.problem_pattern,
                "audience_level": context.audience_level,
            },
        }


# 便捷函数
def get_narration_skill_engine() -> NarrationSkillEngine:
    """获取讲解 Skill 引擎实例"""
    return NarrationSkillEngine()


def standardize_geometry_terms(text: str) -> str:
    """标准化几何术语"""
    engine = get_narration_skill_engine()
    return engine.apply_terminology_standard(text)


def build_fold_narration_prompt(stage: str, audience: str = "middle_school") -> str:
    """
    构建折叠题讲解 prompt
    
    Args:
        stage: 折叠阶段 (pre_fold, axis_definition, parts_identification, fold_execution, post_analysis)
        audience: 受众水平
        
    Returns:
        讲解 prompt
    """
    engine = get_narration_skill_engine()
    
    context = NarrationContext(
        step_type="fold",
        problem_pattern="fold_transform",
        audience_level=audience,
    )
    
    # 获取特定阶段的模板
    template = FoldProblemNarrationTemplates.get_template_for_stage(stage)
    
    if template:
        return f"""
你是一位专业的数学教师，正在讲解几何折叠问题。

{template.prompt_template}

受众：{audience}

请生成适合语音播报的讲解文本，要求：
1. 术语统一准确
2. 逻辑清晰连贯
3. 句子长度适中
4. 语气友好鼓励
"""
    
    return engine.build_enhanced_prompt(context)
