import { API_ERROR_CODES, type ApiErrorCode } from '@/lib/server/api-response';

export interface ClassifiedVideoError {
  code: ApiErrorCode;
  status: number;
  message: string;
  retryable: boolean;
}

export function classifyVideoGenerationError(error: unknown): ClassifiedVideoError {
  const rawMessage = error instanceof Error ? error.message : String(error || 'Unknown error');
  const message = rawMessage.trim();
  const lower = message.toLowerCase();

  if (
    lower.includes('sensitivecontent') ||
    lower.includes('sensitive information') ||
    lower.includes('content safety') ||
    lower.includes('moderation')
  ) {
    return {
      code: API_ERROR_CODES.CONTENT_SENSITIVE,
      status: 400,
      message,
      retryable: false,
    };
  }

  if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('deadline')) {
    return {
      code: API_ERROR_CODES.UPSTREAM_TIMEOUT,
      status: 504,
      message,
      retryable: true,
    };
  }

  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('auth failed') ||
    lower.includes('invalid api key')
  ) {
    return {
      code: API_ERROR_CODES.AUTH_FAILED,
      status: 401,
      message,
      retryable: false,
    };
  }

  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      code: API_ERROR_CODES.RATE_LIMITED,
      status: 429,
      message,
      retryable: true,
    };
  }

  if (
    lower.includes('400') ||
    lower.includes('invalid request') ||
    lower.includes('bad request') ||
    lower.includes('validation')
  ) {
    return {
      code: API_ERROR_CODES.INVALID_REQUEST,
      status: 400,
      message,
      retryable: false,
    };
  }

  return {
    code: API_ERROR_CODES.UPSTREAM_ERROR,
    status: 502,
    message,
    retryable: true,
  };
}
