/**
 * Media Generation Orchestrator
 *
 * Dispatches media generation API calls for all mediaGenerations across outlines.
 * Runs entirely on the frontend — calls /api/generate/image and /api/generate/video,
 * fetches result blobs, stores in IndexedDB, and updates the Zustand store.
 */

import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useSettingsStore } from '@/lib/store/settings';
import { db, mediaFileKey } from '@/lib/utils/database';
import type { SceneOutline } from '@/lib/types/generation';
import type { MediaGenerationRequest, VideoProviderId } from '@/lib/media/types';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import { createLogger } from '@/lib/logger';
import { recordMediaExperience, suggestFallbackVideoProvider } from '@/lib/media/media-experience';

const log = createLogger('MediaOrchestrator');
const MEDIA_GENERATION_MAX_CONCURRENCY = 2;
const VIDEO_GATEWAY_POLL_INTERVAL_MS = 1500;
const VIDEO_GATEWAY_TIMEOUT_MS = 10 * 60 * 1000;

/** Error with a structured errorCode from the API */
class MediaApiError extends Error {
  errorCode?: string;
  constructor(message: string, errorCode?: string) {
    super(message);
    this.errorCode = errorCode;
  }
}

/**
 * Launch media generation for all mediaGenerations declared in outlines.
 * Runs in parallel with content/action generation — does not block.
 */
export async function generateMediaForOutlines(
  outlines: SceneOutline[],
  stageId: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  const settings = useSettingsStore.getState();
  const store = useMediaGenerationStore.getState();

  // Collect all media requests
  const allRequests: MediaGenerationRequest[] = [];
  for (const outline of outlines) {
    if (!outline.mediaGenerations) continue;
    for (const mg of outline.mediaGenerations) {
      // Filter by enabled flags
      if (mg.type === 'image' && !settings.imageGenerationEnabled) continue;
      if (mg.type === 'video' && !settings.videoGenerationEnabled) continue;
      // Skip already completed or permanently failed (restored from DB)
      const existing = store.getTask(mg.elementId);
      if (existing?.status === 'done' || existing?.status === 'failed') continue;
      allRequests.push(mg);
    }
  }

  if (allRequests.length === 0) return;

  // Enqueue all as pending
  useMediaGenerationStore.getState().enqueueTasks(stageId, allRequests);

  // Process requests with limited concurrency to reduce end-to-end wait time
  const concurrency = Math.min(MEDIA_GENERATION_MAX_CONCURRENCY, allRequests.length);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (!abortSignal?.aborted) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= allRequests.length) return;
      await generateSingleMedia(allRequests[currentIndex], stageId, abortSignal);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
}

/**
 * Retry a single failed media task.
 */
export async function retryMediaTask(elementId: string): Promise<void> {
  const store = useMediaGenerationStore.getState();
  const task = store.getTask(elementId);
  if (!task || task.status !== 'failed') return;

  // Check if the corresponding generation type is still enabled in global settings
  const settings = useSettingsStore.getState();
  if (task.type === 'image' && !settings.imageGenerationEnabled) {
    store.markFailed(elementId, 'Generation disabled', 'GENERATION_DISABLED');
    return;
  }
  if (task.type === 'video' && !settings.videoGenerationEnabled) {
    store.markFailed(elementId, 'Generation disabled', 'GENERATION_DISABLED');
    return;
  }

  // Remove persisted failure record from DB so a fresh result can be written
  const dbKey = mediaFileKey(task.stageId, elementId);
  await db.mediaFiles.delete(dbKey).catch(() => {});

  store.markPendingForRetry(elementId);
  await generateSingleMedia(
    {
      type: task.type,
      prompt: task.prompt,
      elementId: task.elementId,
      aspectRatio: task.params.aspectRatio as MediaGenerationRequest['aspectRatio'],
      style: task.params.style,
    },
    task.stageId,
  );
}

// ==================== Internal ====================

