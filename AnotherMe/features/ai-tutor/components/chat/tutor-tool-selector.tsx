'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Lightbulb,
  BookOpen,
  Globe,
  Code,
  Brain,
  FileText,
  Sparkles,
  ChevronDown,
  X,
  Workflow,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  TUTOR_TOOLS,
  type TutorToolName,
  type TutorToolState,
} from '@/lib/types/tutor-tools';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Lightbulb,
  BookOpen,
  Globe,
  Code,
  Brain,
  FileText,
};

interface TutorToolSelectorProps {
  /** 当前选中的工具状态 */
  value: TutorToolState;
  /** 工具状态变更回调 */
  onChange: (state: TutorToolState) => void;
  /** 是否禁用 */
  disabled?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 尺寸变体 */
  size?: 'sm' | 'md';
}

export function TutorToolSelector({
  value,
  onChange,
  disabled = false,
  className,
  size = 'md',
}: TutorToolSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const toggleTool = (toolId: TutorToolName) => {
    if (disabled) return;

    const newEnabledTools = value.enabledTools.includes(toolId)
      ? value.enabledTools.filter((id) => id !== toolId)
      : [...value.enabledTools, toolId];

    onChange({
      ...value,
      enabledTools: newEnabledTools,
    });
  };

  const clearAllTools = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    onChange({
      ...value,
      enabledTools: [],
    });
  };

  const toggleAgenticPipeline = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    onChange({
      ...value,
      useAgenticPipeline: !value.useAgenticPipeline,
    });
  };

  const enabledCount = value.enabledTools.length;
  const isAgenticMode = value.useAgenticPipeline ?? false;

  // 获取已选工具的标签列表（用于显示在按钮旁边）
  const selectedToolLabels = value.enabledTools
    .map((id) => TUTOR_TOOLS.find((t) => t.id === id)?.label)
    .filter(Boolean);

  const isSmall = size === 'sm';

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* 触发按钮 - 参考 DeepTutor 风格 */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={cn(
            'inline-flex items-center gap-1 font-medium transition-colors',
            isSmall ? 'py-1 px-1.5 text-[11px]' : 'py-1.5 px-2 text-xs',
            disabled
              ? 'opacity-50 cursor-not-allowed text-gray-400'
              : isOpen
                ? 'text-purple-600 dark:text-purple-400'
                : isAgenticMode
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          )}
        >
          {isAgenticMode ? (
            <Workflow className={cn(isSmall ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
          ) : (
            <Sparkles className={cn(isSmall ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
          )}
          <span>工具</span>
          {isAgenticMode && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
              Agentic
            </span>
          )}
          <ChevronDown
            className={cn(
              'transition-transform duration-200',
              isSmall ? 'w-3 h-3' : 'w-3.5 h-3.5',
              isOpen ? 'rotate-180' : ''
            )}
          />
        </button>

        {/* 已选工具标签列表 - 参考 DeepTutor 用"·"分隔 */}
        {selectedToolLabels.length > 0 && (
          <div className="flex items-center gap-[3px] overflow-hidden">
            {selectedToolLabels.map((label, i) => (
              <span
                key={label}
                className={cn(
                  'shrink-0 text-gray-400/60 dark:text-gray-500/60',
                  isSmall ? 'text-[10px]' : 'text-xs'
                )}
              >
                {i > 0 && <span className="text-xs leading-none mx-0.5">·</span>}
                {label}
              </span>
            ))}
          </div>
        )}

        {/* 清除按钮 */}
        {enabledCount > 0 && (
          <button
            onClick={clearAllTools}
            disabled={disabled}
            className={cn(
              'text-gray-400 hover:text-red-500 transition-colors',
              isSmall ? 'p-0.5' : 'p-1'
            )}
          >
            <X className={isSmall ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
          </button>
        )}
      </div>

      {/* 下拉面板 - 参考 DeepTutor 风格 */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className={cn(
              'absolute z-50 mb-1.5 rounded-lg border shadow-lg backdrop-blur-md',
              'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700',
              isSmall ? 'bottom-full left-0 min-w-[220px]' : 'bottom-full left-0 min-w-[240px]'
            )}
          >
            {/* P2: Agentic Pipeline 模式开关 */}
            {enabledCount > 0 && (
              <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
                <button
                  onClick={toggleAgenticPipeline}
                  disabled={disabled}
                  className={cn(
                    'flex w-full items-center gap-2 text-left transition-colors',
                    isAgenticMode
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  )}
                >
                  <div
                    className={cn(
                      'w-8 h-4 rounded-full transition-colors relative',
                      isAgenticMode ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                    )}
                  >
                    <div
                      className={cn(
                        'absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-white transition-transform',
                        isAgenticMode && 'translate-x-4'
                      )}
                    />
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-medium">
                      {isAgenticMode ? 'Agentic 模式' : '预执行模式'}
                    </div>
                    <div className="text-[10px] text-gray-400 dark:text-gray-500">
                      {isAgenticMode
                        ? '模型按需选择工具 (DeepTutor风格)'
                        : '回答前执行所有工具'}
                    </div>
                  </div>
                  {isAgenticMode ? (
                    <Workflow className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <Zap className="w-3.5 h-3.5 shrink-0" />
                  )}
                </button>
              </div>
            )}

            <div className="py-1">
              {TUTOR_TOOLS.map((tool) => {
                const Icon = ICON_MAP[tool.icon];
                const isEnabled = value.enabledTools.includes(tool.id);

                return (
                  <button
                    key={tool.id}
                    onClick={() => toggleTool(tool.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors',
                      isEnabled
                        ? 'text-purple-600 dark:text-purple-400'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
                      'hover:bg-gray-100/50 dark:hover:bg-gray-800/50'
                    )}
                  >
                    {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{tool.label}</div>
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                        {tool.description}
                      </div>
                    </div>
                    {isEnabled && (
                      <div className="h-1.5 w-1.5 rounded-full bg-purple-500 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* 底部提示 */}
            {enabledCount > 0 && (
              <div className="px-3 py-1.5 border-t border-gray-100 dark:border-gray-800">
                <div className="text-[10px] text-gray-400 dark:text-gray-500">
                  {isAgenticMode ? (
                    <span className="flex items-center gap-1">
                      <Workflow className="w-3 h-3" />
                      模型将按需调用工具，展示思考过程
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      所有工具将在回答前并行执行
                    </span>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export type { TutorToolState };
