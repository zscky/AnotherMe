/**
 * Code Execution 工具 - 代码执行
 * 在沙箱环境中执行 Python 代码
 */

import { generateText } from 'ai';
import { executePythonCode } from '@/lib/server/code-exec';
import type { ToolExecutionContext, ToolExecutionResult } from './types';

interface CodeExecutionAPIResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  error?: string;
}

const CODE_GENERATION_PROMPT = `你是一位 Python 代码生成专家。

将用户的自然语言请求转换为可执行的 Python 代码。

规则：
1. 只输出 Python 代码，不要包含 markdown 代码块标记或解释
2. 优先使用标准库，可以使用 numpy、pandas、matplotlib、scipy、sympy 等常见包
3. 将最终结果打印到 stdout
4. 代码应该简洁、安全、可执行
5. 使用中文注释

注意：代码将在受限环境中执行，禁止访问文件系统、网络、系统命令等。

用户请求：`;

/**
 * 生成 Python 代码（从自然语言描述）
 */
async function generateCode(
  intent: string,
  modelParam: Parameters<typeof generateText>[0]['model'],
): Promise<string> {
  const result = await generateText({
    model: modelParam,
    messages: [
      { role: 'system', content: CODE_GENERATION_PROMPT },
      { role: 'user', content: intent },
    ],
    temperature: 0.2,
  });

  let code = result.text || '';

  // 去除 markdown 代码块标记
  code = code.replace(/^```python\s*/i, '');
  code = code.replace(/^```\s*/i, '');
  code = code.replace(/```\s*$/i, '');
  code = code.trim();

  return code;
}

/**
 * 调用代码执行（服务端内部调用）
 */
async function executeCodeInternal(
  code: string,
  timeout: number,
): Promise<CodeExecutionAPIResponse> {
  // 直接调用服务端函数，而不是通过 HTTP API
  const result = await executePythonCode({
    code,
    timeout,
    language: 'python',
  });

  return result;
}

export async function executeCodeExecution(
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    const { message, config, apiKey, model, languageModel } = context;

    // 优先使用 languageModel 对象，如果不可用则回退到字符串 model
    const modelParam = languageModel || model || 'gpt-4o-mini';

    // 从消息中提取代码或生成代码
    let code: string;
    let intent: string;

    // 检查消息中是否包含代码块
    const codeBlockMatch = message.match(/```(?:python)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      // 用户提供了代码
      code = codeBlockMatch[1].trim();
      intent = message.replace(/```[\s\S]*?```/, '').trim() || '执行代码';
    } else {
      // 需要从自然语言生成代码
      intent = message;

      if (!languageModel && !apiKey) {
        return {
          success: false,
          output: '',
          error: '未配置 API Key 或 LanguageModel，无法生成代码。请提供 Python 代码块或配置 API。',
        };
      }

      code = await generateCode(message, modelParam as Parameters<typeof generateText>[0]['model']);

      if (!code) {
        return {
          success: false,
          output: '',
          error: '代码生成失败，未返回有效代码',
        };
      }
    }

    // 验证代码不为空
    if (!code.trim()) {
      return {
        success: false,
        output: '',
        error: '代码为空',
      };
    }

    // 执行代码
    const timeout = config.codeTimeoutSec || 30;
    const result = await executeCodeInternal(code, timeout);

    // 格式化输出
    const output = formatExecutionResult(result, code, intent);

    return {
      success: result.success,
      output,
      metadata: {
        tool: 'code_execution',
        exitCode: result.exitCode,
        executionTime: result.executionTime,
        codeLength: code.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : '代码执行失败',
    };
  }
}

function formatExecutionResult(
  result: CodeExecutionAPIResponse,
  code: string,
  intent: string,
): string {
  const parts: string[] = [];

  // 意图描述
  parts.push(`📝 执行意图: ${intent.slice(0, 100)}${intent.length > 100 ? '...' : ''}`);
  parts.push('');

  // 代码（截断显示）
  const displayCode = code.length > 500 ? code.slice(0, 500) + '\n... (代码已截断)' : code;
  parts.push(`💻 执行代码:\n\`\`\`python\n${displayCode}\n\`\`\``);
  parts.push('');

  // 执行结果
  if (result.stdout) {
    parts.push(`✅ 输出结果:\n\`\`\`\n${result.stdout}\n\`\`\``);
  }

  if (result.stderr) {
    parts.push(`⚠️ 错误/警告:\n\`\`\`\n${result.stderr}\n\`\`\``);
  }

  if (!result.stdout && !result.stderr) {
    parts.push('📭 无输出');
  }

  // 执行信息
  parts.push('');
  parts.push(`⏱️ 执行时间: ${result.executionTime}ms | 退出码: ${result.exitCode}`);

  return parts.join('\n');
}
