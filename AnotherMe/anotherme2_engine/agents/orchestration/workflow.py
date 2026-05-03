"""
LangGraph 工作流定义
使用并行架构 - 所有智能体共享视觉工具
"""
import subprocess
from typing import Dict, Any, Optional, cast
from langgraph.graph import StateGraph, END

from ..foundation.state import AgentState, VideoProject
from ..planning.script_agent import ScriptAgent
from ..execution.animation_agent import AnimationAgent
from ..execution.repair_agent import RepairAgent
from ..execution.voice_agent import VoiceAgent
from ..execution.merge_agent import MergeAgent
from ..planning.learner_modeling_agent import LearnerModelingAgent
from ..perception.vision_agent import VisionAgent
from ..perception.vision_tool import VisionTool
from ..foundation.config import MANIM_CANVAS_CONFIG
from ..foundation.state_contracts import wrap_agent_node
try:
    from output_paths import DEFAULT_OUTPUT_DIR
except ModuleNotFoundError:
    from anotherme2_engine.output_paths import DEFAULT_OUTPUT_DIR


def _detect_latex_support() -> bool:
    """检测本机是否具备可用的 LaTeX + dvisvgm 环境。"""
    commands = [
        ["latex", "--version"],
        ["dvisvgm", "--version"],
    ]
    for cmd in commands:
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="ignore",
                timeout=10,
            )
        except Exception:
            return False
        if result.returncode != 0:
            return False
    return True


def create_workflow(
    vision_agent: VisionAgent,
    learner_modeling_agent: LearnerModelingAgent,
    script_agent: ScriptAgent,
    animation_agent: AnimationAgent,
    repair_agent: RepairAgent,
    voice_agent: VoiceAgent,
    merge_agent: MergeAgent,
    vision_tool: VisionTool
) -> Any:
    """
    创建 LangGraph 工作流

    工作流程（先生成音频，再生成动画，实现音画同步）：
    1. Vision    ← 图片（识别题目 + Scene Graph）
    2. Learner   ← 学情建模（知识差距分析 + 策略分发）
    3. Script    ← 题目文字 + 图片 + 学情策略
    4. Voice     ← 脚本（先跑，获取真实音频时长）
    5. Animation ← 脚本 + 音频时长 + Scene Graph（按真实时长生成动画 + add_sound）
    6. Repair    ← 自动修复常见 Manim 错误
    7. Merge     → 输出
    """
    builder = StateGraph(AgentState)

    # 添加节点
    builder.add_node("vision", cast(Any, wrap_agent_node("vision", vision_agent.process)))
    builder.add_node("learner_modeling", cast(Any, wrap_agent_node("learner_modeling", learner_modeling_agent.process)))
    builder.add_node("script", cast(Any, wrap_agent_node("script", script_agent.process)))
    builder.add_node("animation", cast(Any, wrap_agent_node("animation", animation_agent.process)))
    builder.add_node("repair", cast(Any, wrap_agent_node("repair", repair_agent.process)))
    builder.add_node("voice", cast(Any, wrap_agent_node("voice", voice_agent.process)))
    builder.add_node("merge", cast(Any, wrap_agent_node("merge", merge_agent.process)))

    # 设置入口
    builder.set_entry_point("vision")

    # 顺序流程
    # voice 先于 animation，确保音频时长和路径已知
    builder.add_edge("vision", "learner_modeling")
    builder.add_edge("learner_modeling", "script")
    builder.add_edge("script", "voice")
    builder.add_edge("voice", "animation")
    builder.add_edge("animation", "repair")
    builder.add_edge("repair", "merge")
    builder.add_edge("merge", END)

    workflow = builder.compile()
    return workflow