async function generateSingleMedia(
  req: MediaGenerationRequest,
  stageId: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  const store = useMediaGenerationStore.getState();
  if (abortSignal?.aborted) {
    store.markPending(req.elementId);
    return;
  }
  store.markGenerating(req.elementId);

  try {
    let resultUrl: string;
    let posterUrl: string | undefined;
    let mimeType: string;

    if (req.type === 'image') {
      const result = await callImageApi(req, abortSignal);
      resultUrl = result.url;
      mimeType = 'image/png';
      await recordMediaExperience({
        kind: 'image',
        providerId: useSettingsStore.getState().imageProviderId,
        modelId: useSettingsStore.getState().imageModelId,
        success: true,
        strategy: 'direct',
      });
    } else {
      const result = await generateVideoWithRecovery(req, abortSignal);
      resultUrl = result.url;
      posterUrl = result.poster;
      mimeType = 'video/mp4';
    }

    if (abortSignal?.aborted) {
      store.markPending(req.elementId);
      return;
    }

    // Fetch blob from URL
    const blob = await fetchAsBlob(resultUrl, abortSignal);
    const posterBlob = posterUrl
      ? await fetchAsBlob(posterUrl, abortSignal).catch(() => undefined)
      : undefined;

    if (abortSignal?.aborted) {
      store.markPending(req.elementId);
      return;
    }

    // Store in IndexedDB
    await db.mediaFiles.put({
      id: mediaFileKey(stageId, req.elementId),
      stageId,
      type: req.type,
      blob,
      mimeType,
      size: blob.size,
      poster: posterBlob,
      prompt: req.prompt,
      params: JSON.stringify({
        aspectRatio: req.aspectRatio,
        style: req.style,
      }),
      createdAt: Date.now(),
    });

    // Update store with object URL
    const objectUrl = URL.createObjectURL(blob);
    const posterObjectUrl = posterBlob ? URL.createObjectURL(posterBlob) : undefined;
    useMediaGenerationStore.getState().markDone(req.elementId, objectUrl, posterObjectUrl);
  } catch (err) {
    if (abortSignal?.aborted) {
      store.markPending(req.elementId);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    const errorCode = err instanceof MediaApiError ? err.errorCode : undefined;
    log.error(`Failed ${req.elementId}:`, message);
    useMediaGenerationStore.getState().markFailed(req.elementId, message, errorCode);

    if (req.type === 'image') {
      await recordMediaExperience({
        kind: 'image',
        providerId: useSettingsStore.getState().imageProviderId,
        modelId: useSettingsStore.getState().imageModelId,
        success: false,
        errorCode,
        strategy: 'direct',
      });
    }

    // Persist non-retryable failures to IndexedDB so they survive page refresh
    if (errorCode) {
      await db.mediaFiles
        .put({
          id: mediaFileKey(stageId, req.elementId),
          stageId,
          type: req.type,
          blob: new Blob(), // empty placeholder
          mimeType: req.type === 'image' ? 'image/png' : 'video/mp4',
          size: 0,
          prompt: req.prompt,
          params: JSON.stringify({
            aspectRatio: req.aspectRatio,
            style: req.style,
          }),
          error: message,
          errorCode,
          createdAt: Date.now(),
        })
        .catch(() => {}); // best-effort
    }
  }
}

async function callImageApi(
  req: MediaGenerationRequest,
  abortSignal?: AbortSignal,
): Promise<{ url: string }> {
  const settings = useSettingsStore.getState();
  const providerConfig = settings.imageProvidersConfig?.[settings.imageProviderId];

  const response = await fetch('/api/generate/image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-image-provider': settings.imageProviderId || '',
      'x-image-model': settings.imageModelId || '',
      'x-api-key': providerConfig?.apiKey || '',
      'x-base-url': providerConfig?.baseUrl || '',
    },
    body: JSON.stringify({
      prompt: req.prompt,
      aspectRatio: req.aspectRatio,
      style: req.style,
    }),
    signal: abortSignal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new MediaApiError(data.error || `Image API returned ${response.status}`, data.errorCode);
  }

  const data = await response.json();
  if (!data.success)
    throw new MediaApiError(data.error || 'Image generation failed', data.errorCode);

  // Result may have url or base64
  const url =
    data.result?.url || (data.result?.base64 ? `data:image/png;base64,${data.result.base64}` : '');
  if (!url) throw new Error('No image URL in response');
  return { url };
}

