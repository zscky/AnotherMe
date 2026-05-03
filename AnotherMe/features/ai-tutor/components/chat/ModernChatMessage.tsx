'use client';

import { useState, useCallback, memo } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  Copy,
  Check,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Volume2,
  Code,
  ChevronDown,
  ChevronUp,
  BrainIcon,
  Sparkles,
} from 'lucide-react';
import { AvatarDisplay } from '@/components/ui/avatar-display';
import { useUserProfileStore } from '@/lib/store/user-profile';

// 消息类型定义
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  reasoning?: string;
  metadata?: {
    model?: string;
    tokens?: number;
    latency?: number;
  };
}

interface ModernChatMessageProps {
  message: Message;
  isLast?: boolean;
  onCopy?: (content: string) => void;
  onRegenerate?: () => void;
  onFeedback?: (type: 'up' | 'down') => void;
}

// 代码块组件
const CodeBlock = memo(function CodeBlock({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-900">
      {/* 代码头部 */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Code className="w-4 h-4 text-gray-400" />
          <span className="text-xs text-gray-400 font-medium">
            {language || 'code'}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      {/* 代码内容 */}
      <pre className="p-4 overflow-x-auto">
        <code className="text-sm text-gray-100 font-mono leading-relaxed">
          {code}
        </code>
      </pre>
    </div>
  );
});

// 神经节点动画指示器
const NeuralDots = memo(function NeuralDots() {
  return (
    <span className="flex items-center gap-0.5">
      <span className="neural-dot inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
      <span className="neural-dot inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
      <span className="neural-dot inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
    </span>
  );
});

// 脑波动画指示器
const BrainWaveIndicator = memo(function BrainWaveIndicator() {
  return (
    <div className="thinking-ripple flex h-5 w-5 items-center justify-center text-amber-500">
      <BrainIcon className="size-4 animate-brain-wave" />
    </div>
  );
});

// 思考过程组件
const ReasoningBlock = memo(function ReasoningBlock({
  reasoning,
  isStreaming = false,
}: {
  reasoning: string;
  isStreaming?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={`mb-3 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-900/20 overflow-hidden animate-thinking-enter ${isStreaming ? 'animate-border-glow' : ''}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <BrainWaveIndicator />
          ) : (
            <Sparkles className="w-4 h-4 text-amber-500" />
          )}
          <span className={`text-sm font-medium ${isStreaming ? 'thinking-text-shimmer text-transparent' : 'text-amber-800 dark:text-amber-200'}`}>
            {isStreaming ? 'Thinking' : 'Thought Process'}
          </span>
          {isStreaming && <NeuralDots />}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        )}
      </button>
      {isExpanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="px-4 pb-3"
        >
          <p className="text-sm text-amber-700 dark:text-amber-300/80 leading-relaxed">
            {reasoning}
          </p>
        </motion.div>
      )}
    </div>
  );
});

// 用户消息
const UserMessage = memo(function UserMessage({
  content,
}: {
  content: string;
}) {
  const userProfileAvatar = useUserProfileStore((s) => s.avatar);

  return (
    <div className="flex gap-3 justify-end">
      <div className="flex-1 max-w-[85%]">
        <div className="rounded-2xl rounded-tr-sm bg-indigo-600 dark:bg-indigo-500 px-5 py-3 text-white shadow-sm">
          <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{content}</p>
        </div>
      </div>
      <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 shrink-0 ring-2 ring-white dark:ring-gray-800">
        <AvatarDisplay
          src={userProfileAvatar || '/avatars/user.png'}
          alt="User"
          className="text-xs"
        />
      </div>
    </div>
  );
});

// 助手消息
const AssistantMessage = memo(function AssistantMessage({
  message,
  isLast,
  onCopy,
  onRegenerate,
  onFeedback,
}: ModernChatMessageProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!message.content) return;
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onCopy?.(message.content);
  }, [message.content, onCopy]);

  const handleFeedback = useCallback(
    (type: 'up' | 'down') => {
      setFeedback(type);
      onFeedback?.(type);
    },
    [onFeedback]
  );

  // 简单的Markdown解析
  const renderContent = (content: string) => {
    // 代码块
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      // 添加代码块前的文本
      if (match.index > lastIndex) {
        const textBefore = content.slice(lastIndex, match.index);
        parts.push(
          <p
            key={`text-${lastIndex}`}
            className="text-[15px] leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap"
          >
            {textBefore}
          </p>
        );
      }

      // 添加代码块
      const language = match[1];
      const code = match[2].trim();
      parts.push(<CodeBlock key={`code-${match.index}`} code={code} language={language} />);

      lastIndex = match.index + match[0].length;
    }

    // 添加剩余文本
    if (lastIndex < content.length) {
      const remainingText = content.slice(lastIndex);
      parts.push(
        <p
          key={`text-${lastIndex}`}
          className="text-[15px] leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap"
        >
          {remainingText}
        </p>
      );
    }

    return parts.length > 0 ? parts : content;
  };

  return (
    <div className="flex gap-3">
      {/* 头像 */}
      <div className="w-8 h-8 rounded-xl overflow-hidden bg-gradient-to-br from-indigo-500 to-purple-600 shrink-0 flex items-center justify-center text-white text-xs font-bold">
        AI
      </div>

      <div className="flex-1 min-w-0 space-y-1">
        {/* 消息内容 */}
        <div className="group/message relative">
          {/* 思考过程 */}
          {message.reasoning && <ReasoningBlock reasoning={message.reasoning} isStreaming={message.isStreaming} />}

          {/* 主要内容 */}
          <div className="rounded-2xl rounded-tl-sm bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 px-5 py-3 shadow-sm">
            <div className="space-y-2">
              {renderContent(message.content)}
              {message.isStreaming && isLast && (
                <span className="inline-block w-2 h-4 bg-gray-400 dark:bg-gray-500 animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-1 mt-2 opacity-0 group-hover/message:opacity-100 transition-opacity duration-200">
            {/* 复制按钮 */}
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800 transition-colors"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copied ? t('common.copied') : t('common.copy')}</span>
            </button>

            {/* 重新生成按钮 */}
            {!message.isStreaming && onRegenerate && (
              <button
                onClick={onRegenerate}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t('chat.regenerate')}</span>
              </button>
            )}

            {/* 朗读按钮 */}
            <button
              onClick={() => setIsSpeaking(!isSpeaking)}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-colors',
                isSpeaking
                  ? 'text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-900/30'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800'
              )}
            >
              <Volume2 className="w-3.5 h-3.5" />
            </button>

            {/* 分隔线 */}
            <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />

            {/* 反馈按钮 */}
            <button
              onClick={() => handleFeedback('up')}
              className={cn(
                'p-1.5 rounded-lg transition-colors',
                feedback === 'up'
                  ? 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/30'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800'
              )}
            >
              <ThumbsUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleFeedback('down')}
              className={cn(
                'p-1.5 rounded-lg transition-colors',
                feedback === 'down'
                  ? 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/30'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800'
              )}
            >
              <ThumbsDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 元信息 */}
        {message.metadata && (
          <div className="flex items-center gap-3 text-[10px] text-gray-400 dark:text-gray-500">
            {message.metadata.model && <span>{message.metadata.model}</span>}
            {message.metadata.tokens && <span>{message.metadata.tokens} tokens</span>}
            {message.metadata.latency && <span>{message.metadata.latency}ms</span>}
          </div>
        )}
      </div>
    </div>
  );
});

// 主组件
export function ModernChatMessage({
  message,
  isLast,
  onCopy,
  onRegenerate,
  onFeedback,
}: ModernChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      className="py-4"
    >
      {isUser ? (
        <UserMessage content={message.content} />
      ) : (
        <AssistantMessage
          message={message}
          isLast={isLast}
          onCopy={onCopy}
          onRegenerate={onRegenerate}
          onFeedback={onFeedback}
        />
      )}
    </motion.div>
  );
}

export default ModernChatMessage;
