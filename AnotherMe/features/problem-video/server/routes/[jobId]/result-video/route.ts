import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { constants as fsConstants } from 'node:fs';
import { type NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/server/api-response';
import { getAnotherMe2ProblemVideoResult, isAnotherMe2GatewayError } from '@/lib/server/anotherme2-gateway';

export const maxDuration = 60;

function resolveLocalPath(raw: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('/')) {
    return path.normalize(raw);
  }
  return path.resolve(process.cwd(), raw);
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.mkv') return 'video/x-matroska';
  return 'application/octet-stream';
}

function isExpectedJobVideoPath(filePath: string, jobId: string): boolean {
  const normalized = path.normalize(filePath).replace(/\\/g, '/').toLowerCase();
  const expectedSuffix = `/jobs/${jobId.toLowerCase()}/problem_video/final.mp4`;
  return normalized.endsWith(expectedSuffix);
}

function isInsideWorkspace(filePath: string): boolean {
  const workspaceRoot = path.resolve(process.cwd());
  const target = path.resolve(filePath);
  const relative = path.relative(workspaceRoot, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function parseRange(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
  if (fileSize <= 0) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  const startToken = match[1];
  const endToken = match[2];

  if (!startToken && !endToken) {
    return null;
  }

  if (!startToken) {
    const suffixLength = Number.parseInt(endToken, 10);
    if (Number.isNaN(suffixLength) || suffixLength <= 0) {
      return null;
    }
    if (suffixLength >= fileSize) {
      return { start: 0, end: fileSize - 1 };
    }
    return {
      start: fileSize - suffixLength,
      end: fileSize - 1,
    };
  }

  const start = Number.parseInt(startToken, 10);
  const end = endToken ? Number.parseInt(endToken, 10) : fileSize - 1;

  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start < 0 ||
    end < 0 ||
    start > end ||
    start >= fileSize
  ) {
    return null;
  }

  return {
    start,
    end: Math.min(end, fileSize - 1),
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    if (!jobId) {
      return apiError('INVALID_REQUEST', 400, 'Missing job id');
    }

    const result = await getAnotherMe2ProblemVideoResult(jobId);
    const rawVideoUrl = typeof result.video_url === 'string' ? result.video_url.trim() : '';
    if (!rawVideoUrl) {
      return apiError('RESULT_NOT_READY', 409, 'Problem video result is not ready');
    }

    if (/^https?:\/\//i.test(rawVideoUrl)) {
      return NextResponse.redirect(rawVideoUrl, 307);
    }

    const filePath = resolveLocalPath(rawVideoUrl);
    if (!isExpectedJobVideoPath(filePath, jobId) || !isInsideWorkspace(filePath)) {
      return apiError('FILE_FORBIDDEN', 403, 'Video artifact path is not allowed');
    }

    await access(filePath, fsConstants.R_OK);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return apiError('FILE_NOT_FOUND', 404, 'Video artifact is missing');
    }

    const contentType = guessContentType(filePath);
    const rangeHeader = request.headers.get('range');

    if (rangeHeader) {
      const parsed = parseRange(rangeHeader, fileStat.size);
      if (!parsed) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            'Content-Range': `bytes */${fileStat.size}`,
          },
        });
      }

      const { start, end } = parsed;
      const stream = createReadStream(filePath, { start, end });
      const chunkSize = end - start + 1;

      return new NextResponse(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
        status: 206,
        headers: {
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${fileStat.size}`,
          'Content-Type': contentType,
        },
      });
    }

    const stream = createReadStream(filePath);
    return new NextResponse(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status: 200,
      headers: {
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Content-Length': String(fileStat.size),
        'Content-Type': contentType,
      },
    });
  } catch (error) {
    if (isAnotherMe2GatewayError(error)) {
      return apiError('UPSTREAM_ERROR', error.status, error.message);
    }

    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return apiError('FILE_NOT_FOUND', 404, 'Video artifact file does not exist');
    }

    if ((error as NodeJS.ErrnoException)?.code === 'EACCES') {
      return apiError('FILE_FORBIDDEN', 403, 'Video artifact file is not readable');
    }

    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to stream problem video',
    );
  }
}
