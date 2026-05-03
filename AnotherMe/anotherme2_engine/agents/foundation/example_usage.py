"""
DeepTutor Integration Usage Example.

This example demonstrates how all 5 innovations work together in a realistic
problem video generation workflow.
"""

from datetime import datetime
from agents.foundation import (
    LearningContext,
    LearningBlock,
    LearningEventEmitter,
    CapabilityRegistry,
    TraceEventEmitter,
    StudentProfileSnapshot,
    LearningStatsSummary,
    AbilityScore,
)


def example_problem_video_workflow():
    """
    Example: Problem video generation with full DeepTutor integration.
    
    This shows how the 5 innovations work together:
    1. LearningContext provides unified context
    2. LearningBlock tracks the video as a learning object
    3. LearningEvent captures student interactions
    4. CapabilityRegistry checks tool availability
    5. TraceEvent exposes workflow steps for visualization
    """
    
    print("=" * 60)
    print("DeepTutor Integration Example: Problem Video Generation")
    print("=" * 60)
    
    # Step 1: Create unified learning context
    print("\n[1] Creating LearningContext...")
    context = LearningContext(
        user_id="student-123",
        classroom_id=None,
        scene_id=None,
        ai_session_id="session-456",
        problem_video_job_id=None,
        metadata={
            "source": "problem_video",
            "topic": "勾股定理应用",
            "language": "zh-CN",
            "grade": 8,
        },
    )
    print(f"  Created context for user: {context.user_id}")
    print(f"  Topic: {context.metadata.topic}")
    print(f"  Grade: {context.metadata.grade}")
    
    # Step 2: Load student profile into context
    print("\n[2] Loading student profile...")
    profile = StudentProfileSnapshot(
        weak_subjects=["数学"],
        weak_knowledge_points=["勾股定理", "直角三角形"],
        ability_scores=[
            AbilityScore(metric="概念理解", value=45, full_mark=100),
            AbilityScore(metric="练习表现", value=52, full_mark=100),
            AbilityScore(metric="学习主动性", value=70, full_mark=100),
        ],
        learning_stats=LearningStatsSummary(
            records_total=120,
            records_14d=15,
            active_days_14=8,
            confusion_records=25,
            solved_records=45,
            top_subjects=["数学"],
            top_knowledge_points=["勾股定理", "一次方程"],
        ),
        snapshot_at=datetime.utcnow(),
    )
    context = context.with_student_profile(profile)
    print(f"  Weak subjects: {profile.weak_subjects}")
    print(f"  Weak knowledge points: {profile.weak_knowledge_points}")
    
    # Step 3: Check capability availability
    print("\n[3] Checking capability registry...")
    registry = CapabilityRegistry.with_defaults()
    
    is_available = registry.is_capability_available("problem_video_generate")
    print(f"  problem_video_generate available: {is_available}")
    
    status = registry.get_capability_status()
    for cap_id, cap_status in status.items():
        if cap_status["category"] == "generation":
            print(f"  {cap_status['name']}: {'✓' if cap_status['available'] else '✗'}")
    
    # Step 4: Initialize trace emitter for workflow visualization
    print("\n[4] Initializing trace emitter...")
    job_id = "job-video-789"
    trace_emitter = TraceEventEmitter(job_id=job_id)
    
    trace_emitter.start_step("vision", "Starting vision analysis...")
    trace_emitter.emit_knowledge_identified(
        step="vision",
        knowledge_points=["勾股定理", "直角三角形"],
        confidence=0.92,
        source="vision",
    )
    trace_emitter.complete_step("vision", "Vision analysis completed")
    
    trace_emitter.start_step("learner_modeling", "Starting learner modeling...")
    trace_emitter.emit_learner_profile_loaded(
        step="learner_modeling",
        user_id="student-123",
        weak_subjects=["数学"],
        weak_knowledge_points=["勾股定理", "直角三角形"],
        ability_scores=[
            {"metric": "概念理解", "value": 45},
            {"metric": "练习表现", "value": 52},
        ],
    )
    trace_emitter.emit_weakness_discovered(
        step="learner_modeling",
        knowledge_point="勾股定理",
        mastery_score=0.45,
        common_mistakes=["把斜边当直角边", "平方与开方计算错误"],
        suggested_remediation="使用面积拼图法重新讲解",
    )
    trace_emitter.emit_adaptive_plan(
        step="learner_modeling",
        mode="remedial",
        weak_knowledge_points=["勾股定理"],
        tts_profile={"rate": "-18%", "volume": "+12%", "pause_style": "strong"},
        visual_profile={
            "scaffold_level": "high",
            "highlight_intensity": "high",
            "blink_auxiliary_lines": True,
        },
    )
    trace_emitter.complete_step("learner_modeling", "Learner modeling completed")
    
    trace_emitter.start_step("script", "Generating script...")
    trace_emitter.complete_step("script", "Script generated")
    
    trace_emitter.start_step("tts", "Generating TTS...")
    trace_emitter.complete_step("tts", "TTS generated")
    
    trace_emitter.start_step("animation", "Generating Manim animation...")
    trace_emitter.emit_manim_error_fixed(
        step="animation",
        error_type="Text font not found",
        error_message="Font 'SimSun' not found",
        fix_applied="Replaced with 'WenQuanYi Micro Hei'",
        retry_count=1,
    )
    trace_emitter.complete_step("animation", "Animation generated")
    
    trace_emitter.start_step("merge", "Merging video...")
    trace_emitter.complete_step("merge", "Video merged successfully")
    
    # Print trace summary
    print("\n[5] Trace Event Summary:")
    knowledge_summary = trace_emitter.get_knowledge_summary()
    print(f"  Knowledge points identified: {knowledge_summary['identified']}")
    print(f"  Weaknesses discovered: {len(knowledge_summary['weaknesses'])}")
    for weakness in knowledge_summary['weaknesses']:
        print(f"    - {weakness['point']}: {round(weakness['mastery'] * 100)}% mastery")
    print(f"  Manim errors fixed: {knowledge_summary['errors_fixed']}")
    
    workflow_status = trace_emitter.get_workflow_status()
    print(f"\n  Workflow status: {workflow_status['status']}")
    print(f"  Progress: {workflow_status['progress']}%")
    print(f"  Completed steps: {workflow_status['completed_steps']}/{workflow_status['total_steps']}")
    
    # Step 5: Create learning block for the video
    print("\n[6] Creating LearningBlock...")
    block = LearningBlock(
        scene_id="scene-video-1",
        stage_id="stage-1",
        order=1,
        title="勾股定理讲解视频",
        content={
            "type": "video",
            "video_url": "http://example.com/video.mp4",
            "duration_seconds": 180,
        },
    )
    block.metadata.type = "video"
    block.metadata.learning_objectives = [
        "理解勾股定理的几何意义",
        "掌握勾股定理的公式 a² + b² = c²",
        "能够应用勾股定理解决实际问题",
    ]
    block.metadata.knowledge_points = ["勾股定理", "直角三角形"]
    block.metadata.generated_by = "problem_video_workflow"
    block.metadata.estimated_time_minutes = 5
    
    print(f"  Block created: {block.title}")
    print(f"  Type: {block.metadata.type}")
    print(f"  Knowledge points: {block.metadata.knowledge_points}")
    print(f"  Learning objectives: {len(block.metadata.learning_objectives)}")
    
    # Step 6: Simulate student watching the video and emit learning events
    print("\n[7] Simulating student interactions...")
    event_emitter = LearningEventEmitter(user_id="student-123")
    
    event_emitter.emit_video_watched(
        video_job_id=job_id,
        watch_duration_seconds=165,
        total_duration_seconds=180,
        knowledge_points=["勾股定理", "直角三角形"],
        paused_at=[30.5, 95.2],
        replayed_at=[45.0],
    )
    print("  Event: video_watched (91.7% completion)")
    
    event_emitter.emit_quiz_answered(
        question_id="quiz-1",
        selected_answers=["A"],
        correct_answers=["A"],
        knowledge_points=["勾股定理"],
        time_spent_ms=25000,
        attempt_number=1,
    )
    print("  Event: quiz_answered (correct, first attempt)")
    
    event_emitter.emit_quiz_answered(
        question_id="quiz-2",
        selected_answers=["B"],
        correct_answers=["C"],
        knowledge_points=["勾股定理"],
        time_spent_ms=45000,
        attempt_number=1,
    )
    print("  Event: quiz_answered (wrong)")
    
    event_emitter.emit_hint_used(
        knowledge_points=["勾股定理"],
        hint_id="hint-1",
        hint_content="注意斜边是最长边，公式为 a² + b² = c²",
        question_id="quiz-2",
    )
    print("  Event: hint_used")
    
    event_emitter.emit_quiz_answered(
        question_id="quiz-2",
        selected_answers=["C"],
        correct_answers=["C"],
        knowledge_points=["勾股定理"],
        time_spent_ms=30000,
        attempt_number=2,
    )
    print("  Event: quiz_answered (correct, second attempt)")
    
    # Step 7: Calculate mastery from events
    print("\n[8] Calculating knowledge point mastery...")
    mastery = event_emitter.calculate_knowledge_point_mastery("勾股定理")
    print(f"  勾股定理 mastery: {mastery['mastery']}")
    print(f"  Event count: {mastery['event_count']}")
    
    # Step 8: Convert events for LearnerModelingAgent
    print("\n[9] Converting events for LearnerModelingAgent...")
    events_for_agent = event_emitter.to_event_list_for_agent()
    print(f"  Events for agent: {len(events_for_agent)}")
    for event in events_for_agent:
        print(f"    - type={event['type']}, points={event['knowledge_points']}, weight={event['weight']}")
    
    # Step 9: Record attempt on the learning block
    print("\n[10] Recording block attempt...")
    block.record_attempt(
        success=True,
        score=75,
        time_spent_ms=195000,
        hints_used=["hint-1"],
        struggled_points=["勾股定理"],
    )
    print(f"  Block status: {block.metadata.status}")
    print(f"  Attempts: {len(block.metadata.attempts)}")
    print(f"  Mastery: {block.calculate_mastery()}")
    
    # Step 10: Update context with notebook reference
    print("\n[11] Updating LearningContext...")
    from agents.foundation import NotebookRef
    context = context.add_notebook_ref(NotebookRef(
        id="note-1",
        title="勾股定理学习笔记",
        source_scene_id="scene-video-1",
        content_type="problem_solution",
        saved_at=datetime.utcnow(),
    ))
    print(f"  Notebook refs: {len(context.notebook_refs)}")
    
    # Final summary
    print("\n" + "=" * 60)
    print("Integration Summary")
    print("=" * 60)
    print(f"  LearningContext: ✓ (user={context.user_id}, topic={context.metadata.topic})")
    print(f"  LearningBlock: ✓ (type={block.metadata.type}, status={block.metadata.status})")
    print(f"  LearningEvent: ✓ ({len(event_emitter.events)} events emitted)")
    print(f"  CapabilityRegistry: ✓ ({len(registry.capabilities)} capabilities registered)")
    print(f"  TraceEvent: ✓ ({len(trace_emitter.events)} trace events)")
    print("=" * 60)


if __name__ == "__main__":
    example_problem_video_workflow()
