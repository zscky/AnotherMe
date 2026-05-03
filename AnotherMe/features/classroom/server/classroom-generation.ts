import { nanoid } from 'nanoid';
import { callLLM } from '@/lib/ai/llm';
import { createStageAPI } from '@/lib/api/stage-api';
import type { StageStore } from '@/lib/api/stage-api-types';
import {
  applyOutlineFallbacks,
  generateSceneOutlinesFromRequirements,
} from '@/lib/generation/outline-generator';
import {
  createSceneWithActions,
  generateSceneActions,
  generateSceneContent,
} from '@/lib/generation/scene-generator';
import type { AICallFn } from '@/lib/generation/pipeline-types';
import type { AgentInfo } from '@/lib/generation/pipeline-types';
import { formatTeacherPersonaForPrompt } from '@/lib/generation/prompt-formatters';
import { getRequiredClassroomAgentInfos } from '@/lib/orchestration/registry/classroom-presets';
import { createLogger } from '@/lib/logger';
import { parseModelString } from '@/lib/ai/providers';
import { resolveApiKey, resolveWebSearchApiKey } from '@/lib/server/provider-config';
import { resolveModel } from '@/lib/server/resolve-model';
import { buildSearchQuery } from '@/lib/server/search-query-builder';
import { searchWithTavily, formatSearchResultsAsContext } from '@/lib/web-search/tavily';
import { persistClassroom } from '@/lib/server/classroom-storage';
import {
  analyzeMiddleSchoolMathRequirement,
  applyMathQualityRecovery,
  buildMathLessonPlan,
  buildSceneMathGuidance,
  compileMathLessonPlanToOutlines,
  enrichOutlineForMiddleSchoolMath,
  normalizePedagogyProfile,
  runMathQualityGates,
} from '@/lib/server/course-engine';
import type {
  CourseGenerationAttempt,
  CourseGenerationMeta,
  PedagogyProfileInput,
  QualityGateReport,
} from '@/lib/server/course-engine';
import {
  generateMediaForClassroom,
  replaceMediaPlaceholders,
  generateTTSForClassroom,
} from '@/lib/server/classroom-media-generation';
import type { UserRequirements } from '@/lib/types/generation';
import type { Scene, Stage } from '@/lib/types/stage';
import type { LearningContext } from '@/lib/types/learning-context';

const log = createLogger('Classroom');

export interface GenerateClassroomInput {
  requirement: string;
  pdfContent?: { text: string; images: string[] };
  language?: string;
  enableWebSearch?: boolean;
  enableImageGeneration?: boolean;
  enableVideoGeneration?: boolean;
  enableTTS?: boolean;
  agentMode?: 'default' | 'generate';
  pedagogy_profile?: PedagogyProfileInput;
  learningContext?: LearningContext;
}

export type ClassroomGenerationStep =
  | 'initializing'
  | 'researching'
  | 'generating_outlines'
  | 'generating_scenes'
  | 'generating_media'
  | 'generating_tts'
  | 'persisting'
  | 'completed';

export interface ClassroomGenerationProgress {
  step: ClassroomGenerationStep;
  progress: number;
  message: string;
  scenesGenerated: number;
  totalScenes?: number;
}

export interface GenerateClassroomResult {
  id: string;
  url: string;
  stage: Stage;
  scenes: Scene[];
  scenesCount: number;
  createdAt: string;
  meta?: {
    quality_score?: number;
    engine_version?: string;
  };
}

