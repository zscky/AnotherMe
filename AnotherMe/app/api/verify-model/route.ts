import { NextRequest } from 'next/server';
import { generateText } from 'ai';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModel } from '@/lib/server/resolve-model';
const log = createLogger('Verify Model');

export async function POST(req: NextRequest) {
  let model: string | undefined;
  try {
    const body = await req.json();
    const { apiKey, baseUrl, providerType, requiresApiKey } = body;
    model = body.model;

    if (!model) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Model name is required');
    }

    // Parse model string and resolve server-side fallback
    let languageModel;
    try {
      const result = resolveModel({
        modelString: model,
        apiKey: apiKey || '',
        baseUrl: baseUrl || undefined,
        providerType,
        requiresApiKey,
      });
      languageModel = result.model;
    } catch (error) {
      return apiError(
        'INVALID_REQUEST',
        401,
        error instanceof Error ? error.message : String(error),
      );
    }

    // Send a minimal test message
    let text: string;
    try {
      const result = await generateText({
        model: languageModel,
        prompt: 'Say "OK" if you can hear me.',
      });
      text = result.text;
    } catch (genError) {
      log.error(`Model verification generateText failed [model="${model ?? 'unknown'}"]:`, genError);

      let errorMessage = 'Connection failed';
      let statusCode = 500;
      if (genError instanceof Error) {
        const msg = genError.message;
        if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('AUTH')) {
          errorMessage = 'API key is invalid or expired';
          statusCode = 401;
        } else if (msg.includes('404') || msg.includes('not found') || msg.includes('Not Found')) {
          errorMessage = 'Model not found or API endpoint error';
          statusCode = 404;
        } else if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Rate limit')) {
          errorMessage = 'API rate limit exceeded, please try again later';
          statusCode = 429;
        } else if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) {
          errorMessage = 'Cannot connect to API server, please check the Base URL';
          statusCode = 502;
        } else if (msg.includes('timeout') || msg.includes('Timeout')) {
          errorMessage = 'Connection timed out, please check your network';
          statusCode = 504;
        } else {
          errorMessage = msg;
          statusCode = 500;
        }
      }

      return apiError('MODEL_VERIFICATION_FAILED', statusCode, errorMessage);
    }

    return apiSuccess({
      message: 'Connection successful',
      response: text,
    });
  } catch (error) {
    log.error(`Model verification failed [model="${model ?? 'unknown'}"]:`, error);

    let errorMessage = 'Connection failed';
    if (error instanceof Error) {
      errorMessage = error.message;
    }

    return apiError('INTERNAL_ERROR', 500, errorMessage);
  }
}
