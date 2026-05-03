'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  BookOpen,
  Bot,
  Brain,
  Calculator,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Database,
  FileSearch,
  Globe,
  GraduationCap,
  Image,
  LayoutGrid,
  Lightbulb,
  Loader2,
  MessageSquare,
  Microscope,
  Music,
  NotebookPen,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Video,
  Wrench,
  Zap,
} from 'lucide-react';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { UNIFIED_MENTOR_PRESET } from '@/lib/orchestration/registry/classroom-presets';
import { cn } from '@/lib/utils';
import { NeuralLoader, BrainWaveLoader } from '@/features/ai-tutor/components/ai-elements/loader';
import { MarkdownRenderer } from '@/features/ai-tutor/components/markdown/MarkdownRenderer';
import { ToolTracePanel } from '@/features/ai-tutor/components/chat/tool-trace-panel';

type TutorMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  capability?: CapabilityId;
  feedback?: 'up' | 'down' | null;
  toolTraces?: TutorToolTrace[];
  capabilityResult?: Record<string, unknown>;
  reasoning?: string;
};

type TutorSession = {
  id: string;
  title: string;
  autoTitle: boolean;
  createdAt: string;
  updatedAt: string;
  messages: TutorMessage[];
};

type ChatApiEvent = {
  type: string;
  data?: Record<string, unknown>;
};

type ChatRequestMessage = {
  id: string;
  role: 'user' | 'assistant';
  parts: Array<{ type: 'text'; text: string }>;
};

export type CapabilityId =
  | ''
  | 'deep_solve'
  | 'quiz_practice'
  | 'deep_research'
  | 'math_animator'
  | 'visualize';

type TutorToolName =
  | 'brainstorm'
  | 'rag'
  | 'web_search'
  | 'code_execution'
  | 'reason'
  | 'paper_search';

type TutorToolTrace = {
  id: string;
  toolName: TutorToolName;
  status: 'running' | 'success' | 'error';
  startTime: number;
  endTime?: number;
  output?: string;
  error?: string;
};

type QuizPreviewQuestion = {
  question: string;
  options?: string[];
  answer: string;
  explanation?: string;
  difficulty?: string;
};

type VisualizePreviewData = {
  format: string;
  content: string;
};

type MathAnimatorPreviewData = {
  response?: string;
  outputUrl?: string;
  artifacts?: Array<{ type: 'video' | 'image'; url: string; filename?: string; label?: string }>;
  storyboard?: Array<{ frame: number; description: string; code?: string }>;
  manimCode?: string;
  renderError?: string;
};

interface CapabilityDef {
  id: CapabilityId;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface ToolDef {
  id: TutorToolName;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const CAPABILITIES: CapabilityDef[] = [
  { id: '', label: '聊天', description: '灵活对话，可使用多种工具', icon: MessageSquare },
  { id: 'deep_solve', label: '深度解题', description: '多步骤推理与问题解决', icon: Zap },
  { id: 'quiz_practice', label: '练习生成', description: '自动验证的题目生成', icon: BookOpen },
  { id: 'deep_research', label: '深度研究', description: '多智能体综合研究', icon: Microscope },
  { id: 'math_animator', label: '数学动画', description: '生成数学视频或分镜图', icon: Sparkles },
  { id: 'visualize', label: '可视化', description: '生成SVG、图表或Mermaid图形', icon: Zap },
];

// 空状态建议卡片
const SUGGESTION_CARDS = [
  { icon: Calculator, title: '解题', description: '逐步解答数学问题', prompt: '帮我解这道数学题，请给出详细步骤' },
  { icon: BookOpen, title: '概念讲解', description: '深入理解任何知识点', prompt: '用简单的话解释量子力学' },
  { icon: Code2, title: '代码辅助', description: '生成和调试代码', prompt: '写一个 Python 函数来排序列表' },
  { icon: Microscope, title: '深度研究', description: '多维度综合分析', prompt: '研究人工智能的最新发展' },
  { icon: Sparkles, title: '可视化', description: '生成图表和示意图', prompt: '创建一个机器学习流程图' },
  { icon: Lightbulb, title: '头脑风暴', description: '激发创意灵感', prompt: '为科学项目头脑风暴一些创意' },
];

// 快速提示
const QUICK_PROMPTS = [
  '解释光合作用',
  '帮我写一篇作文',
  '解这个方程：2x + 5 = 15',
  '气候变化的原因是什么？',
  '神经网络是如何工作的？',
];

const CHAT_TOOLS: ToolDef[] = [
  { id: 'brainstorm', label: '头脑风暴', description: '生成发散性想法和角度', icon: Lightbulb },
  { id: 'rag', label: '知识检索', description: '从学习笔记和知识库中检索', icon: Database },
  { id: 'web_search', label: '网络搜索', description: '搜索最新的网络信息', icon: Globe },
  { id: 'code_execution', label: '代码执行', description: '运行代码进行计算或验证', icon: Code2 },
  { id: 'reason', label: '深度推理', description: '进行更深层次的多步推理', icon: Brain },
  { id: 'paper_search', label: '论文搜索', description: '搜索学术论文', icon: FileSearch },
];

const TOOL_CONFIG_BY_CAPABILITY: Record<CapabilityId, { allowedTools: TutorToolName[]; defaultTools: TutorToolName[] }> = {
  '': {
    allowedTools: ['brainstorm', 'rag', 'web_search', 'code_execution', 'reason', 'paper_search'],
    defaultTools: [],
  },
  deep_solve: {
    allowedTools: ['rag', 'web_search', 'code_execution', 'reason'],
    defaultTools: ['rag', 'web_search', 'code_execution', 'reason'],
  },
  quiz_practice: {
    allowedTools: ['rag', 'web_search', 'code_execution'],
    defaultTools: ['rag', 'web_search', 'code_execution'],
  },
  deep_research: {
    allowedTools: [],
    defaultTools: [],
  },
  math_animator: {
    allowedTools: [],
    defaultTools: [],
  },
  visualize: {
    allowedTools: [],
    defaultTools: [],
  },
};

const STORAGE_KEY = 'anotherme:ai-tutor:sessions:v1';
const LEGACY_STORAGE_KEY = 'openmaic:ai-tutor:sessions:v1';
const MAX_SESSIONS = 40;

const AI_TUTOR_DETAILED_SYSTEM_PROMPT = `You are a detailed AI tutor. Use "in-depth explanation mode" by default:
- Start with the conclusion, then explain the principle, give examples, show common mistakes, and provide practice problems
- Answer in detail unless I explicitly say "brief"
- For key concepts, explain the definition, purpose, boundary conditions, and comparisons
- For step-by-step problems, show all steps without skipping
- End your response with: "You can ask me 3 more questions"
- Always respond in Chinese (Simplified) regardless of the language used in these instructions`;

function parseSSEChunk(buffer: string) {
  const events: string[] = [];
  let rest = buffer;
  while (true) {
    const separatorIndex = rest.indexOf('\n\n');
    if (separatorIndex < 0) break;
    const one = rest.slice(0, separatorIndex);
    rest = rest.slice(separatorIndex + 2);
    events.push(one);
  }
  return { events, rest };
}

async function parseApiError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string; details?: string };
    return payload.error || payload.details || '';
  } catch {
    return await response.text();
  }
}

function sessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createSession(): TutorSession {
  const now = new Date().toISOString();
  return {
    id: sessionId(),
    title: '新会话',
    autoTitle: true,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function deriveSessionTitle(messages: TutorMessage[]): string {
  const firstUser = messages.find((item) => item.role === 'user' && item.content.trim());
  if (!firstUser) return '新会话';
  const normalized = firstUser.content.replace(/\s+/g, ' ').trim();
  return normalized.length > 20 ? `${normalized.slice(0, 20)}...` : normalized;
}

function safeParseSessions(raw: string | null): TutorSession[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as TutorSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === 'string' && Array.isArray(item.messages))
      .map((item) => ({
        id: item.id,
        title: typeof item.title === 'string' && item.title.trim() ? item.title : '新会话',
        autoTitle: Boolean(item.autoTitle),
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
        messages: item.messages
          .filter((msg) => msg && typeof msg.id === 'string')
          .map((msg) => {
            const rawMessage = msg as Record<string, unknown>;
            return {
              id: rawMessage.id as string,
              role: rawMessage.role === 'assistant' ? 'assistant' : 'user',
              content: typeof rawMessage.content === 'string' ? rawMessage.content : '',
              capability: asCapabilityId(rawMessage.capability),
              feedback: asFeedback(rawMessage.feedback),
              toolTraces: parseToolTraces(rawMessage.toolTraces),
              capabilityResult: asRecord(rawMessage.capabilityResult),
            };
          }),
      }));
  } catch {
    return [];
  }
}

function formatSessionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function extractSvgPreview(content: string): string | null {
  const fenced = content.match(/```svg\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || content.match(/<svg[\s\S]*?<\/svg>/i)?.[0];
  if (!candidate) return null;

  const svg = candidate.trim();
  if (!/^<svg[\s>]/i.test(svg)) return null;
  return svg;
}

function buildSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function stringifyEventValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function asTutorToolName(value: unknown): TutorToolName | null {
  if (typeof value !== 'string') return null;
  return CHAT_TOOLS.some((tool) => tool.id === value) ? (value as TutorToolName) : null;
}

function asCapabilityId(value: unknown): CapabilityId | undefined {
  if (value === '') return '';
  if (typeof value !== 'string') return undefined;
  return CAPABILITIES.some((capability) => capability.id === value)
    ? (value as CapabilityId)
    : undefined;
}

function asFeedback(value: unknown): TutorMessage['feedback'] {
  return value === 'up' || value === 'down' || value === null ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseToolTraces(value: unknown): TutorToolTrace[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const traces = value
    .map((trace): TutorToolTrace | null => {
      if (!trace || typeof trace !== 'object') return null;
      const item = trace as Record<string, unknown>;
      const toolName = asTutorToolName(item.toolName);
      const status = item.status;
      const startTime = item.startTime;
      if (
        !toolName ||
        (status !== 'running' && status !== 'success' && status !== 'error') ||
        typeof item.id !== 'string' ||
        typeof startTime !== 'number'
      ) {
        return null;
      }

      return {
        id: item.id,
        toolName,
        status,
        startTime,
        endTime: typeof item.endTime === 'number' ? item.endTime : undefined,
        output: typeof item.output === 'string' ? item.output : undefined,
        error: typeof item.error === 'string' ? item.error : undefined,
      };
    })
    .filter((trace): trace is TutorToolTrace => Boolean(trace));

  return traces.length ? traces : undefined;
}

function getDefaultTools(capability: CapabilityId): TutorToolName[] {
  return [...TOOL_CONFIG_BY_CAPABILITY[capability].defaultTools];
}

function extractQuizPreviewQuestions(result: Record<string, unknown> | undefined): QuizPreviewQuestion[] {
  const output = result?.output;
  if (!output || typeof output !== 'object') return [];

  const questions = (output as Record<string, unknown>).questions;
  if (!Array.isArray(questions)) return [];

  return questions
    .map((item): QuizPreviewQuestion | null => {
      if (!item || typeof item !== 'object') return null;
      const question = item as Record<string, unknown>;
      const title = typeof question.question === 'string' ? question.question.trim() : '';
      const answer = typeof question.answer === 'string' ? question.answer.trim() : '';
      if (!title || !answer) return null;

      return {
        question: title,
        options: Array.isArray(question.options)
          ? question.options.filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
          : undefined,
        answer,
        explanation: typeof question.explanation === 'string' ? question.explanation : undefined,
        difficulty: typeof question.difficulty === 'string' ? question.difficulty : undefined,
      };
    })
    .filter((item): item is QuizPreviewQuestion => Boolean(item));
}

function getCapabilityOutput(result: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const output = result?.output;
  return output && typeof output === 'object' ? (output as Record<string, unknown>) : null;
}

function extractVisualizePreview(result: Record<string, unknown> | undefined): VisualizePreviewData | null {
  const output = getCapabilityOutput(result);
  if (!output) return null;

  const format = typeof output.render_type === 'string'
    ? output.render_type
    : typeof output.format === 'string'
      ? output.format
      : 'svg';
  const preview = typeof output.preview === 'string' ? output.preview.trim() : '';
  const codeRaw = output.code;
  const code = typeof codeRaw === 'string'
    ? codeRaw.trim()
    : codeRaw && typeof codeRaw === 'object' && typeof (codeRaw as Record<string, unknown>).content === 'string'
      ? String((codeRaw as Record<string, unknown>).content).trim()
      : '';
  const content = preview || code;

  if (!content) return null;
  return { format, content };
}

function extractMathAnimatorPreview(result: Record<string, unknown> | undefined): MathAnimatorPreviewData | null {
  const output = getCapabilityOutput(result);
  if (!output) return null;

  const storyboard = Array.isArray(output.storyboard)
    ? output.storyboard
        .map((item): { frame: number; description: string; code?: string } | null => {
          if (!item || typeof item !== 'object') return null;
          const frame = item as Record<string, unknown>;
          const description = typeof frame.description === 'string' ? frame.description.trim() : '';
          if (!description) return null;
          return {
            frame: typeof frame.frame === 'number' ? frame.frame : 0,
            description,
            code: typeof frame.code === 'string' ? frame.code : undefined,
          };
        })
        .filter((item): item is { frame: number; description: string; code?: string } => Boolean(item))
    : undefined;

  const artifacts = Array.isArray(output.artifacts)
    ? output.artifacts
        .map((item): { type: 'video' | 'image'; url: string; filename?: string; label?: string } | null => {
          if (!item || typeof item !== 'object') return null;
          const artifact = item as Record<string, unknown>;
          const type = artifact.type === 'image' ? 'image' : artifact.type === 'video' ? 'video' : null;
          const url = typeof artifact.url === 'string' ? artifact.url : '';
          if (!type || !url) return null;
          return {
            type,
            url,
            filename: typeof artifact.filename === 'string' ? artifact.filename : undefined,
            label: typeof artifact.label === 'string' ? artifact.label : undefined,
          };
        })
        .filter((item): item is { type: 'video' | 'image'; url: string; filename?: string; label?: string } => Boolean(item))
    : undefined;

  const codeRaw = output.code;
  const codeContent = typeof codeRaw === 'object' && codeRaw && typeof (codeRaw as Record<string, unknown>).content === 'string'
    ? String((codeRaw as Record<string, unknown>).content)
    : undefined;
  const render = output.render && typeof output.render === 'object' ? output.render as Record<string, unknown> : undefined;
  const toolArtifacts = output.toolArtifacts && typeof output.toolArtifacts === 'object'
    ? output.toolArtifacts as Record<string, unknown>
    : undefined;

  const preview: MathAnimatorPreviewData = {
    response: typeof output.response === 'string' ? output.response : undefined,
    outputUrl: typeof output.outputUrl === 'string' ? output.outputUrl : undefined,
    artifacts,
    storyboard,
    manimCode: typeof output.manimCode === 'string' ? output.manimCode : codeContent,
    renderError: typeof render?.renderError === 'string'
      ? render.renderError
      : typeof toolArtifacts?.renderError === 'string'
        ? toolArtifacts.renderError
        : undefined,
  };

  if (preview.outputUrl || preview.artifacts?.length || preview.storyboard?.length || preview.manimCode || preview.renderError) {
    return preview;
  }

  if (preview.response) {
    return { ...preview, renderError: '未生成可渲染动画结果。' };
  }

  return null;
}

function VisualPreview({ content }: { content: string }) {
  const svg = extractSvgPreview(content);
  if (!svg) return null;

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#201c18]">
      <div className="border-b border-gray-200 dark:border-gray-700 px-3 py-2 text-[12px] font-medium text-gray-600 dark:text-gray-400">
        可视化预览
      </div>
      <div className="flex justify-center bg-white dark:bg-[#171411] p-3">
        <img
          src={buildSvgDataUrl(svg)}
          alt="AI 生成的可视化图形"
          className="max-h-[420px] w-full max-w-full object-contain"
        />
      </div>
    </div>
  );
}

function VisualizeResultPreview({ result }: { result?: Record<string, unknown> }) {
  const preview = extractVisualizePreview(result);
  if (!preview) return null;

  const normalizedFormat = preview.format.toLowerCase();
  const isSvg = normalizedFormat === 'svg' || preview.content.trim().startsWith('<svg');
  const isHtml = normalizedFormat === 'html' || preview.content.trim().startsWith('<!doctype') || preview.content.trim().startsWith('<html');

  if (isSvg) {
    const svg = preview.content.includes('</svg>')
      ? preview.content.slice(preview.content.indexOf('<svg'), preview.content.lastIndexOf('</svg>') + 6)
      : preview.content;

    return (
      <div className="mb-3 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#201c18]">
        <div className="border-b border-gray-200 dark:border-gray-700 px-3 py-2 text-[12px] font-medium text-gray-600 dark:text-gray-400">
          可视化预览
        </div>
        <div className="flex justify-center bg-white dark:bg-[#171411] p-3">
          <img
            src={buildSvgDataUrl(svg)}
            alt="AI 生成的可视化图形"
            className="max-h-[460px] w-full max-w-full object-contain"
          />
        </div>
      </div>
    );
  }

  if (isHtml) {
    return (
      <div className="mb-3 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#201c18]">
        <div className="border-b border-gray-200 dark:border-gray-700 px-3 py-2 text-[12px] font-medium text-gray-600 dark:text-gray-400">
          可视化预览
        </div>
        <iframe
          title="AI 生成的可视化图形"
          sandbox=""
          srcDoc={preview.content}
          className="h-[460px] w-full bg-white dark:bg-[#171411]"
        />
      </div>
    );
  }

  return (
    <pre className="mb-3 max-h-[420px] overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-950 p-3 text-[11px] text-gray-100">
      {preview.content}
    </pre>
  );
}

function MathAnimatorPreview({ result }: { result?: Record<string, unknown> }) {
  const preview = extractMathAnimatorPreview(result);
  if (!preview) return null;
  const videos = [
    ...(preview.outputUrl ? [{ type: 'video' as const, url: preview.outputUrl, label: 'Video Output' }] : []),
    ...(preview.artifacts || []).filter((item) => item.type === 'video'),
  ];
  const images = (preview.artifacts || []).filter((item) => item.type === 'image');

  return (
    <div className="space-y-3">
      {videos.length > 0 ? (
        <div className="space-y-2">
          {videos.map((video, index) => (
            <div key={`${video.url}-${index}`} className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-black">
              <video controls playsInline preload="metadata" src={video.url} className="aspect-video max-h-[520px] w-full object-contain" />
            </div>
          ))}
        </div>
      ) : null}

      {images.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {images.map((image, index) => (
            <div key={`${image.url}-${index}`} className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#201c18]">
              <img src={image.url} alt={image.label || image.filename || 'Math animation output'} className="max-h-[320px] w-full object-contain" />
            </div>
          ))}
        </div>
      ) : null}

      {preview.storyboard?.length ? (
        <div className="space-y-2">
          {preview.storyboard.map((frame, index) => (
            <div key={`${frame.frame}-${index}`} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#201c18] p-3">
              <div className="mb-1 text-[11px] font-semibold text-orange-700 dark:text-orange-400">
                第{frame.frame || index + 1}帧
              </div>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">{frame.description}</p>
              {frame.code ? (
                <pre className="mt-2 max-h-[180px] overflow-auto rounded-lg bg-gray-950 p-2 text-[10px] text-gray-100">
                  {frame.code}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {!videos.length && !images.length && preview.renderError ? (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
          动画渲染失败：{preview.renderError}
        </div>
      ) : null}

      {preview.manimCode ? (
        <details className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#201c18] p-3">
          <summary className="cursor-pointer text-[12px] font-semibold text-gray-700 dark:text-gray-300">Manim 代码</summary>
          <pre className="mt-2 max-h-[260px] overflow-auto rounded-lg bg-gray-950 p-3 text-[10px] text-gray-100">
            {preview.manimCode}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function QuizPreview({ questions }: { questions: QuizPreviewQuestion[] }) {
  if (!questions.length) return null;

  return (
    <div className="space-y-3">
      {questions.map((question, index) => (
        <details
          key={`${question.question}-${index}`}
          className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#201c18] p-3 text-left"
        >
          <summary className="cursor-pointer list-none">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 rounded-md bg-orange-100 dark:bg-orange-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 dark:text-orange-400">
                Q{index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold leading-relaxed text-gray-800 dark:text-gray-100">
                  {question.question}
                </div>
                {question.difficulty ? (
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    {question.difficulty}
                  </div>
                ) : null}
              </div>
            </div>
          </summary>

          {question.options?.length ? (
            <div className="mt-3 space-y-1.5">
              {question.options.map((option, optionIndex) => (
                <div
                  key={`${option}-${optionIndex}`}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#171411] px-2.5 py-2 text-[12px] text-gray-700 dark:text-gray-300"
                >
                  <span className="mr-1.5 font-semibold text-gray-400 dark:text-gray-500">
                    {String.fromCharCode(65 + optionIndex)}.
                  </span>
                  {option}
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-3 rounded-lg border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-2 text-[12px] leading-relaxed text-emerald-800 dark:text-emerald-300">
            <div className="font-semibold">答案：{question.answer}</div>
            {question.explanation ? <div className="mt-1 text-emerald-700 dark:text-emerald-400">{question.explanation}</div> : null}
          </div>
        </details>
      ))}
    </div>
  );
}

// 思考过程可折叠组件
function ReasoningBlock({ reasoning, isStreaming = false }: { reasoning: string; isStreaming?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={`mb-3 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-900/20 overflow-hidden animate-thinking-enter ${isStreaming ? 'animate-border-glow' : ''}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <BrainWaveLoader size={16} />
          ) : (
            <Sparkles className="w-4 h-4 text-amber-500" />
          )}
          <span className={`text-sm font-medium ${isStreaming ? 'thinking-text-shimmer text-transparent' : 'text-amber-800 dark:text-amber-200'}`}>
            {isStreaming ? '思考中' : '思考过程'}
          </span>
          {isStreaming && (
            <span className="flex items-center gap-0.5">
              <span className="neural-dot inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="neural-dot inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="neural-dot inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        )}
      </button>
      {isExpanded && (
        <div className="px-4 pb-3">
          <p className="text-sm text-amber-700 dark:text-amber-300/80 leading-relaxed whitespace-pre-wrap">
            {reasoning}
          </p>
        </div>
      )}
    </div>
  );
}

