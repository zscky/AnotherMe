'use client';

import { useImperativeHandle, forwardRef, useRef, useCallback, useState, useMemo } from 'react';
import type { SessionType } from '@/lib/types/chat';
import type { DiscussionRequest } from '@/features/classroom/components/roundtable';
import type { Action } from '@/lib/types/action';
import type { TutorToolState } from '@/lib/types/tutor-tools';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useStageStore } from '@/lib/store';
import { PanelRightClose, BookOpen, MessageSquare, NotebookPen, Plus } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useChatSessions } from './use-chat-sessions';
import { SessionList } from './session-list';
import { LectureNotesView } from './lecture-notes-view';
import { ToolTracePanel } from './tool-trace-panel';
import { ChatComposer, type ChatCapability } from './chat-composer';

interface ChatAreaProps {
  className?: string;
  width?: number;
  onWidthChange?: (width: number) => void;
  collapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
  activeBubbleId?: string | null;
  onActiveBubble?: (messageId: string | null) => void;
  onLiveSpeech?: (text: string | null, agentId?: string | null) => void;
  onSpeechProgress?: (ratio: number | null) => void;
  onThinking?: (state: { stage: string; agentId?: string } | null) => void;
  onCueUser?: (fromAgentId?: string, prompt?: string) => void;
  onLiveSessionError?: () => void;
  onStopSession?: () => void;
  onSegmentSealed?: (
    messageId: string,
    partId: string,
    fullText: string,
    agentId: string | null,
  ) => void;
  shouldHoldAfterReveal?: () => { holding: boolean; segmentDone: number } | boolean;
  currentSceneId?: string | null;
  stageId?: string | null;
  tutorToolState?: TutorToolState;
}

export interface ChatAreaRef {
  createSession: (type: SessionType, title: string) => Promise<string>;
  endSession: (sessionId: string) => Promise<void>;
  endActiveSession: () => Promise<void>;
  softPauseActiveSession: () => Promise<void>;
  resumeActiveSession: () => Promise<void>;
  sendMessage: (content: string, capability?: 'chat' | 'deep_solve' | 'quiz' | 'research' | 'math_animator' | 'visualize') => Promise<void>;
  startDiscussion: (request: DiscussionRequest) => Promise<void>;
  startLecture: (sceneId: string) => Promise<string>;
  addLectureMessage: (sessionId: string, action: Action, actionIndex: number) => void;
  getIsStreaming: () => boolean;
  getActiveSessionType: () => string | null;
  getLectureMessageId: (sessionId: string) => string | null;
  pauseBuffer: (sessionId: string) => void;
  resumeBuffer: (sessionId: string) => void;
  pauseActiveLiveBuffer: () => boolean;
  resumeActiveLiveBuffer: () => void;
  switchToTab: (tab: 'lecture' | 'chat') => void;
  deleteMessage: (sessionId: string, messageId: string) => void;
  deleteSession: (sessionId: string) => void;
}

const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 280;
const MAX_WIDTH = 600;

