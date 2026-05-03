import { createLogger } from '@/lib/logger';

const log = createLogger('CompileQueue');

export interface CompileTask {
  jobId: string;
  bookId: string;
  pageId: string;
  priority: number; // Higher = more urgent
  createdAt: number;
  retryCount: number;
}

export interface CompileQueueOptions {
  maxConcurrent?: number;
  retryLimit?: number;
  retryDelayMs?: number;
  taskTimeoutMs?: number;
}

export type CompileTaskHandler = (task: CompileTask) => Promise<void>;

class BookCompileQueue {
  private queue: CompileTask[] = [];
  private running = false;
  private activeTasks = new Map<string, AbortController>();
  private activeTaskMeta = new Map<string, CompileTask>();
  private pendingRetries = 0;
  private handler: CompileTaskHandler;
  private options: Required<CompileQueueOptions>;
  private processingPromise: Promise<void> | null = null;

  constructor(handler: CompileTaskHandler, options: CompileQueueOptions = {}) {
    this.handler = handler;
    this.options = {
      maxConcurrent: options.maxConcurrent ?? 2,
      retryLimit: options.retryLimit ?? 2,
      retryDelayMs: options.retryDelayMs ?? 5000,
      taskTimeoutMs: options.taskTimeoutMs ?? 120000,
    };
  }

  enqueue(task: Omit<CompileTask, 'createdAt' | 'retryCount'> & Partial<Pick<CompileTask, 'createdAt' | 'retryCount'>>): void {
    const fullTask: CompileTask = {
      jobId: task.jobId,
      bookId: task.bookId,
      pageId: task.pageId,
      priority: task.priority,
      createdAt: task.createdAt ?? Date.now(),
      retryCount: task.retryCount ?? 0,
    };

    // Insert by priority (higher first), then by creation time
    const insertIndex = this.queue.findIndex(
      (t) => t.priority < fullTask.priority ||
        (t.priority === fullTask.priority && t.createdAt > fullTask.createdAt)
    );

    if (insertIndex === -1) {
      this.queue.push(fullTask);
    } else {
      this.queue.splice(insertIndex, 0, fullTask);
    }

    log.info(`Task enqueued: book=${task.bookId}, page=${task.pageId}, priority=${task.priority}, queueSize=${this.queue.length}`);

    if (!this.running) {
      this.start();
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.processingPromise = this.processLoop();
    await this.processingPromise;
  }

  private async processLoop(): Promise<void> {
    while (this.running) {
      if (this.queue.length === 0) {
        this.running = false;
        break;
      }

      if (this.activeTasks.size >= this.options.maxConcurrent) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      const task = this.queue.shift()!;
      this.processTask(task);
    }
  }

  private async processTask(task: CompileTask): Promise<void> {
    const controller = new AbortController();
    const taskKey = `${task.bookId}:${task.pageId}`;
    this.activeTasks.set(taskKey, controller);
    this.activeTaskMeta.set(taskKey, task);

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Task timeout after ${this.options.taskTimeoutMs}ms`));
        }, this.options.taskTimeoutMs);

        controller.signal.addEventListener('abort', () => {
          clearTimeout(timer);
        });
      });

      await Promise.race([
        this.handler(task),
        timeoutPromise,
      ]);

      log.info(`Task completed: book=${task.bookId}, page=${task.pageId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      log.warn(`Task failed: book=${task.bookId}, page=${task.pageId}, error=${message}, retry=${task.retryCount}`);

      if (task.retryCount < this.options.retryLimit && !controller.signal.aborted) {
        // Retry with lower priority
        this.pendingRetries += 1;
        setTimeout(() => {
          this.pendingRetries = Math.max(0, this.pendingRetries - 1);
          this.enqueue({
            jobId: task.jobId,
            bookId: task.bookId,
            pageId: task.pageId,
            priority: Math.max(0, task.priority - 1),
            retryCount: task.retryCount + 1,
          });
        }, this.options.retryDelayMs);
      }
    } finally {
      this.activeTasks.delete(taskKey);
      this.activeTaskMeta.delete(taskKey);
    }
  }

  cancelPage(bookId: string, pageId: string): boolean {
    const taskKey = `${bookId}:${pageId}`;
    const controller = this.activeTasks.get(taskKey);
    if (controller) {
      controller.abort();
      this.activeTasks.delete(taskKey);
      this.activeTaskMeta.delete(taskKey);
      return true;
    }

    const queueIndex = this.queue.findIndex((t) => t.bookId === bookId && t.pageId === pageId);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
      return true;
    }

    return false;
  }

  cancelBook(bookId: string): number {
    let count = 0;

    // Cancel active tasks
    for (const [taskKey, controller] of this.activeTasks) {
      const task = this.activeTaskMeta.get(taskKey);
      if (task?.bookId === bookId) {
        controller.abort();
        this.activeTasks.delete(taskKey);
        this.activeTaskMeta.delete(taskKey);
        count++;
      }
    }

    // Remove queued tasks
    const beforeLength = this.queue.length;
    this.queue = this.queue.filter((t) => t.bookId !== bookId);
    count += beforeLength - this.queue.length;

    return count;
  }

  getStatus(bookId?: string): { queued: number; active: number; tasks: CompileTask[] } {
    const tasks = bookId
      ? this.queue.filter((t) => t.bookId === bookId)
      : [...this.queue];

    const active = bookId
      ? Array.from(this.activeTaskMeta.values()).filter((task) => task.bookId === bookId).length
      : this.activeTasks.size;

    return {
      queued: tasks.length,
      active: active + this.pendingRetries,
      tasks,
    };
  }

  async shutdown(): Promise<void> {
    this.running = false;

    // Cancel all active tasks
    for (const [, controller] of this.activeTasks) {
      controller.abort();
    }
    this.activeTasks.clear();

    // Clear queue
    this.queue = [];

    if (this.processingPromise) {
      await this.processingPromise.catch(() => {});
    }

    log.info('Compile queue shutdown complete');
  }
}

// Global queue manager
class CompileQueueManager {
  private queues = new Map<string, BookCompileQueue>();
  private defaultOptions: CompileQueueOptions = {
    maxConcurrent: 2,
    retryLimit: 2,
    retryDelayMs: 5000,
    taskTimeoutMs: 120000,
  };

  getOrCreateQueue(bookId: string, handler: CompileTaskHandler, options?: CompileQueueOptions): BookCompileQueue {
    const existing = this.queues.get(bookId);
    if (existing) return existing;

    const queue = new BookCompileQueue(handler, { ...this.defaultOptions, ...options });
    this.queues.set(bookId, queue);
    return queue;
  }

  getQueue(bookId: string): BookCompileQueue | undefined {
    return this.queues.get(bookId);
  }

  removeQueue(bookId: string): boolean {
    const queue = this.queues.get(bookId);
    if (queue) {
      void queue.shutdown();
      return this.queues.delete(bookId);
    }
    return false;
  }

  async shutdownAll(): Promise<void> {
    const shutdowns = Array.from(this.queues.values()).map((q) => q.shutdown());
    await Promise.all(shutdowns);
    this.queues.clear();
  }

  getAllStatus(): Record<string, { queued: number; active: number }> {
    const status: Record<string, { queued: number; active: number }> = {};
    for (const [bookId, queue] of this.queues) {
      const s = queue.getStatus();
      status[bookId] = { queued: s.queued, active: s.active };
    }
    return status;
  }
}

export const compileQueueManager = new CompileQueueManager();
export { BookCompileQueue };
