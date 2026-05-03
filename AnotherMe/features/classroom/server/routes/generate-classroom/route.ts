import { type NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { type GenerateClassroomInput } from '@/lib/server/classroom-generation';
import { createClassroomGenerationJob } from '@/lib/server/classroom-job-store';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import { getAuthenticatedUserFromRequest } from '@/lib/auth/session';
import { buildLearningContext } from '@/lib/server/learning-context';
import { createDefaultRuntime } from '@/lib/orchestration/capability-runtime';
import { createLearningContext } from '@/lib/types/learning-context';
import { globalStreamBus } from '@/lib/orchestration/stream-bus';
import { classroomGenerateHandler } from '@/lib/orchestration/handlers/classroom-generation-handler';
import { buildClassroomGenerationClassroomBook, saveClassroomBook } from '@/lib/server/classroom-book-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('GenerateClassroom API');

export const maxDuration = 30;

function gradeFromBand(band?: string): number | null {
  if (band === 'grade7') return 7;
  if (band === 'grade8') return 8;
  if (band === 'grade9') return 9;
  return null;
}

export async function POST(req: NextRequest) {
  let requirementSnippet: string | undefined;
  try {
    const rawBody = (await req.json()) as Partial<GenerateClassroomInput>;
    requirementSnippet = rawBody.requirement?.substring(0, 60);
    const body: GenerateClassroomInput = {
      requirement: rawBody.requirement || '',
      ...(rawBody.pdfContent ? { pdfContent: rawBody.pdfContent } : {}),
      ...(rawBody.language ? { language: rawBody.language } : {}),
      ...(rawBody.enableWebSearch != null ? { enableWebSearch: rawBody.enableWebSearch } : {}),
      ...(rawBody.enableImageGeneration != null
        ? { enableImageGeneration: rawBody.enableImageGeneration }
        : {}),
      ...(rawBody.enableVideoGeneration != null
        ? { enableVideoGeneration: rawBody.enableVideoGeneration }
        : {}),
      ...(rawBody.enableTTS != null ? { enableTTS: rawBody.enableTTS } : {}),
      ...(rawBody.agentMode ? { agentMode: rawBody.agentMode } : {}),
      ...(rawBody.pedagogy_profile ? { pedagogy_profile: rawBody.pedagogy_profile } : {}),
    };
    const { requirement } = body;

    if (!requirement) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: requirement');
    }

    let authUserId: string | undefined;
    try {
      const authUser = await getAuthenticatedUserFromRequest(req);
      authUserId = authUser?.id?.trim() || undefined;
      if (authUserId) {
        body.learningContext = await buildLearningContext({
          userId: authUserId,
          source: 'classroom',
          topic: requirement,
          language: body.language || 'zh-CN',
          grade: gradeFromBand(body.pedagogy_profile?.grade_band),
          extra: {
            hasPdf: Boolean(body.pdfContent),
            pdfTextLength: body.pdfContent?.text.length,
            pdfImageCount: body.pdfContent?.images.length,
            enableWebSearch: body.enableWebSearch,
            enableImageGeneration: body.enableImageGeneration,
            enableVideoGeneration: body.enableVideoGeneration,
            enableTTS: body.enableTTS,
          },
          enabledTools: [
            { id: 'course_generation', enabled: true, config: {} },
            { id: 'web_search', enabled: Boolean(body.enableWebSearch), config: {} },
            { id: 'media_generation', enabled: Boolean(body.enableImageGeneration || body.enableVideoGeneration), config: {} },
            { id: 'tts', enabled: Boolean(body.enableTTS), config: {} },
          ],
          lookbackDays: 14,
        });
      }
    } catch (error) {
      log.warn('Failed to build classroom LearningContext, continuing without it:', error);
    }

    const baseUrl = buildRequestOrigin(req);
    const jobId = nanoid(10);

    // Run through CapabilityRuntime for unified execution flow + ClassroomBook persistence
    const runtime = createDefaultRuntime({
      buildContext: async () => body.learningContext || createLearningContext(authUserId || 'anonymous', { metadata: { source: 'classroom', topic: null, language: 'zh-CN', grade: null, extra: {} } }),
      checkGuard: async () => ({ passed: true }),
      emitTrace: async (event) => {
        globalStreamBus.publish(event);
      },
      persistResult: async (result) => {
        const output = result.output as Record<string, unknown> | undefined;
        const resultJobId = typeof output?.jobId === 'string' ? output.jobId : jobId;
        const knowledgePointIds =
          (result.stages.find((s) => s.stage === 'post_process')?.output?.knowledgePointIds as string[] | undefined) || [];

        if (authUserId) {
          try {
            const book = buildClassroomGenerationClassroomBook({
              userId: authUserId,
              jobId: resultJobId,
              requirement,
              sourceCapability: 'course_generate',
              knowledgePointIds,
            });
            await saveClassroomBook(book);
          } catch {
            // Non-blocking: ClassroomBook persistence failure should not break classroom generation
          }
        }
      },
    });
    runtime.registerHandler(classroomGenerateHandler);

    const requestId = `cg-${authUserId || 'anon'}-${Date.now()}`;
    const capabilityRequest = {
      requestId,
      capabilityId: 'course_generate' as const,
      userId: authUserId || 'anonymous',
      payload: {
        input: body,
        baseUrl,
        jobId,
      },
      streaming: false,
      signal: req.signal,
    };

    let jobStatus: { jobId: string; status: string; step: string; pollUrl: string } | null = null;
    for await (const stageResult of runtime.run(capabilityRequest)) {
      if (stageResult.stage === 'complete' && stageResult.output) {
        jobStatus = {
          jobId: String(stageResult.output.jobId || jobId),
          status: String(stageResult.output.status || 'queued'),
          step: String(stageResult.output.step || 'queued'),
          pollUrl: String(stageResult.output.pollUrl || `${baseUrl}/api/generate-classroom/${jobId}`),
        };
      }
    }

    if (!jobStatus) {
      // Fallback if runtime didn't yield complete stage
      const job = await createClassroomGenerationJob(jobId, body);
      jobStatus = {
        jobId,
        status: job.status,
        step: job.step,
        pollUrl: `${baseUrl}/api/generate-classroom/${jobId}`,
      };
    }

    return apiSuccess(
      {
        jobId: jobStatus.jobId,
        status: jobStatus.status,
        step: jobStatus.step,
        message: 'Classroom generation job queued',
        pollUrl: jobStatus.pollUrl,
        pollIntervalMs: 5000,
      },
      202,
    );
  } catch (error) {
    log.error(
      `Classroom generation job creation failed [requirement="${requirementSnippet ?? 'unknown'}..."]:`,
      error,
    );
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to create classroom generation job',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