// 将内部 TutorToolTrace 转换为 ToolTracePanel 需要的格式
function toToolExecutionTraces(traces?: TutorToolTrace[]): import('@/features/ai-tutor/components/chat/tool-trace-panel').ToolExecutionTrace[] {
  if (!traces) return [];
  return traces.map((t) => ({
    id: t.id,
    toolName: t.toolName,
    status: t.status,
    startTime: t.startTime,
    endTime: t.endTime,
    output: t.output,
    error: t.error,
  }));
}

export default function AITutorPage() {
  const [sessions, setSessions] = useState<TutorSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [activeCapability, setActiveCapability] = useState<CapabilityId>('');
  const [selectedTools, setSelectedTools] = useState<TutorToolName[]>(getDefaultTools(''));
  const [useAgenticPipeline, setUseAgenticPipeline] = useState(true);
  const [showCapabilityMenu, setShowCapabilityMenu] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isUserScrollingRef = useRef(false);

  const orderedSessions = useMemo(
    () => [...sessions].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    [sessions],
  );

  const activeSession = useMemo(
    () => sessions.find((item) => item.id === activeSessionId) || null,
    [sessions, activeSessionId],
  );

  const messages = useMemo(() => activeSession?.messages || [], [activeSession]);

  const currentCap = CAPABILITIES.find((c) => c.id === activeCapability) || CAPABILITIES[0];
  const toolConfig = TOOL_CONFIG_BY_CAPABILITY[activeCapability];
  const visibleTools = CHAT_TOOLS.filter((tool) => toolConfig.allowedTools.includes(tool.id));
  const _selectedToolLabels = visibleTools
    .filter((tool) => selectedTools.includes(tool.id))
    .map((tool) => tool.label);

  useEffect(() => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    const savedSessions = safeParseSessions(
      localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY),
    );
    if (savedSessions.length > 0) {
      const sorted = [...savedSessions].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
      setSessions(sorted.slice(0, MAX_SESSIONS));
      setActiveSessionId(sorted[0].id);
      setHydrated(true);
      return;
    }
    const initial = createSession();
    setSessions([initial]);
    setActiveSessionId(initial.id);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }, [hydrated, sessions]);

  useEffect(() => {
    if (!activeSessionId && orderedSessions[0]?.id) {
      setActiveSessionId(orderedSessions[0].id);
      return;
    }
    if (activeSessionId && !sessions.some((item) => item.id === activeSessionId)) {
      setActiveSessionId(orderedSessions[0]?.id || '');
    }
  }, [activeSessionId, orderedSessions, sessions]);

  // 检测用户是否在底部附近
  const isNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 100; // 距离底部100px内视为在底部
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  // 智能滚动：只有用户在底部时才自动滚动
  const smartScrollToBottom = useCallback(() => {
    if (isUserScrollingRef.current) return;
    if (isNearBottom()) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isNearBottom]);

  // 手动滚动到底部
  const scrollToBottom = useCallback(() => {
    isUserScrollingRef.current = false;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setShowScrollToBottom(false);
  }, []);

  // 处理滚动事件 - 用户主动滚动时暂停自动滚动并显示返回底部按钮
  const handleScroll = useCallback(() => {
    isUserScrollingRef.current = true;
    setShowScrollToBottom(!isNearBottom());
  }, [isNearBottom]);

  useEffect(() => {
    smartScrollToBottom();
  }, [messages, smartScrollToBottom]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const updateSessionMessages = useCallback(
    (targetSessionId: string, updater: (prev: TutorMessage[]) => TutorMessage[]) => {
      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== targetSessionId) return session;
          const nextMessages = updater(session.messages);
          const nextTitle = session.autoTitle ? deriveSessionTitle(nextMessages) : session.title;
          return {
            ...session,
            messages: nextMessages,
            title: nextTitle || '新会话',
            updatedAt: new Date().toISOString(),
          };
        }),
      );
    },
    [],
  );

  const toRequestMessages = (list: TutorMessage[]): ChatRequestMessage[] => {
    return list.map((item) => ({
      id: item.id,
      role: item.role,
      parts: [{ type: 'text', text: item.content }],
    }));
  };

  const handleNewSession = () => {
    if (isTyping) return;
    abortControllerRef.current?.abort();
    const next = createSession();
    setSessions((prev) => [next, ...prev].slice(0, MAX_SESSIONS));
    setActiveSessionId(next.id);
    setErrorText('');
    setInput('');
  };

  const _handleRenameSession = () => {
    if (!activeSession || isTyping) return;
    const nextTitle = window.prompt('请输入新标题', activeSession.title)?.trim();
    if (!nextTitle) return;
    setSessions((prev) =>
      prev.map((session) =>
        session.id === activeSession.id
          ? { ...session, title: nextTitle, autoTitle: false, updatedAt: new Date().toISOString() }
          : session,
      ),
    );
  };

  const _handleClearCurrent = () => {
    if (!activeSession || isTyping) return;
    if (!window.confirm('确定清空当前会话记录吗？')) return;
    setSessions((prev) =>
      prev.map((session) =>
        session.id === activeSession.id
          ? { ...session, messages: [], autoTitle: true, title: '新会话', updatedAt: new Date().toISOString() }
          : session,
      ),
    );
    setErrorText('');
  };

  const handleClearAll = () => {
    if (isTyping) return;
    if (!window.confirm('确定清空全部历史会话吗？')) return;
    abortControllerRef.current?.abort();
    const fresh = createSession();
    setSessions([fresh]);
    setActiveSessionId(fresh.id);
    setInput('');
    setErrorText('');
  };

  const handleDeleteSession = (sessionId: string) => {
    if (isTyping) return;
    if (!window.confirm('确定删除该会话吗？')) return;
    abortControllerRef.current?.abort();
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionId);
      if (next.length === 0) {
        const fresh = createSession();
        return [fresh];
      }
      return next;
    });
    if (activeSessionId === sessionId) {
      const remaining = sessions.filter((s) => s.id !== sessionId);
      const nextActive = remaining.length > 0 ? remaining[0].id : '';
      setActiveSessionId(nextActive);
    }
  };

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
  };

  const handleCapabilitySelect = (capability: CapabilityId) => {
    setActiveCapability(capability);
    setSelectedTools(getDefaultTools(capability));
    setShowCapabilityMenu(false);
    setShowToolsMenu(false);
  };

  const handleToggleTool = (tool: TutorToolName) => {
    if (!toolConfig.allowedTools.includes(tool)) return;
    setSelectedTools((prev) =>
      prev.includes(tool) ? prev.filter((item) => item !== tool) : [...prev, tool],
    );
  };

  const handleEditMessage = (messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setEditingContent(content);
  };

  const handleSaveEdit = () => {
    if (!editingMessageId || !activeSession) return;
    updateSessionMessages(activeSession.id, (prev) =>
      prev.map((msg) => (msg.id === editingMessageId ? { ...msg, content: editingContent } : msg)),
    );
    setEditingMessageId(null);
    setEditingContent('');
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingContent('');
  };

  const handleRetry = async (messageId: string) => {
    if (isTyping || !activeSession) return;
    const messageIndex = activeSession.messages.findIndex((msg) => msg.id === messageId);
    if (messageIndex === -1 || messageIndex === 0) return;
    const userMessage = activeSession.messages[messageIndex - 1];
    if (!userMessage || userMessage.role !== 'user') return;
    const messagesToKeep = activeSession.messages.slice(0, messageIndex);
    updateSessionMessages(activeSession.id, () => messagesToKeep);
    await handleSend(userMessage.content);
  };

  const handleFeedback = (messageId: string, feedback: 'up' | 'down' | null) => {
    if (!activeSession) return;
    updateSessionMessages(activeSession.id, (prev) =>
      prev.map((msg) => (msg.id === messageId ? { ...msg, feedback } : msg)),
    );
  };

  const handleSend = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isTyping || !activeSession) return;

    const targetSessionId = activeSession.id;
    const userMessage: TutorMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };
    const assistantId = `assistant-${Date.now() + 1}`;
    const assistantPlaceholder: TutorMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      capability: activeCapability,
    };

    const snapshotMessages = [...activeSession.messages, userMessage, assistantPlaceholder];
    updateSessionMessages(targetSessionId, () => snapshotMessages);
    setInput('');
    setIsTyping(true);
    setErrorText('');

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    let assistantContent = '';
    const deltaQueue: string[] = [];
    let hasStructuredResult = false;
    const structuredOnlyCapability = activeCapability === 'math_animator'
      || activeCapability === 'visualize'
      || activeCapability === 'quiz_practice';

    const renderAssistant = () => {
      updateSessionMessages(targetSessionId, (prev) =>
        prev.map((msg) => (msg.id === assistantId ? { ...msg, content: assistantContent } : msg)),
      );
    };

    const appendToolEvent = (event: ChatApiEvent) => {
      const toolName = asTutorToolName(event.data?.toolName);
      if (!toolName) return;
      const toolId = typeof event.data?.toolId === 'string'
        ? event.data.toolId
        : `${toolName}-${Date.now()}`;
      const now = Date.now();

      updateSessionMessages(targetSessionId, (prev) =>
        prev.map((msg) => {
          if (msg.id !== assistantId) return msg;
          const traces = msg.toolTraces || [];

          if (event.type === 'tool_start') {
            if (traces.some((trace) => trace.id === toolId)) {
              return {
                ...msg,
                toolTraces: traces.map((trace) =>
                  trace.id === toolId ? { ...trace, status: 'running' as const } : trace,
                ),
              };
            }
            return {
              ...msg,
              toolTraces: [...traces, { id: toolId, toolName, status: 'running', startTime: now }],
            };
          }

          const success = event.data?.success !== false;
          const output = stringifyEventValue(event.data?.output);
          const error = stringifyEventValue(event.data?.error);
          const nextTrace: TutorToolTrace = {
            id: toolId,
            toolName,
            status: success ? 'success' : 'error',
            startTime: now,
            endTime: now,
            output,
            error,
          };

          if (!traces.some((trace) => trace.id === toolId)) {
            return { ...msg, toolTraces: [...traces, nextTrace] };
          }

          return {
            ...msg,
            toolTraces: traces.map((trace) =>
              trace.id === toolId
                ? {
                    ...trace,
                    status: success ? 'success' : 'error',
                    endTime: now,
                    output,
                    error,
                  }
                : trace,
            ),
          };
        }),
      );
    };

    const flushDelta = (budget = 2) => {
      let remaining = budget;
      let changed = false;
      while (remaining > 0 && deltaQueue.length > 0) {
        const chunk = deltaQueue[0];
        if (!chunk) {
          deltaQueue.shift();
          continue;
        }
        const take = Math.min(remaining, chunk.length);
        assistantContent += chunk.slice(0, take);
        remaining -= take;
        changed = true;
        if (take >= chunk.length) {
          deltaQueue.shift();
        } else {
          deltaQueue[0] = chunk.slice(take);
        }
      }
      if (changed) renderAssistant();
      return changed;
    };

    const streamTimer = window.setInterval(() => {
      flushDelta(2);
    }, 18);

    try {
      const modelConfig = getCurrentModelConfig();
      const isCapabilityMode = activeCapability !== '';
      const apiEndpoint = isCapabilityMode ? `/api/capabilities/${activeCapability}` : '/api/chat';

      const requestBody = isCapabilityMode
        ? {
            message: trimmed,
            messages: toRequestMessages(snapshotMessages.slice(0, -1)),
            enabledTools: selectedTools,
            ...(activeCapability === 'math_animator'
              ? { outputFormat: 'video', tts: { enabled: false } }
              : {}),
            apiKey: modelConfig.apiKey || '',
            baseUrl: modelConfig.baseUrl || undefined,
            model: modelConfig.modelString || undefined,
            providerType: modelConfig.providerType || undefined,
            requiresApiKey: modelConfig.requiresApiKey,
          }
        : {
            messages: toRequestMessages(snapshotMessages.slice(0, -1)),
            storeState: { stage: null, scenes: [], currentSceneId: null, mode: 'autonomous', whiteboardOpen: false },
            config: {
              agentIds: [UNIFIED_MENTOR_PRESET.id],
              sessionType: 'qa',
              systemPromptAddendum: AI_TUTOR_DETAILED_SYSTEM_PROMPT,
              enabledTutorTools: selectedTools,
              tutorToolConfig: {},
              useAgenticPipeline: selectedTools.length > 0 ? useAgenticPipeline : false,
            },
            persistence: {
              enabled: true,
              sessionId: targetSessionId,
              title: activeSession.title || 'AI 导师对话',
              source: 'ai_tutor',
              latestUserMessageId: userMessage.id,
            },
            apiKey: modelConfig.apiKey || '',
            baseUrl: modelConfig.baseUrl || undefined,
            model: modelConfig.modelString || undefined,
            providerType: modelConfig.providerType || undefined,
            requiresApiKey: modelConfig.requiresApiKey,
          };

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errText = await parseApiError(response);
        throw new Error(errText || 'AI 导师服务暂时不可用。');
      }
      if (!response.body) {
        throw new Error('AI 导师服务未返回可读取的流。');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let rawBuffer = '';

      const processEventBlocks = (blocks: string[]) => {
        for (const block of blocks) {
          const dataLines = block
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('data:'));
          for (const line of dataLines) {
            const payloadText = line.replace(/^data:\s*/, '');
            if (!payloadText) continue;
            let event: ChatApiEvent;
            try {
              event = JSON.parse(payloadText) as ChatApiEvent;
            } catch {
              continue;
            }
            if (event.type === 'text_delta') {
              const delta = typeof event.data?.content === 'string' ? event.data.content : '';
              if (delta && !structuredOnlyCapability) deltaQueue.push(delta);
            }
            if (event.type === 'thinking') {
              const content = typeof event.data?.content === 'string' ? event.data.content : '';
              if (content && !structuredOnlyCapability) {
                // 将思考内容累积到 reasoning 字段
                updateSessionMessages(targetSessionId, (prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId
                      ? { ...msg, reasoning: (msg.reasoning || '') + content }
                      : msg,
                  ),
                );
              }
            }
            if (event.type === 'code_delta') {
              const code = typeof event.data?.code === 'string' ? event.data.code : '';
              if (code && !structuredOnlyCapability) deltaQueue.push(code);
            }
            if (event.type === 'text_end' && structuredOnlyCapability) {
              continue;
            }
            if (event.type === 'tool_start' || event.type === 'tool_end') {
              appendToolEvent(event);
            }
            if (event.type === 'result') {
              const result = event.data && typeof event.data === 'object' ? event.data : {};
              if (structuredOnlyCapability) {
                hasStructuredResult = true;
                assistantContent = '';
                deltaQueue.length = 0;
              }
              updateSessionMessages(targetSessionId, (prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
                        content: structuredOnlyCapability ? '' : msg.content,
                        capabilityResult: result as Record<string, unknown>,
                      }
                    : msg,
                ),
              );
            }
            if (event.type === 'text_end') {
              const fullText = typeof event.data?.content === 'string' ? event.data.content : '';
              if (fullText) {
                const pendingText = `${assistantContent}${deltaQueue.join('')}`;
                if (fullText.startsWith(pendingText)) {
                  const tail = fullText.slice(pendingText.length);
                  if (tail) deltaQueue.push(tail);
                } else {
                  deltaQueue.length = 0;
                  assistantContent = fullText;
                  renderAssistant();
                }
              }
            }
            if (event.type === 'error') {
              const message = typeof event.data?.message === 'string' ? event.data.message : 'AI 导师返回错误。';
              throw new Error(message);
            }
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        rawBuffer += decoder.decode(value, { stream: true });
        const parsed = parseSSEChunk(rawBuffer);
        rawBuffer = parsed.rest;
        processEventBlocks(parsed.events);
      }

      rawBuffer += decoder.decode();
      const tailParsed = parseSSEChunk(rawBuffer);
      processEventBlocks(tailParsed.events);

      while (flushDelta(9999)) {
        // flush all remaining queued chars
      }

      if (!assistantContent.trim() && !(structuredOnlyCapability && hasStructuredResult)) {
        assistantContent = '收到请求，但当前没有返回文本结果。请检查模型配置后重试。';
        renderAssistant();
      }
    } catch (error) {
      if (controller.signal.aborted) {
        // switched session or new request; ignore aborted errors
      } else {
        setErrorText(error instanceof Error ? error.message : 'AI 导师请求失败。');
        updateSessionMessages(targetSessionId, (prev) =>
          prev.map((msg) =>
            msg.id === assistantId ? { ...msg, content: '请求失败，请检查后端模型配置是否可用。' } : msg,
          ),
        );
      }
    } finally {
      window.clearInterval(streamTimer);
      setIsTyping(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = '28px';
    const next = Math.max(el.scrollHeight, 28);
    const bounded = Math.min(next, 120);
    el.style.height = `${bounded}px`;
    el.style.overflowY = next > 120 ? 'auto' : 'hidden';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.shiftKey) {
      e.preventDefault();
      void handleSend(input);
    }
  };

  if (!hydrated || !activeSession) {
    return (
      <div className="h-[calc(100vh-4rem)] flex items-center justify-center text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        正在初始化 AI 导师...
      </div>
    );
  }

  return (
    <div className="fixed inset-0 left-64 flex bg-[#faf9f7] dark:bg-[#171411] overflow-hidden z-20">
      {/* 会话列表侧边栏 */}
      <aside className="bg-[#f5f4f2] dark:bg-[#1c1814] border-r border-gray-200/60 dark:border-gray-800/60 flex flex-col h-full overflow-hidden w-60 shrink-0">
        <div className="p-4 border-b border-gray-200/60 dark:border-gray-800/60">
          <button
            type="button"
            disabled={isTyping}
            onClick={handleNewSession}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-[#201c18] text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-[#2a241f] disabled:opacity-50 disabled:cursor-not-allowed transition-all border border-gray-200 dark:border-gray-800 shadow-sm w-full"
          >
            <Plus className="h-4 w-4" />
            <span>新对话</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-2">
          {orderedSessions.map((session) => {
            const active = session.id === activeSessionId;
            return (
              <div
                key={session.id}
                className={cn(
                  'group w-full text-left px-3 py-2.5 rounded-xl mb-1 transition-all text-sm flex items-center gap-2',
                  active
                    ? 'bg-white dark:bg-[#201c18] text-gray-900 dark:text-gray-100 shadow-sm border border-gray-200/80 dark:border-gray-800/80'
                    : 'hover:bg-white/60 dark:hover:bg-white/5 text-gray-600 dark:text-gray-400',
                )}
              >
                <button
                  type="button"
                  disabled={isTyping}
                  onClick={() => setActiveSessionId(session.id)}
                  className="flex-1 min-w-0 text-left disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <p className="font-medium truncate">{session.title}</p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{formatSessionTime(session.updatedAt)}</p>
                </button>
                <button
                  type="button"
                  disabled={isTyping}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteSession(session.id);
                  }}
                  className="shrink-0 p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-0"
                  title="删除会话"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="p-3 border-t border-gray-200/60 dark:border-gray-800/60 space-y-1">
          <button
            type="button"
            disabled={isTyping}
            onClick={handleClearAll}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-[#201c18] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <Trash2 className="h-4 w-4" />
            <span>清空对话历史</span>
          </button>
        </div>
      </aside>

      {/* Main Chat Area */}
      <section className="flex-1 flex flex-col min-w-0 bg-[#faf9f7] dark:bg-[#171411] h-full overflow-hidden">
        {/* Top header bar - Fixed height */}
        <div className="h-14 flex items-center justify-between px-6 shrink-0 border-b border-gray-200/60 dark:border-gray-800/60 bg-[#faf9f7] dark:bg-[#171411]">
          <span className="text-[14px] font-semibold text-gray-800 dark:text-gray-100 tracking-tight">聊天</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewSession}
              disabled={isTyping}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-[#201c18] border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-[#2a241f] transition-colors shadow-sm disabled:opacity-50"
            >
              <NotebookPen className="h-3.5 w-3.5" />
              保存到笔记本
            </button>
            <button
              disabled={isTyping}
              className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-white dark:bg-[#201c18] border border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#2a241f] transition-colors shadow-sm disabled:opacity-50"
              title="通知"
            >
              <Bell className="h-4 w-4" />
            </button>
            <button
              disabled={isTyping}
              className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-white dark:bg-[#201c18] border border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-[#2a241f] transition-colors shadow-sm disabled:opacity-50"
              title="设置"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              onClick={handleNewSession}
              disabled={isTyping}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-white bg-[#2d2d2d] dark:bg-[#f1dfc5] dark:text-[#1a1612] rounded-lg hover:bg-black dark:hover:bg-[#e8d5b8] transition-colors shadow-sm disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              新对话
            </button>
          </div>
        </div>

        {/* Messages area - Flex-1 with internal scroll */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overflow-x-hidden min-h-0"
        >
          {messages.length === 0 ? (
            /* Empty state - Centered, no scroll */
            <div className="h-full flex flex-col items-center justify-center px-6 py-12">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white mb-4 shadow-xl shadow-indigo-500/20">
                  <Sparkles className="w-8 h-8" />
                </div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                  我们先从哪里开始呢？
                </h1>
                <p className="text-gray-500 dark:text-gray-400">
                  你的专属AI导师随时为你服务
                </p>
              </div>
            </div>
          ) : (
            <div className="w-full mx-auto py-6 px-4 lg:px-10 space-y-6">
              {messages.map((msg, index) => {
                // 如果是 AI 消息且内容为空且正在输入，跳过渲染（思考动画会单独显示）
                const isEmptyAssistant = msg.role === 'assistant' && !msg.content && isTyping && index === messages.length - 1;
                if (isEmptyAssistant) return null;

                return (
                  <div key={msg.id} className={cn('group/message flex gap-3 animate-thinking-enter', msg.role === 'user' && 'flex-row-reverse')} style={{ animationDelay: `${index * 50}ms` }}>
                    <div className="shrink-0">
                      {msg.role === 'user' ? (
                        <div className="h-8 w-8 rounded-full bg-[#2d2d2d] dark:bg-[#f1dfc5] flex items-center justify-center text-white dark:text-[#1a1612] text-xs font-semibold shadow-sm">
                          你
                        </div>
                      ) : (
                        <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-sm">
                          <Bot className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                    <div className={cn('flex-1 overflow-hidden', msg.role === 'user' ? 'text-right' : 'text-left')}>
                      <div
                        className={cn(
                          'inline-block px-4 py-3 rounded-2xl text-[14px] leading-relaxed max-w-full break-words',
                          msg.role === 'user'
                            ? 'bg-[#2d2d2d] dark:bg-[#f1dfc5] text-white dark:text-[#1a1612] rounded-br-sm'
                            : 'bg-white dark:bg-[#201c18] text-gray-800 dark:text-gray-100 rounded-bl-sm border border-gray-100 dark:border-gray-800 shadow-sm',
                        )}
                      >
                        {editingMessageId === msg.id && msg.role === 'user' ? (
                          <div className="flex flex-col gap-2">
                            <textarea
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              className="w-full min-h-[80px] bg-white/20 dark:bg-black/20 text-white dark:text-[#1a1612] rounded-lg px-3 py-2 text-sm outline-none resize-y placeholder:text-white/70 dark:placeholder:text-black/50"
                              autoFocus
                            />
                            <div className="flex gap-2 justify-end">
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                className="px-3 py-1.5 text-xs rounded-md bg-white/20 dark:bg-black/20 text-white dark:text-[#1a1612] hover:bg-white/30 dark:hover:bg-black/30"
                              >
                                取消
                              </button>
                              <button
                                type="button"
                                onClick={handleSaveEdit}
                                className="px-3 py-1.5 text-xs rounded-md bg-white dark:bg-[#2a241f] text-blue-600 dark:text-[#f1dfc5] hover:bg-gray-100 dark:hover:bg-[#332c25]"
                              >
                                保存
                              </button>
                            </div>
                          </div>
                        ) : msg.role === 'assistant' ? (
                          <div className="ai-tutor-markdown text-gray-800 dark:text-gray-100">
                            {msg.reasoning ? (
                              <ReasoningBlock
                                reasoning={msg.reasoning}
                                isStreaming={isTyping && index === messages.length - 1}
                              />
                            ) : null}
                            {msg.capability !== 'math_animator' && msg.capability !== 'visualize' && msg.capability !== 'quiz_practice' ? (
                              <ToolTracePanel traces={toToolExecutionTraces(msg.toolTraces)} isStreaming={isTyping && index === messages.length - 1} />
                            ) : null}
                            {(() => {
                              const quizQuestions = msg.capability === 'quiz_practice'
                                ? extractQuizPreviewQuestions(msg.capabilityResult)
                                : [];

                              if (quizQuestions.length > 0) {
                                return <QuizPreview questions={quizQuestions} />;
                              }

                              if (msg.capability === 'math_animator' && msg.capabilityResult) {
                                return <MathAnimatorPreview result={msg.capabilityResult} />;
                              }

                              if (msg.capability === 'visualize' && msg.capabilityResult) {
                                return <VisualizeResultPreview result={msg.capabilityResult} />;
                              }

                              return (
                                <>
                                  <VisualPreview content={msg.content} />
                                  <MarkdownRenderer content={msg.content} variant="prose" />
                                </>
                              );
                            })()}
                          </div>
                        ) : (
                          msg.content
                        )}
                      </div>
                    <div className={cn('flex gap-1 mt-2 opacity-0 group-hover/message:opacity-100 transition-opacity duration-200', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                      {msg.role === 'user' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleEditMessage(msg.id, msg.content)}
                            disabled={isTyping}
                            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50 flex items-center gap-1 text-xs transition-colors"
                            title="编辑"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopy(msg.content)}
                            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1 text-xs transition-colors"
                            title="复制"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleCopy(msg.content)}
                            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1 text-xs transition-colors"
                            title="复制"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRetry(msg.id)}
                            disabled={isTyping}
                            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50 flex items-center gap-1 text-xs transition-colors"
                            title="重试"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleFeedback(msg.id, msg.feedback === 'up' ? null : 'up')}
                            disabled={isTyping}
                            className={cn(
                              'p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 flex items-center gap-1 text-xs transition-colors',
                              msg.feedback === 'up' ? 'text-orange-600' : 'text-gray-400 hover:text-orange-600',
                            )}
                            title="点赞"
                          >
                            <ThumbsUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleFeedback(msg.id, msg.feedback === 'down' ? null : 'down')}
                            disabled={isTyping}
                            className={cn(
                              'p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 flex items-center gap-1 text-xs transition-colors',
                              msg.feedback === 'down' ? 'text-orange-600' : 'text-gray-400 hover:text-orange-600',
                            )}
                            title="点踩"
                          >
                            <ThumbsDown className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {isTyping && messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.content ? (
                <div className="flex gap-3 items-start animate-thinking-enter">
                  <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-sm shrink-0">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="bg-white dark:bg-[#201c18] border border-amber-200 dark:border-amber-800/50 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm animate-border-glow">
                    <div className="flex items-center gap-2.5 text-[14px] text-gray-700 dark:text-gray-200">
                      <BrainWaveLoader size={18} />
                      <span className="thinking-text-shimmer text-transparent">思考中</span>
                      <NeuralLoader size="sm" color="bg-amber-500" />
                    </div>
                  </div>
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* 滚动到底部按钮 */}
          {showScrollToBottom && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-4 right-6 z-10 flex items-center gap-1.5 px-3 py-2 rounded-full bg-white dark:bg-[#201c18] border border-gray-200 dark:border-gray-800 shadow-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#2a241f] hover:text-gray-900 dark:hover:text-gray-100 transition-all"
            >
              <ArrowDown className="w-3.5 h-3.5" />
              回到底部
            </button>
          )}
        </div>

        {/* Composer - Fixed height, no overflow */}
        <div className="px-4 pb-3 pt-2 shrink-0 border-t border-gray-200/60 dark:border-gray-800/60 bg-[#faf9f7] dark:bg-[#171411]">
          {errorText ? <p className="text-xs text-red-600 dark:text-red-400 mb-1.5 text-center">{errorText}</p> : null}

          <div className="w-full mx-auto px-4 lg:px-10">
            <div className="relative">
              {showCapabilityMenu && (
                <div className="absolute bottom-full left-0 z-50 mb-2 w-[280px] overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#201c18] shadow-lg">
                  {CAPABILITIES.map((cap) => {
                    const Icon = cap.icon;
                    const isActive = cap.id === activeCapability;
                    return (
                      <button
                        key={cap.id}
                        type="button"
                        onClick={() => handleCapabilitySelect(cap.id)}
                        className={cn(
                          'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-[#2a241f]',
                          isActive && 'bg-gray-50 dark:bg-[#2a241f]',
                        )}
                      >
                        <div className="mt-0.5 text-gray-500 dark:text-gray-400">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-semibold text-gray-800 dark:text-gray-100">{cap.label}</span>
                            {isActive ? <span className="h-1.5 w-1.5 rounded-full bg-orange-400" /> : null}
                          </div>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">{cap.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {showToolsMenu && (
                <div className="absolute bottom-full left-0 z-50 mb-2 w-[240px] overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#201c18] shadow-lg">
                  <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                    <h3 className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">工具</h3>
                  </div>

                  <div className="py-1.5">
                    {CHAT_TOOLS.map((tool) => {
                      const Icon = tool.icon;
                      const isSelected = selectedTools.includes(tool.id);
                      const isAllowed = toolConfig.allowedTools.includes(tool.id);
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          disabled={!isAllowed || isTyping}
                          onClick={() => {
                            if (!isAllowed) return;
                            handleToggleTool(tool.id);
                          }}
                          className={cn(
                            'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                            isAllowed
                              ? 'hover:bg-gray-50 dark:hover:bg-[#2a241f] text-gray-700 dark:text-gray-300'
                              : 'text-gray-300 dark:text-gray-600 cursor-not-allowed',
                          )}
                        >
                          <Icon className={cn('w-5 h-5', isAllowed ? 'text-gray-500' : 'text-gray-300 dark:text-gray-600')} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px]">{tool.label}</span>
                              {isSelected && isAllowed && <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />}
                            </div>
                            <div className="text-[11px] text-gray-400">{tool.description}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="relative rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#201c18] shadow-[0_1px_8px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_8px_rgba(0,0,0,0.2)]">
                {/* Textarea */}
                <div className="px-4 pt-2.5 pb-1.5">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    disabled={isTyping}
                    placeholder="今天我能帮你什么？"
                    className="w-full resize-none overflow-y-auto bg-transparent text-[14px] leading-relaxed text-gray-900 dark:text-gray-100 outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500 disabled:opacity-50"
                    style={{ transition: 'height 0.15s ease-out', minHeight: 24, maxHeight: 120 }}
                  />
                </div>

                {/* Bottom toolbar - Simplified style */}
                <div className="border-t border-gray-100 dark:border-gray-800 px-3 py-2">
                  <div className="flex items-center justify-between">
                    {/* Left: icon tools */}
                    <div className="flex items-center gap-0.5">
                      {/* Capability button */}
                      <button
                        type="button"
                        onClick={() => {
                          setShowCapabilityMenu(!showCapabilityMenu);
                          setShowToolsMenu(false);
                        }}
                        disabled={isTyping}
                        className={cn(
                          'inline-flex items-center gap-1 py-1.5 px-2 text-[11px] font-medium transition-colors disabled:opacity-40 rounded-lg',
                          showCapabilityMenu
                            ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
                        )}
                        title="能力模式"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{currentCap.label}</span>
                        <ChevronDown className={cn('w-3 h-3 transition-transform', showCapabilityMenu && 'rotate-180')} />
                      </button>

                      {/* Tools button */}
                      <button
                        type="button"
                        onClick={() => {
                          setShowToolsMenu(!showToolsMenu);
                          setShowCapabilityMenu(false);
                        }}
                        disabled={isTyping}
                        className={cn(
                          'inline-flex items-center gap-1 py-1.5 px-2 text-[11px] font-medium transition-colors rounded-lg',
                          showToolsMenu
                            ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
                        )}
                        title="工具"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        <span>工具</span>
                        <ChevronDown className={cn('w-3 h-3 transition-transform', showToolsMenu && 'rotate-180')} />
                      </button>

                      {/* Reference button */}
                      <button
                        type="button"
                        disabled={isTyping}
                        className="inline-flex items-center gap-1 py-1.5 px-2 text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 rounded-lg"
                        title="参考"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">参考</span>
                      </button>
                    </div>

                    {/* Right: send button */}
                    <button
                      type="button"
                      onClick={() => void handleSend(input)}
                      disabled={!input.trim() || isTyping}
                      className="flex items-center justify-center w-9 h-9 rounded-full bg-[#2d2d2d] dark:bg-[#f1dfc5] text-white dark:text-[#1a1612] shadow-lg transition-all hover:bg-black dark:hover:bg-[#e8d5b8] hover:shadow-xl hover:scale-105 disabled:opacity-30 disabled:shadow-none disabled:cursor-not-allowed disabled:hover:scale-100"
                      aria-label="发送"
                    >
                      <ArrowUp className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
