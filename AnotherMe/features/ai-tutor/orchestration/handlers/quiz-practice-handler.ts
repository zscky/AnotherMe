/**
 * Quiz Practice Capability Handler
 *
 * Generates structured practice questions with answers and explanations.
 */

import { generateText } from 'ai';
import type { CapabilityHandler, CapabilityRequest, CapabilityStageResult, CapabilityResult } from '../capability-runtime';
import type {
  QuizDifficulty,
  QuizPracticePayload,
  QuizPracticeResult,
  QuizQuestion,
  QuizQuestionType,
} from '../../types/capability-payloads';
import type { ToolExecutionContext } from '../tutor-tools/types';
import { executeTool } from '../tutor-tools/registry';
import { createLogger } from '@/lib/logger';

const log = createLogger('QuizPracticeHandler');

const QUIZ_SYSTEM_PROMPT = `你是一位严谨的测验出题老师。请根据用户主题生成结构化练习题。

必须只输出 JSON，不要输出 Markdown，不要添加解释性前后缀。

JSON 格式：
{
  "questions": [
    {
      "type": "choice" | "multiple" | "short_answer" | "coding",
      "question": "题干",
      "options": ["选项A", "选项B"],
      "answer": "标准答案",
      "explanation": "解析",
      "difficulty": "easy" | "medium" | "hard",
      "knowledgePoints": ["知识点"]
    }
  ]
}

要求：
1. 题目要符合主题和难度
2. 单选题至少 4 个选项，多选题至少 4 个选项
3. 简答题和编程题可以省略 options
4. 答案必须准确，解析要帮助学习者理解
5. 使用中文`;

function clampCount(count: unknown): number {
  if (typeof count !== 'number' || !Number.isFinite(count)) return 5;
  return Math.min(Math.max(Math.floor(count), 1), 20);
}

function normalizeQuestionType(value: unknown): QuizQuestionType {
  if (value === 'choice' || value === 'multiple' || value === 'short_answer' || value === 'coding') {
    return value;
  }
  return 'choice';
}

function normalizeDifficulty(value: unknown): QuizDifficulty {
  if (value === 'easy' || value === 'medium' || value === 'hard' || value === 'auto') {
    return value;
  }
  return 'auto';
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim());
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
  }

  return null;
}

function normalizeQuestions(raw: unknown, fallback: {
  topic: string;
  count: number;
  type: QuizQuestionType;
  difficulty: QuizDifficulty;
}): QuizQuestion[] {
  const data = raw as { questions?: unknown };
  const items = Array.isArray(data?.questions) ? data.questions : [];

  const questions = items
    .map((item, index): QuizQuestion | null => {
      if (!item || typeof item !== 'object') return null;
      const q = item as Record<string, unknown>;
      const question = typeof q.question === 'string' ? q.question.trim() : '';
      const answer = typeof q.answer === 'string' ? q.answer.trim() : '';
      if (!question || !answer) return null;

      const type = normalizeQuestionType(q.type || fallback.type);
      const difficulty = normalizeDifficulty(q.difficulty || fallback.difficulty);
      const options = Array.isArray(q.options)
        ? q.options.filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
        : undefined;
      const knowledgePoints = Array.isArray(q.knowledgePoints)
        ? q.knowledgePoints.filter((point): point is string => typeof point === 'string' && point.trim().length > 0)
        : undefined;

      return {
        id: `quiz-${Date.now()}-${index}`,
        type,
        question,
        ...(options?.length ? { options } : {}),
        answer,
        explanation: typeof q.explanation === 'string' ? q.explanation : undefined,
        difficulty,
        ...(knowledgePoints?.length ? { knowledgePoints } : {}),
      };
    })
    .filter((item): item is QuizQuestion => Boolean(item))
    .slice(0, fallback.count);

  if (questions.length > 0) return questions;

  return Array.from({ length: fallback.count }, (_, index) => ({
    id: `quiz-fallback-${Date.now()}-${index}`,
    type: fallback.type,
    question: `请解释“${fallback.topic}”中的关键概念 ${index + 1}。`,
    answer: '请结合课堂内容作答。',
    explanation: '当前模型未返回可解析题目，已生成占位练习题。',
    difficulty: fallback.difficulty === 'auto' ? 'medium' : fallback.difficulty,
    knowledgePoints: [fallback.topic],
  }));
}

