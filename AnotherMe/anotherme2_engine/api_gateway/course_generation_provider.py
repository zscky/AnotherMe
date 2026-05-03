"""Course generation provider abstraction.

Allows routing course_generate between legacy behavior and the middle-school-math v1 flow.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Protocol

from .anotherme_client import AnotherMeClient
from .config import Settings


class CourseGenerationProvider(Protocol):
    def submit(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        ...

    def poll(self, job_id: str) -> Dict[str, Any]:
        ...


@dataclass
class LegacyCourseGenerationProvider:
    client: AnotherMeClient

    def submit(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.client.submit_course_job(payload)

    def poll(self, job_id: str) -> Dict[str, Any]:
        return self.client.poll_course_job(job_id)


@dataclass
class MiddleSchoolMathCourseGenerationProvider:
    client: AnotherMeClient

    def _with_default_pedagogy(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        next_payload = dict(payload)
        next_profile = dict(next_payload.get("pedagogy_profile") or {})
        next_profile.setdefault("domain", "middle-school-math")
        next_profile.setdefault("exam_orientation", "zhongkao")
        next_profile.setdefault("grade_band", "auto")
        next_profile.setdefault("strictness", "standard")
        next_payload["pedagogy_profile"] = next_profile
        return next_payload

    def submit(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self.client.submit_course_job(self._with_default_pedagogy(payload))

    def poll(self, job_id: str) -> Dict[str, Any]:
        return self.client.poll_course_job(job_id)


def create_course_generation_provider(
    settings: Settings,
    client: AnotherMeClient,
) -> CourseGenerationProvider:
    mode = (settings.course_generation_provider or "legacy").strip().lower()
    if mode == "msm_v1":
        return MiddleSchoolMathCourseGenerationProvider(client)
    return LegacyCourseGenerationProvider(client)
