"""
Capability Registry - Capability/Tool separation inspired by DeepTutor.

DeepTutor separates Capability (what the system can do for learning) from
Tool (how the system does it). This provides a clean architecture:

Capabilities (learning-focused):
- course_generate, problem_video_generate, quiz_practice
- interactive_demo, ai_tutor_chat

Tools (infrastructure-focused):
- web_search, vision_parse, tts, manim_render
- student_profile, notebook

This separation allows:
1. Capabilities to compose multiple tools
2. Tools to be shared across capabilities
3. Clear dependency tracking
4. Feature flagging at capability level
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set
from datetime import datetime
import time


VALID_CAPABILITY_IDS = {
    "course_generate",
    "problem_video_generate",
    "quiz_practice",
    "interactive_demo",
    "ai_tutor_chat",
    "deep_solve",
    "deep_research",
    "math_animator",
    "visualize",
    "co_writer",
}

VALID_TOOL_IDS = {
    "web_search",
    "vision_parse",
    "tts",
    "manim_render",
    "student_profile",
    "notebook",
    "image_generation",
    "video_generation",
    "asr",
    "latex_render",
    "mermaid_render",
    "chart_render",
}


@dataclass
class Tool:
    """
    A tool is an infrastructure capability: web_search, tts, vision_parse, etc.
    Tools are shared across capabilities.
    """
    id: str
    name: str
    description: str
    available: bool = True
    config: Dict[str, Any] = field(default_factory=dict)
    provider: Optional[str] = None
    last_health_check: Optional[datetime] = None
    error_message: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "available": self.available,
            "config": self.config,
            "provider": self.provider,
            "last_health_check": self.last_health_check.isoformat() if self.last_health_check else None,
            "error_message": self.error_message,
        }


@dataclass
class Capability:
    """
    A capability is a learning-focused feature: course_generate, quiz_practice, etc.
    Capabilities depend on tools to function.
    """
    id: str
    name: str
    description: str
    required_tools: List[str] = field(default_factory=list)
    optional_tools: List[str] = field(default_factory=list)
    enabled: bool = True
    status: str = "available"
    config: Dict[str, Any] = field(default_factory=dict)
    icon: str = ""
    category: str = "generation"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "required_tools": self.required_tools,
            "optional_tools": self.optional_tools,
            "enabled": self.enabled,
            "status": self.status,
            "config": self.config,
            "icon": self.icon,
            "category": self.category,
        }


DEFAULT_CAPABILITIES = [
    Capability(
        id="course_generate",
        name="课程生成",
        description="根据学习主题自动生成结构化课程",
        required_tools=["web_search"],
        optional_tools=["image_generation", "video_generation", "tts"],
        icon="BookOpen",
        category="generation",
    ),
    Capability(
        id="problem_video_generate",
        name="题目视频生成",
        description="上传题目图片生成讲解视频",
        required_tools=["vision_parse", "manim_render", "tts"],
        optional_tools=["student_profile"],
        icon="Video",
        category="generation",
    ),
    Capability(
        id="quiz_practice",
        name="测验练习",
        description="生成并评分测验题目",
        required_tools=[],
        optional_tools=["student_profile"],
        icon="CircleHelp",
        category="practice",
    ),
    Capability(
        id="interactive_demo",
        name="互动演示",
        description="生成可交互的科学模拟",
        required_tools=[],
        optional_tools=[],
        icon="MousePointer2",
        category="practice",
    ),
    Capability(
        id="ai_tutor_chat",
        name="AI导师对话",
        description="与AI导师进行个性化对话学习",
        required_tools=[],
        optional_tools=["student_profile", "notebook", "web_search"],
        icon="MessageSquare",
        category="chat",
    ),
    Capability(
        id="deep_solve",
        name="深度解题",
        description="多智能体协作深度解题",
        required_tools=["vision_parse"],
        optional_tools=["web_search", "student_profile", "notebook"],
        icon="Brain",
        category="chat",
    ),
    Capability(
        id="deep_research",
        name="深度研究",
        description="多轮搜索与深度分析",
        required_tools=["web_search"],
        optional_tools=["notebook"],
        icon="Search",
        category="generation",
    ),
    Capability(
        id="math_animator",
        name="数学动画",
        description="生成数学概念动画讲解",
        required_tools=["manim_render", "tts"],
        optional_tools=[],
        icon="Play",
        category="visualization",
    ),
    Capability(
        id="visualize",
        name="可视化",
        description="生成图表和可视化内容",
        required_tools=["chart_render", "mermaid_render"],
        optional_tools=[],
        icon="BarChart3",
        category="visualization",
    ),
    Capability(
        id="co_writer",
        name="AI协作者",
        description="多文档Markdown协作工作区",
        required_tools=[],
        optional_tools=["notebook"],
        icon="PenTool",
        category="creation",
    ),
]

DEFAULT_TOOLS = [
    Tool(id="web_search", name="联网搜索", description="使用搜索引擎获取最新信息"),
    Tool(id="vision_parse", name="视觉解析", description="使用视觉模型理解图片内容"),
    Tool(id="tts", name="语音合成", description="将文本转换为语音"),
    Tool(id="manim_render", name="Manim渲染", description="使用Manim生成数学动画"),
    Tool(id="student_profile", name="学生画像", description="获取学生的学习画像和能力评估"),
    Tool(id="notebook", name="笔记本", description="保存和管理学习笔记"),
    Tool(id="image_generation", name="图像生成", description="使用AI生成教学配图"),
    Tool(id="video_generation", name="视频生成", description="使用AI生成教学视频"),
    Tool(id="asr", name="语音识别", description="将语音转换为文本"),
    Tool(id="latex_render", name="LaTeX渲染", description="渲染数学公式"),
    Tool(id="mermaid_render", name="Mermaid渲染", description="渲染Mermaid图表"),
    Tool(id="chart_render", name="图表渲染", description="使用Chart.js生成图表"),
]


class CapabilityRegistry:
    """
    Registry for capabilities and tools.
    
    Provides a centralized way to:
    - Register and discover capabilities
    - Track tool availability
    - Check capability dependencies
    - Manage feature flags
    """

    def __init__(self):
        self.capabilities: Dict[str, Capability] = {}
        self.tools: Dict[str, Tool] = {}
        self._health_checks: Dict[str, Callable] = {}

    def register_capability(self, capability: Capability) -> None:
        """Register a capability."""
        self.capabilities[capability.id] = capability

    def register_tool(self, tool: Tool) -> None:
        """Register a tool."""
        self.tools[tool.id] = tool

    def register_health_check(self, tool_id: str, check_fn: Callable) -> None:
        """Register a health check function for a tool."""
        self._health_checks[tool_id] = check_fn

    def get_capability(self, capability_id: str) -> Optional[Capability]:
        """Get a capability by ID."""
        return self.capabilities.get(capability_id)

    def get_tool(self, tool_id: str) -> Optional[Tool]:
        """Get a tool by ID."""
        return self.tools.get(tool_id)

    def is_capability_available(self, capability_id: str) -> bool:
        """Check if a capability is available (all required tools are available)."""
        capability = self.capabilities.get(capability_id)
        if not capability or not capability.enabled:
            return False
        
        return all(
            self.tools.get(tool_id, Tool(id=tool_id, name="", description="")).available
            for tool_id in capability.required_tools
        )

    def update_tool_availability(
        self,
        tool_id: str,
        available: bool,
        error_message: Optional[str] = None,
    ) -> None:
        """Update tool availability status."""
        tool = self.tools.get(tool_id)
        if tool:
            tool.available = available
            tool.last_health_check = datetime.utcnow()
            tool.error_message = error_message

    def run_health_checks(self) -> Dict[str, bool]:
        """Run all registered health checks and update tool availability."""
        results = {}
        for tool_id, check_fn in self._health_checks.items():
            try:
                available = check_fn()
                self.update_tool_availability(tool_id, available)
                results[tool_id] = available
            except Exception as exc:
                self.update_tool_availability(tool_id, False, str(exc))
                results[tool_id] = False
        return results

    def get_capabilities_using_tool(self, tool_id: str) -> List[Capability]:
        """Get all capabilities that use a specific tool."""
        result = []
        for capability in self.capabilities.values():
            if (
                tool_id in capability.required_tools
                or tool_id in capability.optional_tools
            ):
                result.append(capability)
        return result

    def get_effective_capabilities(self) -> List[Capability]:
        """Get all enabled and available capabilities."""
        return [
            cap
            for cap in self.capabilities.values()
            if cap.enabled and self.is_capability_available(cap.id)
        ]

    def get_capability_status(self) -> Dict[str, Dict[str, Any]]:
        """Get status of all capabilities."""
        result = {}
        for cap_id, capability in self.capabilities.items():
            available = self.is_capability_available(cap_id)
            missing_tools = [
                tool_id
                for tool_id in capability.required_tools
                if not self.tools.get(tool_id, Tool(id=tool_id, name="", description="")).available
            ]
            result[cap_id] = {
                "name": capability.name,
                "enabled": capability.enabled,
                "available": available,
                "missing_tools": missing_tools,
                "category": capability.category,
            }
        return result

    def to_dict(self) -> Dict[str, Any]:
        """Serialize registry to dictionary."""
        return {
            "capabilities": {
                cap_id: cap.to_dict()
                for cap_id, cap in self.capabilities.items()
            },
            "tools": {
                tool_id: tool.to_dict()
                for tool_id, tool in self.tools.items()
            },
        }

    @classmethod
    def with_defaults(cls) -> "CapabilityRegistry":
        """Create a registry with default capabilities and tools."""
        registry = cls()
        for capability in DEFAULT_CAPABILITIES:
            registry.register_capability(capability)
        for tool in DEFAULT_TOOLS:
            registry.register_tool(tool)
        return registry


def create_default_registry() -> CapabilityRegistry:
    """Create a capability registry with default capabilities and tools."""
    return CapabilityRegistry.with_defaults()
