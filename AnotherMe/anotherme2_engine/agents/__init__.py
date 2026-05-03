"""
Agents package.

尽量保持轻量导入，避免仅使用局部模块时被可选依赖阻塞。
"""

from importlib import import_module


_EXPORTS = {
    "AgentState": ".foundation.state",
    "VideoProject": ".foundation.state",
    "ScriptStep": ".foundation.state",
    "CoordinateSceneCompiler": ".perception.coordinate_scene",
    "CoordinateSceneError": ".perception.coordinate_scene",
    "GeometryFactCompiler": ".perception.geometry_fact_compiler",
    "BaseAgent": ".foundation.base_agent",
    "VisionTool": ".perception.vision_tool",
    "VisionAgent": ".perception.vision_agent",
    "ScriptAgent": ".planning.script_agent",
    "AnimationAgent": ".execution.animation_agent",
    "TemplateCodeGenerator": ".execution.codegen",
    "TemplateRetriever": ".planning.template_retriever",
    "TemplateReference": ".planning.template_retriever",
    "AnimationPlanner": ".planning.animation_planner",
    "TeachingIRPlanner": ".planning.teaching_ir",
    "ProblemPatternClassifier": ".planning.problem_pattern",
    "ActionExecutabilityChecker": ".planning.action_executability_checker",
    "CaseReplayRecorder": ".execution.case_replay_recorder",
    "SceneGraphUpdater": ".planning.scene_graph_updater",
    "CanvasScene": ".planning.canvas_scene",
    "RepairAgent": ".execution.repair_agent",
    "VoiceAgent": ".execution.voice_agent",
    "LearnerModelingAgent": ".planning.learner_modeling_agent",
    "MergeAgent": ".execution.merge_agent",
    "create_workflow": ".orchestration.workflow",
    "create_default_workflow": ".orchestration.workflow",
}

__all__ = list(_EXPORTS.keys())


def __getattr__(name):
    module_name = _EXPORTS.get(name)
    if module_name is None:
        raise AttributeError(f"module 'agents' has no attribute {name!r}")
    module = import_module(module_name, __name__)
    return getattr(module, name)
