import {
  createLearningContext,
  setToolEnabled,
  withStudentProfile,
  type EnabledTool,
  type LearningContext,
  type LearningContextMetadata,
  type StudentProfileSnapshot,
  type TeachingDecisionSnapshot,
  type KnowledgeTracingSnapshot,
} from '@/lib/types/learning-context';
import {
  getGatewayStudentProfile,
  getGatewayTeachingDecisions,
  getGatewayStudentKnowledgeContext,
  type GatewayLearningStats,
  type GatewayStudentProfile,
  type GatewayTeachingDecision,
} from '@/lib/server/anotherme2-gateway';
import { createLogger } from '@/lib/logger';
import { globalStreamBus } from '@/lib/orchestration/stream-bus';
import { createTraceEvent } from '@/lib/types/teaching-trace';

const log = createLogger('LearningContext');

export interface BuildLearningContextParams {
  userId: string;
  source: LearningContextMetadata['source'];
  classroomId?: string | null;
  sceneId?: string | null;
  aiSessionId?: string | null;
  problemVideoJobId?: string | null;
  topic?: string | null;
  language?: string | null;
  grade?: number | null;
  extra?: Record<string, unknown>;
  enabledTools?: EnabledTool[];
  includeStudentProfile?: boolean;
  lookbackDays?: number;
}

function compactRecord(input: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function normalizeLanguage(language?: string | null): string {
  return language?.trim() || 'zh-CN';
}

function mapLearningStats(stats: GatewayLearningStats): StudentProfileSnapshot['learningStats'] {
  return {
    recordsTotal: stats.records_total,
    records14d: stats.records_14d,
    activeDays14: stats.active_days_14,
    confusionRecords: stats.confusion_records,
    solvedRecords: stats.solved_records,
    topSubjects: stats.top_subjects,
    topKnowledgePoints: stats.top_knowledge_points,
  };
}

function mapGatewayProfile(profile: GatewayStudentProfile) {
  return {
    weakSubjects: profile.weak_subjects,
    weakKnowledgePoints: profile.weak_knowledge_points,
    abilityScores: profile.ability_scores.map((score) => ({
      metric: score.metric,
      value: score.value,
      fullMark: score.full_mark,
    })),
    recentFocus: profile.recent_focus,
    learningStats: mapLearningStats(profile.learning_stats),
  };
}

function mapTeachingDecision(decision: GatewayTeachingDecision): TeachingDecisionSnapshot {
  const validActions: TeachingDecisionSnapshot['action'][] = [
    'reteach',
    'give_hint',
    'worked_example',
    'variant_practice',
    'advance',
    'review_later',
  ];
  const action = validActions.includes(decision.action as TeachingDecisionSnapshot['action'])
    ? (decision.action as TeachingDecisionSnapshot['action'])
    : 'give_hint';
  return {
    knowledgePointId: decision.target_knowledge_point_id,
    mastery: decision.mastery,
    action,
    reason: decision.reason,
  };
}

export async function buildLearningContext(
  params: BuildLearningContextParams,
): Promise<LearningContext> {
  let context = createLearningContext(params.userId, {
    classroomId: params.classroomId || null,
    sceneId: params.sceneId || null,
    aiSessionId: params.aiSessionId || null,
    problemVideoJobId: params.problemVideoJobId || null,
    enabledTools: params.enabledTools || [],
    metadata: {
      source: params.source,
      topic: params.topic?.trim() || null,
      language: normalizeLanguage(params.language),
      grade: params.grade ?? null,
      extra: compactRecord(params.extra),
    },
  });

  for (const tool of params.enabledTools || []) {
    context = setToolEnabled(context, tool.id, tool.enabled, tool.config);
  }

  let profile: GatewayStudentProfile | null = null;

  if (params.includeStudentProfile !== false) {
    try {
      profile = await getGatewayStudentProfile({
        userId: params.userId,
        lookbackDays: params.lookbackDays,
      });
      context = withStudentProfile(context, mapGatewayProfile(profile));
    } catch (error) {
      log.warn('Failed to attach student profile to LearningContext:', error);
    }
  }

  // Knowledge Tracing: fetch teaching decisions for weakest knowledge points
  try {
    const decisions = await getGatewayTeachingDecisions({
      userId: params.userId,
    });
    // Take top 3 weakest (already sorted by mastery ascending from backend)
    const topDecisions = decisions.slice(0, 3).map(mapTeachingDecision);

    let weakestContext: string | null = null;
    if (topDecisions.length > 0) {
      try {
        const ctx = await getGatewayStudentKnowledgeContext({
          userId: params.userId,
          knowledgePointId: topDecisions[0].knowledgePointId,
        });
        weakestContext = ctx.context_text;
      } catch (ktCtxError) {
        log.warn('Failed to fetch KT context for weakest KP:', ktCtxError);
      }
    }

    const ktSnapshot: KnowledgeTracingSnapshot = {
      teachingDecisions: topDecisions,
      weakestKnowledgePointContext: weakestContext,
    };

    context = {
      ...context,
      knowledgeTracing: ktSnapshot,
      updatedAt: Date.now(),
    };

    globalStreamBus.publish(
      createTraceEvent(
        'learning_context_loaded',
        params.userId,
        {
          userId: params.userId,
          capabilityId: params.extra?.capabilityId || 'ai_tutor_chat',
          weakKnowledgePoints: profile?.weak_knowledge_points?.slice(0, 8) || [],
          teachingDecisionCount: topDecisions.length,
          enabledTools: context.enabledTools.filter((t) => t.enabled).map((t) => t.id),
        },
        { stage: 'context_build' },
      ),
    );
  } catch (ktError) {
    log.warn('Failed to attach knowledge tracing to LearningContext:', ktError);
  }

  return context;
}
