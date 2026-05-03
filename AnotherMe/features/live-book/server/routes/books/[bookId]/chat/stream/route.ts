import { NextRequest } from 'next/server';
import { apiError } from '@/lib/server/api-response';
import { chatWithLiveBookPageStream } from '@/lib/server/live-book-store';

interface Params {
  params: Promise<{ bookId: string }>;
}

export async function POST(req: NextRequest, context: Params) {
  try {
    const { bookId } = await context.params;
    const body = (await req.json()) as {
      pageId?: string;
      message?: string;
    };

    const pageId = (body.pageId || '').trim();
    const message = (body.message || '').trim();

    if (!pageId || !message) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required fields: pageId/message');
    }

    const result = await chatWithLiveBookPageStream(bookId, { pageId, message });
    if (!result) {
      return apiError('FILE_NOT_FOUND', 404, 'Live book or page not found');
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const push = (payload: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };

        push({ type: 'start' });

        for (const chunk of result.chunks) {
          push({ type: 'chunk', chunk });
          await new Promise((resolve) => setTimeout(resolve, 35));
        }

        push({
          type: 'done',
          reply: result.finalReply,
          book: result.book,
        });

        controller.close();
      },
      cancel() {
        // no-op
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
      'Failed to stream page chat',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
