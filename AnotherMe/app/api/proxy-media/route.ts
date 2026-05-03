/**
 * Media Proxy API
 *
 * Server-side proxy for fetching remote media URLs (images/videos).
 * Required because browser fetch() to remote CDN URLs fails with CORS errors.
 * The media orchestrator uses this to download generated media as blobs
 * for IndexedDB persistence.
 *
 * POST /api/proxy-media
 * Body: { url: string }
 * Response: Binary blob with appropriate Content-Type
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';

const log = createLogger('ProxyMedia');

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let url: string | undefined;
  try {
    ({ url } = await request.json());

    if (!url || typeof url !== 'string') {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing or invalid url');
    }

    // Block local/private network URLs to prevent SSRF
    const ssrfError = validateUrlForSSRF(url);
    if (ssrfError) {
      return apiError('INVALID_URL', 403, ssrfError);
    }

    // Disable redirect following to prevent redirect-to-internal attacks
    const response = await fetch(url, { redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      return apiError('REDIRECT_NOT_ALLOWED', 403, 'Redirects are not allowed');
    }
    if (!response.ok) {
      return apiError('UPSTREAM_ERROR', 502, `Upstream returned ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentLength = response.headers.get('content-length');
    const cacheControl = response.headers.get('cache-control') || 'private, max-age=3600';

    // Stream upstream body directly to reduce memory usage and first-byte latency.
    if (response.body) {
      const headers = new Headers();
      headers.set('Content-Type', contentType);
      if (contentLength) headers.set('Content-Length', contentLength);
      headers.set('Cache-Control', cacheControl);

      return new NextResponse(response.body, {
        status: response.status,
        headers,
      });
    }

    // Fallback for runtimes where body stream is unavailable.
    const blob = await response.blob();

    return new NextResponse(blob, {
      status: response.status,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(blob.size),
        'Cache-Control': cacheControl,
      },
    });
  } catch (error) {
    log.error(`Proxy media failed [url="${url?.substring(0, 100) ?? 'unknown'}"]:`, error);
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
