import type { VideoProviderId } from '@/lib/media/types';
import { db } from '@/lib/utils/database';

export type MediaRecoveryStrategy = 'direct' | 'soften_prompt' | 'fallback_provider';

export interface MediaExperienceInput {
  kind: 'image' | 'video';
  providerId: string;
  modelId?: string;
  success: boolean;
  errorCode?: string;
  strategy: MediaRecoveryStrategy;
  createdAt?: number;
}

export async function recordMediaExperience(input: MediaExperienceInput): Promise<void> {
  await db.mediaGenerationExperiences
    .add({
      kind: input.kind,
      providerId: input.providerId,
      modelId: input.modelId,
      success: input.success,
      errorCode: input.errorCode,
      strategy: input.strategy,
      createdAt: input.createdAt || Date.now(),
    })
    .catch(() => {
      // best-effort only
    });
}

export async function suggestFallbackVideoProvider(params: {
  currentProviderId: VideoProviderId;
  configuredProviderIds: VideoProviderId[];
  lookback: number;
}): Promise<VideoProviderId | null> {
  const candidates = params.configuredProviderIds.filter((id) => id !== params.currentProviderId);
  if (candidates.length === 0) {
    return null;
  }

  const records = await db.mediaGenerationExperiences
    .where('kind')
    .equals('video')
    .reverse()
    .limit(Math.max(20, params.lookback))
    .toArray()
    .catch(() => []);

  if (records.length === 0) {
    return candidates[0] || null;
  }

  const stats = new Map<VideoProviderId, { ok: number; fail: number }>();
  for (const providerId of candidates) {
    stats.set(providerId, { ok: 0, fail: 0 });
  }

  for (const record of records) {
    const providerId = record.providerId as VideoProviderId;
    const bucket = stats.get(providerId);
    if (!bucket) continue;
    if (record.success) bucket.ok += 1;
    else bucket.fail += 1;
  }

  let bestProvider: VideoProviderId | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const [providerId, bucket] of stats.entries()) {
    const total = bucket.ok + bucket.fail;
    const successRate = total > 0 ? bucket.ok / total : 0;
    const score = successRate * 10 + bucket.ok - bucket.fail;
    if (score > bestScore) {
      bestScore = score;
      bestProvider = providerId;
    }
  }

  return bestProvider || candidates[0] || null;
}
