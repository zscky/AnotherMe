'use client';

import { useRef, useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { motion, AnimatePresence } from 'motion/react';
import {
  PanelLeftClose,
  PanelLeft,
  Plus,
  MessageSquare,
  Settings,
  Search,
  MoreHorizontal,
  Edit3,
} from 'lucide-react';

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

interface FixedLayoutChatProps {
  className?: string;
}

// 模拟长消息用于测试滚动
const MOCK_LONG_MESSAGE = `这是一个测试长消息，用于验证滚动功能是否正常工作。

第一段落：Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

第二段落：Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

第三段落：Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.

第四段落：Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

第五段落：Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.

第六段落：Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.

第七段落：Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit.

第八段落：Sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem.`;

export function FixedLayoutChat({ className }: FixedLayoutChatProps) {
  const { t } = useI18n();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [input, setInput] = useState('');

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const messages = activeSession?.messages || [];

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

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
  const handleSend = useCallback(async () => {
    if (!input.trim()) return;

    if (!activeSessionId) {
      createNewSession();
    }

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input,
    };

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? { ...s, messages: [...s.messages, userMessage] }
          : s
      )
    );

    setInput('');
    setIsStreaming(true);

    // 模拟AI回复
    const assistantMessage: Message = {
      id: `msg-${Date.now() + 1}`,
      role: 'assistant',
      content: '',
      isStreaming: true,
    };

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? { ...s, messages: [...s.messages, assistantMessage] }
          : s
      )
    );

    // 模拟流式输出
    const response = MOCK_LONG_MESSAGE;
    let currentText = '';

    for (let i = 0; i < response.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
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
                  ? { ...m, isStreaming: false }
                  : m
              ),
            }
          : s
      )
    );
  }, [activeSessionId, input, createNewSession]);

  // Initialize a session during render if none exist
  if (sessions.length === 0) {
    createNewSession();
  }

  return (
    <div
      className={cn(
        'fixed inset-0 flex bg-[#faf8f5] dark:bg-[#1a1a1a]',
        'overflow-hidden'
      )}
    >
      {/* 左侧边栏 - 固定宽度，不可滚动 */}
      <aside
        className={cn(
          'flex flex-col border-r border-gray-200 dark:border-gray-800',
          'bg-white dark:bg-gray-900',
          sidebarCollapsed ? 'w-16' : 'w-64',
          'transition-all duration-300',
          'flex-shrink-0'
        )}
      >
        {/* Logo区域 */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center text-white font-bold text-sm">
                AI
              </div>
              <span className="font-semibold text-gray-900 dark:text-gray-100">
                Tutor
              </span>
            </div>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors"
          >
            {sidebarCollapsed ? (
              <PanelLeft className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* 新建按钮 */}
        <div className="p-3 flex-shrink-0">
          <button
            onClick={createNewSession}
            className={cn(
              'w-full flex items-center gap-2 px-4 py-2.5 rounded-xl',
              'border border-gray-200 dark:border-gray-700',
              'bg-white dark:bg-gray-800',
              'text-gray-700 dark:text-gray-200',
              'hover:bg-gray-50 dark:hover:bg-gray-700',
              'transition-colors text-sm font-medium',
              sidebarCollapsed && 'justify-center px-2'
            )}
          >
            <Plus className="w-4 h-4" />
            {!sidebarCollapsed && 'New chat'}
          </button>
        </div>

        {/* 会话列表 - 可滚动 */}
        <div className="flex-1 overflow-y-auto px-3 space-y-1 min-h-0">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => setActiveSessionId(session.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left',
                'transition-colors text-sm',
                activeSessionId === session.id
                  ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50',
                sidebarCollapsed && 'justify-center px-2'
              )}
            >
              <MessageSquare className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && (
                <span className="truncate flex-1">{session.title}</span>
              )}
            </button>
          ))}
        </div>

        {/* 底部设置 - 固定 */}
        <div className="p-3 border-t border-gray-100 dark:border-gray-800 flex-shrink-0">
          <button
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 rounded-xl',
              'text-gray-600 dark:text-gray-400',
              'hover:bg-gray-100 dark:hover:bg-gray-800',
              'transition-colors text-sm',
              sidebarCollapsed && 'justify-center'
            )}
          >
            <Settings className="w-4 h-4" />
            {!sidebarCollapsed && 'Settings'}
          </button>
        </div>
      </aside>

      {/* 中间主内容区 */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 顶部导航栏 - 固定 */}
        <header className="h-14 flex items-center justify-between px-6 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex-shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="font-semibold text-gray-900 dark:text-gray-100">
              {activeSession?.title || 'New Chat'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors">
              <Search className="w-4 h-4" />
            </button>
            <button className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* 消息卡片区域 - 固定高度，内部可滚动 */}
        <div className="flex-1 p-4 min-h-0 overflow-hidden">
          <div className="h-full max-w-4xl mx-auto bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col overflow-hidden">
            {/* 消息头部 */}
            <div className="h-12 flex items-center justify-between px-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center">
                  <span className="text-white text-xs font-bold">AI</span>
                </div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  AI Tutor
                </span>
              </div>
              <button className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
                <Edit3 className="w-4 h-4" />
              </button>
            </div>

            {/* 消息内容 - 可滚动 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center text-white mb-4">
                    <MessageSquare className="w-8 h-8" />
                  </div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    How can I help you today?
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md">
                    Ask me anything about learning, problem solving, or creative projects.
                  </p>
                </div>
              ) : (
                <>
                  {messages.map((message, index) => (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        'flex gap-3',
                        message.role === 'user' && 'flex-row-reverse'
                      )}
                    >
                      {/* 头像 */}
                      <div
                        className={cn(
                          'w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0',
                          message.role === 'user'
                            ? 'bg-gray-600'
                            : 'bg-gradient-to-br from-orange-500 to-red-500'
                        )}
                      >
                        {message.role === 'user' ? 'U' : 'AI'}
                      </div>

                      {/* 消息内容 */}
                      <div
                        className={cn(
                          'max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
                          message.role === 'user'
                            ? 'bg-gray-900 text-white rounded-br-sm'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-sm'
                        )}
                      >
                        <div className="whitespace-pre-wrap">{message.content}</div>
                        {message.isStreaming && (
                          <span className="inline-block w-2 h-4 bg-current animate-pulse ml-1" />
                        )}
                      </div>
                    </motion.div>
                  ))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* 输入区域 - 固定在卡片底部 */}
            <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex-shrink-0 bg-white dark:bg-gray-900">
              <div className="flex items-end gap-2">
                <div className="flex-1 relative">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Type your message..."
                    rows={1}
                    className={cn(
                      'w-full resize-none rounded-xl border border-gray-200 dark:border-gray-700',
                      'bg-gray-50 dark:bg-gray-800',
                      'px-4 py-3 pr-12',
                      'text-sm text-gray-900 dark:text-gray-100',
                      'placeholder:text-gray-400',
                      'focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500',
                      'min-h-[44px] max-h-[120px]'
                    )}
                    style={{ height: 'auto' }}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || isStreaming}
                    className={cn(
                      'absolute right-2 bottom-2',
                      'w-8 h-8 rounded-lg',
                      'bg-gray-900 dark:bg-white text-white dark:text-gray-900',
                      'flex items-center justify-center',
                      'disabled:opacity-30 disabled:cursor-not-allowed',
                      'hover:bg-gray-800 dark:hover:bg-gray-100',
                      'transition-colors'
                    )}
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 12h14M12 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 mt-2 text-center">
                AI can make mistakes. Please verify important information.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* 右侧边栏 - 固定宽度 */}
      <aside className="w-64 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex-shrink-0 hidden xl:flex flex-col">
        {/* 头部 */}
        <div className="h-14 flex items-center px-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            Tools & Resources
          </span>
        </div>

        {/* 工具列表 - 可滚动 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
          <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
              Deep Solve
            </h3>
            <p className="text-xs text-gray-500">
              Multi-step reasoning & problem solving
            </p>
          </div>

          <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
              Quiz Generation
            </h3>
            <p className="text-xs text-gray-500">
              Auto-validated question generation
            </p>
          </div>

          <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
              Deep Research
            </h3>
            <p className="text-xs text-gray-500">
              Comprehensive multi-agent research
            </p>
          </div>

          <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
              Math Animator
            </h3>
            <p className="text-xs text-gray-500">
              Generate math videos or storyboard images
            </p>
          </div>

          <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
              Visualize
            </h3>
            <p className="text-xs text-gray-500">
              Generate SVG, Chart.js, or Mermaid visuals
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default FixedLayoutChat;
