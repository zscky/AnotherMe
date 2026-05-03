'use client';

import { useState } from 'react';
import { Check, Library, Loader2, MessageSquare, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface LiveBookSourceSnapshot {
  kind: 'note' | 'chat' | 'question' | 'kb' | 'manual';
  id: string;
  title?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface LiveBookSourceInput {
  kind: 'kb' | 'notes' | 'chat' | 'question' | 'manual';
  text: string;
  weight?: number;
  snapshots?: LiveBookSourceSnapshot[];
  kbIds?: string[];
  notebookRefs?: string[];
  chatSelections?: Array<{ chatId: string; messageIds: string[] }>;
  questionRefs?: string[];
}

interface NotebookOption {
  id: string;
  title: string;
  content: string;
  subject: string;
  tags: string[];
  source?: 'classroom-book' | 'local-notebook';
  bookId?: string;
  bookTitle?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

interface ChatSessionOption {
  session_id: string;
  title: string;
  source?: string;
  subject?: string | null;
  updated_at?: string;
}

interface ChatMessageOption {
  message_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at?: string;
}

interface KbSourceOption {
  id: string;
  title: string;
  source: string;
  kbId?: string;
  kbName?: string;
  chunkCount: number;
}

const sourceKindLabels: Record<LiveBookSourceInput['kind'], string> = {
  kb: '知识库',
  notes: '笔记',
  chat: '对话',
  question: '题目',
  manual: '手动',
};

async function parseApi<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { success?: boolean; error?: string } & T;
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || '请求失败');
  }
  return payload;
}

