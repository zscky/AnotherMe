"""
Base agent utilities shared across the workflow.
"""

import time
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

from langchain_core.messages import HumanMessage, SystemMessage


class BaseAgent(ABC):
    """Base class for all agents."""

    def __init__(self, config: Dict[str, Any], llm: Optional[Any] = None):
        self.config = config
        self.llm = llm
        self.max_retries = int(config.get("max_retries", 3))
        self.retry_backoff_seconds = float(config.get("retry_backoff_seconds", 2.0))

    @abstractmethod
    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Process and return updated state."""

    def _format_messages(
        self,
        system_prompt: str,
        user_prompt: str,
        image_path: Optional[str] = None,
    ) -> list:
        messages = [SystemMessage(content=system_prompt)]
        if image_path:
            content = [
                {"type": "text", "text": user_prompt},
                {"type": "image_url", "image_url": {"url": f"file://{image_path}"}},
            ]
            messages.append(HumanMessage(content=content))
        else:
            messages.append(HumanMessage(content=user_prompt))
        return messages

    def _invoke_llm(self, messages: list) -> str:
        if self.llm is None:
            raise RuntimeError("LLM is not configured.")

        last_error: Optional[Exception] = None
        attempts = max(self.max_retries, 1)
        for attempt in range(attempts):
            try:
                response = self.llm.invoke(messages)
                return response.content
            except Exception as exc:
                last_error = exc
                if not self._is_retryable_llm_error(exc) or attempt >= attempts - 1:
                    raise
                sleep_seconds = self.retry_backoff_seconds * (2 ** attempt)
                print(
                    f"[{self.__class__.__name__}] LLM request hit a temporary limit; "
                    f"retrying in {sleep_seconds:.1f}s ({attempt + 1}/{attempts})"
                )
                time.sleep(sleep_seconds)

        if last_error is not None:
            raise last_error
        raise RuntimeError("LLM invocation failed without an exception.")

    def _is_retryable_llm_error(self, exc: Exception) -> bool:
        status_code = getattr(exc, "status_code", None)
        if status_code in {408, 409, 429, 500, 502, 503, 504}:
            return True

        error_text = f"{exc.__class__.__name__}: {exc}".lower()
        retry_markers = [
            "ratelimit",
            "rate limit",
            "toomanyrequests",
            "too many requests",
            "429",
            "temporarily unavailable",
            "timeout",
            "timed out",
            "connection reset",
            "server error",
            "service unavailable",
        ]
        return any(marker in error_text for marker in retry_markers)