function buildValidationCode(questions: QuizQuestion[], expectedCount: number): string {
  const questionsJson = JSON.stringify(questions);
  const pythonJsonLiteral = JSON.stringify(questionsJson);

  return `import json

questions = json.loads(${pythonJsonLiteral})
issues = []

if len(questions) != ${expectedCount}:
    issues.append(f"题目数量为 {len(questions)}，期望为 ${expectedCount}")

for index, question in enumerate(questions, start=1):
    qtype = question.get("type")
    text = str(question.get("question", "")).strip()
    answer = str(question.get("answer", "")).strip()
    options = question.get("options") or []

    if not text:
        issues.append(f"第 {index} 题缺少题干")
    if not answer:
        issues.append(f"第 {index} 题缺少答案")
    if qtype in ("choice", "multiple") and len(options) < 4:
        issues.append(f"第 {index} 题选项少于 4 个")

print(json.dumps({
    "question_count": len(questions),
    "issues": issues,
}, ensure_ascii=False))`;
}

export const quizPracticeHandler: CapabilityHandler<QuizPracticePayload> = {
  capabilityId: 'quiz_practice',

  validatePayload(payload: unknown): QuizPracticePayload {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid payload: expected object');
    }
    const p = payload as Record<string, unknown>;
    if (!p.topic || typeof p.topic !== 'string') {
      throw new Error('Invalid payload: topic is required');
    }

    return {
      topic: p.topic,
      count: clampCount(p.count),
      questionType: normalizeQuestionType(p.questionType),
      difficulty: normalizeDifficulty(p.difficulty),
      knowledgeBases: Array.isArray(p.knowledgeBases)
        ? p.knowledgeBases.filter((kb): kb is string => typeof kb === 'string')
        : undefined,
      languageModel: p.languageModel as QuizPracticePayload['languageModel'],
    };
  },

  async *execute(
    request: CapabilityRequest<QuizPracticePayload>,
  ): AsyncGenerator<CapabilityStageResult, CapabilityResult, unknown> {
    const startTime = Date.now();
    const {
      topic,
      count = 5,
      questionType = 'choice',
      difficulty = 'auto',
      knowledgeBases = [],
      languageModel,
    } = request.payload;

    const planningStart = Date.now();
    yield {
      stage: 'pre_process',
      success: true,
      output: {
        stage: 'idea',
        topic,
        count,
        questionType,
        difficulty,
        knowledgeBases,
      },
      durationMs: Date.now() - planningStart,
      completedAt: Date.now(),
    };

    const invokeStart = Date.now();
    let questions: QuizQuestion[];
    let ragContext = '';
    let webContext = '';
    let validationOutput = '';
    let generationError: string | undefined;

    try {
      const baseToolContext: Omit<ToolExecutionContext, 'message' | 'config'> = {
        stage: null,
        scenes: [],
        apiKey: '',
        languageModel,
      };

      yield {
        stage: 'agent_invoke',
        success: true,
        output: { stage: 'evaluate', message: '正在检索出题依据...' },
        durationMs: Date.now() - invokeStart,
        completedAt: Date.now(),
      };

      const toolId = `rag-${Date.now()}`;
      yield {
        stage: 'agent_stream',
        success: true,
        output: {
          agentEvent: {
            type: 'tool_start',
            data: { toolName: 'rag', toolId },
          },
        },
        durationMs: Date.now() - invokeStart,
        completedAt: Date.now(),
      };

      const ragResult = await executeTool('rag', {
        ...baseToolContext,
        message: topic,
        config: {
          knowledgeBase: knowledgeBases[0],
          userId: request.userId,
          maxRAGResults: 5,
        },
      });
      ragContext = ragResult.output;

      yield {
        stage: 'agent_stream',
        success: true,
        output: {
          agentEvent: {
            type: 'tool_end',
            data: {
              toolName: 'rag',
              toolId,
              success: ragResult.success,
              output: ragResult.output,
              error: ragResult.error,
            },
          },
        },
        durationMs: Date.now() - invokeStart,
        completedAt: Date.now(),
      };

      const webToolId = `web_search-${Date.now()}`;
      yield {
        stage: 'agent_stream',
        success: true,
        output: {
          agentEvent: {
            type: 'tool_start',
            data: { toolName: 'web_search', toolId: webToolId },
          },
        },
        durationMs: Date.now() - invokeStart,
        completedAt: Date.now(),
      };

      const webResult = await executeTool('web_search', {
        ...baseToolContext,
        message: topic,
        config: {
          maxWebResults: 3,
        },
      });
      webContext = webResult.output;

      yield {
        stage: 'agent_stream',
        success: true,
        output: {
          agentEvent: {
            type: 'tool_end',
            data: {
              toolName: 'web_search',
              toolId: webToolId,
              success: webResult.success,
              output: webResult.output,
              error: webResult.error,
            },
          },
        },
        durationMs: Date.now() - invokeStart,
        completedAt: Date.now(),
      };

      yield {
        stage: 'agent_invoke',
        success: true,
        output: { stage: 'generate', message: '正在生成题目...' },
        durationMs: Date.now() - invokeStart,
        completedAt: Date.now(),
      };

      if (!languageModel) {
        questions = normalizeQuestions(null, { topic, count, type: questionType, difficulty });
      } else {
        const result = await generateText({
          model: languageModel,
          messages: [
            { role: 'system', content: QUIZ_SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                `主题：${topic}`,
                `题目数量：${count}`,
                `题型：${questionType}`,
                `难度：${difficulty}`,
                knowledgeBases.length ? `知识库：${knowledgeBases.join(', ')}` : '',
                ragContext ? `检索到的学习资料：\n${ragContext}` : '',
                webContext ? `联网检索资料：\n${webContext}` : '',
              ].filter(Boolean).join('\n'),
            },
          ],
          temperature: 0.4,
          abortSignal: request.signal,
        });

        questions = normalizeQuestions(extractJson(result.text), {
          topic,
          count,
          type: questionType,
          difficulty,
        });
      }
      if (questions.some((question) => question.id.startsWith('quiz-fallback-'))) {
        generationError = '模型未返回可解析题目，已生成占位练习题。';
      }

      yield {
        stage: 'agent_invoke',
        success: true,
        output: { stage: 'validate', message: '正在校验题目结构...' },
        durationMs: Date.now() - invokeStart,
        completedAt: Date.now(),
      };

      const codeToolId = `code_execution-${Date.now()}`;
      yield {
        stage: 'agent_stream',
        success: true,
        output: {
          agentEvent: {
            type: 'tool_start',
            data: { toolName: 'code_execution', toolId: codeToolId },
          },
        },
        durationMs: Date.now() - invokeStart,
        completedAt: Date.now(),
      };

      const validationResult = await executeTool('code_execution', {
        ...baseToolContext,
        message: `请执行以下 Python 代码校验题目结构：\n\`\`\`python\n${buildValidationCode(questions, count)}\n\`\`\``,
        config: {
          codeTimeoutSec: 10,
        },
      });
      validationOutput = validationResult.output;

      yield {
        stage: 'agent_stream',
        success: true,
        output: {
          agentEvent: {
            type: 'tool_end',
            data: {
              toolName: 'code_execution',
              toolId: codeToolId,
              success: validationResult.success,
              output: validationResult.output,
              error: validationResult.error,
            },
          },
        },
        durationMs: Date.now() - invokeStart,
        completedAt: Date.now(),
      };

      yield {
        stage: 'agent_invoke',
        success: true,
        output: {
          stage: 'validate',
          questionCount: questions.length,
          validation: validationOutput,
        },
        durationMs: Date.now() - invokeStart,
        completedAt: Date.now(),
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('[QuizPractice] Generation failed:', err);
      generationError = err.message;
      questions = normalizeQuestions(null, { topic, count, type: questionType, difficulty });

      yield {
        stage: 'agent_invoke',
        success: false,
        error: { code: 'QUIZ_GENERATION_FAILED', message: err.message },
        durationMs: Date.now() - invokeStart,
        completedAt: Date.now(),
      };
    }

    const success = !generationError;
    const result: QuizPracticeResult = {
      success,
      questions,
      ...(generationError ? { error: generationError } : {}),
    };

    yield {
      stage: 'complete',
      success,
      output: result as unknown as Record<string, unknown>,
      durationMs: Date.now() - startTime,
      completedAt: Date.now(),
    };

    return {
      success,
      output: result as unknown as Record<string, unknown>,
      stages: [],
      traceEvents: [],
      totalDurationMs: Date.now() - startTime,
      error: generationError ? { code: 'QUIZ_GENERATION_FAILED', message: generationError } : undefined,
    };
  },
};
