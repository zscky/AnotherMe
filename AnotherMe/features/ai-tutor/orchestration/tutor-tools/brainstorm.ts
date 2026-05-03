/**
 * Brainstorm 工具 - 头脑风暴
 * 使用 LLM 进行发散式思考，生成创意点子
 */

import { generateText } from 'ai';
import type { ToolExecutionContext, ToolExecutionResult } from './types';

const BRAINSTORM_PROMPT = `你是一位创意激发专家。请针对用户的问题进行头脑风暴，生成多个不同的想法和角度。

要求：
1. 提供至少 5 个不同的思路或方向
2. 每个思路都要有简要的解释
3. 鼓励 unconventional 和非传统的想法
4. 使用中文回复

请按以下格式输出：

💡 思路一：[标题]
[详细描述]

💡 思路二：[标题]
[详细描述]

...以此类推`;

export async function executeBrainstorm(
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    const { message, model, languageModel } = context;

    // 优先使用 languageModel 对象，如果不可用则回退到字符串 model
    const modelParam = languageModel || model || 'gpt-4o-mini';

    const result = await generateText({
      model: modelParam as Parameters<typeof generateText>[0]['model'],
      messages: [
        { role: 'system', content: BRAINSTORM_PROMPT },
        { role: 'user', content: message },
      ],
      temperature: 0.9, // 高温度以获得更创意的输出
    });

    return {
      success: true,
      output: result.text || 'brainstorm 完成，但没有返回内容',
      metadata: {
        tool: 'brainstorm',
        temperature: 0.9,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : 'Brainstorm 执行失败',
    };
  }
}
