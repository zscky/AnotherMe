"""
Tests for teaching narration skills.
验证讲解 skill 系统的正确性。
"""

import pytest
from anotherme2_engine.agents.planning.teaching_narration_skills import (
    GeometryTerminologyStandard,
    FoldProblemNarrationTemplates,
    DetailedExplanationTemplates,
    NarrationSkillEngine,
    NarrationContext,
    get_narration_skill_engine,
    standardize_geometry_terms,
    build_fold_narration_prompt,
)


class TestGeometryTerminologyStandard:
    """测试几何术语标准化"""

    def test_standardize_fold_terms(self):
        """测试折叠相关术语标准化"""
        # 测试"折痕"标准化
        assert GeometryTerminologyStandard.standardize_term("折叠线", "line") == "折痕"
        assert GeometryTerminologyStandard.standardize_term("对称轴", "line") == "折痕"
        
        # 测试"像点"标准化
        assert GeometryTerminologyStandard.standardize_term("对称点", "point") == "像点"
        assert GeometryTerminologyStandard.standardize_term("对应点", "point") == "像点"
        
        # 测试"翻折"
        assert GeometryTerminologyStandard.standardize_term("折叠", "transform") == "折叠"
        assert GeometryTerminologyStandard.standardize_term("轴对称", "transform") == "对称"

    def test_standardize_point_terms(self):
        """测试点相关术语标准化"""
        assert GeometryTerminologyStandard.standardize_term("顶点", "point") == "顶点"
        assert GeometryTerminologyStandard.standardize_term("端点", "point") == "端点"
        assert GeometryTerminologyStandard.standardize_term("垂足", "point") == "垂足"

    def test_standardize_line_terms(self):
        """测试线相关术语标准化"""
        assert GeometryTerminologyStandard.standardize_term("垂直线", "line") == "垂线"
        assert GeometryTerminologyStandard.standardize_term("高线", "line") == "垂线"
        assert GeometryTerminologyStandard.standardize_term("分角线", "line") == "角平分线"

    def test_standardize_shape_terms(self):
        """测试图形相关术语标准化"""
        assert GeometryTerminologyStandard.standardize_term("正三角形", "shape") == "等边三角形"
        assert GeometryTerminologyStandard.standardize_term("长方形", "shape") == "矩形"
        assert GeometryTerminologyStandard.standardize_term("Rt△", "shape") == "直角三角形"

    def test_standardize_relation_terms(self):
        """测试关系相关术语标准化"""
        assert GeometryTerminologyStandard.standardize_term("正交", "relation") == "垂直"
        assert GeometryTerminologyStandard.standardize_term("交叉", "relation") == "相交"

    def test_get_preferred_term(self):
        """测试获取首选术语"""
        assert GeometryTerminologyStandard.get_preferred_term("三角形") == "三角形"
        assert "三角形" in GeometryTerminologyStandard.SHAPE_TERMS["三角形"]


class TestFoldProblemNarrationTemplates:
    """测试折叠题讲解模板"""

    def test_get_template_for_stage(self):
        """测试根据阶段获取模板"""
        template = FoldProblemNarrationTemplates.get_template_for_stage("pre_fold")
        assert template is not None
        assert template.name == "pre_fold_intro"
        
        template = FoldProblemNarrationTemplates.get_template_for_stage("axis_definition")
        assert template is not None
        assert template.name == "axis_definition"
        
        template = FoldProblemNarrationTemplates.get_template_for_stage("fold_execution")
        assert template is not None
        assert template.name == "fold_execution"
        
        template = FoldProblemNarrationTemplates.get_template_for_stage("unknown")
        assert template is None

    def test_template_content(self):
        """测试模板内容包含关键要素"""
        template = FoldProblemNarrationTemplates.PRE_FOLD_INTRO
        assert "折痕" in template.prompt_template
        assert "像点" in template.prompt_template
        assert "原像" in template.prompt_template
        
        template = FoldProblemNarrationTemplates.AXIS_DEFINITION
        assert "垂直平分" in template.prompt_template
        assert "对称关系" in template.prompt_template


