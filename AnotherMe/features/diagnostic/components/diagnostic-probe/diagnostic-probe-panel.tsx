/**
 * DiagnosticProbePanel - A lightweight panel for displaying diagnostic probes.
 *
 * This is a starting UI. It can be embedded in:
 * - The chat sidebar
 * - A knowledge tracing dashboard
 * - Post-chat review flow
 */

'use client';

import React from 'react';
import type { DiagnosticProbe } from '@/lib/types/diagnostic-probe';
import { useDiagnosticProbe } from '@/lib/hooks/use-diagnostic-probe';

interface DiagnosticProbePanelProps {
  userId: string;
  knowledgePointId?: string;
}

export function DiagnosticProbePanel({ userId, knowledgePointId }: DiagnosticProbePanelProps) {
  const { probe, loading, error, generateProbe, clearProbe } = useDiagnosticProbe({ userId });

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-card-foreground">诊断练习</h3>
        {probe && (
          <button
            onClick={clearProbe}
            className="text-xs text-muted-foreground hover:text-foreground"
            type="button"
          >
            清除
          </button>
        )}
      </div>

      {!probe && !loading && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            基于知识追踪状态生成一道针对性诊断题，检测薄弱知识点的掌握情况。
          </p>
          <button
            onClick={() => generateProbe({ knowledgePointId })}
            disabled={loading}
            className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            type="button"
          >
            {loading ? '生成中...' : '生成诊断题'}
          </button>
        </div>
      )}

      {loading && (
        <div className="py-4 text-center text-xs text-muted-foreground">正在生成诊断题...</div>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {probe && <ProbeCard probe={probe} />}
    </div>
  );
}

function ProbeCard({ probe }: { probe: DiagnosticProbe }) {
  const [showHint, setShowHint] = React.useState(false);
  const [showAnswer, setShowAnswer] = React.useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
          {probe.probeType === 'choice' ? '选择题' : probe.probeType === 'step_by_step' ? '分步题' : '填空题'}
        </span>
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          难度: {probe.difficulty}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-card-foreground">{probe.question}</p>

      {probe.options && probe.options.length > 0 && (
        <ul className="space-y-1.5">
          {probe.options.map((opt, idx) => (
            <li
              key={idx}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-accent/50"
            >
              {opt}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowHint((v) => !v)}
          className="text-xs text-primary hover:underline"
          type="button"
        >
          {showHint ? '隐藏提示' : '查看提示'}
        </button>
        <button
          onClick={() => setShowAnswer((v) => !v)}
          className="text-xs text-primary hover:underline"
          type="button"
        >
          {showAnswer ? '隐藏答案' : '查看答案'}
        </button>
      </div>

      {showHint && probe.hints.length > 0 && (
        <div className="rounded-md bg-yellow-50 p-2 text-xs text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
          <p className="font-medium">提示:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {probe.hints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      )}

      {showAnswer && (
        <div className="rounded-md bg-green-50 p-2 text-xs text-green-800 dark:bg-green-950 dark:text-green-200">
          <p className="font-medium">参考答案:</p>
          <p className="mt-1">{probe.correctAnswer}</p>
          <p className="mt-2 text-muted-foreground">{probe.explanation}</p>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        策略: {probe.teachingAction} · {probe.reason}
      </p>
    </div>
  );
}