export const ChatArea = forwardRef<ChatAreaRef, ChatAreaProps>(
  (
    {
      className,
      width = DEFAULT_WIDTH,
      onWidthChange,
      collapsed = false,
      onCollapseChange,
      activeBubbleId,
      onActiveBubble,
      onLiveSpeech,
      onSpeechProgress,
      onThinking,
      onCueUser,
      onLiveSessionError,
      onStopSession,
      onSegmentSealed,
      shouldHoldAfterReveal,
      currentSceneId,
      tutorToolState,
    },
    ref,
  ) => {
    const { t } = useI18n();
    const stageId = useStageStore((s) => s.stage?.id ?? null);
    const scenes = useStageStore((s) => s.scenes);
    const {
      sessions,
      activeSessionType,
      expandedSessionIds,
      isStreaming,
      toolTraces,
      createSession,
      endSession,
      endActiveSession,
      softPauseActiveSession,
      resumeActiveSession,
      sendMessage,
      startDiscussion,
      startLecture,
      addLectureMessage,
      toggleSessionExpand,
      getLectureMessageId,
      pauseBuffer,
      resumeBuffer,
      pauseActiveLiveBuffer,
      resumeActiveLiveBuffer,
      deleteMessage,
      deleteSession,
    } = useChatSessions({
      onLiveSpeech,
      onSpeechProgress,
      onThinking,
      onCueUser,
      onActiveBubble,
      onLiveSessionError,
      onStopSession,
      onSegmentSealed,
      shouldHoldAfterReveal,
      tutorToolState,
    });

    const [activeTab, setActiveTab] = useState<'lecture' | 'chat'>('lecture');
    const [capability, setCapability] = useState<ChatCapability>('chat');
    const isDraggingRef = useRef(false);
    const [isDragging, setIsDragging] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    const chatSessions = useMemo(() => sessions.filter((s) => s.type !== 'lecture'), [sessions]);

    const hasActiveChatSession = useMemo(
      () => chatSessions.some((s) => s.status === 'active'),
      [chatSessions],
    );

    const handleEndSession = useCallback(
      async (sessionId: string) => {
        await endSession(sessionId);
        onStopSession?.();
      },
      [endSession, onStopSession],
    );

    const switchToTab = useCallback((tab: 'lecture' | 'chat') => {
      setActiveTab(tab);
    }, []);

    useImperativeHandle(ref, () => ({
      createSession,
      endSession,
      endActiveSession,
      softPauseActiveSession,
      resumeActiveSession,
      sendMessage,
      startDiscussion,
      startLecture,
      addLectureMessage,
      getIsStreaming: () => isStreaming,
      getActiveSessionType: () => activeSessionType,
      getLectureMessageId,
      pauseBuffer,
      resumeBuffer,
      pauseActiveLiveBuffer,
      resumeActiveLiveBuffer,
      switchToTab,
      deleteMessage,
      deleteSession,
    }));

    const handleDragStart = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        isDraggingRef.current = true;
        setIsDragging(true);
        const startX = e.clientX;
        const startWidth = width;

        const handleMouseMove = (me: MouseEvent) => {
          const delta = startX - me.clientX;
          const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
          onWidthChange?.(newWidth);
        };

        const handleMouseUp = () => {
          isDraggingRef.current = false;
          setIsDragging(false);
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
        };

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
      },
      [width, onWidthChange],
    );

    const displayWidth = collapsed ? 0 : width;

    const handleSendMessage = useCallback(
      async (content: string) => {
        // v3.3+: 传递当前选中的 capability
        await sendMessage(content, capability);
      },
      [sendMessage, capability],
    );

    return (
      <div
        style={{
          width: displayWidth,
          transition: isDragging ? 'none' : 'width 0.3s ease',
        }}
        className={cn(
          'bg-[#faf9f7] dark:bg-[#1a1a1a] border-l border-gray-200/60 dark:border-gray-800/60 shadow-[-2px_0_24px_rgba(0,0,0,0.02)] flex flex-col shrink-0 z-20 relative overflow-visible',
          className,
        )}
      >
        {/* Drag handle */}
        {!collapsed && (
          <div
            onMouseDown={handleDragStart}
            className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-50 group hover:bg-purple-400/30 dark:hover:bg-purple-600/30 active:bg-purple-500/40 dark:active:bg-purple-500/40 transition-colors"
          >
            <div className="absolute left-0.5 top-1/2 -translate-y-1/2 w-0.5 h-8 rounded-full bg-gray-300 dark:bg-gray-600 group-hover:bg-purple-400 dark:group-hover:bg-purple-500 transition-colors" />
          </div>
        )}

        <div className={cn('flex flex-col w-full h-full overflow-hidden', collapsed && 'hidden')}>
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'lecture' | 'chat')}
            className="flex flex-col h-full gap-0"
          >
            {/* Tab header row */}
            <div className="h-11 flex items-center gap-1 shrink-0 mt-3 mb-1 px-3">
              <TabsList variant="line" className="h-full flex-1 w-0 bg-transparent">
                <TabsTrigger
                  value="lecture"
                  className="text-xs gap-1.5 flex-1 data-[state=active]:bg-purple-50 dark:data-[state=active]:bg-purple-900/20 data-[state=active]:text-purple-700 dark:data-[state=active]:text-purple-300"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  {t('chat.tabs.lecture')}
                </TabsTrigger>
                <TabsTrigger
                  value="chat"
                  className="text-xs gap-1.5 flex-1 relative data-[state=active]:bg-purple-50 dark:data-[state=active]:bg-purple-900/20 data-[state=active]:text-purple-700 dark:data-[state=active]:text-purple-300"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  {t('chat.tabs.chat')}
                  {hasActiveChatSession && activeTab === 'lecture' && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              {onCollapseChange && (
                <button
                  onClick={() => onCollapseChange(true)}
                  className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center bg-gray-100/80 dark:bg-gray-800/80 text-gray-500 dark:text-gray-400 ring-1 ring-black/[0.04] dark:ring-white/[0.06] hover:bg-gray-200/90 dark:hover:bg-gray-700/90 hover:text-gray-700 dark:hover:text-gray-200 active:scale-90 transition-all duration-200"
                >
                  <PanelRightClose className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Notes Tab */}
            <TabsContent value="lecture" className="flex-1 overflow-hidden flex flex-col">
              <LectureNotesView
                scenes={scenes}
                currentSceneId={currentSceneId}
                stageId={stageId}
              />
            </TabsContent>

            {/* Chat Tab - DeepTutor style */}
            <TabsContent value="chat" className="flex-1 overflow-hidden flex flex-col min-h-0">
              {/* Top header bar */}
              <div className="flex items-center justify-between px-4 py-2 shrink-0">
                <span className="text-[13px] font-semibold text-gray-800 dark:text-gray-200">
                  Chat
                </span>
                <div className="flex items-center gap-2">
                  <button className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <NotebookPen className="w-3 h-3" />
                    Save to Notebook
                  </button>
                  <button className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <Plus className="w-3 h-3" />
                    New chat
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 space-y-3 scrollbar-hide">
                {/* AI导师工具执行轨迹 */}
                <ToolTracePanel traces={toolTraces} isStreaming={isStreaming} />

                {chatSessions.length === 0 ? (
                  /* Empty state - DeepTutor style */
                  <div className="flex-1 flex flex-col items-center justify-center text-center px-6 min-h-[300px]">
                    <h2 className="text-[22px] font-semibold text-gray-800 dark:text-gray-100 mb-2 tracking-tight">
                      {t('chat.welcomeTitle') || 'What would you like to learn?'}
                    </h2>
                    <p className="text-[13px] text-gray-400 dark:text-gray-500 leading-relaxed">
                      {t('chat.welcomeSubtitle') || 'Ask anything — I am here to help you understand.'}
                    </p>
                  </div>
                ) : (
                  <>
                    <SessionList
                      sessions={chatSessions}
                      expandedSessionIds={expandedSessionIds}
                      isStreaming={isStreaming}
                      activeBubbleId={activeBubbleId}
                      onToggleExpand={toggleSessionExpand}
                      onEndSession={handleEndSession}
                      onDeleteMessage={deleteMessage}
                      onDeleteSession={deleteSession}
                    />
                    <div ref={bottomRef} />
                  </>
                )}
              </div>

              {/* Chat Composer */}
              <div className="shrink-0 px-3 pb-3 pt-1">
                <ChatComposer
                  isStreaming={isStreaming}
                  capability={capability}
                  onSend={handleSendMessage}
                  onCapabilityChange={setCapability}
                  onCancelStreaming={() => {
                    // Interrupt active generation
                    // The hook's sendMessage handles abort internally
                  }}
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    );
  },
);

ChatArea.displayName = 'ChatArea';
