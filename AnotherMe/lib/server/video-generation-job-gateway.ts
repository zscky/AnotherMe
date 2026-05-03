import { randomUUID } from 'crypto';
import type { ApiErrorCode } from '@/lib/server/api-response';
import { API_ERROR_CODES } from '@/lib/server/api-response';
import type { VideoGenerationResult } from '@/lib/media/types';
import { classifyVideoGenerationError } from '@/lib/server/video-error-classifier';

export type VideoGenerationJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

interface VideoGenerationJobRecord {
  id: string;
  status: VideoGenerationJobStatus;
  createdAt: number;
  updatedAt: number;
  result?: VideoGenerationResult;
  error?: string;
  errorCode?: ApiErrorCode;
}

export interface VideoGenerationJobSnapshot {
  id: string;
  status: VideoGenerationJobStatus;
  createdAt: number;
  updatedAt: number;
  result?: VideoGenerationResult;
  error?: string;
  errorCode?: ApiErrorCode;
}

const JOB_TTL_MS = 30 * 60 * 1000;
const jobs = new Map<string, VideoGenerationJobRecord>();

function toSnapshot(record: VideoGenerationJobRecord): VideoGenerationJobSnapshot {
  return {
    id: record.id,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    result: record.result,
    error: record.error,
    errorCode: record.errorCode,
  };
}

function cleanupExpiredJobs(): void {
  const now = Date.now();
  for (const [id, record] of jobs.entries()) {
    if (now - record.updatedAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}

export function enqueueVideoGenerationJob(
  worker: () => Promise<VideoGenerationResult>,
): VideoGenerationJobSnapshot {
  cleanupExpiredJobs();

  const now = Date.now();
  const id = randomUUID();
  const record: VideoGenerationJobRecord = {
    id,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, record);

  void Promise.resolve().then(async () => {
    const current = jobs.get(id);
    if (!current) return;

    current.status = 'running';
    current.updatedAt = Date.now();

    try {
      current.result = await worker();
      current.status = 'succeeded';
      current.updatedAt = Date.now();
    } catch (error) {
      const classified = classifyVideoGenerationError(error);
      current.status = 'failed';
      current.error = classified.message || 'Video generation failed';
      current.errorCode = classified.code || API_ERROR_CODES.GENERATION_FAILED;
      current.updatedAt = Date.now();
    }
  });

  return toSnapshot(record);
}

export function getVideoGenerationJob(jobId: string): VideoGenerationJobSnapshot | null {
  cleanupExpiredJobs();
  const record = jobs.get(jobId);
  if (!record) return null;
  return toSnapshot(record);
}