async function callVideoApi(
  req: MediaGenerationRequest,
  abortSignal?: AbortSignal,
  override?: {
    providerId?: VideoProviderId;
    modelId?: string;
    prompt?: string;
  },
): Promise<{ url: string; poster?: string }> {
  const settings = useSettingsStore.getState();
  const providerId = override?.providerId || settings.videoProviderId;
  const modelId = override?.modelId || settings.videoModelId;
  const providerConfig = settings.videoProvidersConfig?.[providerId];
  const generationMode =
    String(process.env.NEXT_PUBLIC_VIDEO_GENERATION_MODE || '').toLowerCase() === 'gateway-job'
      ? 'gateway-job'
      : 'direct';

  const response = await fetch('/api/generate/video', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-video-provider': providerId || '',
      'x-video-model': modelId || '',
      'x-api-key': providerConfig?.apiKey || '',
      'x-base-url': providerConfig?.baseUrl || '',
      'x-video-generation-mode': generationMode,
    },
    body: JSON.stringify({
      prompt: override?.prompt || req.prompt,
      aspectRatio: req.aspectRatio,
    }),
    signal: abortSignal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new MediaApiError(data.error || `Video API returned ${response.status}`, data.errorCode);
  }

  const data = await response.json();

  if (response.status === 202 || data.job?.id) {
    const jobId = data.job?.id;
    if (!jobId || typeof jobId !== 'string') {
      throw new MediaApiError('Video gateway job created without job id', 'INTERNAL_ERROR');
    }

    const result = await pollVideoGatewayJob(jobId, abortSignal);
    const url = result?.url;
    if (!url) throw new MediaApiError('No video URL in gateway result', 'GENERATION_FAILED');
    return { url, poster: result?.poster };
  }

  if (!data.success)
    throw new MediaApiError(data.error || 'Video generation failed', data.errorCode);

  const url = data.result?.url;
  if (!url) throw new Error('No video URL in response');
  return { url, poster: data.result?.poster };
}

