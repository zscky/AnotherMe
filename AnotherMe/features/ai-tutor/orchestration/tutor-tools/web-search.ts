/**
 * Web Search 工具 - 联网搜索
 * 复用已有的 Tavily 搜索实现和项目配置
 */

import { searchWithTavily } from '@/lib/web-search/tavily';
import { resolveWebSearchApiKey } from '@/lib/server/provider-config';
import type { WebSearchResult, WebSearchSource } from '@/lib/types/web-search';
import type { ToolExecutionContext, ToolExecutionResult } from './types';

export interface WebSearchStructuredResult {
  answer?: string;
  sources: WebSearchSource[];
  query: string;
  responseTime: number;
}

export async function executeWebSearch(
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    const { message, config } = context;

    // 使用 provider-config 解析 API key（server-providers.yml/env 优先，用户配置兜底）
    const apiKey = resolveWebSearchApiKey(config.tavilyApiKey);

    // 如果没有 API key，返回友好的提示
    if (!apiKey) {
      return {
        success: true,
        output: `⚠️ 联网搜索未配置

当前无法执行联网搜索。如需使用此功能，请配置 Tavily API Key：

方式1：在 server-providers.yml 中添加 web-search 配置
方式2：设置 TAVILY_API_KEY 环境变量
方式3：通过客户端配置传递

访问 https://tavily.com 获取免费 API Key

用户原始问题：${message.slice(0, 100)}...`,
        metadata: {
          tool: 'web_search',
          configured: false,
        },
      };
    }

    // 提取搜索查询（可以优化为使用 LLM 提取关键词）
    const query = message.slice(0, 400); // Tavily 限制 400 字符
    // 使用专门的 maxWebResults 配置，而不是复用 maxPaperResults
    const maxResults = Math.min(Math.max(config.maxWebResults || 5, 1), 10);

    const result: WebSearchResult = await searchWithTavily({
      query,
      apiKey,
      maxResults,
    });

    // 格式化搜索结果
    const formattedResults = formatSearchResults(result);

    return {
      success: true,
      output: formattedResults,
      metadata: {
        tool: 'web_search',
        resultCount: result.sources?.length || 0,
        query,
        responseTime: result.responseTime,
        // 结构化返回 sources，供前端引用
        sources: result.sources?.map((s) => ({
          title: s.title,
          url: s.url,
          content: s.content,
        })),
      },
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : 'Web 搜索执行失败',
    };
  }
}

function formatSearchResults(result: WebSearchResult): string {
  if (!result.answer && (!result.sources || result.sources.length === 0)) {
    return '未找到相关搜索结果。';
  }

  let output = '';

  // 如果有 AI 生成的答案，先显示
  if (result.answer) {
    output += `🤖 AI 总结：\n${result.answer}\n\n`;
    output += `---\n\n`;
  }

  // 显示搜索结果
  if (result.sources && result.sources.length > 0) {
    output += `🌐 搜索结果：\n\n`;

    result.sources.forEach((source, index) => {
      output += `[${index + 1}] ${source.title}\n`;
      output += `    ${source.content}\n`;
      if (source.url) {
        output += `    来源：${source.url}\n`;
      }
      output += `\n`;
    });
  }

  return output;
}
