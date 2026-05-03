'use client';

import { useCallback, useRef, useState, memo } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  ArrowUp,
  Paperclip,
  Square,
  ChevronDown,
  Wrench,
  BookOpen,
  Zap,
  X,
} from 'lucide-react';

interface PendingAttachment {
  type: string;
  filename: string;
  previewUrl?: string;
}

export type ChatCapability = 'chat' | 'deep_solve' | 'quiz' | 'research' | 'math_animator' | 'visualize';

interface ChatComposerProps {
  isStreaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  capability?: ChatCapability;
  attachments?: PendingAttachment[];
  onSend?: (content: string) => void;
  onCapabilityChange?: (capability: ChatCapability) => void;
  onCancelStreaming?: () => void;
  onAddFiles?: (files: File[]) => void;
  onRemoveAttachment?: (index: number) => void;
}

const CAPABILITY_OPTIONS: Array<{ value: ChatCapability; label: string }> = [
  { value: 'chat', label: 'Chat' },
  { value: 'deep_solve', label: 'Solve' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'research', label: 'Research' },
  { value: 'math_animator', label: 'Animator' },
  { value: 'visualize', label: 'Visualize' },
];

export const ChatComposer = memo(function ChatComposer({
  isStreaming,
  disabled,
  placeholder,
  capability = 'chat',
  attachments = [],
  onSend,
  onCapabilityChange,
  onCancelStreaming,
  onAddFiles,
  onRemoveAttachment,
}: ChatComposerProps) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [hasContent, setHasContent] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);



  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setInput(value);
      setHasContent(!!value.trim());

      // Auto-resize textarea
      const el = e.target;
      el.style.height = '28px';
      const next = Math.max(el.scrollHeight, 28);
      const bounded = Math.min(next, 200);
      el.style.height = `${bounded}px`;
      el.style.overflowY = next > 200 ? 'auto' : 'hidden';
    },
    [],
  );

  const doSend = useCallback(() => {
    const content = input.trim();
    if (!content && !attachments.length) return;
    onSend?.(content);
    setInput('');
    setHasContent(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = '28px';
      textareaRef.current.style.overflowY = 'hidden';
    }
  }, [input, attachments.length, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    },
    [doSend],
  );

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const picked = Array.from(event.target.files ?? []);
      if (picked.length) onAddFiles?.(picked);
      event.target.value = '';
    },
    [onAddFiles],
  );

  const canSend = (hasContent || !!attachments.length) && !isStreaming && !disabled;

  return (
    <div className="relative z-20 mx-auto w-full shrink-0 pb-3 pt-1">
      <div className="relative">
        <div
          className={cn(
            'relative rounded-2xl border bg-white dark:bg-gray-900 shadow-[0_1px_8px_rgba(0,0,0,0.03)] transition-colors',
            'border-gray-200 dark:border-gray-700',
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.txt,.md,.csv,.json,.py,.js,.ts,.tsx"
            onChange={handleFileInputChange}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
          />

          {/* Attachments preview */}
          {!!attachments.length && (
            <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1">
              {attachments.map((a, i) => {
                if (a.type === 'image' && a.previewUrl) {
                  return (
                    <div key={`${a.filename}-${i}`} className="group relative">
                      <div className="relative block h-14 w-14 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 transition-shadow hover:shadow-md">
                        <img
                          src={a.previewUrl}
                          alt={a.filename}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveAttachment?.(i);
                        }}
                        className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-gray-800 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  );
                }
                return (
                  <div key={`${a.filename}-${i}`} className="group relative">
                    <div className="flex h-14 w-[140px] items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2.5 text-left">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-100 dark:bg-gray-700">
                        <Paperclip className="w-4 h-4 text-gray-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-medium text-gray-700 dark:text-gray-200">
                          {a.filename}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveAttachment?.(i);
                      }}
                      className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-gray-800 text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Textarea */}
          <div className="px-4 pt-3 pb-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={disabled}
              placeholder={
                placeholder || t('chat.howCanIHelp') || 'How can I help you today?'
              }
              className="w-full resize-none overflow-hidden bg-transparent text-[14px] leading-relaxed text-gray-900 dark:text-gray-100 outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500 disabled:opacity-50"
              style={{ transition: 'height 0.15s ease-out', minHeight: 28 }}
            />
          </div>

          {/* Bottom toolbar - DeepTutor style */}
          <div className="border-t border-gray-100 dark:border-gray-800/50 px-3 py-2">
            <div className="flex items-center gap-1">
              {/* Tools button */}
              <button
                type="button"
                onClick={() => setShowToolsMenu(!showToolsMenu)}
                disabled={disabled}
                className="inline-flex shrink-0 items-center gap-1 py-1 px-2 text-[11px] font-medium text-gray-600 dark:text-gray-300 transition-colors hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-40 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>Tools</span>
                <ChevronDown className="w-3 h-3" />
              </button>

              {/* Reference button */}
              <button
                type="button"
                disabled={disabled}
                className="inline-flex shrink-0 items-center gap-1 py-1 px-2 text-[11px] font-medium text-gray-600 dark:text-gray-300 transition-colors hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-40 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Reference</span>
                <ChevronDown className="w-3 h-3" />
              </button>

              {/* Skills button */}
              <button
                type="button"
                disabled={disabled}
                className="inline-flex shrink-0 items-center gap-1 py-1 px-2 text-[11px] font-medium text-gray-600 dark:text-gray-300 transition-colors hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-40 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Skills</span>
                <ChevronDown className="w-3 h-3" />
              </button>

              <select
                value={capability}
                onChange={(event) => onCapabilityChange?.(event.target.value as ChatCapability)}
                disabled={disabled}
                className="ml-1 h-7 rounded-md border border-gray-200 bg-white px-2 text-[11px] font-medium text-gray-600 outline-none transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                aria-label="Capability"
              >
                {CAPABILITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <div className="flex-1" />

              {/* Send / Stop button */}
              {isStreaming ? (
                <button
                  type="button"
                  onClick={onCancelStreaming}
                  className="group relative inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full bg-purple-600 text-white shadow-[0_4px_12px_rgba(147,51,234,0.18)] transition-all hover:bg-purple-700 hover:shadow-[0_6px_16px_rgba(147,51,234,0.28)]"
                  aria-label={t('chat.stopGenerating') || 'Stop generating'}
                  title={t('chat.stopGenerating') || 'Stop generating'}
                >
                  <span className="pointer-events-none absolute inset-0 rounded-full border-[1.5px] border-white/30 border-t-white/85 animate-spin opacity-90 transition-opacity group-hover:opacity-40" />
                  <Square className="relative z-10 w-2.5 h-2.5 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={doSend}
                  disabled={!canSend}
                  className="rounded-full bg-purple-600 p-[6px] text-white shadow-[0_4px_12px_rgba(147,51,234,0.15)] transition-all hover:bg-purple-700 hover:shadow-[0_6px_16px_rgba(147,51,234,0.22)] disabled:opacity-25 disabled:shadow-none disabled:cursor-not-allowed"
                  aria-label={t('chat.send') || 'Send'}
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
