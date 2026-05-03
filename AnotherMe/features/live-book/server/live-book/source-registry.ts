import type { ClassroomBook } from '@/lib/types/classroom-book';
import type { LiveBookSourceInput, LiveBookSourceSnapshot } from '@/lib/server/live-book-store';

export type LiveBookRegisteredSourceKind = 'note' | 'chat' | 'question' | 'kb' | 'manual';

export interface LiveBookSourceOption {
  kind: LiveBookRegisteredSourceKind;
  id: string;
  title: string;
  content?: string;
  preview: string;
  source: string;
  subject?: string;
  bookId?: string;
  bookTitle?: string;
  chunkCount?: number;
  updatedAt?: string | number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface LiveBookSourceAnchor {
  kind: LiveBookRegisteredSourceKind | 'exploration' | 'live_book_spine';
  ref: string;
  title?: string;
  snippet: string;
  confidence: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

function clip(text: unknown, limit = 600): string {
  const value = String(text || '').trim().replace(/\s+/g, ' ');
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trim()}...`;
}

function unique<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function snapshotToSourceOption(snapshot: LiveBookSourceSnapshot): LiveBookSourceOption {
  return {
    kind: snapshot.kind,
    id: snapshot.id,
    title: snapshot.title || snapshot.id,
    content: snapshot.content,
    preview: clip(snapshot.content, 180),
    source: String(snapshot.metadata?.source || snapshot.kind),
    metadata: snapshot.metadata || {},
  };
}

export function snapshotToAnchor(snapshot: LiveBookSourceSnapshot, sourceKind?: LiveBookSourceInput['kind']): LiveBookSourceAnchor {
  return {
    kind: snapshot.kind,
    ref: `${snapshot.kind}:${snapshot.id}`,
    title: snapshot.title || snapshot.id,
    snippet: clip(`${snapshot.title ? `${snapshot.title}: ` : ''}${snapshot.content}`, 300),
    confidence: 0.9,
    source: sourceKind || snapshot.kind,
    metadata: snapshot.metadata || {},
  };
}

export function sourceInputToAnchors(source: LiveBookSourceInput): LiveBookSourceAnchor[] {
  const anchors: LiveBookSourceAnchor[] = [];

  for (const snapshot of source.snapshots || []) {
    anchors.push(snapshotToAnchor(snapshot, source.kind));
  }

  for (const kbId of source.kbIds || []) {
    anchors.push({
      kind: 'kb',
      ref: `kb:${kbId}`,
      title: kbId,
      snippet: source.text ? clip(source.text, 240) : `知识库引用：${kbId}`,
      confidence: source.snapshots?.length ? 0.65 : 0.35,
      source: 'kb',
      metadata: { kbId },
    });
  }

  for (const ref of source.notebookRefs || []) {
    anchors.push({
      kind: 'note',
      ref: `note:${ref}`,
      title: ref,
      snippet: source.text ? clip(source.text, 240) : `笔记引用：${ref}`,
      confidence: source.snapshots?.length ? 0.7 : 0.3,
      source: 'notes',
      metadata: { notebookRef: ref },
    });
  }

  for (const ref of source.questionRefs || []) {
    anchors.push({
      kind: 'question',
      ref: `question:${ref}`,
      title: ref,
      snippet: source.text ? clip(source.text, 240) : `题目引用：${ref}`,
      confidence: source.snapshots?.length ? 0.75 : 0.25,
      source: 'question',
      metadata: { questionRef: ref },
    });
  }

  for (const selection of source.chatSelections || []) {
    anchors.push({
      kind: 'chat',
      ref: `chat:${selection.chatId}`,
      title: selection.chatId,
      snippet: source.text ? clip(source.text, 240) : `对话引用：${selection.chatId}`,
      confidence: source.snapshots?.length ? 0.75 : 0.35,
      source: 'chat',
      metadata: { chatId: selection.chatId, messageIds: selection.messageIds },
    });
  }

  if (source.text && anchors.length === 0) {
    anchors.push({
      kind: source.kind === 'notes' ? 'note' : source.kind,
      ref: `${source.kind}:manual`,
      title: source.kind,
      snippet: clip(source.text, 300),
      confidence: 0.55,
      source: source.kind,
    });
  }

  return unique(anchors, (anchor) => `${anchor.kind}:${anchor.ref}:${anchor.snippet}`);
}

export function explorationChunkToAnchor(chunk: Record<string, unknown>): LiveBookSourceAnchor {
  const kind = String(chunk.kind || chunk.source || 'exploration') as LiveBookSourceAnchor['kind'];
  const ref = String(chunk.ref || chunk.chunk_id || chunk.id || '');
  const title = typeof chunk.title === 'string' ? chunk.title : undefined;
  return {
    kind,
    ref,
    title,
    snippet: clip(chunk.snippet || chunk.text || chunk.content || '', 300),
    confidence: typeof chunk.confidence === 'number'
      ? chunk.confidence
      : typeof chunk.score === 'number'
        ? chunk.score
        : 0.5,
    source: String(chunk.source || chunk.sourceKind || kind),
    metadata: {
      query: chunk.query,
      kbName: chunk.kbName,
      notebookRef: chunk.notebookRef,
      warning: chunk.warning,
      metadata: chunk.metadata,
    },
  };
}

export function selectEvidenceAnchors(input: {
  topic: string;
  chapterTitle?: string;
  pageTitle?: string;
  chunks?: Array<Record<string, unknown>>;
  limit?: number;
}): LiveBookSourceAnchor[] {
  const limit = input.limit ?? 5;
  const haystack = [input.topic, input.chapterTitle, input.pageTitle]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const scored = (input.chunks || []).map((chunk, index) => {
    const text = [
      chunk.title,
      chunk.ref,
      chunk.snippet,
      chunk.text,
      chunk.query,
      chunk.metadata && typeof chunk.metadata === 'object'
        ? Object.values(chunk.metadata as Record<string, unknown>).join(' ')
        : '',
    ].join(' ').toLowerCase();
    const lexicalScore = haystack
      .split(/\s+/)
      .filter((token) => token.length > 1 && text.includes(token)).length;
    const confidence = typeof chunk.confidence === 'number'
      ? chunk.confidence
      : typeof chunk.score === 'number'
        ? chunk.score
        : 0.4;
    return { chunk, score: lexicalScore + confidence, index };
  });

  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => explorationChunkToAnchor(item.chunk));
}

export function classroomBookToSourceOptions(book: ClassroomBook): LiveBookSourceOption[] {
  return book.blocks
    .filter((block) => block.content?.trim())
    .map((block) => {
      const anchors = block.sourceAnchorIds
        .map((anchorId) => book.sourceAnchors.find((anchor) => anchor.id === anchorId))
        .filter(Boolean);
      const sourceCapability = book.meta?.sourceCapability || 'generated';
      return {
        kind: 'note',
        id: `${book.id}:${block.id}`,
        title: block.title ? `${book.title} / ${block.title}` : book.title,
        content: block.content,
        preview: clip(block.content, 180),
        source: 'classroom-book',
        subject: book.meta?.originalTopic || sourceCapability,
        bookId: book.id,
        bookTitle: book.title,
        updatedAt: book.updatedAt,
        tags: [sourceCapability, block.type, ...block.knowledgePointIds].filter(Boolean),
        metadata: {
          bookId: book.id,
          bookTitle: book.title,
          blockId: block.id,
          blockType: block.type,
          subject: book.meta?.originalTopic || sourceCapability,
          sourceCapability,
          sourceAnchors: anchors,
        },
      };
    });
}

export async function listGeneratedNoteOptions(userIds: string[]): Promise<LiveBookSourceOption[]> {
  const { listClassroomBooks } = await import('@/lib/server/classroom-book-service');
  const booksByUser = await Promise.all(
    userIds.map(async (candidateUserId) => {
      try {
        return await listClassroomBooks(candidateUserId);
      } catch {
        return [];
      }
    }),
  );
  return booksByUser
    .flat()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .flatMap(classroomBookToSourceOptions)
    .slice(0, 120);
}

export async function listKbSourceOptions(): Promise<{ sources: LiveBookSourceOption[]; unavailableReason?: string }> {
  try {
    const { initRAGStore } = await import('@/lib/rag/vectorStore');
    const store = await initRAGStore();
    return {
      sources: store.listSources().slice(0, 80).map((source) => ({
        kind: 'kb',
        id: source.id,
        title: source.title,
        preview: `${source.source} · ${source.chunkCount} chunks`,
        source: source.source,
        chunkCount: source.chunkCount,
        tags: [source.kbId, source.kbName].filter(Boolean) as string[],
        metadata: { ...source },
      })),
    };
  } catch (error) {
    return {
      sources: [],
      unavailableReason: error instanceof Error ? error.message : 'RAG source index is unavailable',
    };
  }
}
