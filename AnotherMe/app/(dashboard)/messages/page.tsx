'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  Search,
  Edit,
  Send,
  Loader2,
  MessageSquare,
  Users,
  UserPlus,
  X,
  Trash2,
  MoreVertical,
  Copy,
  Check,
  Wifi,
  WifiOff,
  ChevronLeft,
  Bell,
  BellOff,
  Sparkles,
} from 'lucide-react';
import { useSettingsStore } from '@/lib/store/settings';
import { useAuth } from '@/features/auth/components/auth-provider';
import { cn } from '@/lib/utils';

type ConversationSummary = {
  conversation_id: string;
  type: string;
  name: string;
  creator_id: string;
  last_message_id?: string | null;
  last_message_time?: string | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
};

type ConversationMessage = {
  message_id: string;
  conversation_id: string;
  seq: number;
  sender_id: string;
  message_type: string;
  content: string;
  source_type: string;
  source_ref_id?: string | null;
  created_at: string;
};

type ConversationMember = {
  conversation_id: string;
  user_id: string;
  joined_at: string;
  mute_flag: boolean;
  unread_count: number;
  last_read_message_id?: string | null;
  last_read_seq: number;
};

type AIChatSession = {
  session_id: string;
  user_id: string;
  title: string;
};

type AIChatMessage = {
  message_id: string;
};

type ChatMessage = {
  id: string;
  sender: string;
  role: 'assistant' | 'student' | 'peer';
  text: string;
  time: string;
  rawTime: string;
};

type ConversationsResponse = {
  success: boolean;
  conversations?: ConversationSummary[];
  error?: string;
};

type ConversationResponse = {
  success: boolean;
  conversation?: ConversationSummary;
  error?: string;
};

type MessagesResponse = {
  success: boolean;
  messages?: ConversationMessage[];
  error?: string;
};

type MessageResponse = {
  success: boolean;
  message?: ConversationMessage;
  error?: string;
};

type MembersResponse = {
  success: boolean;
  members?: ConversationMember[];
  error?: string;
};

type RemoveMemberResponse = {
  success: boolean;
  result?: {
    conversation_id: string;
    member_user_id: string;
    removed: boolean;
  };
  error?: string;
};

type DeleteConversationResponse = {
  success: boolean;
  result?: {
    conversation_id: string;
    deleted: boolean;
  };
  error?: string;
};

type AISessionsResponse = {
  success: boolean;
  sessions?: AIChatSession[];
  error?: string;
};

type AISessionResponse = {
  success: boolean;
  session?: AIChatSession;
  error?: string;
};

type AIMessageResponse = {
  success: boolean;
  message?: AIChatMessage;
  error?: string;
};

type SearchResponse = {
  success: boolean;
  answer?: string;
  sources?: Array<{ title: string; url: string }>;
  error?: string;
};

type WSConfigResponse = {
  success: boolean;
  wsBaseUrl?: string;
  error?: string;
};

const ASSISTANT_ID = 'system-assistant';

function formatTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return '昨天';
  }
  
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatFullTime(value: string) {
  return new Date(value).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mapBackendMessage(message: ConversationMessage, currentUserId: string): ChatMessage {
  const isUser = message.sender_id === currentUserId;
  const isAssistant = message.sender_id === ASSISTANT_ID;
  return {
    id: message.message_id,
    sender: isUser ? '你' : isAssistant ? '系统助手' : message.sender_id.slice(0, 8),
    role: isUser ? 'student' : isAssistant ? 'assistant' : 'peer',
    text: message.content,
    time: formatTime(message.created_at),
    rawTime: message.created_at,
  };
}

function parseMemberIds(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getInitials(name: string): string {
  if (!name) return '?';
  return name.slice(0, 2).toUpperCase();
}

function getAvatarColor(id: string, isGroup: boolean = false): string {
  // 使用项目统一的暖色调配色
  const colors = [
    'bg-[#96673a]',
    'bg-[#70624d]',
    'bg-[#c07f45]',
    'bg-[#8e8a7d]',
    'bg-[#4d6a5c]',
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export default function MessagesPage() {
  const { user, loading: authLoading } = useAuth();
  const currentUserId = user?.id || '';
  const userReady = Boolean(user && !authLoading);
  const [contacts, setContacts] = useState<ConversationSummary[]>([]);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({});
  const [memberMap, setMemberMap] = useState<Record<string, ConversationMember[]>>({});
  const [membersApiEnabled, setMembersApiEnabled] = useState(true);
  const [aiSessionByConversation, setAiSessionByConversation] = useState<Record<string, string>>({});
  const [wsBaseUrl, setWsBaseUrl] = useState('');
  const [wsConnected, setWsConnected] = useState(false);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [memberUpdating, setMemberUpdating] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [successText, setSuccessText] = useState('');

  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState('');
  const [addMembersInput, setAddMembersInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showMobileSidebar, setShowMobileSidebar] = useState(true);
  
  const [deletingConversation, setDeletingConversation] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const webSearchProviderId = useSettingsStore((s) => s.webSearchProviderId);
  const webSearchProvidersConfig = useSettingsStore((s) => s.webSearchProvidersConfig);

  const selectedContact = useMemo(() => {
    return contacts.find((contact) => contact.conversation_id === selectedContactId);
  }, [contacts, selectedContactId]);

  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return contacts;
    const query = searchQuery.toLowerCase();
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        (c.type === 'group' && '群聊'.includes(query))
    );
  }, [contacts, searchQuery]);

  const activeMessages = useMemo(() => {
    if (!selectedContactId) return [];
    return threads[selectedContactId] || [];
  }, [threads, selectedContactId]);

  const activeMembers = useMemo(() => {
    if (!selectedContactId) return [];
    return memberMap[selectedContactId] || [];
  }, [memberMap, selectedContactId]);

  const showSuccess = useCallback((message: string) => {
    setSuccessText(message);
    setTimeout(() => setSuccessText(''), 3000);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [activeMessages, scrollToBottom]);

  const fetchConversations = useCallback(
    async (preferredId?: string) => {
      const response = await fetch(
        `/api/messages/conversations?userId=${encodeURIComponent(currentUserId)}&limit=30`,
        {
          method: 'GET',
          cache: 'no-store',
        },
      );
      const payload = (await response.json()) as ConversationsResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '加载会话失败。');
      }

      let list = payload.conversations || [];
      if (list.length === 0) {
        const created = await fetch('/api/messages/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            type: 'single',
            name: '系统助手',
            creatorId: currentUserId,
            memberIds: [ASSISTANT_ID],
          }),
        });

        const createdPayload = (await created.json()) as ConversationResponse;
        if (!created.ok || !createdPayload.success || !createdPayload.conversation) {
          throw new Error(createdPayload.error || '创建默认会话失败。');
        }
        list = [createdPayload.conversation];
      }

      setContacts(list);
      const hasConversation = (id: string) => list.some((item) => item.conversation_id === id);
      const nextSelected =
        (preferredId && hasConversation(preferredId) ? preferredId : '') ||
        (selectedContactId && hasConversation(selectedContactId) ? selectedContactId : '') ||
        list[0]?.conversation_id ||
        '';
      if (nextSelected) {
        setSelectedContactId(nextSelected);
      }
    },
    [currentUserId, selectedContactId],
  );

  const loadConversationMessages = useCallback(
    async (conversationId: string) => {
      const response = await fetch(
        `/api/messages/${conversationId}/messages?userId=${encodeURIComponent(currentUserId)}&limit=200`,
        {
          method: 'GET',
          cache: 'no-store',
        },
      );
      const payload = (await response.json()) as MessagesResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '加载消息失败。');
      }

      const mapped = (payload.messages || []).map((item) => mapBackendMessage(item, currentUserId));
      setThreads((prev) => ({
        ...prev,
        [conversationId]: mapped,
      }));

      await fetch(`/api/messages/${conversationId}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      });
    },
    [currentUserId],
  );

  const loadConversationMembers = useCallback(
    async (conversationId: string) => {
      const response = await fetch(
        `/api/messages/${conversationId}/members?userId=${encodeURIComponent(currentUserId)}`,
        {
          method: 'GET',
          cache: 'no-store',
        },
      );
      if (response.status === 404) {
        setMembersApiEnabled(false);
        setMemberMap((prev) => ({
          ...prev,
          [conversationId]: [],
        }));
        return;
      }
      const payload = (await response.json()) as MembersResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '加载成员失败。');
      }

      setMemberMap((prev) => ({
        ...prev,
        [conversationId]: payload.members || [],
      }));
    },
    [currentUserId],
  );

  const handleDeleteConversation = async (conversationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const contact = contacts.find((c) => c.conversation_id === conversationId);
    if (!contact) return;
    
    const isCreator = contact.creator_id === currentUserId;
    if (!isCreator) {
      setErrorText('只有会话创建者才能删除会话');
      return;
    }

    if (!confirm(`确定要删除会话"${contact.name}"吗？此操作不可恢复。`)) {
      return;
    }

    setDeletingConversation(conversationId);
    try {
      const response = await fetch(`/api/messages/conversations/${encodeURIComponent(conversationId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operatorUserId: currentUserId }),
      });

      const payload = (await response.json()) as DeleteConversationResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '删除会话失败');
      }

      setContacts((prev) => prev.filter((c) => c.conversation_id !== conversationId));
      if (selectedContactId === conversationId) {
        const remaining = contacts.filter((c) => c.conversation_id !== conversationId);
        setSelectedContactId(remaining[0]?.conversation_id || '');
      }
      showSuccess('会话已删除');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '删除会话失败');
    } finally {
      setDeletingConversation(null);
    }
  };

  const handleCopyMessage = async (text: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch {
      setErrorText('复制失败');
    }
  };

  const ensureAiSession = async (conversationId: string, conversationName?: string) => {
    const cached = aiSessionByConversation[conversationId];
    if (cached) return cached;

    const listResponse = await fetch(
      `/api/ai/sessions?userId=${encodeURIComponent(currentUserId)}&conversationId=${encodeURIComponent(conversationId)}&limit=1`,
      {
        method: 'GET',
        cache: 'no-store',
      },
    );
    const listPayload = (await listResponse.json()) as AISessionsResponse;
    if (!listResponse.ok || !listPayload.success) {
      throw new Error(listPayload.error || '查询 AI 会话失败。');
    }

    const existing = listPayload.sessions?.[0];
    if (existing) {
      setAiSessionByConversation((prev) => ({ ...prev, [conversationId]: existing.session_id }));
      return existing.session_id;
    }

    const created = await fetch('/api/ai/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUserId,
        title: `${conversationName || '系统助手'}会话`,
        source: '课后答疑',
        linkedConversationId: conversationId,
      }),
    });
    const createdPayload = (await created.json()) as AISessionResponse;
    if (!created.ok || !createdPayload.success || !createdPayload.session) {
      throw new Error(createdPayload.error || '创建 AI 会话失败。');
    }

    setAiSessionByConversation((prev) => ({ ...prev, [conversationId]: createdPayload.session!.session_id }));
    return createdPayload.session.session_id;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/messages/ws-config', { method: 'GET', cache: 'no-store' });
        const payload = (await response.json()) as WSConfigResponse;
        if (!response.ok || !payload.success || !payload.wsBaseUrl) {
          throw new Error(payload.error || '获取 WebSocket 地址失败');
        }
        if (!cancelled) {
          setWsBaseUrl(payload.wsBaseUrl);
        }
      } catch {
        if (!cancelled) {
          setWsBaseUrl('');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!userReady) return;

    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        await fetchConversations();
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : '加载消息页面失败。');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchConversations, userReady]);

  useEffect(() => {
    if (!selectedContactId) return;

    let cancelled = false;
    (async () => {
      try {
        const tasks: Array<Promise<void>> = [loadConversationMessages(selectedContactId)];
        if (membersApiEnabled) {
          tasks.push(loadConversationMembers(selectedContactId));
        }
        await Promise.all(tasks);
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : '加载会话数据失败。');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadConversationMembers, loadConversationMessages, membersApiEnabled, selectedContactId]);

  useEffect(() => {
    if (!selectedContactId || !currentUserId || !wsBaseUrl || !userReady) {
      setWsConnected(false);
      return;
    }
    setWsConnected(false);
    let active = true;
    const wsQuery = new URLSearchParams({ user_id: currentUserId });

    const ws = new WebSocket(`${wsBaseUrl}/ws/messages/${selectedContactId}?${wsQuery.toString()}`);

    ws.onopen = () => {
      if (!active) {
        ws.close();
        return;
      }
      setWsConnected(true);
    };

    ws.onclose = () => {
      if (!active) return;
      setWsConnected(false);
    };

    ws.onerror = () => {
      if (!active) return;
      setWsConnected(false);
    };

    ws.onmessage = (event) => {
      if (!active) return;
      try {
        const payload = JSON.parse(event.data) as {
          type?: string;
          message?: ConversationMessage;
          members?: ConversationMember[];
        };

        if (payload.type === 'message_created' && payload.message) {
          const mapped = mapBackendMessage(payload.message, currentUserId);
          setThreads((prev) => {
            const existing = prev[selectedContactId] || [];
            if (existing.some((item) => item.id === mapped.id)) {
              return prev;
            }
            return {
              ...prev,
              [selectedContactId]: [...existing, mapped],
            };
          });
          void fetchConversations(selectedContactId);
          return;
        }

        if (payload.type === 'members_updated' && Array.isArray(payload.members)) {
          setMemberMap((prev) => ({
            ...prev,
            [selectedContactId]: payload.members || [],
          }));
        }
      } catch {
        // Ignore malformed events.
      }
    };

    return () => {
      active = false;
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [currentUserId, fetchConversations, selectedContactId, userReady, wsBaseUrl]);

  const handleCreateGroupConversation = async () => {
    const name = newGroupName.trim();
    if (!name) {
      setErrorText('请先输入群聊名称。');
      return;
    }

    const memberIds = parseMemberIds(newGroupMembers).filter((id) => id !== currentUserId);

    try {
      const response = await fetch('/api/messages/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          type: 'group',
          name,
          creatorId: currentUserId,
          memberIds,
        }),
      });

      const payload = (await response.json()) as ConversationResponse;
      if (!response.ok || !payload.success || !payload.conversation) {
        throw new Error(payload.error || '创建群聊失败。');
      }

      setShowCreateGroup(false);
      setNewGroupName('');
      setNewGroupMembers('');
      await fetchConversations(payload.conversation.conversation_id);
      await loadConversationMembers(payload.conversation.conversation_id);
      showSuccess('群聊创建成功');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '创建群聊失败。');
    }
  };

  const handleAddMembers = async () => {
    if (!membersApiEnabled) {
      setErrorText('当前环境未启用成员管理接口。');
      return;
    }
    if (!selectedContactId) return;

    const memberIds = parseMemberIds(addMembersInput).filter((id) => id !== currentUserId);
    if (memberIds.length === 0) {
      setErrorText('请输入要添加的成员 userId。');
      return;
    }

    setMemberUpdating(true);
    try {
      const response = await fetch(`/api/messages/${selectedContactId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operatorUserId: currentUserId,
          memberIds,
        }),
      });

      const payload = (await response.json()) as MembersResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '添加成员失败。');
      }

      setMemberMap((prev) => ({
        ...prev,
        [selectedContactId]: payload.members || [],
      }));
      setAddMembersInput('');
      showSuccess('成员添加成功');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '添加成员失败。');
    } finally {
      setMemberUpdating(false);
    }
  };

  const handleRemoveMember = async (memberUserId: string) => {
    if (!membersApiEnabled) {
      setErrorText('当前环境未启用成员管理接口。');
      return;
    }
    if (!selectedContactId || !memberUserId || memberUserId === currentUserId) return;

    setMemberUpdating(true);
    try {
      const response = await fetch(
        `/api/messages/${selectedContactId}/members/${encodeURIComponent(memberUserId)}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operatorUserId: currentUserId }),
        },
      );

      const payload = (await response.json()) as RemoveMemberResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '移除成员失败。');
      }

      await loadConversationMembers(selectedContactId);
      showSuccess('成员已移除');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '移除成员失败。');
    } finally {
      setMemberUpdating(false);
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || !selectedContactId) return;

    const conversationId = selectedContactId;
    const conversationName = selectedContact?.name || '系统助手';

    setInput('');
    setSending(true);
    setErrorText('');

    try {
      const userMessageResponse = await fetch(`/api/messages/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: currentUserId,
          content: text,
          messageType: 'text',
          sourceType: 'manual',
        }),
      });
      const userMessagePayload = (await userMessageResponse.json()) as MessageResponse;
      if (!userMessageResponse.ok || !userMessagePayload.success) {
        throw new Error(userMessagePayload.error || '发送用户消息失败。');
      }

      if (selectedContact?.type === 'single') {
        const aiSessionId = await ensureAiSession(conversationId, conversationName);

        const aiUserResponse = await fetch(`/api/ai/sessions/${aiSessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'user',
            content: text,
            userId: currentUserId,
            contentType: 'text',
            requestId: `msg-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          }),
        });
        const aiUserPayload = (await aiUserResponse.json()) as AIMessageResponse;
        if (!aiUserResponse.ok || !aiUserPayload.success) {
          throw new Error(aiUserPayload.error || '写入 AI 用户消息失败。');
        }

        const searchResponse = await fetch('/api/web-search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: text,
            apiKey: webSearchProvidersConfig?.[webSearchProviderId]?.apiKey || undefined,
            baseUrl: webSearchProvidersConfig?.[webSearchProviderId]?.baseUrl || undefined,
          }),
        });

        const searchPayload = (await searchResponse.json()) as SearchResponse;
        if (!searchResponse.ok || !searchPayload.success) {
          throw new Error(searchPayload.error || '后端检索失败。');
        }

        const sourceHint = searchPayload.sources?.[0]?.title
          ? `\n\n参考来源：${searchPayload.sources[0].title}`
          : '';
        const assistantText = `${searchPayload.answer || '已完成查询，但未返回答案。'}${sourceHint}`;

        const aiAssistantResponse = await fetch(`/api/ai/sessions/${aiSessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'assistant',
            content: assistantText,
            userId: currentUserId,
            contentType: 'text',
            modelName: 'web-search-proxy',
            requestId: `msg-assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          }),
        });
        const aiAssistantPayload = (await aiAssistantResponse.json()) as AIMessageResponse;
        if (!aiAssistantResponse.ok || !aiAssistantPayload.success || !aiAssistantPayload.message) {
          throw new Error(aiAssistantPayload.error || '写入 AI 助手消息失败。');
        }

        const assistantMessageResponse = await fetch(`/api/messages/${conversationId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            senderId: ASSISTANT_ID,
            content: assistantText,
            messageType: 'text',
            sourceType: 'ai',
            sourceRefId: aiAssistantPayload.message.message_id,
          }),
        });
        const assistantMessagePayload = (await assistantMessageResponse.json()) as MessageResponse;
        if (!assistantMessageResponse.ok || !assistantMessagePayload.success) {
          throw new Error(assistantMessagePayload.error || '写入会话助手消息失败。');
        }

        void fetch(`/api/ai/sessions/${aiSessionId}/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUserId,
            latestUserMessageId: aiUserPayload.message?.message_id,
          }),
        });
      }

      await Promise.all([loadConversationMessages(conversationId), fetchConversations(conversationId)]);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '消息发送失败。');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 left-64 flex items-center justify-center bg-[#faf9f7] dark:bg-[#171411]">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <Loader2 className="h-10 w-10 animate-spin text-[#96673a]" />
          </div>
          <p className="text-sm text-[#75695d]">正在加载消息...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 left-64 flex bg-[#faf9f7] dark:bg-[#171411] overflow-hidden z-20">
        {/* Sidebar */}
        <aside className="bg-[#f5f4f2] dark:bg-[#1c1814] border-r border-gray-200/60 dark:border-gray-800/60 flex flex-col h-full overflow-hidden w-60 shrink-0">
          {/* Header */}
          <div className="p-4 border-b border-gray-200/60 dark:border-gray-800/60">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                  <MessageSquare className="h-4 w-4 text-white" />
                </div>
                <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">消息中心</h2>
              </div>
              <button
                className="p-2 hover:bg-white dark:hover:bg-[#201c18] rounded-xl transition-colors group"
                type="button"
                aria-label="新建群聊"
                title="新建群聊"
                onClick={() => setShowCreateGroup((prev) => !prev)}
              >
                <Edit className="h-4 w-4 text-gray-500 group-hover:text-gray-700 dark:group-hover:text-gray-200" />
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索会话..."
                className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-[#201c18] border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-gray-200/50 transition-all text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
              />
            </div>

            {/* Create Group Form */}
            {showCreateGroup && (
              <div className="mt-3 p-3 bg-white dark:bg-[#201c18] rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-2 animate-in slide-in-from-top-2">
                <input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="群聊名称"
                  className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-[#171411] border border-gray-200 dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-gray-200/50 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
                />
                <input
                  value={newGroupMembers}
                  onChange={(e) => setNewGroupMembers(e.target.value)}
                  placeholder="成员 userId，逗号分隔"
                  className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-[#171411] border border-gray-200 dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-gray-200/50 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateGroup(false)}
                    className="flex-1 py-2 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-[#2a241f] rounded-lg transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCreateGroupConversation()}
                    className="flex-1 py-2 text-sm bg-[#2d2d2d] dark:bg-[#f1dfc5] text-white dark:text-[#1a1612] rounded-lg hover:bg-black dark:hover:bg-[#e8d5b8] transition-colors"
                  >
                    创建
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Contact List */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-2">
            {filteredContacts.length === 0 ? (
              <div className="p-8 text-center">
                <div className="h-16 w-16 mx-auto mb-4 rounded-full bg-gray-100 dark:bg-[#201c18] flex items-center justify-center">
                  <MessageSquare className="h-8 w-8 text-gray-400" />
                </div>
                <p className="text-sm text-gray-400">
                  {searchQuery ? '未找到匹配的会话' : '暂无会话'}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {filteredContacts.map((contact) => {
                  const isSelected = selectedContactId === contact.conversation_id;
                  const isCreator = contact.creator_id === currentUserId;
                  const avatarColor = getAvatarColor(contact.conversation_id, contact.type === 'group');

                  return (
                    <div
                      key={contact.conversation_id}
                      onClick={() => {
                        setSelectedContactId(contact.conversation_id);
                        setShowMobileSidebar(false);
                      }}
                      className={cn(
                        'w-full text-left p-3 flex items-center gap-3 rounded-xl transition-all group relative cursor-pointer',
                        isSelected
                          ? 'bg-white dark:bg-[#201c18] shadow-sm border border-gray-200/80 dark:border-gray-800/80'
                          : 'hover:bg-white/60 dark:hover:bg-white/5'
                      )}
                    >
                      {/* Avatar */}
                      <div
                        className={cn(
                          'h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0',
                          avatarColor
                        )}
                      >
                        {contact.type === 'group' ? (
                          <Users className="h-5 w-5" />
                        ) : (
                          getInitials(contact.name)
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                            {contact.name}
                          </h3>
                          {contact.last_message_time && (
                            <span className="text-[10px] text-gray-400">
                              {formatTime(contact.last_message_time)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-xs text-gray-400 truncate">
                            {contact.type === 'group' ? '群聊' : '单聊'}
                            {contact.unread_count > 0 && (
                              <span className="ml-1 text-orange-600 font-medium">
                                · {contact.unread_count} 条未读
                              </span>
                            )}
                          </p>
                          {contact.unread_count > 0 && (
                            <span className="h-5 min-w-[20px] px-1.5 bg-orange-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                              {contact.unread_count}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Delete Button (visible on hover) */}
                      {isCreator && (
                        <button
                          onClick={(e) => handleDeleteConversation(contact.conversation_id, e)}
                          disabled={deletingConversation === contact.conversation_id}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                          title="删除会话"
                        >
                          {deletingConversation === contact.conversation_id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-red-500" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* Main Chat Area */}
        <section className="flex-1 flex flex-col min-w-0 bg-[#faf9f7] dark:bg-[#171411] h-full overflow-hidden">
          {selectedContact ? (
            <>
              {/* Chat Header */}
              <div className="h-14 flex items-center justify-between px-6 shrink-0 border-b border-gray-200/60 dark:border-gray-800/60 bg-[#faf9f7] dark:bg-[#171411]">
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div
                    className={cn(
                      'h-8 w-8 rounded-xl flex items-center justify-center text-white',
                      getAvatarColor(selectedContact.conversation_id, selectedContact.type === 'group')
                    )}
                  >
                    {selectedContact.type === 'group' ? (
                      <Users className="h-4 w-4" />
                    ) : (
                      getInitials(selectedContact.name)
                    )}
                  </div>

                  {/* Title */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                      {selectedContact.name}
                    </h3>
                    <div className="flex items-center gap-1.5">
                      {wsConnected ? (
                        <>
                          <Wifi className="h-3 w-3 text-green-500" />
                          <span className="text-[11px] text-green-500">在线</span>
                        </>
                      ) : (
                        <>
                          <WifiOff className="h-3 w-3 text-gray-400" />
                          <span className="text-[11px] text-gray-400">离线</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Header Actions */}
                <div className="flex items-center gap-1">
                  {selectedContact.type === 'group' && (
                    <button
                      className="p-2 hover:bg-gray-100 dark:hover:bg-[#201c18] rounded-lg transition-colors"
                      title="群成员"
                    >
                      <Users className="h-4 w-4 text-gray-500" />
                    </button>
                  )}
                </div>
              </div>

              {/* Members Bar (for group) */}
              {selectedContact.type === 'group' && membersApiEnabled && (
                <div className="px-4 py-2 bg-[#f5f4f2] dark:bg-[#1c1814] border-b border-gray-200/60 dark:border-gray-800/60">
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {activeMembers.map((member) => (
                      <span
                        key={member.user_id}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-white dark:bg-[#201c18] border border-gray-200 dark:border-gray-700 rounded-lg text-gray-500"
                      >
                        <span className="truncate max-w-[80px]">{member.user_id.slice(0, 8)}</span>
                        {member.user_id !== currentUserId && (
                          <button
                            type="button"
                            onClick={() => void handleRemoveMember(member.user_id)}
                            className="text-gray-400 hover:text-red-500 transition-colors"
                            disabled={memberUpdating}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={addMembersInput}
                      onChange={(e) => setAddMembersInput(e.target.value)}
                      placeholder="添加成员 userId"
                      className="flex-1 px-3 py-1.5 text-xs bg-white dark:bg-[#201c18] border border-gray-200 dark:border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-gray-200/50 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
                    />
                    <button
                      type="button"
                      onClick={() => void handleAddMembers()}
                      disabled={memberUpdating}
                      className="px-3 py-1.5 bg-[#2d2d2d] dark:bg-[#f1dfc5] text-white dark:text-[#1a1612] text-xs rounded-lg hover:bg-black dark:hover:bg-[#e8d5b8] disabled:opacity-50 transition-colors flex items-center gap-1"
                    >
                      <UserPlus className="h-3 w-3" />
                      添加
                    </button>
                  </div>
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 p-4 space-y-4">
                {activeMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white mb-4 shadow-xl shadow-indigo-500/20">
                      <Sparkles className="w-8 h-8" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                      开始新的对话
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
                      发送消息开始与 {selectedContact.name} 的对话
                    </p>
                  </div>
                ) : (
                  activeMessages.map((msg, index) => {
                    const showAvatar =
                      index === 0 ||
                      activeMessages[index - 1].role !== msg.role;
                    const isUser = msg.role === 'student';

                    return (
                      <div
                        key={msg.id}
                        className={cn(
                          'flex gap-3 group',
                          isUser ? 'flex-row-reverse' : 'flex-row'
                        )}
                        onMouseEnter={() => setHoveredMessageId(msg.id)}
                        onMouseLeave={() => setHoveredMessageId(null)}
                      >
                        {/* Avatar */}
                        {showAvatar ? (
                          <div
                            className={cn(
                              'h-8 w-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0',
                              msg.role === 'assistant'
                                ? 'bg-[#4d6a5c]'
                                : msg.role === 'student'
                                ? 'bg-[#96673a]'
                                : 'bg-[#70624d]'
                            )}
                          >
                            {msg.role === 'assistant' ? (
                              <Sparkles className="h-4 w-4" />
                            ) : (
                              getInitials(msg.sender)
                            )}
                          </div>
                        ) : (
                          <div className="w-8 shrink-0" />
                        )}

                        {/* Message Content */}
                        <div
                          className={cn(
                            'flex flex-col max-w-[75%]',
                            isUser ? 'items-end' : 'items-start'
                          )}
                        >
                          {/* Sender & Time */}
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[11px] font-medium text-gray-500">
                              {msg.sender}
                            </span>
                            <span
                              className="text-[10px] text-gray-400"
                              title={formatFullTime(msg.rawTime)}
                            >
                              {msg.time}
                            </span>
                          </div>

                          {/* Message Bubble */}
                          <div
                            className={cn(
                              'relative px-4 py-2.5 rounded-2xl text-sm leading-relaxed',
                              isUser
                                ? 'bg-[#2d2d2d] dark:bg-[#f1dfc5] text-white dark:text-[#1a1612] rounded-br-sm'
                                : msg.role === 'assistant'
                                ? 'bg-white dark:bg-[#201c18] text-gray-800 dark:text-gray-100 rounded-bl-sm border border-gray-100 dark:border-gray-800 shadow-sm'
                                : 'bg-white dark:bg-[#201c18] text-gray-800 dark:text-gray-100 rounded-bl-sm border border-gray-100 dark:border-gray-800 shadow-sm'
                            )}
                          >
                            <div className="whitespace-pre-wrap">{msg.text}</div>

                            {/* Message Actions */}
                            {hoveredMessageId === msg.id && (
                              <div
                                className={cn(
                                  'absolute top-1/2 -translate-y-1/2 flex items-center gap-1',
                                  isUser ? 'left-0 -translate-x-full pr-2' : 'right-0 translate-x-full pl-2'
                                )}
                              >
                                <button
                                  onClick={() => handleCopyMessage(msg.text, msg.id)}
                                  className="p-1.5 bg-white dark:bg-[#201c18] border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-[#2a241f] transition-colors"
                                  title="复制"
                                >
                                  {copiedMessageId === msg.id ? (
                                    <Check className="h-3.5 w-3.5 text-green-500" />
                                  ) : (
                                    <Copy className="h-3.5 w-3.5 text-gray-500" />
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div className="px-4 pb-3 pt-2 shrink-0 border-t border-gray-200/60 dark:border-gray-800/60 bg-[#faf9f7] dark:bg-[#171411]">
                {/* Notifications */}
                {errorText && (
                  <div className="mb-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-lg text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    {errorText}
                  </div>
                )}
                {successText && (
                  <div className="mb-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 rounded-lg text-xs text-green-600 dark:text-green-400 flex items-center gap-2">
                    <Check className="h-3.5 w-3.5" />
                    {successText}
                  </div>
                )}

                {/* Input */}
                <div className="flex items-end gap-2">
                  <div className="flex-1 relative">
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          void handleSend();
                        }
                      }}
                      placeholder={
                        selectedContact.type === 'group'
                          ? '输入群消息...'
                          : '输入问题，AI 助手将为你解答...'
                      }
                      rows={1}
                      className="w-full resize-none max-h-32 bg-white dark:bg-[#201c18] border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 pr-12 text-sm outline-none focus:ring-2 focus:ring-gray-200/50 transition-all text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
                      style={{ minHeight: '48px' }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={sending || !input.trim()}
                    className="h-10 w-10 bg-[#2d2d2d] dark:bg-[#f1dfc5] hover:bg-black dark:hover:bg-[#e8d5b8] disabled:opacity-30 text-white dark:text-[#1a1612] rounded-full flex items-center justify-center transition-all shadow-lg hover:shadow-xl hover:scale-105 disabled:hover:scale-100"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Empty State */
            <div className="h-full flex flex-col items-center justify-center px-6 py-12">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white mb-4 shadow-xl shadow-indigo-500/20">
                  <MessageSquare className="w-8 h-8" />
                </div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                  选择一个会话开始聊天
                </h1>
                <p className="text-gray-500 dark:text-gray-400">
                  从左侧列表选择一个会话，或创建新的群聊开始交流
                </p>
              </div>
            </div>
          )}
        </section>
    </div>
  );
}
