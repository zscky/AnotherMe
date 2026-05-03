'use client';

import React, { useState, useCallback, memo, useMemo } from 'react';
import { motion } from 'motion/react';

import { BookOpen, Copy, Check, RefreshCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { AvatarDisplay } from '@/components/ui/avatar-display';
import { useUserProfileStore } from '@/lib/store/user-profile';
import type { UIMessage } from 'ai';
import type { ChatMessageMetadata } from '@/lib/types/chat';

// 导入新的组件
import { VisualizationViewer, type VisualizeResult } from '../visualization/VisualizationViewer';
import { ImageViewer, FullscreenImageViewer } from '../visualization/ImageViewer';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { CallTracePanel, type CallTrace, type StreamEvent } from './CallTracePanel';
import type { FilePreviewSource } from '../file-preview/FilePreviewDrawer';

// 附件类型
interface MessageAttachment {
  id?: string;
  type: 'image' | 'file' | 'pdf';
  filename: string;
  url?: string;
  base64?: string;
  mime_type?: string;
  extracted_text?: string;
  size?: number;
}

// 扩展示例消息元数据
interface ExtendedChatMessageMetadata extends ChatMessageMetadata {
  attachments?: MessageAttachment[];
  events?: StreamEvent[];
  visualizeResult?: VisualizeResult;
  capability?: string;
  notebookReferences?: Array<{ record_ids?: string[] }>;
}

// 从 UIMessage.parts 中提取纯文本
function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p): p is import('ai').TextUIPart => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

interface EnhancedChatMessageProps {
  message: UIMessage<ExtendedChatMessageMetadata>;
  isStreaming?: boolean;
  isLastMessage?: boolean;
  activeBubbleId?: string | null;
  onCopy?: (content: string) => void;
  onRegenerate?: () => void;
  onPreviewAttachment?: (attachment: FilePreviewSource) => void;
}

const AVATARS = {
  teacher: '/avatars/teacher.png',
  user: '/avatars/user.png',
};

// 获取能力标签
function getCapabilityLabel(capability?: string): string {
  if (!capability || capability === 'chat') return 'Chat';
  const labels: Record<string, string> = {
    deep_solve: 'Deep Solve',
    quiz: 'Quiz',
    research: 'Research',
    math_animator: 'Math Animator',
    visualize: 'Visualize',
  };
  return labels[capability] || capability;
}

