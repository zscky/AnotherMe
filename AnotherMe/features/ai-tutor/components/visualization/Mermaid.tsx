'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';

interface MermaidProps {
  chart: string;
}

export function Mermaid({ chart }: MermaidProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import('mermaid')).default;

        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'strict',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        });

        const id = `mermaid-${Math.random().toString(36).slice(2, 11)}`;
        const { svg: renderedSvg } = await mermaid.render(id, chart);

        if (!cancelled) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('chat.visualization.mermaidError'));
        }
      }
    }

    void render();

    return () => {
      cancelled = true;
    };
  }, [chart, t]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/30">
        <p className="text-sm font-medium text-red-600 dark:text-red-400">
          {t('chat.visualization.mermaidError')}
        </p>
        <pre className="mt-2 whitespace-pre-wrap text-xs text-red-500">{error}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex justify-center overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default Mermaid;