function createInMemoryStore(stage: Stage): StageStore {
  let state = {
    stage: stage as Stage | null,
    scenes: [] as Scene[],
    currentSceneId: null as string | null,
    mode: 'playback' as const,
  };

  const listeners: Array<(s: typeof state, prev: typeof state) => void> = [];

  return {
    getState: () => state,
    setState: (partial: Partial<typeof state>) => {
      const prev = state;
      state = { ...state, ...partial };
      listeners.forEach((fn) => fn(state, prev));
    },
    subscribe: (listener: (s: typeof state, prev: typeof state) => void) => {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };
}

function normalizeLanguage(language?: string): 'zh-CN' | 'en-US' {
  return language === 'en-US' ? 'en-US' : 'zh-CN';
}

function fallbackQualityReport(): QualityGateReport {
  return {
    passed: true,
    score: 70,
    checks: [],
    failedChecks: [],
    failureReasons: [],
    targetedFixes: [],
  };
}

async function generateLegacyOutlines(params: {
  requirements: UserRequirements;
  pdfText?: string;
  aiCall: AICallFn;
  input: GenerateClassroomInput;
  researchContext?: string;
  teacherContext: string;
}) {
  const outlinesResult = await generateSceneOutlinesFromRequirements(
    params.requirements,
    params.pdfText,
    undefined,
    params.aiCall,
    undefined,
    {
      imageGenerationEnabled: params.input.enableImageGeneration,
      videoGenerationEnabled: params.input.enableVideoGeneration,
      researchContext: params.researchContext,
      teacherContext: params.teacherContext,
    },
  );

  if (!outlinesResult.success || !outlinesResult.data) {
    throw new Error(outlinesResult.error || 'Failed to generate scene outlines');
  }

  return outlinesResult.data;
}

export async function generateClassroom(
  input: GenerateClassroomInput,
  options: {
    baseUrl: string;
    onProgress?: (progress: ClassroomGenerationProgress) => Promise<void> | void;
  },
): Promise<GenerateClassroomResult> {
  const { requirement, pdfContent } = input;

  await options.onProgress?.({
    step: 'initializing',
    progress: 5,
    message: 'Initializing classroom generation',
    scenesGenerated: 0,
  });

  const { model: languageModel, modelInfo, modelString } = resolveModel({});
  log.info(`Using server-configured model: ${modelString}`);

  // Fail fast if the resolved provider has no API key configured
  const { providerId } = parseModelString(modelString);
  const apiKey = resolveApiKey(providerId);
  if (!apiKey) {
    throw new Error(
      `No API key configured for provider "${providerId}". ` +
        `Set the appropriate key in .env.local or server-providers.yml (e.g. ${providerId.toUpperCase()}_API_KEY).`,
    );
  }

  const aiCall: AICallFn = async (systemPrompt, userPrompt, _images) => {
    const result = await callLLM(
      {
        model: languageModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        maxOutputTokens: modelInfo?.outputWindow,
      },
      'generate-classroom',
    );
    return result.text;
  };

  const searchQueryAiCall: AICallFn = async (systemPrompt, userPrompt, _images) => {
    const result = await callLLM(
      {
        model: languageModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        maxOutputTokens: 256,
      },
      'web-search-query-rewrite',
    );
    return result.text;
  };

  const lang = normalizeLanguage(input.language);
  const requirements: UserRequirements = {
    requirement,
    language: lang,
  };
  const pdfText = pdfContent?.text || undefined;

  // Classroom role slots are fixed to guarantee mentor consistency across
  // side-panel tutoring and classroom teaching.
  const agentMode = input.agentMode || 'default';
  if (agentMode === 'generate') {
    log.info('agentMode=generate received; using fixed classroom role roster by design.');
  }
  const agents: AgentInfo[] = getRequiredClassroomAgentInfos();
  const teacherContext = formatTeacherPersonaForPrompt(agents);

  await options.onProgress?.({
    step: 'researching',
    progress: 10,
    message: 'Researching topic',
    scenesGenerated: 0,
  });

  // Web search (optional, graceful degradation)
  let researchContext: string | undefined;
  if (input.enableWebSearch) {
    const tavilyKey = resolveWebSearchApiKey();
    if (tavilyKey) {
      try {
        const searchQuery = await buildSearchQuery(requirement, pdfText, searchQueryAiCall);

        log.info('Running web search for classroom generation', {
          hasPdfContext: searchQuery.hasPdfContext,
          rawRequirementLength: searchQuery.rawRequirementLength,
          rewriteAttempted: searchQuery.rewriteAttempted,
          finalQueryLength: searchQuery.finalQueryLength,
        });

        const searchResult = await searchWithTavily({
          query: searchQuery.query,
          apiKey: tavilyKey,
        });
        researchContext = formatSearchResultsAsContext(searchResult);
        if (researchContext) {
          log.info(`Web search returned ${searchResult.sources.length} sources`);
        }
      } catch (e) {
        log.warn('Web search failed, continuing without search context:', e);
      }
    } else {
      log.warn('enableWebSearch is true but no Tavily API key configured, skipping web search');
    }
  }

  await options.onProgress?.({
    step: 'generating_outlines',
    progress: 15,
    message: 'Generating scene outlines',
    scenesGenerated: 0,
  });
  const requirementAnalysis = analyzeMiddleSchoolMathRequirement({
    requirement,
    language: lang,
    pedagogyProfile: input.pedagogy_profile,
    pdfText,
  });
  const resolvedPedagogyProfile = normalizePedagogyProfile(
    input.pedagogy_profile,
    requirementAnalysis.gradeBand,
  );

  let lessonPlan = buildMathLessonPlan(requirementAnalysis);
  let outlines = compileMathLessonPlanToOutlines(lessonPlan).map((outline, index) =>
    enrichOutlineForMiddleSchoolMath({
      outline,
      analysis: requirementAnalysis,
      plan: lessonPlan,
      index,
    }),
  );

  const generationAttempts: CourseGenerationAttempt[] = [];
  let usedLegacyFallback = false;
  let qualityReport = runMathQualityGates({
    analysis: requirementAnalysis,
    plan: lessonPlan,
    outlines,
  });
  generationAttempts.push({
    attempt: 1,
    quality: qualityReport,
    outlinesCount: outlines.length,
    recovered: false,
  });

  if (!qualityReport.passed) {
    lessonPlan = applyMathQualityRecovery(lessonPlan, qualityReport);
    outlines = compileMathLessonPlanToOutlines(lessonPlan).map((outline, index) =>
      enrichOutlineForMiddleSchoolMath({
        outline,
        analysis: requirementAnalysis,
        plan: lessonPlan,
        index,
      }),
    );
    qualityReport = runMathQualityGates({
      analysis: requirementAnalysis,
      plan: lessonPlan,
      outlines,
    });
    generationAttempts.push({
      attempt: 2,
      quality: qualityReport,
      outlinesCount: outlines.length,
      recovered: true,
    });
  }

  if (!qualityReport.passed || outlines.length === 0) {
    usedLegacyFallback = true;
    log.warn('Math lesson quality gate failed, falling back to legacy outline generation', {
      qualityScore: qualityReport.score,
      failedChecks: qualityReport.failedChecks.map((item) => item.name),
    });
    outlines = await generateLegacyOutlines({
      requirements,
      pdfText,
      aiCall,
      input,
      researchContext,
      teacherContext,
    });
    qualityReport = fallbackQualityReport();
    generationAttempts.push({
      attempt: generationAttempts.length + 1,
      quality: qualityReport,
      outlinesCount: outlines.length,
      recovered: true,
    });
  }

  const generationMeta: CourseGenerationMeta = {
    engineVersion: usedLegacyFallback ? 'legacy' : 'msm_v1',
    engineProvider: usedLegacyFallback ? 'legacy' : 'msm_v1',
    pedagogyProfile: resolvedPedagogyProfile,
    requirementAnalysis,
    lessonPlanSummary: {
      planId: lessonPlan.planId,
      segmentCount: lessonPlan.segments.length,
      checkpointCount: lessonPlan.assessmentCheckpoints.length,
    },
    qualityReport,
    attempts: generationAttempts,
    ...(input.learningContext ? { learningContext: input.learningContext } : {}),
  };

  log.info(`Generated ${outlines.length} scene outlines`);

  await options.onProgress?.({
    step: 'generating_outlines',
    progress: 30,
    message: `Generated ${outlines.length} scene outlines`,
    scenesGenerated: 0,
    totalScenes: outlines.length,
  });

  const stageId = nanoid(10);
  const stage: Stage = {
    id: stageId,
    name: outlines[0]?.title || requirement.slice(0, 50),
    description: undefined,
    language: lang,
    style: 'interactive',
    agentIds: agents.map((agent) => agent.id),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const store = createInMemoryStore(stage);
  const api = createStageAPI(store);

  log.info('Stage 2: Generating scene content and actions...');
  let generatedScenes = 0;

  for (const [index, outline] of outlines.entries()) {
    const safeOutline = applyOutlineFallbacks(outline, true);
    const progressStart = 30 + Math.floor((index / Math.max(outlines.length, 1)) * 60);

    await options.onProgress?.({
      step: 'generating_scenes',
      progress: Math.max(progressStart, 31),
      message: `Generating scene ${index + 1}/${outlines.length}: ${safeOutline.title}`,
      scenesGenerated: generatedScenes,
      totalScenes: outlines.length,
    });

    const content = await generateSceneContent(
      safeOutline,
      aiCall,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      agents,
    );
    if (!content) {
      log.warn(`Skipping scene "${safeOutline.title}" — content generation failed`);
      continue;
    }

    const sceneMathGuidance = buildSceneMathGuidance({
      analysis: requirementAnalysis,
      sceneOrder: index + 1,
      totalScenes: outlines.length,
    });
    const actions = await generateSceneActions(
      safeOutline,
      content,
      aiCall,
      undefined,
      agents,
      sceneMathGuidance,
    );
    log.info(`Scene "${safeOutline.title}": ${actions.length} actions`);

    const sceneId = createSceneWithActions(safeOutline, content, actions, api);
    if (!sceneId) {
      log.warn(`Skipping scene "${safeOutline.title}" — scene creation failed`);
      continue;
    }

    generatedScenes += 1;
    const progressEnd = 30 + Math.floor(((index + 1) / Math.max(outlines.length, 1)) * 60);
    await options.onProgress?.({
      step: 'generating_scenes',
      progress: Math.min(progressEnd, 90),
      message: `Generated ${generatedScenes}/${outlines.length} scenes`,
      scenesGenerated: generatedScenes,
      totalScenes: outlines.length,
    });
  }

  const scenes = store.getState().scenes;
  log.info(`Pipeline complete: ${scenes.length} scenes generated`);

  if (scenes.length === 0) {
    throw new Error('No scenes were generated');
  }

  // Phase: Media generation (after all scenes generated)
  if (input.enableImageGeneration || input.enableVideoGeneration) {
    await options.onProgress?.({
      step: 'generating_media',
      progress: 90,
      message: 'Generating media files',
      scenesGenerated: scenes.length,
      totalScenes: outlines.length,
    });

    try {
      const mediaMap = await generateMediaForClassroom(outlines, stageId, options.baseUrl);
      replaceMediaPlaceholders(scenes, mediaMap);
      log.info(`Media generation complete: ${Object.keys(mediaMap).length} files`);
    } catch (err) {
      log.warn('Media generation phase failed, continuing:', err);
    }
  }

  // Phase: TTS generation
  if (input.enableTTS) {
    await options.onProgress?.({
      step: 'generating_tts',
      progress: 94,
      message: 'Generating TTS audio',
      scenesGenerated: scenes.length,
      totalScenes: outlines.length,
    });

    try {
      await generateTTSForClassroom(scenes, stageId, options.baseUrl);
      log.info('TTS generation complete');
    } catch (err) {
      log.warn('TTS generation phase failed, continuing:', err);
    }
  }

  await options.onProgress?.({
    step: 'persisting',
    progress: 98,
    message: 'Persisting classroom data',
    scenesGenerated: scenes.length,
    totalScenes: outlines.length,
  });

  const persisted = await persistClassroom(
    {
      id: stageId,
      stage,
      scenes,
      generationMeta,
    },
    options.baseUrl,
  );

  log.info(`Classroom persisted: ${persisted.id}, URL: ${persisted.url}`);

  await options.onProgress?.({
    step: 'completed',
    progress: 100,
    message: 'Classroom generation completed',
    scenesGenerated: scenes.length,
    totalScenes: outlines.length,
  });

  return {
    id: persisted.id,
    url: persisted.url,
    stage,
    scenes,
    scenesCount: scenes.length,
    createdAt: persisted.createdAt,
    meta: {
      quality_score: qualityReport.score,
      engine_version: generationMeta.engineVersion,
    },
  };
}
