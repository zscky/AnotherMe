import { NextRequest } from 'next/server';
import { apiError } from '@/lib/server/api-response';
import { getLiveBookJob, subscribeLiveBookJob } from '@/lib/server/live-book-store';

interface Params {
  params: Promise<{ jobId: string }>;
}

export async function GET(req: NextRequest, context: Params) {
  try {
    const { jobId } = await context.params;
    const job = await getLiveBookJob(jobId);
    if (!job) {
      return apiError('FILE_NOT_FOUND', 404, 'Live-book job not found');
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const push = (payload: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };

        for (const event of job.events) {
          push(event);
        }

        const unsubscribe = subscribeLiveBookJob(jobId, (event) => {
          push(event);
          if (event.type === 'done' || event.type === 'error') {
            cleanup();
          }
        });

        const heartbeat = setInterval(() => {
          controller.enqueue(encoder.encode(`:heartbeat\n\n`));
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
