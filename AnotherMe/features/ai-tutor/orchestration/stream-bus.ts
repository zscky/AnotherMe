/**
 * StreamBus - Unified event bus for teaching trace events.
 *
 * All capability executions, KT updates, agent responses, and tool calls
 * flow through the StreamBus. This provides:
 * - Centralized logging and debugging
 * - Frontend replay timeline ("Why did the system do that?")
 * - Async analytics pipeline
 *
 * Usage:
 *   const bus = createStreamBus();
 *   bus.subscribe((event) => console.log(event));
 *   bus.publish(createTraceEvent('kt_decision_made', requestId, { ... }));
 */

import type { TeachingTraceEvent, TeachingTraceEventType } from '@/lib/types/teaching-trace';
import { promises as fs } from 'fs';
import path from 'path';

const TRACE_LOG_DIR = path.join(process.cwd(), '.workbuddy', 'teaching-traces');

function formatDateKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

async function ensureTraceDir(): Promise<void> {
  await fs.mkdir(TRACE_LOG_DIR, { recursive: true });
}

function traceFilePath(dateKey: string): string {
  return path.join(TRACE_LOG_DIR, `${dateKey}.jsonl`);
}

/**
 * File-backed trace sink. Appends events to a daily JSONL file.
 * Writes are fire-and-forget (async, errors are logged but not thrown).
 */
export class FileTraceSink {
  private pendingWrites = 0;
  private closed = false;

  constructor() {
    ensureTraceDir().catch(() => {});
  }

