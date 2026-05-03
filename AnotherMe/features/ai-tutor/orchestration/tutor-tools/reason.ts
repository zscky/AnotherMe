/**
 * Reason 工具 - 深度推理
 * 使用 LLM 进行多步骤深度分析
 */

import { generateText } from 'ai';
import type { ToolExecutionContext, ToolExecutionResult } from './types';

const REASON_PROMPT = `你是一位深度思考专家。请针对用户的问题进行系统性、多步骤的深度分析。

分析框架：
1. 问题解构 - 将复杂问题分解为子问题
2. 前提假设 - 识别并检验关键假设
3. 多角度分析 - 从不同视角审视问题
4. 逻辑推理 - 逐步推导结论
5. 反思验证 - 检查推理过程的合理性

要求：
- 展示完整的思考过程
- 使用结构化格式（如编号、缩进）
- 标注每一步的推理依据
- 使用中文回复

请按以下步骤进行分析：`;

export async function executeReason(
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    const { message, model, languageModel } = context;

    // 优先使用 languageModel 对象，如果不可用则回退到字符串 model
    const modelParam = languageModel || model || 'gpt-4o';

    const result = await generateText({
      model: modelParam as Parameters<typeof generateText>[0]['model'],
      messages: [
        { role: 'system', content: REASON_PROMPT },
        { role: 'user', content: message },
      ],
      temperature: 0.3, // 低温度以获得更严谨的推理
    });

    return {
      success: true,
      output: result.text || '推理完成，但没有返回内容',
      metadata: {
        tool: 'reason',
        temperature: 0.3,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : 'Reason 执行失败',
    };
  }
}
