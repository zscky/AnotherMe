'use client';

import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type StageKey = 'queued' | 'ideation' | 'exploration' | 'synthesis' | 'compilation' | 'completed';

const stageOrder: StageKey[] = ['queued', 'ideation', 'exploration', 'synthesis', 'compilation', 'completed'];

const stageLabels: Record<StageKey, string> = {
  queued: '排队',
  ideation: '构思',
  exploration: '探索',
  synthesis: '合成',
  compilation: '编译',
  completed: '完成',
};

const stateTone: Record<string, { bg: string; ring: string }> = {
  pending: { bg: 'bg-white', ring: 'ring-gray-200' },
  running: { bg: 'bg-gray-900', ring: 'ring-gray-300' },
  completed: { bg: 'bg-emerald-50', ring: 'ring-emerald-200' },
  error: { bg: 'bg-red-50', ring: 'ring-red-200' },
};

function getStageState(stageKey: string, currentStage: string): 'pending' | 'running' | 'completed' | 'error' {
  if (currentStage === 'failed') return stageKey === 'compilation' ? 'error' : 'pending';
  const currentIdx = stageOrder.indexOf(currentStage as StageKey);
  const stageIdx = stageOrder.indexOf(stageKey as StageKey);
  if (currentIdx < 0 || stageIdx < 0) return 'pending';
  if (stageKey === currentStage) return 'running';
  if (stageIdx < currentIdx) return 'completed';
  return 'pending';
}

function stageProgressFraction(currentStage: string, progress: number): number {
  const currentIdx = stageOrder.indexOf(currentStage as StageKey);
  if (currentIdx < 0) return 0;
  let value = 0;
  for (let i = 0; i < stageOrder.length; i++) {
    if (i < currentIdx) value += 1;
    else if (i === currentIdx) value += progress / 100;
  }
  return Math.min(1, value / stageOrder.length);
}

export function LiveBookProgressTimeline({
  currentStage,
  currentProgress,
}: {
  currentStage: string;
  currentProgress: number;
}) {
  if (currentStage === 'completed' || currentStage === 'failed') return null;

  const fraction = stageProgressFraction(currentStage, currentProgress);
  const label = stageLabels[currentStage as StageKey] || currentStage;

  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-30">
      <div
        className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/90 px-3 py-1.5 text-[11px] shadow-sm backdrop-blur"
        title={`${label} · ${currentProgress}%`}
      >
        <Loader2 className="h-3 w-3 text-gray-500 animate-spin" />
        <div className="relative flex items-center gap-1">
          <div className="pointer-events-none absolute left-1.5 right-1.5 top-1/2 -z-0 h-px -translate-y-1/2 bg-gray-200" />
          {stageOrder.map((stageKey) => {
            const state = getStageState(stageKey, currentStage);
            const tone = stateTone[state];
            return (
              <span
                key={stageKey}
                title={`${stageLabels[stageKey]} · ${state}`}
                className={cn(
                  'relative z-10 inline-flex h-2.5 w-2.5 items-center justify-center rounded-full ring-1',
                  tone.ring,
                  tone.bg,
                )}
              >
                {state === 'running' && (
                  <span className="absolute inset-0 animate-ping rounded-full bg-gray-400/40" />
                )}
                {state === 'completed' && <Check className="h-1.5 w-1.5 text-emerald-600" />}
              </span>
            );
          })}
        </div>
        <span className="text-[10px] text-gray-500">{label}</span>
        <span className="tabular-nums text-[10px] font-medium text-gray-500">
          {Math.round(fraction * 100)}%
        </span>
      </div>
    </div>
  );
}
