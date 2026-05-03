/**
 * Diagnostic Page - Interactive diagnostic probe practice.
 *
 * Users can generate targeted diagnostic questions based on their knowledge
 * tracing state, practice them, and submit answers for BKT updates.
 */

'use client';

import React, { useState } from 'react';
import { useAuth } from '@/features/auth/components/auth-provider';
import { DiagnosticProbePanel } from '@/features/diagnostic/components/diagnostic-probe/diagnostic-probe-panel';
import { useDiagnosticProbe } from '@/lib/hooks/use-diagnostic-probe';
import type { DiagnosticProbe } from '@/lib/types/diagnostic-probe';
import { Stethoscope, RefreshCw, BookOpen, AlertCircle } from 'lucide-react';

function ProbeAnswerForm({
  probe,
  userId,
  onAnswered,
}: {
  probe: DiagnosticProbe;
  userId: string;
  onAnswered: (result: { correct: boolean; probe: DiagnosticProbe }) => void;
}) {
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [fillAnswer, setFillAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);

    let correct = false;
    if (probe.probeType === 'choice' && selectedOption !== null && probe.options) {
      correct = probe.options[selectedOption] === probe.correctAnswer;
    } else if (probe.probeType === 'fill_blank') {
      correct = fillAnswer.trim().toLowerCase() === probe.correctAnswer.trim().toLowerCase();
    } else {
      correct = true; // step_by_step defaults to correct, user self-checks
    }

    setIsCorrect(correct);
    setSubmitted(true);

    // Report answer to backend for BKT update
    try {
      await fetch(`/api/students/${encodeURIComponent(userId)}/quiz-answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: probe.probeId,
          is_correct: correct,
          knowledge_point_id: probe.knowledgePointId,
        }),
      });
    } catch {
      // Non-blocking: BKT update failure should not break UX
    }

    onAnswered({ correct, probe });
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <div className="mt-4 space-y-3">
        <div
          className={`rounded-lg p-3 text-sm font-medium ${
            isCorrect
              ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
              : 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
          }`}
        >
          {isCorrect ? '回答正确！' : '回答错误，请查看解析。'}
        </div>
        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          <p className="font-medium text-foreground">解析:</p>
          <p className="mt-1 text-muted-foreground">{probe.explanation}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      {probe.probeType === 'choice' && probe.options && (
        <div className="space-y-2">
          {probe.options.map((opt, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setSelectedOption(idx)}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                selectedOption === idx
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border bg-background hover:bg-accent/50'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {probe.probeType === 'fill_blank' && (
        <input
          type="text"
          value={fillAnswer}
          onChange={(e) => setFillAnswer(e.target.value)}
          placeholder="请输入你的答案..."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}

      {probe.probeType === 'step_by_step' && (
        <p className="text-xs text-muted-foreground">
          分步题请自行在纸上推导，提交后查看参考答案与解析。
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || (probe.probeType === 'choice' && selectedOption === null)}
        className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {submitting ? '提交中...' : '提交答案'}
      </button>
    </div>
  );
}

export default function DiagnosticPage() {
  const { user, loading } = useAuth();
  const { probe, loading: probeLoading, error, generateProbe, clearProbe } = useDiagnosticProbe({
    userId: user?.id || '',
  });
  const [history, setHistory] = useState<Array<{ correct: boolean; probe: DiagnosticProbe }>>([]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4" />
          请先登录以使用诊断练习
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Stethoscope className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">诊断练习</h1>
          <p className="text-sm text-muted-foreground">
            基于知识追踪状态生成针对性诊断题，检测薄弱知识点的掌握情况。
          </p>
        </div>
      </div>

      {/* Stats summary */}
      {history.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-card p-3 text-center">
            <p className="text-2xl font-bold text-foreground">{history.length}</p>
            <p className="text-xs text-muted-foreground">已做题数</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-center">
            <p className="text-2xl font-bold text-green-600">
              {history.filter((h) => h.correct).length}
            </p>
            <p className="text-xs text-muted-foreground">正确</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-center">
            <p className="text-2xl font-bold text-red-600">
              {history.filter((h) => !h.correct).length}
            </p>
            <p className="text-xs text-muted-foreground">错误</p>
          </div>
        </div>
      )}

      {/* Probe generation card */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-card-foreground">生成诊断题</h2>
          {probe && (
            <button
              type="button"
              onClick={clearProbe}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              <RefreshCw className="h-3 w-3" />
              重新生成
            </button>
          )}
        </div>

        {!probe && !probeLoading && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              系统将分析你的学习记录，找出掌握度较低的知识点，并生成一道针对性的诊断题。
            </p>
            <button
              type="button"
              onClick={() => generateProbe()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <BookOpen className="h-4 w-4" />
              开始诊断练习
            </button>
          </div>
        )}

        {probeLoading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            正在分析知识状态并生成诊断题...
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {probe && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  probe.probeType === 'choice'
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                    : probe.probeType === 'step_by_step'
                      ? 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                      : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                }`}
              >
                {probe.probeType === 'choice'
                  ? '选择题'
                  : probe.probeType === 'step_by_step'
                    ? '分步题'
                    : '填空题'}
              </span>
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                难度: {probe.difficulty}
              </span>
            </div>

            <div className="rounded-lg bg-muted/40 p-4">
              <p className="text-sm font-medium text-foreground">{probe.question}</p>
            </div>

            {probe.options && probe.options.length > 0 && (
              <div className="space-y-2">
                {probe.options.map((opt, idx) => (
                  <div
                    key={idx}
                    className="rounded-md border border-border bg-background px-3 py-2 text-sm text-card-foreground"
                  >
                    {opt}
                  </div>
                ))}
              </div>
            )}

            <ProbeAnswerForm
              probe={probe}
              userId={user.id}
              onAnswered={(result) => setHistory((prev) => [...prev, result])}
            />
          </div>
        )}
      </div>

      {/* Knowledge point info */}
      {probe && (
        <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">知识点:</span>{' '}
            {probe.knowledgePointId}
          </p>
          <p className="mt-1">
            <span className="font-medium text-foreground">教学策略:</span>{' '}
            {probe.teachingAction} · {probe.reason}
          </p>
        </div>
      )}
    </div>
  );
}