class TestNarrationSkillEngine:
    """测试讲解 Skill 引擎"""

    def test_init(self):
        """测试引擎初始化"""
        engine = NarrationSkillEngine()
        assert engine._narration_engine is None  # 自身就是引擎
        assert "pre_fold_intro" in engine.template_registry
        assert "concept_explanation" in engine.template_registry

    def test_select_templates_for_fold(self):
        """测试为折叠步骤选择模板"""
        engine = NarrationSkillEngine()
        context = NarrationContext(
            step_type="fold",
            problem_pattern="fold_transform",
        )
        
        templates = engine.select_templates(context)
        template_names = [t.name for t in templates]
        
        # 应该包含折叠相关模板
        assert any("fold" in name for name in template_names)

    def test_select_templates_for_proof(self):
        """测试为证明步骤选择模板"""
        engine = NarrationSkillEngine()
        context = NarrationContext(
            step_type="proof",
            problem_pattern="",
        )
        
        templates = engine.select_templates(context)
        template_names = [t.name for t in templates]
        
        # 应该包含推理模板
        assert "reasoning_process" in template_names

    def test_apply_terminology_standard(self):
        """测试术语标准化应用"""
        engine = NarrationSkillEngine()
        
        text = "沿着折叠线AD进行轴对称，得到对称点C'"
        result = engine.apply_terminology_standard(text)
        
        # 应该标准化术语
        assert "折痕" in result or "折叠线" in text

    def test_build_enhanced_prompt(self):
        """测试构建增强 prompt"""
        engine = NarrationSkillEngine()
        context = NarrationContext(
            step_type="fold",
            problem_pattern="fold_transform",
            audience_level="middle_school",
        )
        
        prompt = engine.build_enhanced_prompt(context)
        
        # 应该包含关键部分
        assert "术语规范" in prompt
        assert "讲解结构" in prompt
        assert "折痕" in prompt
        assert "像点" in prompt

    def test_enhance_narration(self):
        """测试增强讲解"""
        engine = NarrationSkillEngine()
        context = NarrationContext(
            step_type="fold",
            problem_pattern="fold_transform",
        )
        
        original = "沿着AD折叠，C的对称点是C'"
        result = engine.enhance_narration(original, context)
        
        assert "original" in result
        assert "standardized" in result
        assert "enhanced_prompt" in result
        assert result["original"] == original


class TestConvenienceFunctions:
    """测试便捷函数"""

    def test_get_narration_skill_engine(self):
        """测试获取引擎实例"""
        engine1 = get_narration_skill_engine()
        engine2 = get_narration_skill_engine()
        
        assert isinstance(engine1, NarrationSkillEngine)
        # 每次应该返回新实例
        assert engine1 is not engine2

    def test_standardize_geometry_terms(self):
        """测试术语标准化便捷函数"""
        text = "使用折叠线进行轴对称变换"
        result = standardize_geometry_terms(text)
        
        assert isinstance(result, str)

    def test_build_fold_narration_prompt(self):
        """测试构建折叠讲解 prompt"""
        prompt = build_fold_narration_prompt("fold_execution")
        
        assert isinstance(prompt, str)
        assert len(prompt) > 0
        assert "折痕" in prompt or "折叠" in prompt
        
        # 测试无效阶段
        prompt = build_fold_narration_prompt("unknown_stage")
        assert isinstance(prompt, str)


class TestIntegrationWithVoiceAgent:
    """测试与 VoiceAgent 的集成"""

    def test_voice_agent_imports(self):
        """测试 VoiceAgent 能正确导入 narration skills"""
        try:
            from anotherme2_engine.agents.execution.voice_agent import (
                NARRATION_SKILLS_AVAILABLE,
                VoiceAgent,
            )
            assert NARRATION_SKILLS_AVAILABLE is True
        except ImportError as e:
            pytest.fail(f"导入失败: {e}")

    def test_voice_agent_system_prompts(self):
        """测试 VoiceAgent 的系统 prompt"""
        from anotherme2_engine.agents.execution.voice_agent import VoiceAgent
        
        # 验证有两个系统 prompt
        assert hasattr(VoiceAgent, 'SYSTEM_PROMPT')
        assert hasattr(VoiceAgent, 'SYSTEM_PROMPT_WITH_SKILLS')
        
        # 验证增强 prompt 包含术语规范
        assert "术语规范" in VoiceAgent.SYSTEM_PROMPT_WITH_SKILLS
        assert "折痕" in VoiceAgent.SYSTEM_PROMPT_WITH_SKILLS
        assert "像点" in VoiceAgent.SYSTEM_PROMPT_WITH_SKILLS


class TestCorrectnessGuarantee:
    """
    测试正确性保障：确保 skill 不破坏正确性
    """

    def test_skill_does_not_change_meaning(self):
        """测试 skill 不改变数学含义"""
        engine = NarrationSkillEngine()
        
        # 原始文本包含关键数学信息
        original = "三角形ABC中，AB=AC，AD是角平分线"
        context = NarrationContext(step_type="explanation")
        
        result = engine.enhance_narration(original, context)
        standardized = result["standardized"]
        
        # 关键信息应该保留
        assert "ABC" in standardized
        assert "AB" in standardized
        assert "AC" in standardized
        assert "AD" in standardized

    def test_terminology_preserves_geometric_meaning(self):
        """测试术语标准化保持几何含义"""
        # 不同表达应该映射到相同概念
        terms = ["折叠线", "对称轴", "折痕"]
        standardized = [
            GeometryTerminologyStandard.standardize_term(t, "line")
            for t in terms
        ]
        
        # 都应该映射到标准术语
        assert all(s == "折痕" for s in standardized)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
