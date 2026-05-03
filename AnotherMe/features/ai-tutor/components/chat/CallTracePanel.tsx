'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronDown,
  Loader2,
  Sparkles,
  Database,
  Globe,
  Code,
  Brain,
  FileText,
  Lightbulb,
  Terminal,
  PenLine,
  MessageSquare,
  BrainCircuit,
  Check,
  X,
} from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';
import type { StreamEvent } from '@/lib/types/chat';

// Re-export StreamEvent for backward compatibility
export type { StreamEvent };
const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  brainstorm: Lightbulb,
  rag: Database,
  web_search: Globe,
  code_execution: Code,
  reason: Brain,
  paper_search: FileText,
  tool_call: Terminal,
  llm_planning: Sparkles,
  llm_generation: PenLine,
  llm_final_response: MessageSquare,
  llm_reasoning: BrainCircuit,
  default: Sparkles,
};

// 工具标签映射
const TOOL_LABELS: Record<string, string> = {
  brainstorm: '头脑风暴',
  rag: '知识库检索',
  web_search: '联网搜索',
  code_execution: '代码执行',
  reason: '深度推理',
  paper_search: '论文检索',
  tool_call: '工具调用',
  llm_planning: '规划',
  llm_generation: '生成',
  llm_final_response: '最终回复',
  llm_reasoning: '推理',
  retrieve: '检索',
  observe: '观察',
  response: '响应',
  thought: '思考',
};

export interface CallTrace {
  id: string;
  toolName: string;
  status: 'pending' | 'running' | 'success' | 'error';
  startTime: number;
  endTime?: number;
  output?: string;
  error?: string;
  events?: StreamEvent[];
  callId?: string;
  phase?: string;
  label?: string;
  callKind?: string;
  traceRole?: string;
  traceGroup?: string;
  stepId?: string;
  round?: number;
}

interface CallTracePanelProps {
  traces: CallTrace[];
  isStreaming?: boolean;
  className?: string;
}

// 渲染工具图标
function renderToolIcon(toolName: string, className?: string) {
  const Icon = TOOL_ICONS[toolName] || TOOL_ICONS.default;
  return <Icon className={className} />;
}

// 获取工具标签
function getToolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] || toolName;
}

// 格式化持续时间
function formatDuration(startTime: number, endTime?: number): string {
  const end = endTime || Date.now();
  const seconds = Math.max(1, Math.round((end - startTime) / 1000));
  return `${seconds}s`;
}

