'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Stage } from '@/features/classroom/components/stage';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { useStageStore } from '@/lib/store';
import { liveBookToStage, type LiveBookStageRecord } from '@/lib/live-book/stage-adapter';

export default function LiveBookStagePage() {
  const params = useParams();
  const bookId = params?.bookId as string;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLiveBookStage = useCallback(async () => {
    if (!bookId) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/live-book/books/${encodeURIComponent(bookId)}`, {
        cache: 'no-store',
      });
      const payload = (await response.json()) as {
        success?: boolean;
        book?: LiveBookStageRecord;
        error?: string;
      };

      if (!response.ok || !payload.success || !payload.book) {
        throw new Error(payload.error || '活书加载失败');
      }

      const { stage, scenes } = liveBookToStage(payload.book);
      useStageStore.getState().setStage(stage);
      useStageStore.setState({
        scenes,
        currentSceneId: scenes[0]?.id ?? null,
        mode: 'playback',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '活书加载失败');
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    void loadLiveBookStage();
  }, [loadLiveBookStage]);

  return (
    <ThemeProvider>
      <div className="h-screen flex flex-col overflow-hidden">
        {loading ? (
          <div className="flex-1 flex items-center justify-center bg-gray-50 text-sm text-gray-500 dark:bg-gray-900">
            正在加载活书舞台...
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
            <div className="text-center">
              <p className="mb-4 text-sm text-red-600">加载失败：{error}</p>
              <button
                type="button"
                onClick={() => void loadLiveBookStage()}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white"
              >
                重试
              </button>
            </div>
          </div>
        ) : (
          <Stage />
        )}
      </div>
    </ThemeProvider>
  );
}
