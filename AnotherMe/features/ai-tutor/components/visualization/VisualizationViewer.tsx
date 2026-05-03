'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Code2, Copy, Check, ExternalLink, Maximize2, X } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';
import { sanitizeSvg } from '@/lib/utils/sanitize-html';
import dynamic from 'next/dynamic';
import type { Chart as ChartInstance, ChartConfiguration } from 'chart.js';

// 动态导入 Mermaid 组件
const Mermaid = dynamic(() => import('./Mermaid'), { ssr: false });

export interface VisualizeResult {
  render_type: 'svg' | 'mermaid' | 'chartjs' | 'html';
  code: {
    language: string;
    content: string;
  };
  analysis?: {
    chart_type?: string;
    title?: string;
  };
  review?: {
    changed: boolean;
    review_notes?: string;
  };
}

interface VisualizationViewerProps {
  result: VisualizeResult;
}

// Chart.js 渲染器
function ChartJsRenderer({ config }: { config: string }) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartInstance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      if (!canvasRef.current) return;

      try {
        const ChartModule = await import('chart.js/auto');
        const Chart = ChartModule.default;

        if (chartRef.current) {
          chartRef.current.destroy();
          chartRef.current = null;
        }

        // Parse config safely: try JSON first, then fallback to Function
        // with strict validation to prevent code injection.
        let parsedConfig: unknown;
        try {
          parsedConfig = JSON.parse(config);
        } catch {
          // Only allow a very restricted subset of Chart.js config syntax
          // Block any function calls, dangerous keywords, or script tags
          const dangerousPatterns = [
            /function\s*\(/i,
            /=>\s*\{/,
            /eval\s*\(/i,
            /new\s+Function/i,
            /<script/i,
            /import\s*\(/i,
            /require\s*\(/i,
          ];
          if (dangerousPatterns.some((p) => p.test(config))) {
            throw new Error('Config contains unsafe expressions');
          }
          parsedConfig = (new Function('"use strict"; return (' + config + ')') as () => unknown)();
        }

        if (cancelled) return;

        chartRef.current = new Chart(canvasRef.current, parsedConfig as ChartConfiguration);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : t('chat.visualization.chartError'),
          );
        }
      }
    }

    void render();

    return () => {
      cancelled = true;
      if (chartRef.current) {
        (chartRef.current as { destroy: () => void }).destroy();
        chartRef.current = null;
      }
    };
  }, [config, t]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/30">
        <p className="text-sm font-medium text-red-600 dark:text-red-400">
          {t('chat.visualization.chartError')}
        </p>
        <pre className="mt-2 whitespace-pre-wrap text-xs text-red-500">{error}</pre>
      </div>
    );
  }

  return (
    <div className="relative w-full" style={{ maxHeight: 480 }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

// HTML 渲染器
function HtmlRenderer({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const prepared = useMemo(() => {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { margin: 0; padding: 16px; font-family: system-ui, -apple-system, sans-serif; }
          </style>
        </head>
        <body>${html}</body>
      </html>
    `;
  }, [html]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.srcdoc = prepared;
  }, [prepared]);

  const handleOpenInNewTab = () => {
    try {
      const blob = new Blob([prepared], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      /* no-op */
    }
  };

  return (
    <div className="relative w-full">
      <button
        type="button"
        onClick={handleOpenInNewTab}
        className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-900/90 px-2 py-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 backdrop-blur transition-colors hover:text-gray-700 dark:hover:text-gray-200"
        title="Open in new tab"
      >
        <ExternalLink size={10} strokeWidth={1.8} />
        Open
      </button>
      <iframe
        ref={iframeRef}
        title="HTML visualization"
        sandbox="allow-scripts"
        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white"
        style={{ minHeight: 480, height: 560 }}
      />
    </div>
  );
}

// SVG 渲染器
function SvgRenderer({ svg }: { svg: string }) {
  const { t } = useI18n();

  const validation = useMemo(() => {
    const trimmed = svg.trim();
    if (!trimmed.startsWith('<svg')) {
      return { valid: false as const, error: t('chat.visualization.svgError') };
    }
    return { valid: true as const, html: trimmed };
  }, [svg, t]);

  if (!validation.valid) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/30">
        <p className="text-sm font-medium text-red-600 dark:text-red-400">
          {t('chat.visualization.svgError')}
        </p>
        <pre className="mt-2 whitespace-pre-wrap text-xs text-red-500">{validation.error}</pre>
      </div>
    );
  }

  return (
    <div
      className="flex justify-center overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: sanitizeSvg(validation.html) }}
    />
  );
}

// 根据类型渲染可视化内容
function renderVisualization(result: VisualizeResult) {
  switch (result.render_type) {
    case 'svg':
      return <SvgRenderer svg={result.code.content} />;
    case 'mermaid':
      return <Mermaid chart={result.code.content} />;
    case 'html':
      return <HtmlRenderer html={result.code.content} />;
    case 'chartjs':
    default:
      return <ChartJsRenderer config={result.code.content} />;
  }
}

export function VisualizationViewer({ result }: VisualizationViewerProps) {
  const { t } = useI18n();
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // HTML iframe 已经有自己的 "在新标签页打开" 功能
  const supportsFullscreen = result.render_type !== 'html';

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [fullscreen]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result.code.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard API may be unavailable */
    }
  };

  const getTypeLabel = () => {
    switch (result.render_type) {
      case 'svg':
        return 'SVG';
      case 'mermaid':
        return `Mermaid · ${result.analysis?.chart_type || 'diagram'}`;
      case 'html':
        return `HTML · ${result.analysis?.chart_type || 'interactive'}`;
      case 'chartjs':
      default:
        return `Chart.js · ${result.analysis?.chart_type || 'chart'}`;
    }
  };

  return (
    <div className="space-y-3">
      {/* 可视化区域 */}
      <div
        className={cn(
          'relative overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900',
          result.render_type !== 'html' && 'p-4',
        )}
      >
        {supportsFullscreen && (
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            title={t('chat.visualization.fullscreen')}
            className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-900/90 px-2 py-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 backdrop-blur transition-colors hover:text-gray-700 dark:hover:text-gray-200"
          >
            <Maximize2 size={10} strokeWidth={1.8} />
            {t('chat.visualization.fullscreen')}
          </button>
        )}
        {renderVisualization(result)}
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowCode((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-gray-200"
        >
          <Code2 size={12} strokeWidth={1.8} />
          {showCode ? t('chat.visualization.hideCode') : t('chat.visualization.showCode')}
        </button>

        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-gray-200"
        >
          {copied ? (
            <Check size={12} strokeWidth={1.8} className="text-emerald-500" />
          ) : (
            <Copy size={12} strokeWidth={1.8} />
          )}
          {copied ? t('chat.visualization.copied') : t('chat.visualization.copyCode')}
        </button>

        <span className="ml-auto text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
          {getTypeLabel()}
        </span>
      </div>

      {/* 代码面板 */}
      {showCode && (
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-[#1f2937]">
          <div className="border-b border-white/10 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">
            {result.code.language}
          </div>
          <pre className="max-h-80 overflow-auto p-4 text-[13px] leading-relaxed text-[#d1d5db]">
            <code>{result.code.content}</code>
          </pre>
        </div>
      )}

      {/* 审核备注 */}
      {result.review?.changed && result.review.review_notes && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          {t('chat.visualization.review')}: {result.review.review_notes}
        </p>
      )}

      {/* 全屏覆盖层 */}
      {fullscreen && supportsFullscreen && (
        <div
          className="fixed inset-0 z-[120] flex flex-col bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setFullscreen(false)}
        >
          <div className="mb-2 flex shrink-0 items-center justify-between text-white">
            <div className="text-xs uppercase tracking-wider opacity-80">{getTypeLabel()}</div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFullscreen(false);
              }}
              title={t('chat.visualization.close')}
              className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-white/20"
            >
              <X size={12} strokeWidth={1.8} />
              {t('chat.visualization.close')}
            </button>
          </div>
          <div
            className="flex flex-1 items-center justify-center overflow-auto rounded-xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full max-w-[1600px]">{renderVisualization(result)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
