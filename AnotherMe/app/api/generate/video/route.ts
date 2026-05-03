/**
 * Video Generation API
 *
 * Generates a video from a text prompt using the specified provider.
 * Uses async task pattern (submit → poll) so maxDuration is set to 5 minutes.
 *
 * POST /api/generate/video
 *
 * Headers:
 *   x-video-provider: VideoProviderId (default: 'seedance')
 *   x-video-model: string (optional model override)
 *   x-api-key: string (optional, user fallback after server config)
 *   x-base-url: string (optional, user fallback after server config)
 *
 * Body: { prompt, duration?, aspectRatio?, resolution? }
 * Response: { success: boolean, result?: VideoGenerationResult, error?: string }
 */

import { NextRequest } from 'next/server';
import { generateVideo, normalizeVideoOptions } from '@/lib/media/video-providers';
import { resolveVideoApiKey, resolveVideoBaseUrl } from '@/lib/server/provider-config';
import type { VideoProviderId, VideoGenerationOptions } from '@/lib/media/types';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';
import { classifyVideoGenerationError } from '@/lib/server/video-error-classifier';
import {
  enqueueVideoGenerationJob,
  getVideoGenerationJob,
} from '@/lib/server/video-generation-job-gateway';

const log = createLogger('VideoGeneration API');

export const maxDuration = 300;

type VideoGenerationMode = 'direct' | 'gateway-job';

function resolveGenerationMode(request: NextRequest): VideoGenerationMode {
  const fromHeader = request.headers.get('x-video-generation-mode');
  if (fromHeader === 'gateway-job') {
    return 'gateway-job';
  }
  if (String(process.env.NEXT_PUBLIC_VIDEO_GENERATION_MODE || '').toLowerCase() === 'gateway-job') {
    return 'gateway-job';
  }
  return 'direct';
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId')?.trim();
  if (!jobId) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing jobId');
  }

  const job = getVideoGenerationJob(jobId);
  if (!job) {
    return apiError('FILE_NOT_FOUND', 404, `Video generation job not found: ${jobId}`);
  }

  return apiSuccess({ job });
}

export async function POST(request: NextRequest) {
  const providerHeader = request.headers.get('x-video-provider') || 'seedance';
  const modelHeader = request.headers.get('x-video-model') || 'default';

  try {
    const body = (await request.json()) as VideoGenerationOptions;

    if (!body.prompt) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing prompt');
    }

    const providerId = providerHeader as VideoProviderId;
    const clientApiKey = request.headers.get('x-api-key') || undefined;
    const clientBaseUrl = request.headers.get('x-base-url') || undefined;
    const clientModel = request.headers.get('x-video-model') || undefined;
    const generationMode = resolveGenerationMode(request);

    if (clientBaseUrl && process.env.NODE_ENV === 'production') {
      const ssrfError = validateUrlForSSRF(clientBaseUrl);
      if (ssrfError) {
        return apiError('INVALID_URL', 403, ssrfError);
      }
    }

    const apiKey = resolveVideoApiKey(providerId, clientApiKey);
    if (!apiKey) {
      return apiError(
        'MISSING_API_KEY',
        401,
        `No API key configured for video provider: ${providerId}`,
      );
    }

    const baseUrl = resolveVideoBaseUrl(providerId, clientBaseUrl);

    // Normalize options against provider capabilities
    const options = normalizeVideoOptions(providerId, body);

    log.info(
      `Generating video: provider=${providerId}, model=${clientModel || 'default'}, ` +
        `prompt="${body.prompt.slice(0, 80)}...", duration=${options.duration ?? 'auto'}, ` +
        `aspect=${options.aspectRatio ?? 'auto'}, resolution=${options.resolution ?? 'auto'}`,
    );

    const config = { providerId, apiKey, baseUrl, model: clientModel };

    if (generationMode === 'gateway-job') {
      const job = enqueueVideoGenerationJob(async () => generateVideo(config, options));
      log.info(`Video gateway job enqueued: job=${job.id}, provider=${providerId}, model=${clientModel || 'default'}`);
      return apiSuccess({ job }, 202);
    }

    const result = await generateVideo(config, options);

    log.info(
      `Video generated: url=${result.url ? 'yes' : 'no'}, ${result.width}x${result.height}, ${result.duration}s`,
    );

    return apiSuccess({ result });
  } catch (error) {
    const classified = classifyVideoGenerationError(error);
    if (classified.code === 'CONTENT_SENSITIVE') {
      log.warn(`Video blocked by content safety filter: ${classified.message}`);
    } else {
      log.error(
        `Video generation failed [provider=${providerHeader}, model=${modelHeader}]:`,
        error,
      );
    }
    return apiError(classified.code, classified.status, classified.message);
  }
}
