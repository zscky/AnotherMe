import { apiError, apiSuccess } from '@/lib/server/api-response';
import { listLiveBooks } from '@/lib/server/live-book-store';

export async function GET() {
  try {
    const books = await listLiveBooks();
    return apiSuccess({ books });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to list live books',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
