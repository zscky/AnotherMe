"""
状态定义 - 用于 LangGraph 的状态管理
"""
from typing import Dict, List, Any, Optional, TypedDict
from dataclasses import dataclass, field


@dataclass
class ScriptStep:
    """脚本步骤"""
    id: int
    title: str
    duration: float
    narration: str
    visual_cues: List[str]
    on_screen_texts: List[Dict[str, Any]] = field(default_factory=list)
    spoken_formulas: List[str] = field(default_factory=list)
    visible_segments: List[str] = field(default_factory=list)
    required_actions: List[Dict[str, Any]] = field(default_factory=list)
    auxiliary_line_actions: List[Dict[str, Any]] = field(default_factory=list)
    animation_policy: str = "auto"
    manim_code: Optional[str] = None
    audio_file: Optional[str] = None
    audio_duration: Optional[float] = None


@dataclass
class VideoProject:
    """视频项目完整状态"""
    # 输入
    problem_text: str = ""
    problem_image: Optional[str] = None  # 图片路径
    geometry_file: Optional[str] = None  # 显式几何定义文件
    export_ggb: bool = True              # 是否导出 GGB 调试指令

    # 脚本阶段输出
    script_steps: List[ScriptStep] = field(default_factory=list)
    total_duration: float = 0.0

    # 动画阶段输出
    manim_class_name: str = ""
    manim_file_path: Optional[str] = None
    animation_rendered: bool = False
    audio_embedded: bool = False  # 音频是否已通过 Manim add_sound 嵌入视频

    # 音频阶段输出
    tts_audio_files: List[str] = field(default_factory=list)
    background_music: Optional[str] = None
    sound_effects: List[str] = field(default_factory=list)
    audio_merged_file: Optional[str] = None

    # 合成阶段输出
    final_video_path: Optional[str] = None
    status: str = "pending"  # pending, running, completed, failed
    error_message: Optional[str] = None


class AgentState(TypedDict):
    """LangGraph 状态"""
    project: VideoProject
    messages: List[Dict[str, Any]]
    current_step: str
    metadata: Dict[str, Any]
