/**
 * AI导师工具执行层类型定义
 */

import type { LanguageModel } from 'ai';
import type { TutorToolName, TutorToolConfig } from '../../types/tutor-tools';

export interface ToolExecutionContext {
  /** 用户消息内容 */
  message: string;
  /** 工具配置 */
  config: TutorToolConfig;
  /** 当前舞台状态 */
  stage: unknown;
  /** 当前场景 */
  scenes: unknown[];
  /** API密钥 */
  apiKey: string;
  /** 基础URL */
  baseUrl?: string;
  /** 模型（字符串，向后兼容） */
  model?: string;
  /** 语言模型对象（推荐） */
  languageModel?: LanguageModel;
}

export interface ToolExecutionResult {
  /** 是否成功 */
  success: boolean;
  /** 工具输出内容 */
  output: string;
  /** 错误信息 */
  error?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

export interface TutorToolExecutor {
  name: TutorToolName;
  execute: (context: ToolExecutionContext) => Promise<ToolExecutionResult>;
}

/** 工具注册表 */
export type ToolRegistry = Map<TutorToolName, TutorToolExecutor>;
