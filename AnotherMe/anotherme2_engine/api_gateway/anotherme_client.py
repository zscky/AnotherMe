"""Client adapter for AnotherMe backend APIs."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Dict

import httpx


class AnotherMeError(RuntimeError):
    pass


@dataclass
class AnotherMeClient:
    base_url: str
    timeout_seconds: int = 30
    _client: httpx.Client | None = field(default=None, init=False, repr=False)

    def _get_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                timeout=self.timeout_seconds,
                limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
            )
        return self._client

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    def _unwrap(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if "data" in payload and isinstance(payload["data"], dict):
            return payload["data"]
        if "result" in payload and isinstance(payload["result"], dict):
            return payload["result"]
        return payload

    def _post(self, path: str, json_body: Dict[str, Any]) -> Dict[str, Any]:
        client = self._get_client()
        response = client.post(f"{self.base_url.rstrip('/')}{path}", json=json_body)
        if response.status_code >= 400:
            raise AnotherMeError(f"AnotherMe POST {path} failed: {response.status_code} {response.text}")
        return self._unwrap(response.json())

    def _get(self, path: str) -> Dict[str, Any]:
        client = self._get_client()
        response = client.get(f"{self.base_url.rstrip('/')}{path}")
        if response.status_code >= 400:
            raise AnotherMeError(f"AnotherMe GET {path} failed: {response.status_code} {response.text}")
        return self._unwrap(response.json())

    def submit_course_job(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        body = {
            "requirement": payload["requirement"],
            "language": payload.get("language", "zh-CN"),
            "enableWebSearch": payload.get("options", {}).get("enable_web_search", False),
            "enableImageGeneration": payload.get("options", {}).get("enable_image_generation", False),
            "enableVideoGeneration": payload.get("options", {}).get("enable_video_generation", False),
            "enableTTS": payload.get("options", {}).get("enable_tts", False),
            "agentMode": payload.get("options", {}).get("agent_mode", "default"),
        }
        pedagogy_profile = payload.get("pedagogy_profile")
        if isinstance(pedagogy_profile, dict) and pedagogy_profile:
            body["pedagogy_profile"] = pedagogy_profile
        return self._post("/api/generate-classroom", body)

    def poll_course_job(self, anotherme_job_id: str) -> Dict[str, Any]:
        return self._get(f"/api/generate-classroom/{anotherme_job_id}")

    def wait_course_job(self, anotherme_job_id: str, poll_seconds: int, timeout_seconds: int) -> Dict[str, Any]:
        start = time.time()
        while True:
            data = self.poll_course_job(anotherme_job_id)
            if data.get("done") or data.get("status") in {"succeeded", "failed"}:
                return data
            if time.time() - start > timeout_seconds:
                raise AnotherMeError(f"AnotherMe job timeout: {anotherme_job_id}")
            time.sleep(max(poll_seconds, 1))

    def get_classroom(self, classroom_id: str) -> Dict[str, Any]:
        return self._get(f"/api/classroom?id={classroom_id}")
