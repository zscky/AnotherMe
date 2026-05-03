import type { Scene, Stage } from '@/lib/types/stage';

export interface LiveBookStageBlock {
  id: string;
  type:
    | 'section'
    | 'text'
    | 'quiz'
    | 'interactive'
    | 'animation'
    | 'deep_dive'
    | 'remedial'
    | 'callout'
    | 'figure'
    | 'flash_cards'
    | 'code'
    | 'timeline'
    | 'concept_graph'
    | 'user_note'
    | 'placeholder';
  title: string;
  content: string;
  status: 'ready' | 'error';
  paramsJson?: Record<string, unknown>;
  metadataJson?: Record<string, unknown>;
  error?: string;
  createdAt?: number;
  updatedAt?: number;
  sourceRefsJson?: Array<Record<string, unknown>>;
}

export interface LiveBookStagePage {
  id: string;
  chapterId: string;
  title: string;
  order: number;
  blocks: LiveBookStageBlock[];
}

export interface LiveBookStageChapter {
  id: string;
  title: string;
  goal: string;
  order: number;
}

export interface LiveBookStageRecord {
  id: string;
  title: string;
  topic: string;
  language?: string;
  createdAt: number;
  updatedAt: number;
  chapters: LiveBookStageChapter[];
  pages: LiveBookStagePage[];
}

export function liveBookToStage(book: LiveBookStageRecord): { stage: Stage; scenes: Scene[] } {
  const stage: Stage = {
    id: `live-book:${book.id}`,
    name: book.title,
    description: `活书：${book.topic}`,
    language: book.language,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
  };

  const chapterById = new Map(book.chapters.map((chapter) => [chapter.id, chapter]));
  const scenes: Scene[] = [...book.pages]
    .sort((a, b) => a.order - b.order)
    .map((page) => {
      const chapter = chapterById.get(page.chapterId);
      return {
        id: `live-book-page:${page.id}`,
        stageId: stage.id,
        type: 'live_book_page',
        title: page.title,
        order: page.order,
        content: {
          type: 'live_book_page',
          bookId: book.id,
          pageId: page.id,
          chapterId: page.chapterId,
          chapterTitle: chapter?.title,
          pageTitle: page.title,
          order: page.order,
          blocks: page.blocks.map((block) => ({
            id: block.id,
            type: block.type,
            title: block.title,
            content: block.content,
            status: block.status,
            paramsJson: block.paramsJson,
            metadataJson: block.metadataJson,
            error: block.error,
            createdAt: block.createdAt,
            updatedAt: block.updatedAt,
            sourceRefsJson: block.sourceRefsJson,
          })),
        },
      };
    });

  return { stage, scenes };
}
