'use client';

import { useEffect, useRef, useState } from 'react';
import { Upload, Sparkles, Settings2, ArrowRight, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSettingsStore } from '@/lib/store/settings';

interface ParsePdfSuccess {
  success: true;
  data: {
    text?: string;
    images?: string[];
    metadata?: {
      pdfImages?: Array<{ src?: string }>;
    };
  };
}

interface ParsePdfError {
  success: false;
  error?: string;
}

interface GenerateClassroomResponse {
  success: boolean;
  jobId?: string;
  pollUrl?: string;
  pollIntervalMs?: number;
  error?: string;
}

interface GenerateClassroomJobResponse {
  success: boolean;
  status?: 'queued' | 'running' | 'succeeded' | 'failed';
  message?: string;
  progress?: number;
  result?: {
    classroomId: string;
    url: string;
    scenesCount: number;
  };
  error?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function CreateClassPage() {
  const router = useRouter();
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [topic, setTopic] = useState('');
  const [requirements, setRequirements] = useState('');
  const [materialFile, setMaterialFile] = useState<File | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  const pdfProviderId = useSettingsStore((s) => s.pdfProviderId);
  const pdfProvidersConfig = useSettingsStore((s) => s.pdfProvidersConfig);

  const parsePdfIfNeeded = async (
    file: File | null,
    signal: AbortSignal,
    providerId?: string,
    apiKey?: string,
    baseUrl?: string,
  ) => {
    if (!file) return undefined;

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      throw new Error('当前仅支持 PDF 资料接入，其他文件格式请先转换为 PDF。');
    }

    const formData = new FormData();
    formData.append('pdf', file);
    if (providerId) {
      formData.append('providerId', providerId);
    }
    if (apiKey?.trim()) {
      formData.append('apiKey', apiKey.trim());
    }
    if (baseUrl?.trim()) {
      formData.append('baseUrl', baseUrl.trim());
    }

    const response = await fetch('/api/parse-pdf', {
      method: 'POST',
      body: formData,
      signal,
    });

    const payload = (await response.json()) as ParsePdfSuccess | ParsePdfError;
    if (!response.ok || !payload.success) {
      throw new Error(payload.success ? 'PDF 解析失败，请稍后重试。' : payload.error || 'PDF 解析失败。');
    }

    const text = payload.data.text || '';
    const imagesFromMetadata = (payload.data.metadata?.pdfImages || [])
      .map((item) => item.src || '')
      .filter(Boolean);
    const images = payload.data.images?.length ? payload.data.images : imagesFromMetadata;

    return {
      text,
      images,
    };
  };

  const handleGenerate = async () => {
    const trimmedTopic = topic.trim();
    const trimmedRequirements = requirements.trim();

    if (!trimmedTopic) {
      setErrorText('请先填写课程主题。');
      return;
    }

    setErrorText('');
    setStatusText('正在准备生成请求...');
    setIsGenerating(true);

    try {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const requirement = trimmedRequirements
        ? `${trimmedTopic}\n\n补充要求：${trimmedRequirements}`
        : trimmedTopic;

      setStatusText('正在处理学习资料...');
      const activePdfConfig = pdfProvidersConfig?.[pdfProviderId];
      const pdfContent = await parsePdfIfNeeded(
        materialFile,
        controller.signal,
        pdfProviderId,
        activePdfConfig?.apiKey,
        activePdfConfig?.baseUrl,
      );

      const createResp = await fetch('/api/generate-classroom', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify({
          requirement,
          language: 'zh-CN',
          ...(pdfContent ? { pdfContent } : {}),
          enableWebSearch: true,
          enableImageGeneration: true,
          enableVideoGeneration: true,
          enableTTS: true,
          agentMode: 'generate',
        }),
      });

      const createPayload = (await createResp.json()) as GenerateClassroomResponse;
      if (!createResp.ok || !createPayload.success || !createPayload.jobId) {
        throw new Error(createPayload.error || '创建课堂任务失败。');
      }

      const { jobId } = createPayload;
      const pollUrl = createPayload.pollUrl || `/api/generate-classroom/${jobId}`;
      const pollIntervalMs = createPayload.pollIntervalMs || 5000;
      setStatusText('任务已提交，正在生成课堂...');

      const maxPollAttempts = 240;
      for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
        if (!isMountedRef.current || controller.signal.aborted) {
          return;
        }

        await sleep(pollIntervalMs);

        const pollResp = await fetch(pollUrl, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });

