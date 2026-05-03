'use client';

import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { PanelLeftClose, PanelLeft, Plus, MessageSquare, Settings } from 'lucide-react';
import { ModernChatComposer } from './ModernChatComposer';
import { ModernChatMessage } from './ModernChatMessage';
import { WelcomeScreen } from './WelcomeScreen';

// 消息类型
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

// 会话类型
interface Session {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
}

interface ModernChatInterfaceProps {
  className?: string;
}

export function ModernChatInterface({ className }: ModernChatInterfaceProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const messages = useMemo(() => activeSession?.messages || [], [activeSession]);

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 创建新会话
  const createNewSession = useCallback(() => {
    const newSession: Session = {
      id: `session-${Date.now()}`,
      title: 'New Chat',
      messages: [],
      createdAt: new Date(),
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
  }, []);

  // 发送消息
  const handleSend = useCallback(
    async (content: string) => {
      if (!activeSessionId) {
        createNewSession();
      }

      const userMessage: Message = {
        id: `msg-${Date.now()}`,
        role: 'user',
        content,
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId
            ? { ...s, messages: [...s.messages, userMessage] }
            : s
        )
      );

      // 模拟AI回复
      setIsStreaming(true);
      const assistantMessage: Message = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        content: '',
        isStreaming: true,
        reasoning: 'Analyzing your question and preparing a comprehensive response...',
      };

      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId
            ? { ...s, messages: [...s.messages, assistantMessage] }
            : s
        )
      );

      // 模拟流式输出
      const response =
        "I'd be happy to help you with that! This is a simulated response to demonstrate the modern chat interface. In a real implementation, this would be connected to your AI backend.";
      let currentText = '';

      for (let i = 0; i < response.length; i++) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        currentText += response[i];
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId
              ? {
                  ...s,
                  messages: s.messages.map((m, idx) =>
                    idx === s.messages.length - 1
                      ? { ...m, content: currentText }
                      : m
                  ),
                }
              : s
          )
        );
      }

      setIsStreaming(false);
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId
            ? {
                ...s,
                messages: s.messages.map((m, idx) =>
                  idx === s.messages.length - 1
                    ? { ...m, isStreaming: false, reasoning: undefined }
                    : m
                ),
              }
            : s
        )
      );
    },
    [activeSessionId, createNewSession]
  );

  // 处理建议点击
  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      handleSend(suggestion);
    },
    [handleSend]
  );

  // Initialize a session during render if none exist
  if (sessions.length === 0) {
    createNewSession();
  }

  return (
    <div className={cn('flex h-[calc(100vh-4rem)] bg-gray-50 dark:bg-gray-950 overflow-hidden', className)}>
      {/* 侧边栏 */}
      <AnimatePresence mode="wait">
        {!sidebarCollapsed && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 260, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
            className="flex flex-col border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 h-full"
          >
            {/* 头部 */}
            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                  AI
                </div>
                <span className="font-semibold text-gray-900 dark:text-gray-100">
                  AI Tutor
                </span>
              </div>
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>

            {/* 新建按钮 */}
            <div className="p-3">
              <button
                onClick={createNewSession}
                className={cn(
                  'w-full flex items-center gap-2 px-4 py-2.5 rounded-xl',
                  'border border-gray-200 dark:border-gray-700',
                  'bg-white dark:bg-gray-800',
                  'text-gray-700 dark:text-gray-200',
                  'hover:bg-gray-50 dark:hover:bg-gray-700',
                  'transition-colors text-sm font-medium'
                )}
              >
                <Plus className="w-4 h-4" />
                New chat
              </button>
            </div>

            {/* 会话列表 */}
            <div className="flex-1 overflow-y-auto px-3 space-y-1">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => setActiveSessionId(session.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left',
                    'transition-colors text-sm',
                    activeSessionId === session.id
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  )}
                >
                  <MessageSquare className="w-4 h-4 shrink-0" />
                  <span className="truncate flex-1">{session.title}</span>
                </button>
              ))}
            </div>

            {/* 底部设置 */}
            <div className="p-3 border-t border-gray-100 dark:border-gray-800">
              <button
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-xl',
                  'text-gray-600 dark:text-gray-400',
                  'hover:bg-gray-100 dark:hover:bg-gray-800',
                  'transition-colors text-sm'
                )}
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* 折叠按钮 */}
      {sidebarCollapsed && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          className="absolute left-4 top-4 z-10 p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 shadow-sm"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
      )}

      {/* 主内容区 */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* 消息区域 */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {messages.length === 0 ? (
            <WelcomeScreen onSuggestionClick={handleSuggestionClick} />
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-6">
              {messages.map((message, index) => (
                <ModernChatMessage
                  key={message.id}
                  message={message}
                  isLast={index === messages.length - 1}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 输入区域 */}
        <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <ModernChatComposer
            isStreaming={isStreaming}
            onSend={handleSend}
            placeholder="Message AI tutor..."
          />
        </div>
      </main>
    </div>
  );
}

export default ModernChatInterface;