  async write(event: TeachingTraceEvent): Promise<void> {
    if (this.closed) return;
    this.pendingWrites++;
    try {
      const line = JSON.stringify(event) + '\n';
      const filePath = traceFilePath(formatDateKey(new Date(event.timestamp)));
      await fs.appendFile(filePath, line, 'utf-8');
    } catch (err) {
       
      console.error('[FileTraceSink] Write failed:', err);
    } finally {
      this.pendingWrites--;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    // Wait for pending writes to finish
    while (this.pendingWrites > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** Read events from a specific date file. */
  async readDate(dateKey: string): Promise<TeachingTraceEvent[]> {
    const filePath = traceFilePath(dateKey);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TeachingTraceEvent);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  /** Read events across multiple dates, optionally filtered. */
  async readRange(startDateKey: string, endDateKey: string, filter?: TraceFilter): Promise<TeachingTraceEvent[]> {
    const results: TeachingTraceEvent[] = [];
    const start = new Date(startDateKey);
    const end = new Date(endDateKey);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const events = await this.readDate(formatDateKey(d));
      results.push(...(filter ? events.filter(filter) : events));
    }
    return results;
  }
}

const fileSink = new FileTraceSink();

export type TraceListener = (event: TeachingTraceEvent) => void | Promise<void>;
export type TraceFilter = (event: TeachingTraceEvent) => boolean;

export interface StreamBus {
  /** Publish an event to all subscribers */
  publish: (event: TeachingTraceEvent) => void;
  /** Subscribe to all events */
  subscribe: (listener: TraceListener) => () => void;
  /** Subscribe to events matching a filter */
  subscribeFiltered: (filter: TraceFilter, listener: TraceListener) => () => void;
  /** Subscribe to events for a specific request */
  subscribeToRequest: (requestId: string, listener: TraceListener) => () => void;
  /** Get all events (optionally filtered) */
  getEvents: (filter?: TraceFilter) => TeachingTraceEvent[];
  /** Get events for a specific request */
  getRequestEvents: (requestId: string) => TeachingTraceEvent[];
  /** Get the last N events */
  getRecent: (count: number) => TeachingTraceEvent[];
  /** Clear buffered events */
  clear: () => void;
}

export interface StreamBusOptions {
  /** Max number of events to keep in memory buffer */
  maxBufferSize?: number;
  /** Whether to collect events in memory */
  bufferEvents?: boolean;
}

/**
 * Global StreamBus instance for the application.
 *
 * Use this for fire-and-forget trace publishing across the codebase.
 * For request-scoped replay, create a local bus and subscribe to the request.
 */
export const globalStreamBus = createStreamingBusWithSink(
  (event) => fileSink.write(event),
  { maxBufferSize: 2000, bufferEvents: true },
);

export function createStreamBus(options: StreamBusOptions = {}): StreamBus {
  const { maxBufferSize = 1000, bufferEvents = true } = options;
  const listeners = new Set<TraceListener>();
  const buffer: TeachingTraceEvent[] = [];

  function publish(event: TeachingTraceEvent): void {
    if (bufferEvents) {
      buffer.push(event);
      if (buffer.length > maxBufferSize) {
        buffer.splice(0, buffer.length - maxBufferSize);
      }
    }

    for (const listener of listeners) {
      try {
        const result = listener(event);
        if (result instanceof Promise) {
          result.catch((err) => {
             
            console.error('[StreamBus] Async listener error:', err);
          });
        }
      } catch (err) {
         
        console.error('[StreamBus] Sync listener error:', err);
      }
    }
  }

  function subscribe(listener: TraceListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function subscribeFiltered(filter: TraceFilter, listener: TraceListener): () => void {
    const wrapped: TraceListener = (event) => {
      if (filter(event)) {
        return listener(event);
      }
    };
    listeners.add(wrapped);
    return () => {
      listeners.delete(wrapped);
    };
  }

  function subscribeToRequest(requestId: string, listener: TraceListener): () => void {
    return subscribeFiltered((event) => event.requestId === requestId, listener);
  }

  function getEvents(filter?: TraceFilter): TeachingTraceEvent[] {
    if (!filter) return [...buffer];
    return buffer.filter(filter);
  }

  function getRequestEvents(requestId: string): TeachingTraceEvent[] {
    return buffer.filter((e) => e.requestId === requestId);
  }

  function getRecent(count: number): TeachingTraceEvent[] {
    return buffer.slice(-count);
  }

  function clear(): void {
    buffer.length = 0;
  }

  return {
    publish,
    subscribe,
    subscribeFiltered,
    subscribeToRequest,
    getEvents,
    getRequestEvents,
    getRecent,
    clear,
  };
}

/**
 * Create a StreamBus that also forwards events to an external sink
 * (e.g., logging service, analytics backend, websocket).
 */
export function createStreamingBusWithSink(
  sink: (event: TeachingTraceEvent) => void | Promise<void>,
  options?: StreamBusOptions,
): StreamBus {
  const bus = createStreamBus(options);
  bus.subscribe((event) => {
    try {
      const result = sink(event);
      if (result instanceof Promise) {
        result.catch((err) => {
           
          console.error('[StreamBus] Sink error:', err);
        });
      }
    } catch (err) {
       
      console.error('[StreamBus] Sink error:', err);
    }
  });
  return bus;
}

/**
 * Build a human-readable replay timeline from a list of trace events.
 */
export function buildReplayTimeline(events: TeachingTraceEvent[]): string {
  if (events.length === 0) return 'No events to replay.';

  const lines: string[] = [];
  lines.push(`# Teaching Trace Replay (${events.length} events)`);
  lines.push('');

  const startTime = events[0].timestamp;
  for (const event of events) {
    const elapsed = event.timestamp - startTime;
    const elapsedStr = `${(elapsed / 1000).toFixed(2)}s`;
    const stageStr = event.stage ? ` [${event.stage}]` : '';
    lines.push(`## +${elapsedStr}${stageStr} ${event.type}`);

    const payload = event.payload;
    for (const [key, value] of Object.entries(payload)) {
      const displayValue =
        typeof value === 'string'
          ? value.length > 120
            ? `${value.slice(0, 120)}...`
            : value
          : JSON.stringify(value);
      lines.push(`- ${key}: ${displayValue}`);
    }
    if (event.durationMs) {
      lines.push(`- durationMs: ${event.durationMs}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Filter builder for common trace queries.
 */
export function byType(...types: TeachingTraceEventType[]): TraceFilter {
  return (event) => types.includes(event.type);
}

export function byStage(stage: string): TraceFilter {
  return (event) => event.stage === stage;
}

export function byRequestId(requestId: string): TraceFilter {
  return (event) => event.requestId === requestId;
}

export function byTimeRange(startMs: number, endMs: number): TraceFilter {
  return (event) => event.timestamp >= startMs && event.timestamp <= endMs;
}
