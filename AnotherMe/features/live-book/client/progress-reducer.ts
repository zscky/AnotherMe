export type TimelineStage =
  | 'queued'
  | 'ideation'
  | 'exploration'
  | 'synthesis'
  | 'compilation'
  | 'completed'
  | 'failed';

export interface TimelineJob {
  id: string;
  stage: TimelineStage | string;
  progress: number;
}

export interface TimelineEvent {
  id: string;
  stage: TimelineStage | string;
  progress: number;
  type: string;
  message: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface ProgressCounters {
  totalPages: number;
  readyPages: number;
  partialPages: number;
  failedPages: number;
  blockReady: number;
  blockFailed: number;
}

export interface LiveBookProgressState<TJob extends TimelineJob, TEvent extends TimelineEvent> {
  job: TJob | null;
  events: TEvent[];
  byStageProgress: Partial<Record<TimelineStage, number>>;
  counters: ProgressCounters;
  connectionState: 'idle' | 'connected' | 'reconnecting' | 'closed';
  reconnectCount: number;
  lastEventAt: number | null;
}

export type LiveBookProgressAction<TJob extends TimelineJob, TEvent extends TimelineEvent> =
  | { type: 'set_job'; job: TJob | null; events?: TEvent[] }
  | { type: 'ingest_event'; event: TEvent }
  | { type: 'set_connection_state'; state: LiveBookProgressState<TJob, TEvent>['connectionState'] }
  | { type: 'set_reconnect_count'; count: number }
  | { type: 'reset' };

function createEmptyCounters(): ProgressCounters {
  return {
    totalPages: 0,
    readyPages: 0,
    partialPages: 0,
    failedPages: 0,
    blockReady: 0,
    blockFailed: 0,
  };
}

function toSafeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function buildCountersFromEvents<TEvent extends TimelineEvent>(events: TEvent[]): ProgressCounters {
  const counters = createEmptyCounters();
  for (const event of events) {
    const meta = event.metadata || {};
    if (event.type === 'page_ready') {
      counters.totalPages = Math.max(counters.totalPages, toSafeNumber(meta.totalPages, counters.totalPages));
      const status = typeof meta.pageStatus === 'string' ? meta.pageStatus : '';
      if (status === 'ready') counters.readyPages += 1;
      if (status === 'partial') counters.partialPages += 1;
      if (status === 'error') counters.failedPages += 1;
    }

    if (event.type === 'block_ready') counters.blockReady += 1;
    if (event.type === 'block_error') counters.blockFailed += 1;
  }
  return counters;
}

export function createInitialProgressState<
  TJob extends TimelineJob,
  TEvent extends TimelineEvent,
>(): LiveBookProgressState<TJob, TEvent> {
  return {
    job: null,
    events: [],
    byStageProgress: {},
    counters: createEmptyCounters(),
    connectionState: 'idle',
    reconnectCount: 0,
    lastEventAt: null,
  };
}

export function liveBookProgressReducer<TJob extends TimelineJob, TEvent extends TimelineEvent>(
  state: LiveBookProgressState<TJob, TEvent>,
  action: LiveBookProgressAction<TJob, TEvent>,
): LiveBookProgressState<TJob, TEvent> {
  if (action.type === 'set_job') {
    const nextEvents = action.events ? action.events.slice(-120) : state.events;
    const nextByStageProgress = { ...state.byStageProgress };
    for (const event of nextEvents) {
      const key = event.stage as TimelineStage;
      nextByStageProgress[key] = Math.max(nextByStageProgress[key] || 0, event.progress || 0);
    }

    return {
      ...state,
      job: action.job,
      events: nextEvents,
      byStageProgress: nextByStageProgress,
      counters: buildCountersFromEvents(nextEvents),
      lastEventAt: nextEvents.length ? Date.now() : state.lastEventAt,
    };
  }

  if (action.type === 'ingest_event') {
    if (state.events.some((item) => item.id === action.event.id)) {
      return state;
    }

    const nextEvents = [...state.events, action.event].slice(-120);
    const stageKey = action.event.stage as TimelineStage;
    const nextByStageProgress = {
      ...state.byStageProgress,
      [stageKey]: Math.max(state.byStageProgress[stageKey] || 0, action.event.progress || 0),
    };

    const nextCounters = { ...state.counters };
    const meta = action.event.metadata || {};
    if (action.event.type === 'page_ready') {
      nextCounters.totalPages = Math.max(nextCounters.totalPages, toSafeNumber(meta.totalPages, nextCounters.totalPages));
      const pageStatus = typeof meta.pageStatus === 'string' ? meta.pageStatus : '';
      if (pageStatus === 'ready') nextCounters.readyPages += 1;
      if (pageStatus === 'partial') nextCounters.partialPages += 1;
      if (pageStatus === 'error') nextCounters.failedPages += 1;
    }
    if (action.event.type === 'block_ready') nextCounters.blockReady += 1;
    if (action.event.type === 'block_error') nextCounters.blockFailed += 1;

    if (!state.job) {
      return {
        ...state,
        events: nextEvents,
        byStageProgress: nextByStageProgress,
        counters: nextCounters,
        lastEventAt: Date.now(),
      };
    }

    return {
      ...state,
      job: {
        ...state.job,
        stage: action.event.stage,
        progress: Math.max(state.job.progress, action.event.progress),
      },
      events: nextEvents,
      byStageProgress: nextByStageProgress,
      counters: nextCounters,
      lastEventAt: Date.now(),
    };
  }

  if (action.type === 'set_connection_state') {
    return {
      ...state,
      connectionState: action.state,
    };
  }

  if (action.type === 'set_reconnect_count') {
    return {
      ...state,
      reconnectCount: Math.max(0, action.count),
    };
  }

  return createInitialProgressState<TJob, TEvent>();
}