// 单个追踪项组件
function TraceItem({
  trace,
  isActive,
  expanded,
  onToggle,
}: {
  trace: CallTrace;
  isActive: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const duration = trace.endTime ? formatDuration(trace.startTime, trace.endTime) : null;
  const hasContent = trace.output || trace.error || (trace.events && trace.events.length > 0);

  return (
    <div
      className={cn(
        'rounded-xl border overflow-hidden transition-colors',
        trace.status === 'error'
          ? 'bg-red-50/60 dark:bg-red-900/10 border-red-200/60 dark:border-red-800/40'
          : trace.status === 'success'
          ? 'bg-emerald-50/60 dark:bg-emerald-900/10 border-emerald-200/60 dark:border-emerald-800/40'
          : 'bg-purple-50/60 dark:bg-purple-900/10 border-purple-200/60 dark:border-purple-800/40',
      )}
    >
      {/* 头部 */}
      <button
        onClick={hasContent ? onToggle : undefined}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-left',
          hasContent && 'group hover:bg-black/5 dark:hover:bg-white/5',
        )}
      >
        {hasContent && (
          <ChevronDown
            className={cn(
              'w-3.5 h-3.5 text-gray-400 transition-transform duration-200',
              expanded && 'rotate-180',
            )}
          />
        )}

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
          {renderToolIcon(trace.toolName, 'w-3 h-3')}
        </div>

        <span className="flex-1 text-[11px] font-semibold text-gray-700 dark:text-gray-300">
          {getToolLabel(trace.toolName)}
        </span>

        {isActive && (
          <span className="inline-flex items-center gap-1 text-[10px] text-purple-500">
            <Loader2 className="w-3 h-3" style={{ animation: 'spin 1s linear infinite' }} />
          </span>
        )}

        {trace.status === 'success' && !isActive && (
          <Check className="w-3.5 h-3.5 text-emerald-500" />
        )}

        {trace.status === 'error' && <X className="w-3.5 h-3.5 text-red-500" />}

        {duration && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
            {duration}
          </span>
        )}
      </button>

      {/* 展开内容 */}
      <AnimatePresence>
        {expanded && hasContent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2.5">
              <TraceContent trace={trace} isActive={isActive} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// 追踪内容组件
function TraceContent({ trace, isActive }: { trace: CallTrace; isActive: boolean }) {
  const { t } = useI18n();

  // 如果有事件，按类型分组显示
  if (trace.events && trace.events.length > 0) {
    const thinkingEvents = trace.events.filter((e) => e.type === 'thinking');
    const observationEvents = trace.events.filter((e) => e.type === 'observation');
    const toolCallEvents = trace.events.filter((e) => e.type === 'tool_call');
    const toolResultEvents = trace.events.filter((e) => e.type === 'tool_result');
    const progressEvents = trace.events.filter((e) => e.type === 'progress');
    const errorEvents = trace.events.filter((e) => e.type === 'error');

    return (
      <div className="space-y-2 text-[11px] leading-relaxed">
        {/* 思考过程 */}
        {thinkingEvents.length > 0 && (
          <div className="space-y-1">
            <div className="font-semibold text-gray-600 dark:text-gray-400">{t('chat.trace.thought')}</div>
            <div className="bg-gray-100/70 dark:bg-gray-800/70 rounded-lg p-2 text-gray-600 dark:text-gray-400">
              {thinkingEvents[thinkingEvents.length - 1].content}
            </div>
          </div>
        )}

        {/* 工具调用 */}
        {toolCallEvents.length > 0 && (
          <div className="space-y-1">
            <div className="font-semibold text-gray-600 dark:text-gray-400">{t('chat.trace.tool')}</div>
            <div className="space-y-1">
              {toolCallEvents.map((event, idx) => (
                <div key={idx} className="flex items-start gap-1">
                  <span className="text-gray-400">→</span>
                  <div className="flex-1">
                    <div className="text-gray-700 dark:text-gray-300">{String(event.content)}</div>
                    {event.metadata?.args != null && (
                      <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-gray-100 dark:bg-gray-800 px-2 py-1 font-mono text-[10px] text-gray-600 dark:text-gray-400">
                        {JSON.stringify(event.metadata.args, null, 2) ?? ''}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 工具结果 */}
        {toolResultEvents.length > 0 && (
          <div className="space-y-1">
            {toolResultEvents.map((event, idx) => (
              <div key={idx} className="flex items-start gap-1">
                <span className="text-emerald-500">✓</span>
                <div className="flex-1 text-gray-600 dark:text-gray-400">
                  {String(event.content) || String(event.metadata?.tool || 'result')}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 观察结果 */}
        {observationEvents.length > 0 && (
          <div className="space-y-1">
            <div className="font-semibold text-gray-600 dark:text-gray-400">{t('chat.trace.observe')}</div>
            <div className="bg-gray-100/70 dark:bg-gray-800/70 rounded-lg p-2 text-gray-600 dark:text-gray-400">
              {observationEvents[observationEvents.length - 1].content}
            </div>
          </div>
        )}

        {/* 进度 */}
        {progressEvents.length > 0 && (
          <div className="space-y-1">
            {progressEvents.map((event, idx) => (
              <div key={idx} className="text-gray-500 italic">
                {String(event.content)}
              </div>
            ))}
          </div>
        )}

        {/* 错误 */}
        {errorEvents.length > 0 && (
          <div className="space-y-1">
            {errorEvents.map((event, idx) => (
              <div key={idx} className="text-red-500">
                ✗ {String(event.content)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 简单输出显示
  return (
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
          <div className="font-semibold mb-1">{t('chat.trace.executionFailed')}</div>
          <div className="opacity-80">{trace.error}</div>
        </div>
      ) : trace.output ? (
        <pre className="whitespace-pre-wrap font-mono text-[10px]">{trace.output}</pre>
      ) : isActive ? (
        <div className="flex items-center gap-1.5 text-purple-500">
          <Loader2 className="w-3 h-3" style={{ animation: 'spin 1s linear infinite' }} />
          <span>{t('chat.trace.executing')}</span>
        </div>
      ) : (
        <span className="opacity-50">{t('chat.trace.waiting')}</span>
      )}
    </div>
  );
}

// 主组件
export function CallTracePanel({ traces, isStreaming, className }: CallTracePanelProps) {
  const { t } = useI18n();
  const [expandedTraces, setExpandedTraces] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpandedTraces((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  if (!traces.length) return null;

  return (
    <div className={cn('mb-3 space-y-1.5', className)}>
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">
        <div className="flex h-4 w-4 items-center justify-center rounded bg-purple-100 dark:bg-purple-900/30">
          <Sparkles className="w-2.5 h-2.5 text-purple-600 dark:text-purple-400" />
        </div>
        <span className="font-medium">{t('chat.trace.title')}</span>
        {isStreaming && (
          <span className="inline-flex items-center gap-1 text-[10px] text-purple-500">
            <Loader2 className="w-2.5 h-2.5" style={{ animation: 'spin 1s linear infinite' }} />
            {t('chat.trace.executing')}
          </span>
        )}
      </div>

      {traces.map((trace, index) => {
        const isLast = index === traces.length - 1;
        const isActive = !!isStreaming && isLast && (trace.status === 'pending' || trace.status === 'running');
        const isExpanded = expandedTraces.has(trace.id);

        return (
          <TraceItem
            key={trace.id}
            trace={trace}
            isActive={isActive}
            expanded={isExpanded}
            onToggle={() => toggleExpand(trace.id)}
          />
        );
      })}
    </div>
  );
}

export default CallTracePanel;
