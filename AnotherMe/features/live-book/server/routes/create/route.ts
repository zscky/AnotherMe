import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLiveBook } from '@/lib/server/live-book-store';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      topic?: string;
      language?: 'zh-CN' | 'en-US';
      targetLevel?: string;
      userId?: string;
      sources?: Array<{
        kind?: 'kb' | 'notes' | 'chat' | 'question' | 'manual';
        text?: string;
        weight?: number;
        snapshots?: Array<{
          kind?: 'note' | 'chat' | 'question' | 'kb' | 'manual';
          id?: string;
          title?: string;
          content?: string;
          metadata?: Record<string, unknown>;
        }>;
        kbIds?: string[];
        notebookRefs?: string[];
        chatSelections?: Array<{ chatId: string; messageIds: string[] }>;
        questionRefs?: string[];
      }>;
    };

    const topic = (body.topic || '').trim();
    if (!topic) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: topic');
    }

    const book = await createLiveBook({
      topic,
      language: body.language === 'en-US' ? 'en-US' : 'zh-CN',
      ...(body.targetLevel ? { targetLevel: body.targetLevel } : {}),
      ...(body.userId ? { userId: body.userId } : {}),
      ...(Array.isArray(body.sources)
        ? {
            sources: body.sources
              .map((item) => ({
                kind: item.kind,
                text: typeof item.text === 'string' ? item.text : '',
                weight: item.weight,
                snapshots: Array.isArray(item.snapshots)
                  ? item.snapshots
                      .filter((snapshot: unknown) => snapshot && typeof snapshot === 'object')
                      .map((snapshot: unknown) => {
                        const value = snapshot as Record<string, unknown>;
                        return {
                          kind: value.kind,
                          id: typeof value.id === 'string' ? value.id : '',
                          title: typeof value.title === 'string' ? value.title : undefined,
                          content: typeof value.content === 'string' ? value.content : '',
                          metadata:
                            value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
                              ? (value.metadata as Record<string, unknown>)
                              : undefined,
                        };
                      })
                  : undefined,
                kbIds: Array.isArray(item.kbIds) ? item.kbIds.filter((id: unknown) => typeof id === 'string') : undefined,
                notebookRefs: Array.isArray(item.notebookRefs) ? item.notebookRefs.filter((id: unknown) => typeof id === 'string') : undefined,
                chatSelections: Array.isArray(item.chatSelections)
                  ? item.chatSelections
                      .filter((sel: unknown) => sel && typeof sel === 'object')
                      .map((sel: unknown) => ({
                        chatId: String((sel as Record<string, unknown>).chatId || ''),
                        messageIds: Array.isArray((sel as Record<string, unknown>).messageIds)
                          ? ((sel as Record<string, unknown>).messageIds as unknown[]).filter((id: unknown) => typeof id === 'string')
                          : [],
                      }))
                      .filter((sel) => sel.chatId)
                  : undefined,
                questionRefs: Array.isArray(item.questionRefs) ? item.questionRefs.filter((id: unknown) => typeof id === 'string') : undefined,
              }))
              .filter((item) =>
                (item.kind === 'kb' ||
                  item.kind === 'notes' ||
                  item.kind === 'chat' ||
                  item.kind === 'question' ||
                  item.kind === 'manual') &&
                (item.text.trim().length > 0 ||
                  Boolean(item.snapshots?.some((snapshot) => snapshot.content.trim().length > 0)) ||
                  Boolean(item.kbIds?.length) ||
                  Boolean(item.notebookRefs?.length) ||
                  Boolean(item.chatSelections?.length) ||
                  Boolean(item.questionRefs?.length)),
              ) as Array<{
                kind: 'kb' | 'notes' | 'chat' | 'question' | 'manual';
                text: string;
                weight?: number;
                snapshots?: Array<{
                  kind: 'note' | 'chat' | 'question' | 'kb' | 'manual';
                  id: string;
                  title?: string;
                  content: string;
                  metadata?: Record<string, unknown>;
                }>;
                kbIds?: string[];
                notebookRefs?: string[];
                chatSelections?: Array<{ chatId: string; messageIds: string[] }>;
                questionRefs?: string[];
              }>,
          }
        : {}),
    });

    return apiSuccess({ book }, 201);
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to create live book',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
