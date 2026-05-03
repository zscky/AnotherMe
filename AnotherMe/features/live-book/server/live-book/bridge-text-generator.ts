import { callLLM } from '@/lib/ai/llm';
import { resolveModel } from '@/lib/server/resolve-model';
import { createLogger } from '@/lib/logger';
import type { LiveBookBlock, LiveBookChapter, LiveBookRecord } from '@/lib/server/live-book-store';

const log = createLogger('BridgeTextGenerator');

export interface BridgeTextInput {
  book: LiveBookRecord;
  chapter: LiveBookChapter;
  previousBlock?: {
    type: string;
    title: string;
    summary?: string;
  };
  nextBlock: {
    type: string;
    title: string;
    hint?: string;
  };
  language: 'zh-CN' | 'en-US';
}

function buildBridgePrompt(input: BridgeTextInput): string {
  const { book, chapter, previousBlock, nextBlock, language } = input;
  const isZh = language === 'zh-CN';

  const prevDesc = previousBlock
    ? `${isZh ? '前一个内容块' : 'Previous block'}: [${previousBlock.type}] ${previousBlock.title}${previousBlock.summary ? ` - ${previousBlock.summary}` : ''}`
    : (isZh ? '这是页面的第一个内容块。' : 'This is the first block of the page.');

  const nextDesc = `${isZh ? '下一个内容块' : 'Next block'}: [${nextBlock.type}] ${nextBlock.title}${nextBlock.hint ? ` (${nextBlock.hint})` : ''}`;

  const chapterDesc = `${isZh ? '当前章节' : 'Current chapter'}: ${chapter.title}${chapter.goal ? ` - ${chapter.goal}` : ''}`;

  return `${isZh ? '你是一位优秀的教学内容编辑，擅长撰写流畅的过渡语。' : 'You are an expert educational content editor skilled at writing smooth transition text.'}

${chapterDesc}

${prevDesc}
${nextDesc}

${isZh ? '任务' : 'Task'}: ${isZh ? '请写一句简短（30-60字）的过渡语，自然地引导读者从前一个内容块进入下一个内容块。过渡语应该：' : 'Please write a brief (30-60 characters) transition sentence that naturally guides the reader from the previous block to the next block. The transition should:'}
1. ${isZh ? '承接上文的核心内容' : 'Connect to the core content above'}
2. ${isZh ? '引出下文的新主题' : 'Introduce the new topic below'}
3. ${isZh ? '保持教学语气，简洁流畅' : 'Maintain an instructional tone, concise and smooth'}
4. ${isZh ? '不要重复标题，要有信息量' : 'Do not repeat titles; add informational value'}

${isZh ? '请只输出过渡语本身，不要加引号或其他格式。' : 'Output only the transition text itself, without quotes or formatting.'}`;
}

export async function generateLLMBridgeText(input: BridgeTextInput): Promise<string | null> {
  try {
    const model = resolveModel({}).model;
    const result = await callLLM(
      {
        model,
        system: input.language === 'zh-CN'
          ? '你是一位专业的教学内容编辑，只输出过渡语，不添加任何解释。'
          : 'You are a professional educational editor. Output only the transition text without any explanation.',
        prompt: buildBridgePrompt(input),
        maxOutputTokens: 128,
        temperature: 0.4,
      },
      'bridge-text-generator',
      { retries: 1, validate: (text) => text.trim().length > 10 },
    );

    const cleaned = result.text.trim().replace(/^[""']|[""']$/g, '');
    if (cleaned.length < 5 || cleaned.length > 120) {
      log.warn('LLM bridge text length out of range:', cleaned.length);
      return null;
    }
    return cleaned;
  } catch (error) {
    log.warn('LLM bridge text generation failed:', error);
    return null;
  }
}

// Batch generate bridge texts for a sequence of blocks
export async function generateBridgeTextsForBlocks(
  book: LiveBookRecord,
  chapter: LiveBookChapter,
  blocks: Array<{ type: string; title: string; hint?: string }>,
): Promise<Record<string, string>> {
  const bridgeTexts: Record<string, string> = {};

  for (let i = 0; i < blocks.length; i++) {
    const prev = i > 0 ? blocks[i - 1] : undefined;
    const next = blocks[i];

    const llmBridge = await generateLLMBridgeText({
      book,
      chapter,
      previousBlock: prev ? { type: prev.type, title: prev.title } : undefined,
      nextBlock: { type: next.type, title: next.title, hint: next.hint },
      language: book.language,
    });

    if (llmBridge) {
      bridgeTexts[`${next.type}_${i}`] = llmBridge;
    }
  }

  return bridgeTexts;
}
