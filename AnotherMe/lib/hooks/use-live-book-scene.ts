'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { LiveBookPageContent, LiveBookBlockContent } from '@/lib/types/stage';

export interface UseLiveBookSceneOptions {
  bookId: string;
  pageId: string;
  chapterId?: string;
  chapterTitle?: string;
  pageTitle: string;
  order?: number;
  blocks?: LiveBookBlockContent[];
}

export interface UseLiveBookSceneReturn {
  content: LiveBookPageContent;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface LiveBookPageApiBlock {
  id: string;
  type: LiveBookBlockContent['type'];
  title: string;
  content: string;
  status?: LiveBookBlockContent['status'];
}

interface LiveBookPageApiPage {
  chapterId?: string;
  chapterTitle?: string;
  title?: string;
  order?: number;
  blocks?: LiveBookPageApiBlock[];
}

export function useLiveBookScene(options: UseLiveBookSceneOptions): UseLiveBookSceneReturn {
  const { bookId, pageId, chapterId, chapterTitle, pageTitle, order, blocks = [] } = options;

  const [content, setContent] = useState<LiveBookPageContent>({
    type: 'live_book_page',
    bookId,
    pageId,
    chapterId,
    chapterTitle,
    pageTitle,
    order,
    blocks,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/live-book/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(pageId)}`,
        { cache: 'no-store' },
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch live book page: ${response.status}`);
      }
      const result = await response.json();
      if (result.success && (result.page || result.data?.page)) {
        const page = (result.page || result.data.page) as LiveBookPageApiPage;
        if (mountedRef.current) {
          setContent({
            type: 'live_book_page',
            bookId,
            pageId,
            chapterId: page.chapterId || chapterId,
            chapterTitle: page.chapterTitle || chapterTitle,
            pageTitle: page.title || pageTitle,
            order: page.order ?? order,
            blocks:
              page.blocks?.map((block) => ({
                id: block.id,
                type: block.type,
                title: block.title,
                content: block.content,
                status: block.status || 'ready',
              })) || [],
          });
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to refresh live book page');
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [bookId, pageId, chapterId, chapterTitle, pageTitle, order]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { content, isLoading, error, refresh };
}
