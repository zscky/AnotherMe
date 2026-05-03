'use client';

import { useCallback, useRef, useState, memo, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  ArrowUp,
  Paperclip,
  Square,
  Globe,
  Lightbulb,
  Database,
  Code2,
  Brain,
  FileSearch,
  X,
  Image as ImageIcon,
  Mic,
} from 'lucide-react';

interface PendingAttachment {
  type: string;
  filename: string;
  previewUrl?: string;
}

export type ChatCapability = 'chat' | 'deep_solve' | 'quiz' | 'research' | 'math_animator' | 'visualize';

interface ModernChatComposerProps {
  isStreaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  attachments?: PendingAttachment[];
  capability?: ChatCapability;
  onSend?: (content: string) => void;
  onCancelStreaming?: () => void;
  onAddFiles?: (files: File[]) => void;
  onRemoveAttachment?: (index: number) => void;
  onCapabilityChange?: (capability: ChatCapability) => void;
}

// 工具配置
const TOOLS = [
  { id: 'web_search', icon: Globe, label: '搜索', color: 'text-blue-500' },
  { id: 'reason', icon: Brain, label: '推理', color: 'text-purple-500' },
  { id: 'code', icon: Code2, label: '代码', color: 'text-emerald-500' },
  { id: 'rag', icon: Database, label: '知识库', color: 'text-amber-500' },
  { id: 'brainstorm', icon: Lightbulb, label: '头脑风暴', color: 'text-orange-500' },
  { id: 'paper_search', icon: FileSearch, label: '论文', color: 'text-indigo-500' },
];

export const ModernChatComposer = memo(function ModernChatComposer({
  isStreaming,
  disabled,
  placeholder,
  attachments = [],
  onSend,
  onCancelStreaming,
  onAddFiles,
  onRemoveAttachment,
}: ModernChatComposerProps) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [activeTools, setActiveTools] = useState<Set<string>>(new Set());

  // 自动调整高度
  const adjustHeight = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    const newHeight = Math.min(Math.max(el.scrollHeight, 24), 400);
    el.style.height = `${newHeight}px`;
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setInput(value);
      adjustHeight(e.target);
    },
    [adjustHeight]
  );

  const doSend = useCallback(() => {
    const content = input.trim();
    if (!content && !attachments.length) return;
    onSend?.(content);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, attachments.length, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    },
    [doSend]
  );

  const handlePickFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const picked = Array.from(event.target.files ?? []);
      if (picked.length) onAddFiles?.(picked);
      event.target.value = '';
    },
    [onAddFiles]
  );

  const toggleTool = useCallback((toolId: string) => {
    setActiveTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  }, []);

  const canSend = (input.trim() || !!attachments.length) && !isStreaming && !disabled;

  // 点击外部关闭工具栏
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.composer-container')) {
        setIsFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="composer-container relative z-20 mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx,.txt,.md,.csv,.json,.py,.js,.ts,.tsx"
        onChange={handleFileInputChange}
        className="hidden"
      />

      <div
        className={cn(
          'relative rounded-3xl bg-white dark:bg-gray-900 transition-all duration-300',
          'shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)]',
          'dark:shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.2)]',
          isFocused && 'shadow-[0_0_0_2px_rgba(99,102,241,0.3),0_4px_20px_rgba(0,0,0,0.08)]',
          isFocused && 'dark:shadow-[0_0_0_2px_rgba(99,102,241,0.4),0_4px_20px_rgba(0,0,0,0.3)]'
        )}
      >
        {/* 附件预览 */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-5 pt-4 pb-2">
            {attachments.map((a, i) => (
              <div
                key={`${a.filename}-${i}`}
                className="group relative flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 pr-8"
              >
                {a.type === 'image' ? (
                  <ImageIcon className="w-4 h-4 text-gray-500" />
                ) : (
                  <Paperclip className="w-4 h-4 text-gray-500" />
                )}
                <span className="text-sm text-gray-700 dark:text-gray-300 truncate max-w-[120px]">
                  {a.filename}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment?.(i)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  <X className="w-3 h-3 text-gray-500" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 输入框 */}
        <div className="px-5 pt-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            rows={1}
            disabled={disabled}
            placeholder={placeholder || t('chat.howCanIHelp') || 'Message AI tutor...'}
            className={cn(
              'w-full resize-none bg-transparent text-[15px] leading-relaxed',
              'text-gray-900 dark:text-gray-100 outline-none',
              'placeholder:text-gray-400 dark:placeholder:text-gray-500',
              'disabled:opacity-50 min-h-[24px] max-h-[400px]'
            )}
          />
        </div>

        {/* 底部工具栏 */}
        <div className="flex items-center justify-between px-3 py-3">
          {/* 左侧工具 */}
          <div className="flex items-center gap-1">
            {/* 附件按钮 */}
            <button
              type="button"
              onClick={handlePickFiles}
              disabled={disabled}
              className={cn(
                'p-2 rounded-xl transition-all duration-200',
                'text-gray-500 hover:text-gray-700 hover:bg-gray-100',
                'dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800',
                'disabled:opacity-40'
              )}
              title="添加附件"
            >
              <Paperclip className="w-5 h-5" />
            </button>

            {/* 语音按钮 */}
            <button
              type="button"
              disabled={disabled}
              className={cn(
                'p-2 rounded-xl transition-all duration-200',
                'text-gray-500 hover:text-gray-700 hover:bg-gray-100',
                'dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800',
                'disabled:opacity-40'
              )}
              title="语音输入"
            >
              <Mic className="w-5 h-5" />
            </button>

            {/* 分隔线 */}
            <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1" />

            {/* 工具按钮组 */}
            <div className="flex items-center gap-0.5">
              {TOOLS.map((tool) => {
                const Icon = tool.icon;
                const isActive = activeTools.has(tool.id);
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => toggleTool(tool.id)}
                    disabled={disabled}
                    className={cn(
                      'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200',
                      'flex items-center gap-1.5',
                      isActive
                        ? `bg-gray-100 dark:bg-gray-800 ${tool.color}`
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    )}
                    title={tool.label}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{tool.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 右侧发送按钮 */}
          <div className="flex items-center gap-2">
            {isStreaming ? (
              <button
                type="button"
                onClick={onCancelStreaming}
                className={cn(
                  'group relative flex items-center justify-center',
                  'w-9 h-9 rounded-full',
                  'bg-gray-900 dark:bg-white text-white dark:text-gray-900',
                  'hover:bg-gray-800 dark:hover:bg-gray-100',
                  'transition-all duration-200 shadow-lg'
                )}
                aria-label={t('chat.stopGenerating') || 'Stop'}
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={doSend}
                disabled={!canSend}
                className={cn(
                  'flex items-center justify-center',
                  'w-9 h-9 rounded-full',
                  'bg-gray-900 dark:bg-white text-white dark:text-gray-900',
                  'hover:bg-gray-800 dark:hover:bg-gray-100',
                  'disabled:opacity-30 disabled:cursor-not-allowed',
                  'transition-all duration-200 shadow-lg hover:shadow-xl',
                  canSend && 'hover:scale-105'
                )}
                aria-label={t('chat.send') || 'Send'}
              >
                <ArrowUp className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 底部提示 */}
      <div className="text-center mt-2">
        <span className="text-[11px] text-gray-400 dark:text-gray-500">
          AI tutor can make mistakes. Please verify important information.
        </span>
      </div>
    </div>
  );
});