        const pollPayload = (await pollResp.json()) as GenerateClassroomJobResponse;
        if (!pollResp.ok || !pollPayload.success) {
          throw new Error(pollPayload.error || '读取课堂生成状态失败。');
        }

        const progressText =
          typeof pollPayload.progress === 'number' ? ` (${Math.round(pollPayload.progress)}%)` : '';
        if (!isMountedRef.current || controller.signal.aborted) {
          return;
        }

        setStatusText(`${pollPayload.message || '课堂生成中'}${progressText}`);

        if (pollPayload.status === 'failed') {
          throw new Error(pollPayload.error || '课堂生成失败。');
        }

        if (pollPayload.status === 'succeeded' && pollPayload.result?.classroomId) {
          setStatusText('课堂生成完成，正在进入课堂...');

          const targetUrl = (() => {
            const resultUrl = pollPayload.result?.url;
            if (resultUrl) {
              try {
                const parsed = new URL(resultUrl, window.location.origin);
                return `${parsed.pathname}${parsed.search}${parsed.hash}`;
              } catch {
                // Fall back to classroom route when url parsing fails.
              }
            }
            return `/classroom/${encodeURIComponent(pollPayload.result.classroomId)}`;
          })();

          router.push(targetUrl);
          return;
        }
      }

      throw new Error('课堂生成超时，请稍后在“我的课程”中查看结果。');
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      setErrorText(error instanceof Error ? error.message : '生成课堂时发生未知错误。');
    } finally {
      if (isMountedRef.current) {
        setIsGenerating(false);
      }
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 tracking-wide uppercase">创建课堂</h1>
      </div>

      <div className="bg-white p-8 shadow-sm">
        <div className="space-y-8">
          <div>
            <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-3">
              课程主题
            </label>
            <input
              type="text"
              placeholder="例如：物理：牛顿运动定律"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              className="w-full px-4 py-3 bg-[#F4F3F0] border-none focus:ring-2 focus:ring-gray-300 rounded-none outline-none transition-all text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-3">
              课程要求 (选填)
            </label>
            <textarea
              rows={3}
              placeholder="例如：重点讲解公式推导，提供生活中的实际案例..."
              value={requirements}
              onChange={(event) => setRequirements(event.target.value)}
              className="w-full px-4 py-3 bg-[#F4F3F0] border-none focus:ring-2 focus:ring-gray-300 rounded-none outline-none transition-all resize-none text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide mb-3">
              学习资料 (PDF)
            </label>
            <label className="mt-2 flex justify-center border-2 border-dashed border-gray-300 px-6 py-12 hover:bg-[#F4F3F0] transition-colors cursor-pointer group">
              <div className="text-center">
                <div className="mx-auto h-16 w-16 bg-black text-white rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Upload className="h-6 w-6" aria-hidden="true" />
                </div>
                <div className="mt-4 flex text-sm leading-6 text-gray-600 justify-center">
                  <span className="relative cursor-pointer bg-transparent font-bold text-[#E0573D] hover:text-[#c94d35]">
                    点击上传
                  </span>
                  <p className="pl-1">或拖拽文件到此处</p>
                </div>
                <p className="text-xs leading-5 text-gray-500 mt-2">
                  {materialFile ? `已选择：${materialFile.name}` : '支持 PDF，最大 50MB'}
                </p>
              </div>
              <input
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(event) => setMaterialFile(event.target.files?.[0] || null)}
              />
            </label>
          </div>

          <div className="pt-6 border-t border-gray-100">
            <div className="flex items-center gap-2 text-sm font-bold text-gray-500 uppercase tracking-wide">
              <Settings2 className="h-4 w-4" />
              默认启用：联网搜索 / 图片生成 / 视频生成 / TTS / 智能教师团队
            </div>
          </div>

          {statusText ? <p className="text-sm text-gray-600">{statusText}</p> : null}
          {errorText ? <p className="text-sm text-red-600">{errorText}</p> : null}

          <div className="pt-4 flex justify-end">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating}
              className="flex items-center gap-2 px-8 py-4 bg-[#E0573D] hover:bg-[#c94d35] text-white font-bold uppercase tracking-wide transition-all disabled:opacity-70 disabled:cursor-not-allowed text-sm"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  生成课堂
                  <ArrowRight className="h-4 w-4 ml-1" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