def create_default_workflow(llm_config: Dict[str, Any],
                            vision_llm_config: Optional[Dict[str, Any]] = None,
                            ocr_llm_config: Optional[Dict[str, Any]] = None,
                            output_dir: str = str(DEFAULT_OUTPUT_DIR),
                            export_ggb: bool = True) -> Any:
    """
    创建默认工作流

    所有智能体共享同一个 VisionTool，可以直接分析原图
    """
    from langchain_openai import ChatOpenAI
    chat_openai_cls: Any = ChatOpenAI

    if vision_llm_config is None:
        vision_llm_config = llm_config
    if ocr_llm_config is None:
        ocr_llm_config = vision_llm_config

    latex_ready = _detect_latex_support()

    # 创建文本 LLM（供 ScriptAgent / VoiceAgent / MergeAgent 使用）
    llm = chat_openai_cls(
        api_key=llm_config.get("api_key", ""),
        base_url=llm_config.get("base_url", ""),
        model=llm_config.get("model", ""),
        temperature=llm_config.get("temperature", 0.1),
        model_kwargs={"max_tokens": llm_config.get("max_tokens", 4096)},
    )

    # AnimationAgent 需要更大的 token 窗口来输出完整代码
    animation_llm = chat_openai_cls(
        api_key=llm_config.get("api_key", ""),
        base_url=llm_config.get("base_url", ""),
        model=llm_config.get("model", ""),
        temperature=0.05,
        model_kwargs={"max_tokens": 16384},
    )

    # 创建视觉工具（共享给所有需要图像分析的智能体）
    vision_tool = VisionTool(
        {
            **vision_llm_config,
            "max_retries": 5,
            "retry_backoff_seconds": 10.0,
        },
        ocr_llm_config={
            **ocr_llm_config,
            "max_retries": 5,
            "retry_backoff_seconds": 10.0,
        },
    )

    # VisionAgent 使用视觉模型直接生成 OCR 与 Scene Graph
    vision_llm = chat_openai_cls(
        api_key=vision_llm_config.get("api_key", ""),
        base_url=vision_llm_config.get("base_url", ""),
        model=vision_llm_config.get("model", ""),
        temperature=vision_llm_config.get("temperature", 0.05),
        model_kwargs={"max_tokens": vision_llm_config.get("max_tokens", 4096)},
    )
    ocr_vision_llm = chat_openai_cls(
        api_key=ocr_llm_config.get("api_key", ""),
        base_url=ocr_llm_config.get("base_url", ""),
        model=ocr_llm_config.get("model", ""),
        temperature=ocr_llm_config.get("temperature", 0.0),
        model_kwargs={"max_tokens": ocr_llm_config.get("max_tokens", 4096)},
    )

    vision_agent = VisionAgent(
        config={
            "temperature": 0.05,
            "output_dir": output_dir,
            "export_ggb": export_ggb,
            "max_retries": 5,
            "retry_backoff_seconds": 10.0,
        },
        llm=vision_llm,
        ocr_llm=ocr_vision_llm,
    )

    # 创建智能体 - 都注入 vision_tool，可以按需调用
    learner_modeling_agent = LearnerModelingAgent(
        config={
            "temperature": 0.0,
        },
        llm=None,
    )

    script_agent = ScriptAgent(
        config={"temperature": 0.1},
        llm=llm,
        vision_tool=vision_tool
    )

    animation_agent = AnimationAgent(
        config={
            "temperature": 0.05,
            "max_tokens": 16384,
            "canvas_config": {
                **MANIM_CANVAS_CONFIG,
                "prefer_mathtex": latex_ready,
                "formula_math_font_size": 24,
                "formula_text_font_size": 24,
            },
            "layout": "left_graph_right_formula",
            "output_dir": output_dir,
        },
        llm=animation_llm,
        vision_tool=vision_tool
    )

    voice_agent = VoiceAgent(
        config={
            "temperature": 0.05,
            "output_dir": output_dir,
            "tts_config": {
                "api_key": llm_config.get("api_key", ""),
                "base_url": llm_config.get("base_url", ""),
            }
        },
        llm=llm,
        vision_tool=vision_tool
    )

    repair_agent = RepairAgent(
        config={
            "temperature": 0.0,
            "use_llm_repair": False,
        },
        llm=llm,
    )

    merge_agent = MergeAgent(
        config={
            "temperature": 0.05,
            "output_dir": output_dir,
            "canvas_config": MANIM_CANVAS_CONFIG,
            "layout": "left_graph_right_formula",
            "manim_quality": "-ql",
            "render_timeout": 900,
            "max_repair_rounds": 3,
        },
        llm=llm
    )

    workflow = create_workflow(
        vision_agent=vision_agent,
        learner_modeling_agent=learner_modeling_agent,
        script_agent=script_agent,
        animation_agent=animation_agent,
        repair_agent=repair_agent,
        voice_agent=voice_agent,
        merge_agent=merge_agent,
        vision_tool=vision_tool
    )

    return workflow