// 用户消息组件
const UserMessage = memo(function UserMessage({
  message,
  onPreviewAttachment,
}: {
  message: UIMessage<ExtendedChatMessageMetadata>;
  onPreviewAttachment?: (attachment: FilePreviewSource) => void;
}) {
  useI18n();
  const [fullscreenImage, setFullscreenImage] = useState<{ src: string; filename?: string } | null>(null);

  const attachments = message.metadata?.attachments || [];
  const images = attachments.filter((a) => a.type === 'image');
  const files = attachments.filter((a) => a.type !== 'image');
  const capability = message.metadata?.capability;

  return (
    <>
      <div className="flex justify-end">
        <div className="max-w-[85%] space-y-2">
          {/* 能力标签 */}
          {capability && (
            <div className="flex justify-end pr-1">
              <span className="text-[10px] tracking-wide text-gray-400 dark:text-gray-500">
                {getCapabilityLabel(capability)}
              </span>
            </div>
          )}

          {/* 图片附件 */}
          {images.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {images.map((img, idx) => {
                const src = img.url || (img.base64 ? `data:${img.mime_type};base64,${img.base64}` : '');
                if (!src) return null;

                return (
                  <ImageViewer
                    key={idx}
                    src={src}
                    alt={img.filename}
                    filename={img.filename}
                    onClick={() => {
                      setFullscreenImage({ src, filename: img.filename });
                      onPreviewAttachment?.({
                        filename: img.filename,
                        type: 'image',
                        url: img.url,
                        base64: img.base64,
                        mimeType: img.mime_type,
                      });
                    }}
                  />
                );
              })}
            </div>
          )}

          {/* 文件附件 */}
          {files.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {files.map((file, idx) => (
                <button
                  key={idx}
                  onClick={() =>
                    onPreviewAttachment?.({
                      filename: file.filename,
                      type: file.type === 'pdf' ? 'pdf' : 'fallback',
                      url: file.url,
                      base64: file.base64,
                      mimeType: file.mime_type,
                      extractedText: file.extracted_text,
                      size: file.size,
                    })
                  }
                  className="flex h-14 w-[200px] items-center gap-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2.5 text-left shadow-sm transition-colors hover:border-purple-300 dark:hover:border-purple-700"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 dark:bg-gray-700">
                    <BookOpen className="w-4 h-4 text-gray-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-medium text-gray-700 dark:text-gray-200">
                      {file.filename}
                    </div>
                    <div className="truncate text-[9px] uppercase tracking-wide text-gray-400">
                      {file.type}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* 引用标记 */}
          {message.metadata?.notebookReferences && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {message.metadata.notebookReferences.map((ref, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-[10px] text-gray-500"
                >
                  <BookOpen size={10} />
                  Notebook · {ref.record_ids?.length || 0} records
                </span>
              ))}
            </div>
          )}

          {/* 消息内容 */}
          <div className="rounded-2xl bg-gradient-to-br from-purple-600 to-purple-700 dark:from-purple-500 dark:to-purple-600 px-4 py-2.5 text-[14px] leading-relaxed text-white shadow-sm">
            {getTextContent(message)}
          </div>
        </div>
      </div>

      {/* 全屏图片查看器 */}
      {fullscreenImage && (
        <FullscreenImageViewer
          src={fullscreenImage.src}
          filename={fullscreenImage.filename}
          isOpen={!!fullscreenImage}
          onClose={() => setFullscreenImage(null)}
        />
      )}
    </>
  );
});

// 助手消息组件
const AssistantMessage = memo(function AssistantMessage({
  message,
  isStreaming,
  isLastMessage,
  onCopy,
  onRegenerate,
}: EnhancedChatMessageProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const events = useMemo(() => message.metadata?.events || [], [message.metadata?.events]);
  const visualizeResult = message.metadata?.visualizeResult;
  const hasCallTrace = events.length > 0;
  const textContent = useMemo(() => getTextContent(message), [message]);

  const handleCopy = useCallback(async () => {
    if (!textContent) return;
    try {
      await navigator.clipboard.writeText(textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onCopy?.(textContent);
    } catch {
      // ignore
    }
  }, [textContent, onCopy]);

  const traces = useMemo(() => {
    const traceMap = new Map<string, CallTrace>();

    events.forEach((event) => {
      const callId = (event.metadata?.call_id as string) || 'default';
      let trace = traceMap.get(callId);
      if (!trace) {
        trace = {
          ...event.metadata,
          id: callId,
          toolName: (event.metadata?.tool_name as string) || event.stage,
          status: 'running',
          startTime: event.timestamp * 1000,
          events: [],
        };
        traceMap.set(callId, trace);
      }
      trace.events ??= [];
      trace.events.push(event);
    });

    // 更新状态
    traceMap.forEach((trace) => {
      const traceEvents = trace.events || [];
      const lastEvent = traceEvents[traceEvents.length - 1];
      if (lastEvent?.type === 'error') {
        trace.status = 'error';
        trace.error = lastEvent.content;
      } else if (lastEvent?.type === 'tool_result' || lastEvent?.type === 'result') {
        trace.status = 'success';
        trace.output = lastEvent.content;
        trace.endTime = lastEvent.timestamp * 1000;
      } else if (lastEvent?.type === 'tool_call') {
        // 工具调用中，状态保持 running
        trace.status = 'running';
      }
    });

    return Array.from(traceMap.values());
  }, [events]);

  return (
    <div className="space-y-3">
      {/* 工具执行轨迹 */}
      {hasCallTrace && <CallTracePanel traces={traces} isStreaming={isStreaming} />}

      {/* 可视化结果 */}
      {visualizeResult && (
        <div className="my-3">
          <VisualizationViewer result={visualizeResult} />
        </div>
      )}

      {/* 消息内容 */}
      {textContent && (
        <div className="group/message relative">
          <div className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 px-4 py-3 text-[14px] leading-relaxed text-gray-800 dark:text-gray-100 shadow-sm">
            <MarkdownRenderer content={textContent} variant="prose" />

            {/* 流式指示器 */}
            {isStreaming && isLastMessage && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse ml-1" />
            )}
          </div>

          {/* 操作按钮 */}
          <div className="mt-2 flex items-center gap-2 opacity-0 group-hover/message:opacity-100 transition-opacity">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? t('common.copied') : t('common.copy')}
            </button>

            {!isStreaming && onRegenerate && (
              <button
                onClick={onRegenerate}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
              >
                <RefreshCcw className="w-3 h-3" />
                {t('chat.regenerate')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

// 主组件
export function EnhancedChatMessage({
  message,
  isStreaming,
  isLastMessage,
  activeBubbleId,
  onCopy,
  onRegenerate,
  onPreviewAttachment,
}: EnhancedChatMessageProps) {
  const userProfileAvatar = useUserProfileStore((s) => s.avatar);
  const isUser = message.metadata?.originalRole === 'user';
  const isActiveBubble = activeBubbleId === message.id;

  const avatar = isUser
    ? userProfileAvatar || AVATARS.user
    : message.metadata?.senderAvatar || AVATARS.teacher;

  const senderName = (() => {
    if (isUser) return 'You';
    const agentId = message.metadata?.agentId;
    if (agentId) return agentId;
    return message.metadata?.senderName || 'Assistant';
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        'flex gap-3 px-2 py-2',
        isUser && 'flex-row-reverse',
        isActiveBubble && 'bg-violet-50/50 dark:bg-violet-900/10 rounded-xl',
      )}
    >
      {/* 头像 */}
      <div className="w-7 h-7 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800 shrink-0 ring-1 ring-gray-200/50 dark:ring-gray-700/50">
        <AvatarDisplay src={avatar} alt={senderName} className="text-xs" />
      </div>

      {/* 内容区域 */}
      <div className={cn('flex-1 min-w-0 flex flex-col', isUser && 'items-end')}>
        {/* 发送者名称 */}
        <span
          className={cn(
            'text-[10px] font-semibold uppercase tracking-wider mb-1',
            isUser
              ? 'text-purple-500 dark:text-purple-400'
              : 'text-gray-400 dark:text-gray-500',
          )}
        >
          {senderName}
        </span>

        {/* 消息内容 */}
        {isUser ? (
          <UserMessage message={message} onPreviewAttachment={onPreviewAttachment} />
        ) : (
          <AssistantMessage
            message={message}
            isStreaming={isStreaming}
            isLastMessage={isLastMessage}
            onCopy={onCopy}
            onRegenerate={onRegenerate}
          />
        )}
      </div>
    </motion.div>
  );
}

export default EnhancedChatMessage;
