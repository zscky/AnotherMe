import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '@/lib/logger';
import { generateClassroom, type GenerateClassroomInput } from '@/lib/server/classroom-generation';
import {
  markClassroomGenerationJobFailed,
  markClassroomGenerationJobRunning,
  markClassroomGenerationJobSucceeded,
  updateClassroomGenerationJobProgress,
} from '@/lib/server/classroom-job-store';
import { CLASSROOM_JOBS_DIR } from '@/lib/server/classroom-storage';

const log = createLogger('ClassroomJob');
const runningJobs = new Map<string, Promise<void>>();
const RUN_LOCK_STALE_MS = 35 * 60 * 1000;

function runLockPath(jobId: string) {
  return path.join(CLASSROOM_JOBS_DIR, `${jobId}.run.lock`);
}

async function acquireRunLock(jobId: string): Promise<boolean> {
  await fs.mkdir(CLASSROOM_JOBS_DIR, { recursive: true });
  const lockPath = runLockPath(jobId);
  try {
    const fd = await fs.open(lockPath, 'wx');
    try {
      await fd.writeFile(JSON.stringify({ pid: process.pid, ts: Date.now() }), 'utf-8');
    } finally {
      await fd.close();
    }
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') throw error;

    try {
      const stat = await fs.stat(lockPath);
      if (Date.now() - stat.mtimeMs > RUN_LOCK_STALE_MS) {
        await fs.unlink(lockPath);
        const fd = await fs.open(lockPath, 'wx');
        try {
          await fd.writeFile(JSON.stringify({ pid: process.pid, ts: Date.now() }), 'utf-8');
        } finally {
          await fd.close();
        }
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }
}

async function releaseRunLock(jobId: string): Promise<void> {
  try {
    await fs.unlink(runLockPath(jobId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn(`Failed to release classroom run lock for ${jobId}:`, error);
    }
  }
}

export function runClassroomGenerationJob(
  jobId: string,
  input: GenerateClassroomInput,
  baseUrl: string,
): Promise<void> {
  const existing = runningJobs.get(jobId);
  if (existing) {
    return existing;
  }

  const jobPromise = (async () => {
    const acquired = await acquireRunLock(jobId);
    if (!acquired) {
      log.info(`Skip classroom job ${jobId}: lock already held by another runner`);
      return;
    }
    try {
      await markClassroomGenerationJobRunning(jobId);

      const result = await generateClassroom(input, {
        baseUrl,
        onProgress: async (progress) => {
          await updateClassroomGenerationJobProgress(jobId, progress);
        },
      });

      await markClassroomGenerationJobSucceeded(jobId, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Classroom generation job ${jobId} failed:`, error);
      try {
        await markClassroomGenerationJobFailed(jobId, message);
      } catch (markFailedError) {
        log.error(`Failed to persist failed status for job ${jobId}:`, markFailedError);
      }
    } finally {
      await releaseRunLock(jobId);
      runningJobs.delete(jobId);
    }
  })();

  runningJobs.set(jobId, jobPromise);
  return jobPromise;
}
