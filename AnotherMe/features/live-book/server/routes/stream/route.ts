import { NextRequest } from 'next/server';
import { apiError } from '@/lib/server/api-response';
import {
  getLiveBookJob,
  listLiveBookJobs,
  subscribeLiveBookJob,
  type LiveBookJobEvent,
} from '@/lib/server/live-book-store';

/**
 * Canonical SSE stream endpoint for live-book job events.
 *
 * Query: ?book_id=<bookId>
 * Returns: text/event-stream with JSON events
 */
export async function GET(req: NextRequest) {
  try {
    const bookId = req.nextUrl.searchParams.get('book_id')?.trim() || '';
    if (!bookId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required query: book_id');
    }

    const jobs = await listLiveBookJobs(bookId);
    const latest = jobs[0];
    if (!latest) {
      return apiError('FILE_NOT_FOUND', 404, 'No live-book job found for this book');
    }

    const job = await getLiveBookJob(latest.id);
    if (!job) {
      return apiError('FILE_NOT_FOUND', 404, 'Live-book job not found');
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const push = (event: LiveBookJobEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        for (const event of job.events) {
          push(event);
        }

        const unsubscribe = subscribeLiveBookJob(job.id, (event) => {
          push(event);
          if (event.type === 'done' || event.type === 'error') {
            cleanup();
          }
        });

        const heartbeat = setInterval(() => {
          controller.enqueue(encoder.encode(':heartbeat\n\n'));
        }, 15000);

        const cleanup = () => {
          clearInterval(heartbeat);
          unsubscribe();
          try {
            controller.close();
          } catch {
            // ignore
          }
        };

        req.signal.addEventListener('abort', cleanup, { once: true });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to open live-book stream',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