function splitQuestionText(text: string): string[] {
  return text
    .split(/\n\s*(?=(?:Q?\d+[\.\、\)]|题目\s*\d+[:：]))/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function LiveBookSourcePicker({
  items,
  onItemsChange,
}: {
  items: LiveBookSourceInput[];
  onItemsChange: (items: LiveBookSourceInput[]) => void;
}) {
  const [sourceKind, setSourceKind] = useState<LiveBookSourceInput['kind']>('notes');
  const [sourceText, setSourceText] = useState('');
  const [sourceWeight, setSourceWeight] = useState('1');
  const [selectedNotebooks, setSelectedNotebooks] = useState<NotebookOption[]>([]);
  const [showNotebookSelector, setShowNotebookSelector] = useState(false);
  const [availableNotebooks, setAvailableNotebooks] = useState<NotebookOption[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSessionOption[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessageOption[]>([]);
  const [selectedChatId, setSelectedChatId] = useState('');
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [kbIdText, setKbIdText] = useState('');
  const [kbSources, setKbSources] = useState<KbSourceOption[]>([]);
  const [selectedKbIds, setSelectedKbIds] = useState<string[]>([]);
  const [optionsError, setOptionsError] = useState('');

  async function loadAvailableNotebooks() {
    setLoadingOptions(true);
    setOptionsError('');
    try {
      const [{ readNotebookNotes }, payload] = await Promise.all([
        import('@/lib/notebook/storage'),
        parseApi<{ notes: NotebookOption[] }>(
          await fetch('/api/live-book/source-options?kind=notes', { cache: 'no-store' }),
        ).catch(() => ({ notes: [] })),
      ]);
      const localNotes = readNotebookNotes().map((note) => ({
        id: `local:${note.id}`,
        title: note.title,
        content: note.content,
        subject: note.subject || '',
        tags: note.tags || [],
        source: 'local-notebook' as const,
        metadata: { originalId: note.id, source: 'local-notebook' },
      }));
      const seen = new Set<string>();
      const merged = [...(payload.notes || []), ...localNotes].filter((note) => {
        if (!note.content?.trim()) return false;
        if (seen.has(note.id)) return false;
        seen.add(note.id);
        return true;
      });
      setAvailableNotebooks(merged);
    } catch (error) {
      setOptionsError(error instanceof Error ? error.message : '笔记加载失败');
      setAvailableNotebooks([]);
    } finally {
      setLoadingOptions(false);
    }
  }

  async function loadChatSessions() {
    setLoadingOptions(true);
    setOptionsError('');
    try {
      const payload = await parseApi<{ sessions: ChatSessionOption[] }>(
        await fetch('/api/live-book/source-options?kind=chat', { cache: 'no-store' }),
      );
      setChatSessions(payload.sessions || []);
    } catch (error) {
      setOptionsError(error instanceof Error ? error.message : '对话加载失败');
      setChatSessions([]);
    } finally {
      setLoadingOptions(false);
    }
  }

  async function loadChatMessages(sessionId: string) {
    setSelectedChatId(sessionId);
    setSelectedMessageIds([]);
    setChatMessages([]);
    if (!sessionId) return;
    setLoadingOptions(true);
    setOptionsError('');
    try {
      const payload = await parseApi<{ messages: ChatMessageOption[] }>(
        await fetch(`/api/live-book/source-options?kind=chatMessages&sessionId=${encodeURIComponent(sessionId)}`, {
          cache: 'no-store',
        }),
      );
      setChatMessages(payload.messages || []);
    } catch (error) {
      setOptionsError(error instanceof Error ? error.message : '消息加载失败');
      setChatMessages([]);
    } finally {
      setLoadingOptions(false);
    }
  }

  async function loadKbSources() {
    setLoadingOptions(true);
    setOptionsError('');
    try {
      const payload = await parseApi<{ sources: KbSourceOption[]; unavailableReason?: string }>(
        await fetch('/api/live-book/source-options?kind=kb', { cache: 'no-store' }),
      );
      setKbSources(payload.sources || []);
      if (payload.unavailableReason) setOptionsError(payload.unavailableReason);
    } catch (error) {
      setOptionsError(error instanceof Error ? error.message : '知识库来源加载失败');
      setKbSources([]);
    } finally {
      setLoadingOptions(false);
    }
  }

  function resetDraft() {
    setSourceText('');
    setSourceWeight('1');
    setSourceKind('notes');
    setSelectedNotebooks([]);
    setShowNotebookSelector(false);
    setSelectedChatId('');
    setSelectedMessageIds([]);
    setChatMessages([]);
    setKbIdText('');
    setSelectedKbIds([]);
    setOptionsError('');
  }

  function addSourceItem() {
    const text = sourceText.trim();
    const parsedWeight = Number(sourceWeight);
    const baseWeight = Number.isFinite(parsedWeight) && parsedWeight > 0 && parsedWeight !== 1
      ? { weight: parsedWeight }
      : {};
    let nextItem: LiveBookSourceInput | null = null;

    if (sourceKind === 'notes' && selectedNotebooks.length > 0) {
      nextItem = {
        kind: 'notes',
        text: `笔记：${selectedNotebooks.map((note) => note.title).join(', ')}`,
        notebookRefs: selectedNotebooks.map((note) => note.id),
        snapshots: selectedNotebooks.map((note) => ({
          kind: 'note',
          id: note.id,
          title: note.title,
          content: note.content,
          metadata: {
            subject: note.subject,
            tags: note.tags,
            source: note.source,
            bookId: note.bookId,
            bookTitle: note.bookTitle,
            ...(note.metadata || {}),
          },
        })),
        ...baseWeight,
      };
    } else if (sourceKind === 'chat' && selectedChatId && selectedMessageIds.length > 0) {
      const selectedMessages = chatMessages.filter((message) => selectedMessageIds.includes(message.message_id));
      const sessionTitle = chatSessions.find((session) => session.session_id === selectedChatId)?.title || selectedChatId;
      nextItem = {
        kind: 'chat',
        text: text || `对话：${sessionTitle}（${selectedMessages.length} 条消息）`,
        chatSelections: [{ chatId: selectedChatId, messageIds: selectedMessageIds }],
        snapshots: selectedMessages.map((message) => ({
          kind: 'chat',
          id: message.message_id,
          title: `${sessionTitle} / ${message.role}`,
          content: message.content,
          metadata: { sessionId: selectedChatId, role: message.role, createdAt: message.created_at },
        })),
        ...baseWeight,
      };
    } else if (sourceKind === 'question' && text) {
      const questions = splitQuestionText(text);
      const stamp = Date.now();
      const questionIds = questions.map((_, index) => `inline-${stamp}-${index + 1}`);
      nextItem = {
        kind: 'question',
        text: `题目：${questions.length} 条`,
        questionRefs: questionIds,
        snapshots: questions.map((question, index) => ({
          kind: 'question',
          id: questionIds[index],
          title: `题目 ${index + 1}`,
          content: question,
          metadata: { source: 'inline' },
        })),
        ...baseWeight,
      };
    } else if (sourceKind === 'kb' && (selectedKbIds.length > 0 || kbIdText.trim() || text)) {
      const typedKbIds = kbIdText
        .split(/[,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
      const kbIds = Array.from(new Set([...selectedKbIds, ...typedKbIds]));
      nextItem = {
        kind: 'kb',
        text: text || `知识库：${kbIds.join(', ')}`,
        ...(kbIds.length > 0 ? { kbIds } : {}),
        ...(text
          ? {
              snapshots: [{
                kind: 'kb',
                id: kbIds[0] || `manual-kb-${Date.now()}`,
                title: kbSources.find((source) => kbIds.includes(source.id))?.title || kbIds[0] || '手动知识库材料',
                content: text,
                metadata: { kbIds, selectedSources: kbSources.filter((source) => kbIds.includes(source.id)) },
              }],
            }
          : {}),
        ...baseWeight,
      };
    } else if (sourceKind === 'manual' && text) {
      nextItem = {
        kind: 'manual',
        text,
        snapshots: [{ kind: 'manual', id: `manual-${Date.now()}`, content: text }],
        ...baseWeight,
      };
    } else if (text) {
      nextItem = { kind: sourceKind, text, ...baseWeight };
    }

    if (!nextItem) return;
    onItemsChange([...items, nextItem].slice(0, 12));
    resetDraft();
  }

  function removeSourceItem(index: number) {
    onItemsChange(items.filter((_, itemIndex) => itemIndex !== index));
  }

  function toggleNotebookSelection(notebook: NotebookOption) {
    setSelectedNotebooks((prev) => (
      prev.some((note) => note.id === notebook.id)
        ? prev.filter((note) => note.id !== notebook.id)
        : [...prev, notebook]
    ));
  }

  function toggleMessageSelection(messageId: string) {
    setSelectedMessageIds((prev) => (
      prev.includes(messageId) ? prev.filter((id) => id !== messageId) : [...prev, messageId]
    ));
  }

  function toggleKbSelection(sourceId: string) {
    setSelectedKbIds((prev) => (
      prev.includes(sourceId) ? prev.filter((id) => id !== sourceId) : [...prev, sourceId]
    ));
  }

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-gray-700">结构化来源</p>
          <p className="text-[11px] text-gray-400">选择来源类型并逐条添加</p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-medium text-gray-500 border border-gray-200">
          {items.length}/12
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <div className="grid grid-cols-3 gap-2">
          <select
            aria-label="来源类型"
            value={sourceKind}
            onChange={(event) => {
              setSourceKind(event.target.value as LiveBookSourceInput['kind']);
              setSourceText('');
              setSelectedNotebooks([]);
              setShowNotebookSelector(false);
              setSelectedChatId('');
              setSelectedMessageIds([]);
              setChatMessages([]);
              setKbIdText('');
              setSelectedKbIds([]);
              if (event.target.value === 'chat' && chatSessions.length === 0) void loadChatSessions();
              if (event.target.value === 'kb' && kbSources.length === 0) void loadKbSources();
            }}
            className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-900 outline-none transition-all focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
          >
            <option value="notes">笔记</option>
            <option value="chat">对话</option>
            <option value="question">题目</option>
            <option value="kb">知识库</option>
            <option value="manual">手动</option>
          </select>
          <input
            value={sourceWeight}
            onChange={(event) => setSourceWeight(event.target.value)}
            placeholder="权重"
            inputMode="decimal"
            className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-900 outline-none transition-all focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
          />
          <Button type="button" onClick={addSourceItem} variant="outline" className="h-9 border-gray-200 text-gray-600 hover:bg-gray-50">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            添加
          </Button>
        </div>

        {sourceKind === 'notes' && (
          <div className="space-y-2">
            <Button
              type="button"
              onClick={() => {
                if (!showNotebookSelector) void loadAvailableNotebooks();
                setShowNotebookSelector(!showNotebookSelector);
              }}
              variant="outline"
              className="w-full h-9 border-gray-200 text-xs text-gray-700 hover:bg-gray-50 justify-start"
            >
              <Library className="h-3.5 w-3.5 mr-1.5" />
              {selectedNotebooks.length > 0 ? `已选择 ${selectedNotebooks.length} 条笔记` : '选择笔记'}
            </Button>
            {loadingOptions && <p className="flex items-center gap-1 text-[11px] text-gray-400"><Loader2 className="h-3 w-3 animate-spin" /> 加载来源</p>}
            {optionsError && sourceKind === 'notes' && <p className="text-[11px] text-amber-600">{optionsError}</p>}
            {showNotebookSelector && (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                {availableNotebooks.length === 0 ? (
                  <p className="p-3 text-xs text-gray-400 text-center">暂无可选笔记；生成课堂、拍题或对话沉淀后会出现在这里</p>
                ) : (
                  availableNotebooks.map((notebook) => {
                    const isSelected = selectedNotebooks.some((note) => note.id === notebook.id);
                    return (
                      <button
                        key={notebook.id}
                        type="button"
                        onClick={() => toggleNotebookSelection(notebook)}
                        className="w-full flex items-start gap-2 px-3 py-2 text-xs text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                      >
                        <div className={`mt-0.5 w-4 h-4 rounded border flex shrink-0 items-center justify-center ${isSelected ? 'bg-gray-900 border-gray-900' : 'border-gray-300'}`}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <span className="truncate font-medium text-gray-700">{notebook.title}</span>
                            <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] text-gray-500">
                              {notebook.source === 'classroom-book' ? '已生成' : '本地'}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-gray-400">{notebook.content}</p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}

        {sourceKind === 'chat' && (
          <div className="space-y-2">
            <select
              value={selectedChatId}
              onFocus={() => { if (chatSessions.length === 0) void loadChatSessions(); }}
              onChange={(event) => void loadChatMessages(event.target.value)}
              className="h-9 w-full rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-900 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
            >
              <option value="">选择对话</option>
              {chatSessions.map((session) => (
                <option key={session.session_id} value={session.session_id}>{session.title}</option>
              ))}
            </select>
            {loadingOptions && <p className="flex items-center gap-1 text-[11px] text-gray-400"><Loader2 className="h-3 w-3 animate-spin" /> 加载中</p>}
            {chatMessages.length > 0 && (
              <div className="max-h-44 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                {chatMessages.map((message) => {
                  const selected = selectedMessageIds.includes(message.message_id);
                  return (
                    <button
                      key={message.message_id}
                      type="button"
                      onClick={() => toggleMessageSelection(message.message_id)}
                      className="flex w-full items-start gap-2 border-b border-gray-100 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-gray-50"
                    >
                      <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center ${selected ? 'bg-gray-900 border-gray-900' : 'border-gray-300'}`}>
                        {selected && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                      <span className="line-clamp-2 flex-1 text-gray-600">[{message.role}] {message.content}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <textarea
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              placeholder="可选：补充这段对话的使用说明"
              className="min-h-[52px] w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
            />
          </div>
        )}

        {sourceKind === 'kb' && (
          <div className="space-y-2">
            <Button
              type="button"
              onClick={() => void loadKbSources()}
              variant="outline"
              className="h-9 w-full justify-start border-gray-200 text-xs text-gray-700 hover:bg-gray-50"
            >
              <Library className="h-3.5 w-3.5 mr-1.5" />
              {selectedKbIds.length > 0 ? `已选择 ${selectedKbIds.length} 个索引来源` : '刷新已索引知识库'}
            </Button>
            {loadingOptions && <p className="flex items-center gap-1 text-[11px] text-gray-400"><Loader2 className="h-3 w-3 animate-spin" /> 加载来源</p>}
            {optionsError && sourceKind === 'kb' && <p className="text-[11px] text-amber-600">{optionsError}</p>}
            {kbSources.length > 0 && (
              <div className="max-h-36 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                {kbSources.map((source) => {
                  const selected = selectedKbIds.includes(source.id);
                  return (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => toggleKbSelection(source.id)}
                      className="flex w-full items-start gap-2 border-b border-gray-100 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-gray-50"
                    >
                      <div className={`mt-0.5 w-4 h-4 rounded border flex shrink-0 items-center justify-center ${selected ? 'bg-gray-900 border-gray-900' : 'border-gray-300'}`}>
                        {selected && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-gray-700">{source.title}</p>
                        <p className="mt-0.5 text-[11px] text-gray-400">{source.source} · {source.chunkCount} chunks</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            <input
              value={kbIdText}
              onChange={(event) => setKbIdText(event.target.value)}
              placeholder="知识库 ID，多个用逗号或换行分隔"
              className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-900 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
            />
            <textarea
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              placeholder="可选：粘贴知识库中最关键的材料，作为快照兜底"
              className="min-h-[60px] w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
            />
          </div>
        )}

        {(sourceKind === 'question' || sourceKind === 'manual') && (
          <textarea
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            placeholder={sourceKind === 'question' ? '粘贴题目；多题可用题号分隔' : '粘贴手动资料'}
            className="min-h-[80px] w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-100"
          />
        )}
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item, index) => (
            <div
              key={`${item.kind}-${index}-${item.text}`}
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] text-gray-600 shadow-sm"
            >
              <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">
                {sourceKindLabels[item.kind]}
              </span>
              <span className="truncate max-w-[140px]">{item.text}</span>
              {item.snapshots && item.snapshots.length > 0 && <span className="text-gray-400">快照 {item.snapshots.length}</span>}
              {typeof item.weight === 'number' && item.weight !== 1 && <span className="text-gray-400">x{item.weight}</span>}
              <button
                type="button"
                onClick={() => removeSourceItem(index)}
                className="text-gray-400 hover:text-red-500"
                aria-label={`移除来源 ${index + 1}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedNotebooks.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedNotebooks.map((note) => (
            <span key={note.id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
              {note.title}
              <button type="button" onClick={() => toggleNotebookSelection(note)} className="text-gray-400 hover:text-gray-600">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