async function pollVideoGatewayJob(
  jobId: string,
  abortSignal?: AbortSignal,
): Promise<{ url: string; poster?: string }> {
  const deadline = Date.now() + VIDEO_GATEWAY_TIMEOUT_MS;

  while (!abortSignal?.aborted && Date.now() < deadline) {
    const response = await fetch(`/api/generate/video?jobId=${encodeURIComponent(jobId)}`, {
      method: 'GET',
      signal: abortSignal,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new MediaApiError(
        data.error || `Video gateway poll failed: ${response.status}`,
        data.errorCode,
      );
    }

    const data = await response.json();
    const job = data.job;
    if (!job || typeof job !== 'object') {
      throw new MediaApiError('Invalid video gateway job status response', 'INTERNAL_ERROR');
    }

    if (job.status === 'succeeded') {
      const url = job.result?.url;
      if (!url) {
        throw new MediaApiError('Gateway job succeeded but no video URL returned', 'GENERATION_FAILED');
      }
      return {
        url,
        poster: job.result?.poster,
      };
    }

    if (job.status === 'failed') {
      throw new MediaApiError(job.error || 'Video gateway job failed', job.errorCode);
    }

    await new Promise((resolve) => setTimeout(resolve, VIDEO_GATEWAY_POLL_INTERVAL_MS));
  }

  throw new MediaApiError('Video gateway job timed out', 'UPSTREAM_TIMEOUT');
}

function getErrorCode(error: unknown): string | undefined {
  if (error instanceof MediaApiError) {
    return error.errorCode;
  }
  return undefined;
}

function makeSafePrompt(prompt: string): string {
  const normalized = prompt.trim();
  if (!normalized) return normalized;
  return `${normalized}. Educational visual style, avoid realistic people, avoid sensitive content.`;
}

function getConfiguredVideoProviderIds(): VideoProviderId[] {
  const settings = useSettingsStore.getState();
  const ids = Object.keys(settings.videoProvidersConfig || {}) as VideoProviderId[];
  return ids.filter((providerId) => {
    const cfg = settings.videoProvidersConfig?.[providerId];
    return Boolean(cfg?.isServerConfigured || cfg?.apiKey);
  });
}

async function generateVideoWithRecovery(
  req: MediaGenerationRequest,
  abortSignal?: AbortSignal,
): Promise<{ url: string; poster?: string }> {
  const settings = useSettingsStore.getState();
  const currentProviderId = settings.videoProviderId;
  const currentModelId = settings.videoModelId;

  try {
    const result = await callVideoApi(req, abortSignal, {
      providerId: currentProviderId,
      modelId: currentModelId,
    });
    await recordMediaExperience({
      kind: 'video',
      providerId: currentProviderId,
      modelId: currentModelId,
      success: true,
      strategy: 'direct',
    });
    return result;
  } catch (error) {
    const directErrorCode = getErrorCode(error);
    await recordMediaExperience({
      kind: 'video',
      providerId: currentProviderId,
      modelId: currentModelId,
      success: false,
      errorCode: directErrorCode,
      strategy: 'direct',
    });

    if (abortSignal?.aborted) {
      throw error;
    }

    if (directErrorCode === 'CONTENT_SENSITIVE') {
      const softenedPrompt = makeSafePrompt(req.prompt);
      try {
        const softened = await callVideoApi(req, abortSignal, {
          providerId: currentProviderId,
          modelId: currentModelId,
          prompt: softenedPrompt,
        });
        await recordMediaExperience({
          kind: 'video',
          providerId: currentProviderId,
          modelId: currentModelId,
          success: true,
          strategy: 'soften_prompt',
        });
        return softened;
      } catch (softenError) {
        await recordMediaExperience({
          kind: 'video',
          providerId: currentProviderId,
          modelId: currentModelId,
          success: false,
          errorCode: getErrorCode(softenError),
          strategy: 'soften_prompt',
        });
      }
    }

    const configuredProviders = getConfiguredVideoProviderIds();
    const fallbackProviderId = await suggestFallbackVideoProvider({
      currentProviderId,
      configuredProviderIds: configuredProviders,
      lookback: 120,
    });

    if (fallbackProviderId && fallbackProviderId !== currentProviderId) {
      const fallbackModelId = VIDEO_PROVIDERS[fallbackProviderId]?.models?.[0]?.id;
      try {
        const fallbackResult = await callVideoApi(req, abortSignal, {
          providerId: fallbackProviderId,
          modelId: fallbackModelId,
        });
        await recordMediaExperience({
          kind: 'video',
          providerId: fallbackProviderId,
          modelId: fallbackModelId,
          success: true,
          strategy: 'fallback_provider',
        });
        return fallbackResult;
      } catch (fallbackError) {
        await recordMediaExperience({
          kind: 'video',
          providerId: fallbackProviderId,
          modelId: fallbackModelId,
          success: false,
          errorCode: getErrorCode(fallbackError),
          strategy: 'fallback_provider',
        });
      }
    }

    throw error;
  }
}

async function fetchAsBlob(url: string, abortSignal?: AbortSignal): Promise<Blob> {
  // For data URLs, convert directly
  if (url.startsWith('data:')) {
    const res = await fetch(url, { signal: abortSignal });
    return res.blob();
  }
  // For remote URLs, proxy through our server to bypass CORS restrictions
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const res = await fetch('/api/proxy-media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: abortSignal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Proxy fetch failed: ${res.status}`);
    }
    return res.blob();
  }
  // Relative URLs (shouldn't happen, but handle gracefully)
  const res = await fetch(url, { signal: abortSignal });
  if (!res.ok) throw new Error(`Failed to fetch blob: ${res.status}`);
  return res.blob();
}
