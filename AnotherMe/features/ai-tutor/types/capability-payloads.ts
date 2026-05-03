/**
 * 能力负载类型定义
 * 定义各个能力模块的请求和响应类型
 */

import type { LanguageModel } from 'ai';

// ============================================================
// Deep Solve - 深度解题
// ============================================================

export interface DeepSolvePayload {
  /** 用户问题 */
  message: string;
  /** 图片附件 */
  attachments?: Array<{
    type: 'image';
    data: string;
    mimeType?: string;
  }>;
  /** 启用的工具 */
  enabledTools?: Array<'rag' | 'web_search' | 'code_execution' | 'reason'>;
  /** 知识库列表 */
  knowledgeBases?: string[];
  /** 是否返回详细解答 */
  detailedAnswer?: boolean;
  /** 语言模型 */
  languageModel?: LanguageModel;
  /** 对话上下文 */
  conversationContext?: string;
}

export interface DeepSolveResult {
  success: boolean;
  response: string;
  stages: {
    planning?: string;
    reasoning?: string;
    writing?: string;
  };
  toolTraces: Array<{
    name: string;
    input: Record<string, unknown>;
    output: string;
    success: boolean;
  }>;
  error?: string;
}

// ============================================================
// Deep Research - 深度研究
// ============================================================

export type ResearchSource = 'kb' | 'web' | 'papers';
export type ResearchDepth = 'shallow' | 'medium' | 'deep';

export interface DeepResearchPayload {
  /** 研究主题 */
  topic: string;
  /** 数据来源 */
  sources: ResearchSource[];
  /** 研究深度 */
  depth: ResearchDepth;
  /** 知识库列表 */
  knowledgeBases?: string[];
  /** 语言模型 */
  languageModel?: LanguageModel;
  /** 已确认的大纲 */
  confirmedOutline?: OutlineItem[];
}

export interface OutlineItem {
  id: string;
  title: string;
  level: number;
  children?: OutlineItem[];
}

export interface DeepResearchResult {
  success: boolean;
  response: string;
  outline?: OutlineItem[];
  sources: Array<{
    title: string;
    url?: string;
    content: string;
    type: ResearchSource;
  }>;
  error?: string;
}

// ============================================================
// Math Animator - 数学动画
// ============================================================

export type MathAnimatorOutputFormat = 'video' | 'storyboard';
export type MathAnimatorStyle = 'default' | 'minimal' | 'colorful' | 'academic';

export interface MathAnimatorPayload {
  /** 数学概念描述 */
  concept: string;
  /** 输出格式 */
  outputFormat: MathAnimatorOutputFormat;
  /** 动画时长（秒） */
  duration?: number;
  /** 动画风格 */
  style?: MathAnimatorStyle;
  /** 参考图片 */
  referenceImages?: Array<{
    data: string;
    mimeType?: string;
  }>;
  /** 语言模型 */
  languageModel?: LanguageModel;
}

export interface MathAnimatorResult {
  success: boolean;
  response: string;
  output_mode?: 'video' | 'image';
  outputUrl?: string;
  storyboard?: Array<{
    frame: number;
    description: string;
    code?: string;
  }>;
  manimCode?: string;
  code?: {
    language: string;
    content: string;
  };
  artifacts?: Array<{
    type: 'video' | 'image';
    url: string;
    filename: string;
    content_type?: string;
    label?: string;
  }>;
  timings?: Record<string, number>;
  render?: {
    quality?: string;
    retry_attempts?: number;
    retry_history?: Array<{ attempt: number; error: string }>;
    renderError?: string;
  };
  error?: string;
}

// ============================================================
// Visualize - 可视化
// ============================================================

export type VisualizeFormat = 'svg' | 'chartjs' | 'mermaid' | 'html';

export interface VisualizePayload {
  /** 可视化描述 */
  description: string;
  /** 输出格式 */
  format: VisualizeFormat;
  /** 数据（可选） */
  data?: Record<string, unknown>;
  /** 语言模型 */
  languageModel?: LanguageModel;
  /** 尺寸配置 */
  size?: {
    width?: number;
    height?: number;
  };
}

export interface VisualizeResult {
  success: boolean;
  response: string;
  code?: string | {
    language: string;
    content: string;
  };
  render_type?: VisualizeFormat;
  preview?: string;
  format: VisualizeFormat;
  error?: string;
}

// ============================================================
// Quiz Practice - 测验练习
// ============================================================

export type QuizQuestionType = 'choice' | 'multiple' | 'short_answer' | 'coding';
export type QuizDifficulty = 'easy' | 'medium' | 'hard' | 'auto';

export interface QuizPracticePayload {
  /** 主题 */
  topic: string;
  /** 题目数量 */
  count?: number;
  /** 题目类型 */
  questionType?: QuizQuestionType;
  /** 难度 */
  difficulty?: QuizDifficulty;
  /** 知识库 */
  knowledgeBases?: string[];
  /** 语言模型 */
  languageModel?: LanguageModel;
}

export interface QuizQuestion {
  id: string;
  type: QuizQuestionType;
  question: string;
  options?: string[];
  answer: string;
  explanation?: string;
  difficulty: QuizDifficulty;
  knowledgePoints?: string[];
}

export interface QuizPracticeResult {
  success: boolean;
  questions: QuizQuestion[];
  error?: string;
}

// ============================================================
// 通用能力事件
// ============================================================

export type CapabilityStageName =
  | 'planning'
  | 'reasoning'
  | 'writing'
  | 'researching'
  | 'generating'
  | 'rendering'
  | 'analyzing';

export interface CapabilityStageEvent {
  type: 'stage_start' | 'stage_progress' | 'stage_end';
  stage: CapabilityStageName;
  message?: string;
  progress?: number;
}

export interface CapabilityToolEvent {
  type: 'tool_start' | 'tool_end';
  toolName: string;
  input?: Record<string, unknown>;
  output?: string;
  success?: boolean;
}

export interface CapabilityContentEvent {
  type: 'content';
  content: string;
}

export type CapabilityEvent =
  | CapabilityStageEvent
  | CapabilityToolEvent
  | CapabilityContentEvent;
