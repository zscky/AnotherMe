import { generateTTS } from '@/lib/audio/tts-providers';
import { DEFAULT_TTS_MODELS, DEFAULT_TTS_VOICES } from '@/lib/audio/constants';
import { resolveTTSApiKey, resolveTTSBaseUrl } from '@/lib/server/provider-config';
import type { TTSProviderId } from '@/lib/audio/types';
import type { CapabilityToolResult, RenderedArtifact } from './types';

export interface SynthesizeSpeechParams {
  text: string;
  providerId?: TTSProviderId;
  modelId?: string;
  voice?: string;
  speed?: number;
  apiKey?: string;
  baseUrl?: string;
}

export async function synthesizeSpeech(params: SynthesizeSpeechParams): Promise<CapabilityToolResult<{ artifact?: RenderedArtifact }>> {
  const text = params.text.trim();
  if (!text) {
    return {
      success: false,
      toolId: 'tts',
      output: '',
      error: 'TTS 文本为空',
    };
  }

  const providerId = params.providerId || 'openai-tts';
  if (providerId === 'browser-native-tts') {
    return {
      success: false,
      toolId: 'tts',
      output: '',
      error: 'browser-native-tts 只能在客户端执行',
    };
  }

  try {
    const apiKey = resolveTTSApiKey(providerId, params.apiKey);
    const baseUrl = resolveTTSBaseUrl(providerId, params.baseUrl);
    const { audio, format } = await generateTTS(
      {
        providerId,
        modelId: params.modelId || DEFAULT_TTS_MODELS[providerId],
        voice: params.voice || DEFAULT_TTS_VOICES[providerId],
        speed: params.speed ?? 1,
        apiKey,
        baseUrl,
      },
      text,
    );

    const base64 = Buffer.from(audio).toString('base64');
    return {
      success: true,
      toolId: 'tts',
      output: 'TTS 音频生成完成',
      metadata: {
        artifact: {
          format,
          content: base64,
          mimeType: `audio/${format}`,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      toolId: 'tts',
      output: '',
      error: error instanceof Error ? error.message : 'TTS 生成失败',
    };
  }
}
