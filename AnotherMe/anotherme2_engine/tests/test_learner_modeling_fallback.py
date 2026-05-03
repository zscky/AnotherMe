from __future__ import annotations

from agents.planning.learner_modeling_agent import LearnerModelingAgent
from agents.foundation.state import VideoProject
from agents.foundation.state_contracts import wrap_agent_node


def test_wrap_agent_node_records_fallback_event_on_exception():
    def _failing_node(_state):
        raise TimeoutError("llm timed out")

    wrapped = wrap_agent_node("script", _failing_node)
    state = {
        "project": VideoProject(problem_text="求解 x"),
        "messages": [],
        "current_step": "start",
        "metadata": {},
    }

    result = wrapped(state)
    assert result["current_step"] == "script_failed"
    assert result["metadata"]["fallback_level"] == "critical"
    events = result["metadata"].get("fallback_events") or []
    assert len(events) == 1
    assert events[0]["stage"] == "script.node_execution"
    assert events[0]["retryable"] is False


def test_learner_modeling_agent_applies_memory_bundle_with_parallel_subagents():
    agent = LearnerModelingAgent(config={"parallel_subagents": 3}, llm=None)
    state = {
        "project": VideoProject(problem_text="已知直角三角形，求斜边长度"),
        "messages": [],
        "current_step": "start",
        "metadata": {
            "learner_memory": {
                "user_id": "stu-123",
                "session_id": "sess-123",
                "profile_snapshot": {
                    "weak_subjects": ["数学"],
                    "weak_knowledge_points": ["勾股定理"],
                    "ability_scores": [
                        {"metric": "概念理解", "value": 40},
                        {"metric": "学习主动性", "value": 82},
                    ],
                },
                "recent_learning_records": [
                    {
                        "knowledge_point": "勾股定理",
                        "confusion_flag": True,
                        "solved_flag": False,
                        "difficulty": "hard",
                    }
                ],
                "derived_learning_events": [
                    {"type": "not_understood", "knowledge_points": ["勾股定理"], "weight": 1.2}
                ],
            }
        },
    }

    updated = agent.process(state)
    metadata = updated["metadata"]
    profile = metadata["learner_profile"]
    report = metadata["parallel_subagent_report"]

    assert profile["learner_id"] == "stu-123"
    assert "勾股定理" in metadata["required_knowledge"]
    assert len(metadata.get("learning_events") or []) >= 1
    assert report["used_parallel"] is True
    assert set(report["tasks"]) >= {"learning_events", "profile_hints", "required_knowledge_hints"}
