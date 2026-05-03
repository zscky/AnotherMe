'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Lightbulb,
  BookOpen,
  Globe,
  Code,
  Brain,
  FileText,
  ChevronDown,
  Check,
  X,
  Loader2,
  Sparkles,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TutorToolName } from '@/lib/types/tutor-tools';

const ICON_MAP: Record<TutorToolName, React.ComponentType<{ className?: string }>> = {
  brainstorm: Lightbulb,
  rag: BookOpen,
  web_search: Globe,
  code_execution: Code,
  reason: Brain,
  paper_search: FileText,
};

const TOOL_LABELS: Record<TutorToolName, string> = {
  brainstorm: '头脑风暴',
  rag: '知识库检索',
  web_search: '联网搜索',
  code_execution: '代码执行',
  reason: '深度推理',
  paper_search: '论文检索',
};

interface ToolExecutionTrace {
  id: string;
  toolName: TutorToolName;
  status: 'pending' | 'running' | 'success' | 'error';
  startTime: number;
  endTime?: number;
  output?: string;
  error?: string;
}

interface ToolTracePanelProps {
  traces: ToolExecutionTrace[];
  isStreaming?: boolean;
  className?: string;
}

export function ToolTracePanel({ traces, isStreaming, className }: ToolTracePanelProps) {
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  if (!traces.length) return null;

  const toggleExpand = (id: string) => {
    const next = new Set(expandedTools);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setExpandedTools(next);
  };

  return (
    <div className={cn('mb-2 space-y-1.5', className)}>
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">
        <div className="flex h-4 w-4 items-center justify-center rounded bg-purple-100 dark:bg-purple-900/30">
          <Sparkles className="w-2.5 h-2.5 text-purple-600 dark:text-purple-400" />
        </div>
        <span className="font-medium">AI导师工具执行</span>
        {isStreaming && (
          <span className="inline-flex items-center gap-1 text-[10px] text-purple-500">
            <Loader2 className="w-2.5 h-2.5" style={{ animation: 'spin 1s linear infinite' }} />
            执行中
          </span>
        )}
      </div>

      {traces.map((trace, index) => {
        const Icon = ICON_MAP[trace.toolName];
        const isExpanded = expandedTools.has(trace.id);
        const isLast = index === traces.length - 1;
        const isActive = isStreaming && isLast && (trace.status === 'pending' || trace.status === 'running');
        const duration = trace.endTime
          ? `${Math.max(1, Math.round((trace.endTime - trace.startTime) / 1000))}s`
          : null;

        return (
          <div
            key={trace.id}
            className={cn(
              'rounded-xl border overflow-hidden transition-colors',
              trace.status === 'error'
                ? 'bg-red-50/60 dark:bg-red-900/10 border-red-200/60 dark:border-red-800/40'
                : trace.status === 'success'
                  ? 'bg-emerald-50/60 dark:bg-emerald-900/10 border-emerald-200/60 dark:border-emerald-800/40'
                  : 'bg-purple-50/60 dark:bg-purple-900/10 border-purple-200/60 dark:border-purple-800/40',
            )}
          >
            {/* Header */}
            <button
              onClick={() => toggleExpand(trace.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left group"
            >
              <ChevronDown
                className={cn(
                  'w-3.5 h-3.5 text-gray-400 transition-transform duration-200',
                  isExpanded && 'rotate-180',
                )}
              />

              <div
                className={cn(
                  'w-5 h-5 rounded-md flex items-center justify-center transition-colors',
                  trace.status === 'error'
                    ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                    : trace.status === 'success'
                      ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
                )}
              >
                <Icon className="w-3 h-3" />
              </div>

              <span className="flex-1 text-[11px] font-semibold text-gray-700 dark:text-gray-300">
                {TOOL_LABELS[trace.toolName]}
              </span>

              {isActive && (
                <span className="inline-flex items-center gap-1 text-[10px] text-purple-500">
                  <Zap className="w-3 h-3 animate-pulse" />
                </span>
              )}

              {trace.status === 'success' && !isActive && (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              )}

              {trace.status === 'error' && <X className="w-3.5 h-3.5 text-red-500" />}

              {duration && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">{duration}</span>
              )}
            </button>

            {/* Expanded Content */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-2.5">
                    <div
                      className={cn(
                        'text-[11px] leading-relaxed p-2.5 rounded-lg max-h-[200px] overflow-y-auto',
                        trace.status === 'error'
                          ? 'bg-red-100/50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                          : 'bg-gray-100/70 dark:bg-gray-800/70 text-gray-600 dark:text-gray-400',
                      )}
                    >
                      {trace.status === 'error' ? (
                        <div>
                          <div className="font-semibold mb-1">执行失败</div>
                          <div className="opacity-80">{trace.error}</div>
                        </div>
                      ) : trace.output ? (
                        <pre className="whitespace-pre-wrap font-mono text-[10px]">{trace.output}</pre>
                      ) : isActive ? (
                        <div className="flex items-center gap-1.5 text-purple-500">
                          <Loader2 className="w-3 h-3" style={{ animation: 'spin 1s linear infinite' }} />
                          <span>执行中...</span>
                        </div>
                      ) : (
                        <span className="opacity-50">等待执行...</span>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

export type { ToolExecutionTrace };
