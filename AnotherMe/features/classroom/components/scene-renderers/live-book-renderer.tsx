'use client';

import type { LiveBookBlockContent, LiveBookPageContent } from '@/lib/types/stage';
import { useLiveBookScene } from '@/lib/hooks/use-live-book-scene';
import { cn } from '@/lib/utils';
import {
  AlertCircle,
  BookOpen,
  Calculator,
  CheckCircle2,
  ChevronRight,
  Circle,
  Lightbulb,
  Loader2,
  Map,
  RefreshCw,
  Sparkles,
  Target,
  Video,
} from 'lucide-react';
import { useState } from 'react';

interface BlockWrapperProps {
  block: LiveBookBlockContent;
  children: React.ReactNode;
  className?: string;
}

function BlockWrapper({ block, children, className }: BlockWrapperProps) {
  return (
    <section
      className={cn(
        'rounded-xl border p-4 shadow-[0_8px_20px_rgba(56,70,104,0.05)] transition-all hover:shadow-[0_12px_28px_rgba(56,70,104,0.1)]',
        blockTone(block.type),
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[#2c3a53]">{block.title}</h3>
        <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-[11px] font-medium text-[#566784]">
          {block.type}
        </span>
      </div>
      {children}
    </section>
  );
}

function blockTone(type: LiveBookBlockContent['type']): string {
  switch (type) {
    case 'section':
      return 'border-[#cddaf4] bg-[#f5f8ff]';
    case 'quiz':
      return 'border-[#d8c7b0] bg-[#fff7ea]';
    case 'interactive':
      return 'border-[#c6ddd6] bg-[#eefbf6]';
    case 'remedial':
      return 'border-[#f4d3de] bg-[#faf2ff]';
    case 'deep_dive':
      return 'border-[#dec9e7] bg-[#faf2ff]';
    case 'animation':
      return 'border-[#c9d9e9] bg-[#f2f9ff]';
    case 'callout':
      return 'border-[#e8d4a8] bg-[#fffbf0]';
    case 'figure':
      return 'border-[#d5e4d9] bg-[#f2f9f5]';
    case 'flash_cards':
      return 'border-[#e0d4f5] bg-[#f8f5ff]';
    case 'code':
      return 'border-[#dce1e9] bg-[#f8f9fc]';
    case 'timeline':
      return 'border-[#c9dfe9] bg-[#f2f9fd]';
    case 'concept_graph':
      return 'border-[#d4e4f5] bg-[#f2f7ff]';
    case 'user_note':
      return 'border-[#e5ddd4] bg-[#fdf9f5]';
    default:
      return 'border-[#d5dbe5] bg-[#f8fbff]';
  }
}

function calloutIcon(contentType?: string) {
  switch (contentType) {
    case 'theory':
      return <Lightbulb className="h-5 w-5 text-amber-500" />;
    case 'derivation':
      return <Calculator className="h-5 w-5 text-orange-500" />;
    case 'practice':
      return <Target className="h-5 w-5 text-emerald-500" />;
    case 'concept':
      return <BookOpen className="h-5 w-5 text-blue-500" />;
    case 'overview':
      return <Map className="h-5 w-5 text-slate-500" />;
    default:
      return <Sparkles className="h-5 w-5 text-purple-500" />;
  }
}

interface CalloutBlockProps {
  block: LiveBookBlockContent;
}

export function CalloutBlock({ block }: CalloutBlockProps) {
  const params = block.paramsJson as { calloutType?: string; icon?: string; dismissible?: boolean } | undefined;
  const metadata = block.metadataJson as { chapterContentType?: string } | undefined;

  return (
    <BlockWrapper block={block}>
      <div className="flex gap-3">
        <div className="shrink-0 pt-0.5">
          {calloutIcon(metadata?.chapterContentType)}
        </div>
        <div className="flex-1 space-y-2">
          <p className="whitespace-pre-wrap text-sm leading-7 text-[#42516a]">{block.content}</p>
          {params?.dismissible && (
            <button className="text-xs text-[#7386a8] hover:text-[#42516a]">点击收起</button>
          )}
        </div>
      </div>
    </BlockWrapper>
  );
}

interface QuizBlockProps {
  block: LiveBookBlockContent;
}

export function QuizBlock({ block }: QuizBlockProps) {
  const params = block.paramsJson as {
    question?: string;
    questionId?: string;
    answerType?: string;
    options?: Array<{ label: string; value: string }>;
  } | undefined;

  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  const questionText = params?.question || block.content;
  const answerType = params?.answerType || 'short_answer';
  const options = params?.options || [];

  const handleSubmit = () => {
    if (!selectedOption) return;
    const correct = answerType === 'short_answer' || options.length === 0;
    setIsCorrect(correct);
    setIsAnswered(true);
  };

  return (
    <BlockWrapper block={block}>
      <div className="space-y-4">
        <p className="whitespace-pre-wrap text-sm leading-7 text-[#42516a]">{questionText}</p>

        {answerType === 'short_answer' ? (
          <div className="space-y-2">
            <textarea
              className="w-full rounded-lg border border-[#d8c7b0] bg-white p-3 text-sm outline-none focus:border-[#b8a078] focus:ring-1 focus:ring-[#b8a078]"
              placeholder="请输入你的答案..."
              rows={3}
            />
            {!isAnswered ? (
              <button
                onClick={handleSubmit}
                className="rounded-lg bg-[#8b6914] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6d5010]"
              >
                提交答案
              </button>
            ) : (
              <div className={cn('flex items-center gap-2 rounded-lg p-3', isCorrect ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
                {isCorrect ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
                <span className="text-sm font-medium">
                  {isCorrect ? '回答正确！' : '答案已提交'}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => !isAnswered && setSelectedOption(option.value)}
                disabled={isAnswered}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition-all',
                  selectedOption === option.value
                    ? 'border-[#8b6914] bg-[#fffbf0]'
                    : 'border-[#d8c7b0] bg-white hover:border-[#b8a078]',
                  isAnswered && 'cursor-default',
                )}
              >
                <span className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold',
                  selectedOption === option.value
                    ? 'border-[#8b6914] bg-[#8b6914] text-white'
                    : 'border-[#d8c7b0]',
                )}>
                  {option.value}
                </span>
                <span>{option.label}</span>
                {isAnswered && selectedOption === option.value && (
                  isCorrect
                    ? <CheckCircle2 className="ml-auto h-5 w-5 text-emerald-500" />
                    : <Circle className="ml-auto h-5 w-5 text-amber-500" />
                )}
              </button>
            ))}
            {!isAnswered && (
              <button
                onClick={handleSubmit}
                disabled={!selectedOption}
                className="rounded-lg bg-[#8b6914] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6d5010] disabled:opacity-50"
              >
                确认选择
              </button>
            )}
          </div>
        )}

        {isAnswered && !isCorrect && (
          <div className="rounded-lg border border-[#dec9e7] bg-[#faf2ff] p-3">
            <p className="text-sm text-[#6b5a7a]">
              <span className="font-semibold">解析：</span>
              可以在页内追问&quot;为什么&quot;，系统会追加深挖解释块。
            </p>
          </div>
        )}
      </div>
    </BlockWrapper>
  );
}

interface FigureBlockProps {
  block: LiveBookBlockContent;
}

export function FigureBlock({ block }: FigureBlockProps) {
  const params = block.paramsJson as {
    figureType?: string;
    caption?: string;
    altText?: string;
  } | undefined;
  const metadata = block.metadataJson as { suggestedMermaid?: string } | undefined;

  const figureType = params?.figureType || 'diagram';

  const renderFigure = () => {
    if (metadata?.suggestedMermaid && figureType === 'diagram') {
      return (
        <div className="overflow-auto rounded-lg bg-white p-4">
          <pre className="text-xs text-[#42516a]">{metadata.suggestedMermaid}</pre>
          <p className="mt-2 text-center text-xs text-[#7386a8]">示意图（待渲染）</p>
        </div>
      );
    }

    return (
      <div className="flex aspect-video items-center justify-center rounded-lg bg-[#f0f4f8]">
        <div className="text-center text-[#7386a8]">
          <svg className="mx-auto h-12 w-12 text-[#c9d9e9]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="mt-2 text-sm">{params?.altText || '图片'}</p>
        </div>
      </div>
    );
  };

  return (
    <BlockWrapper block={block}>
      <div className="space-y-3">
        {renderFigure()}
        {params?.caption && (
          <p className="text-center text-xs text-[#7386a8]">{params.caption}</p>
        )}
      </div>
    </BlockWrapper>
  );
}

interface InteractiveBlockProps {
  block: LiveBookBlockContent;
}

export function InteractiveBlock({ block }: InteractiveBlockProps) {
  const params = block.paramsJson as { url?: string; mode?: string; prompt?: string } | undefined;

  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <BlockWrapper block={block}>
      <div className="space-y-3">
        <p className="whitespace-pre-wrap text-sm leading-7 text-[#42516a]">{block.content}</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2d7a5a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d5a42]"
          >
            <Sparkles className="h-4 w-4" />
            {isExpanded ? '收起' : '展开'}互动区域
          </button>
          {params?.prompt && (
            <span className="flex items-center rounded-full border border-[#c6ddd6] bg-white px-3 py-1.5 text-xs text-[#5a7a6a]">
              {params.prompt}
            </span>
          )}
        </div>
        {isExpanded && (
          <div className="aspect-video overflow-hidden rounded-lg border border-[#c6ddd6] bg-white">
            <div className="flex h-full items-center justify-center bg-[#f8faf9]">
              <div className="text-center text-[#7386a8]">
                <svg className="mx-auto h-12 w-12 text-[#c6ddd6]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
                <p className="mt-2 text-sm">互动内容区域</p>
                <p className="text-xs">URL: {params?.url || '未配置'}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </BlockWrapper>
  );
}

interface AnimationBlockProps {
  block: LiveBookBlockContent;
}

export function AnimationBlock({ block }: AnimationBlockProps) {
  const params = block.paramsJson as { animationKind?: string; videoUrl?: string } | undefined;

  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <BlockWrapper block={block}>
      <div className="space-y-3">
        <p className="whitespace-pre-wrap text-sm leading-7 text-[#42516a]">{block.content}</p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#1a5a8a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0d4a7a]"
          >
            <Video className="h-4 w-4" />
            {isPlaying ? '暂停' : '播放'}演示
          </button>
          {params?.animationKind && (
            <span className="rounded-full border border-[#c9d9e9] bg-white px-3 py-1.5 text-xs text-[#5a7a9a]">
              类型：{params.animationKind}
            </span>
          )}
        </div>
        {isPlaying && (
          <div className="aspect-video overflow-hidden rounded-lg border border-[#c9d9e9] bg-black">
            <div className="flex h-full items-center justify-center">
              <div className="text-center text-white/60">
                <svg className="mx-auto h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="mt-2 text-sm">动画播放区域</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </BlockWrapper>
  );
}

interface ConceptGraphBlockProps {
  block: LiveBookBlockContent;
}

export function ConceptGraphBlock({ block }: ConceptGraphBlockProps) {
  const params = block.paramsJson as {
    graph?: { nodes?: Array<{ id: string; label: string; description?: string }>; edges?: Array<{ src: string; dst: string; relation?: string }> };
    nodeCount?: number;
    edgeCount?: number;
  } | undefined;

  const graph = params?.graph || { nodes: [], edges: [] };
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];

  return (
    <BlockWrapper block={block}>
      <div className="space-y-4">
        <p className="whitespace-pre-wrap text-sm leading-7 text-[#42516a]">{block.content}</p>
        <div className="overflow-auto rounded-lg border border-[#d4e4f5] bg-white p-4">
          {nodes.length > 0 ? (
            <div className="space-y-3">
              <div className="text-xs text-[#7386a8]">
                节点数：{params?.nodeCount || nodes.length}，边数：{params?.edgeCount || edges.length}
              </div>
              <div className="flex flex-wrap gap-2">
                {nodes.slice(0, 12).map((node) => (
                  <div
                    key={node.id}
                    className="rounded-lg border border-[#d4e4f5] bg-[#f2f7ff] px-3 py-1.5 text-xs text-[#2c3a53]"
                  >
                    {node.label}
                  </div>
                ))}
              </div>
              {nodes.length > 12 && (
                <p className="text-xs text-[#7386a8]">还有 {nodes.length - 12} 个节点...</p>
              )}
            </div>
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center text-[#7386a8]">
              <div className="text-center">
                <svg className="mx-auto h-12 w-12 text-[#d4e4f5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <p className="mt-2 text-sm">概念依赖图</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </BlockWrapper>
  );
}

interface FlashCardsBlockProps {
  block: LiveBookBlockContent;
}

export function FlashCardsBlock({ block }: FlashCardsBlockProps) {
  const params = block.paramsJson as {
    cards?: Array<{ id: string; front: string; back: string }>;
    shuffle?: boolean;
    showProgress?: boolean;
  } | undefined;

  const cards = params?.cards || [];
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [shuffledCards, setShuffledCards] = useState(cards);

  const handleShuffle = () => {
    const shuffled = [...cards].sort(() => Math.random() - 0.5);
    setShuffledCards(shuffled);
    setCurrentIndex(0);
    setIsFlipped(false);
  };

  const currentCard = shuffledCards[currentIndex];

  if (cards.length === 0) {
    return (
      <BlockWrapper block={block}>
        <p className="text-sm text-[#7386a8]">暂无记忆卡片</p>
      </BlockWrapper>
    );
  }

  return (
    <BlockWrapper block={block}>
      <div className="space-y-4">
        {params?.showProgress && (
          <div className="flex items-center justify-between text-xs text-[#7386a8]">
            <span>进度：{currentIndex + 1} / {shuffledCards.length}</span>
            <span>{Math.round(((currentIndex + 1) / shuffledCards.length) * 100)}%</span>
          </div>
        )}

        <div
          onClick={() => setIsFlipped(!isFlipped)}
          className={cn(
            'cursor-pointer rounded-xl border-2 border-[#d4c4f5] bg-gradient-to-br p-6 text-center transition-all hover:shadow-lg',
            isFlipped
              ? 'from-purple-50 to-violet-50'
              : 'from-[#f8f5ff] to-[#f0ebff]',
          )}
        >
          <p className="text-sm font-semibold text-[#2c3a53]">
            {isFlipped ? '答案' : '问题'}
          </p>
          <p className="mt-3 text-base text-[#42516a]">
            {isFlipped ? currentCard?.back : currentCard?.front}
          </p>
          <p className="mt-4 text-xs text-[#7386a8]">
            {isFlipped ? '点击查看问题' : '点击查看答案'}
          </p>
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={() => { setCurrentIndex(Math.max(0, currentIndex - 1)); setIsFlipped(false); }}
            disabled={currentIndex === 0}
            className="rounded-lg border border-[#d4c4f5] px-3 py-1.5 text-sm text-[#6b5a8a] disabled:opacity-50"
          >
            上一张
          </button>
          {params?.shuffle && (
            <button
              onClick={handleShuffle}
              className="rounded-lg bg-[#7c5ab8] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#6b4a9a]"
            >
              重新洗牌
            </button>
          )}
          <button
            onClick={() => { setCurrentIndex(Math.min(shuffledCards.length - 1, currentIndex + 1)); setIsFlipped(false); }}
            disabled={currentIndex === shuffledCards.length - 1}
            className="rounded-lg border border-[#d4c4f5] px-3 py-1.5 text-sm text-[#6b5a8a] disabled:opacity-50"
          >
            下一张
          </button>
        </div>
      </div>
    </BlockWrapper>
  );
}

interface TimelineBlockProps {
  block: LiveBookBlockContent;
}

export function TimelineBlock({ block }: TimelineBlockProps) {
  const params = block.paramsJson as {
    steps?: Array<{ id: string; title: string; description?: string }>;
    orientation?: string;
    interactive?: boolean;
  } | undefined;

  const steps = params?.steps || [];
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());

  const toggleStep = (stepId: string) => {
    const newCompleted = new Set(completedSteps);
    if (newCompleted.has(stepId)) {
      newCompleted.delete(stepId);
    } else {
      newCompleted.add(stepId);
    }
    setCompletedSteps(newCompleted);
  };

  return (
    <BlockWrapper block={block}>
      <div className="space-y-4">
        <p className="whitespace-pre-wrap text-sm leading-7 text-[#42516a]">{block.content}</p>
        <div className={cn('space-y-3', params?.orientation === 'horizontal' ? 'flex gap-4 overflow-auto' : '')}>
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={cn(
                'relative rounded-lg border p-4 transition-all',
                completedSteps.has(step.id)
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-[#c9dfe9] bg-white',
              )}
            >
              <div className="flex items-start gap-3">
                <div className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                  completedSteps.has(step.id)
                    ? 'bg-emerald-500 text-white'
                    : 'bg-[#c9dfe9] text-[#2c3a53]',
                )}>
                  {completedSteps.has(step.id) ? <CheckCircle2 className="h-5 w-5" /> : index + 1}
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-[#2c3a53]">{step.title}</h4>
                  {step.description && (
                    <p className="mt-1 text-xs text-[#5a6a7a]">{step.description}</p>
                  )}
                </div>
                {params?.interactive && (
                  <button
                    onClick={() => toggleStep(step.id)}
                    className={cn(
                      'shrink-0 rounded px-2 py-1 text-xs',
                      completedSteps.has(step.id)
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-[#f2f9fd] text-[#5a7a9a]',
                    )}
                  >
                    {completedSteps.has(step.id) ? '已完成' : '标记完成'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </BlockWrapper>
  );
}

interface CodeBlockProps {
  block: LiveBookBlockContent;
}

export function CodeBlockRenderer({ block }: CodeBlockProps) {
  const params = block.paramsJson as {
    language?: string;
    runnable?: boolean;
    lineNumbers?: boolean;
    collapsible?: boolean;
  } | undefined;

  const [isCollapsed, setIsCollapsed] = useState(false);

  const language = params?.language || 'javascript';

  return (
    <BlockWrapper block={block}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="rounded bg-[#e8edf4] px-2 py-0.5 text-xs font-medium text-[#5a6a7a]">
            {language}
          </span>
          <div className="flex gap-2">
            {params?.collapsible && (
              <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="text-xs text-[#7386a8] hover:text-[#42516a]"
              >
                {isCollapsed ? '展开' : '折叠'}
              </button>
            )}
            <button className="text-xs text-[#7386a8] hover:text-[#42516a]">复制</button>
          </div>
        </div>
        {!isCollapsed && (
          <pre className="overflow-auto rounded-lg bg-[#1e2433] p-4 text-sm text-[#e2e8f0]">
            <code>{block.content}</code>
          </pre>
        )}
        {params?.runnable && (
          <button className="rounded-lg bg-[#2d5a3a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d4a2a]">
            运行代码
          </button>
        )}
      </div>
    </BlockWrapper>
  );
}

interface DeepDiveBlockProps {
  block: LiveBookBlockContent;
}

export function DeepDiveBlock({ block }: DeepDiveBlockProps) {
  const params = block.paramsJson as {
    question?: string;
    explanationType?: string;
    chapterGoal?: string;
    learningObjectives?: string[];
  } | undefined;

  return (
    <BlockWrapper block={block}>
      <div className="space-y-3">
        {params?.question && (
          <div className="rounded-lg bg-[#f5f0ff] p-3">
            <p className="text-xs font-semibold text-[#7c5ab8]">问题</p>
            <p className="mt-1 text-sm text-[#42516a]">{params.question}</p>
          </div>
        )}
        <p className="whitespace-pre-wrap text-sm leading-7 text-[#42516a]">{block.content}</p>
        {params?.explanationType && (
          <div className="flex items-center gap-2 text-xs text-[#7386a8]">
            <span className="rounded bg-[#dec9e7] px-2 py-0.5">
              类型：{params.explanationType}
            </span>
          </div>
        )}
      </div>
    </BlockWrapper>
  );
}

interface RemedialBlockProps {
  block: LiveBookBlockContent;
}

export function RemedialBlock({ block }: RemedialBlockProps) {
  const params = block.paramsJson as {
    questionId?: string;
    userAnswer?: string;
    chapterGoal?: string;
    learningObjectives?: string[];
    errorPattern?: string;
  } | undefined;

  return (
    <BlockWrapper block={block}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-lg bg-[#fff5f5] p-3">
          <AlertCircle className="h-5 w-5 text-red-500" />
          <span className="text-sm font-semibold text-red-700">错因分析与补偿练习</span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-7 text-[#42516a]">{block.content}</p>
        {params?.learningObjectives && params.learningObjectives.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#7386a8]">需要掌握的关键点：</p>
            <ul className="space-y-1">
              {params.learningObjectives.map((obj, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-[#42516a]">
                  <ChevronRight className="h-4 w-4 text-[#b8a078]" />
                  {obj}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </BlockWrapper>
  );
}

interface UserNoteBlockProps {
  block: LiveBookBlockContent;
}

export function UserNoteBlock({ block }: UserNoteBlockProps) {
  return (
    <BlockWrapper block={block}>
      <div className="space-y-2">
        <p className="whitespace-pre-wrap text-sm leading-7 text-[#42516a]">{block.content}</p>
      </div>
    </BlockWrapper>
  );
}

interface SectionBlockProps {
  block: LiveBookBlockContent;
}

export function SectionBlock({ block }: SectionBlockProps) {
  const params = block.paramsJson as {
    goal?: string;
    difficulty?: string;
    learningObjectives?: string[];
  } | undefined;

  return (
    <BlockWrapper block={block} className="border-l-4 border-l-[#4a7fc1]">
      <div className="space-y-3">
        <p className="whitespace-pre-wrap text-sm leading-7 text-[#42516a]">{block.content}</p>
        {params?.learningObjectives && params.learningObjectives.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#7386a8]">学习目标：</p>
            <ul className="space-y-1">
              {params.learningObjectives.map((obj, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-[#42516a]">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#cddaf4] text-xs text-[#4a7fc1]">
                    {i + 1}
                  </span>
                  {obj}
                </li>
              ))}
            </ul>
          </div>
        )}
        {params?.difficulty && (
          <span className={cn(
            'inline-block rounded px-2 py-0.5 text-xs font-medium',
            params.difficulty === 'easy' ? 'bg-emerald-100 text-emerald-700' :
            params.difficulty === 'medium' ? 'bg-amber-100 text-amber-700' :
            'bg-red-100 text-red-700',
          )}>
            难度：{params.difficulty}
          </span>
        )}
      </div>
    </BlockWrapper>
  );
}

interface TextBlockProps {
  block: LiveBookBlockContent;
}

export function TextBlock({ block }: TextBlockProps) {
  return (
    <BlockWrapper block={block}>
      <p className="whitespace-pre-wrap text-sm leading-7 text-[#42516a]">{block.content}</p>
    </BlockWrapper>
  );
}

interface PlaceholderBlockProps {
  block: LiveBookBlockContent;
}

export function PlaceholderBlock({ block }: PlaceholderBlockProps) {
  return (
    <BlockWrapper block={block} className="border-dashed">
      <div className="flex items-center gap-2 text-[#7386a8]">
        <AlertCircle className="h-4 w-4" />
        <span className="text-sm">{block.content}</span>
      </div>
    </BlockWrapper>
  );
}

export interface BlockRendererProps {
  block: LiveBookBlockContent;
}

export function BlockRenderer({ block }: BlockRendererProps) {
  switch (block.type) {
    case 'callout':
      return <CalloutBlock block={block} />;
    case 'quiz':
      return <QuizBlock block={block} />;
    case 'figure':
      return <FigureBlock block={block} />;
    case 'interactive':
      return <InteractiveBlock block={block} />;
    case 'animation':
      return <AnimationBlock block={block} />;
    case 'concept_graph':
      return <ConceptGraphBlock block={block} />;
    case 'flash_cards':
      return <FlashCardsBlock block={block} />;
    case 'timeline':
      return <TimelineBlock block={block} />;
    case 'code':
      return <CodeBlockRenderer block={block} />;
    case 'deep_dive':
      return <DeepDiveBlock block={block} />;
    case 'remedial':
      return <RemedialBlock block={block} />;
    case 'user_note':
      return <UserNoteBlock block={block} />;
    case 'section':
      return <SectionBlock block={block} />;
    case 'text':
      return <TextBlock block={block} />;
    case 'placeholder':
      return <PlaceholderBlock block={block} />;
    default:
      return <TextBlock block={block} />;
  }
}

interface LiveBookRendererProps {
  readonly content: LiveBookPageContent;
  readonly sceneId: string;
}

export function LiveBookRenderer({ content }: LiveBookRendererProps) {
  const {
    content: liveContent,
    isLoading,
    error,
    refresh,
  } = useLiveBookScene({
    bookId: content.bookId,
    pageId: content.pageId,
    chapterId: content.chapterId,
    chapterTitle: content.chapterTitle,
    pageTitle: content.pageTitle,
    order: content.order,
    blocks: content.blocks,
  });

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const displayContent = liveContent.blocks.length > 0 ? liveContent : content;

  if (isLoading && displayContent.blocks.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-[#6d7e98]">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">正在加载活书内容...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto px-4 py-4">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <div className="rounded-2xl border border-[#d8e1ef] bg-white/95 p-4 shadow-[0_10px_24px_rgba(35,64,120,0.08)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7386a8]">
                Live Book Page
              </p>
              <h2 className="mt-2 text-xl font-semibold text-[#27344a]">{displayContent.pageTitle}</h2>
              <p className="mt-1 text-sm text-[#5f6f89]">
                章节：{displayContent.chapterTitle || displayContent.chapterId || '未命名章节'}
              </p>
            </div>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#d8e1ef] bg-white text-[#5f6f89] hover:bg-[#f5f8ff] disabled:opacity-50"
              title="刷新内容"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-dashed border-red-200 bg-red-50/80 p-4 text-sm text-red-600">
            <p className="font-medium">加载出错</p>
            <p className="mt-1 text-xs text-red-500">{error}</p>
          </div>
        )}

        {displayContent.blocks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#cbd7ea] bg-white/80 p-4 text-sm text-[#6d7e98]">
            当前页面暂无内容块。
          </div>
        ) : (
          displayContent.blocks.map((block) => (
            <BlockRenderer key={block.id} block={block} />
          ))
        )}
      </div>
    </div>
  );
}
