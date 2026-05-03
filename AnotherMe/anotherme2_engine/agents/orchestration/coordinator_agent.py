"""
协调器智能体 - 可选，用于复杂流程控制
简单线性流程可以不用协调器
"""
from typing import Dict, Any, Optional

from ..foundation.base_agent import BaseAgent
from ..foundation.state import VideoProject


class CoordinatorAgent(BaseAgent):
    """协调器智能体（可选）"""

    def __init__(self, config: Dict[str, Any], llm: Optional[Any] = None):
        super().__init__(config, llm)

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """协调器处理逻辑"""
        # 简单流程不需要协调器
        return state
