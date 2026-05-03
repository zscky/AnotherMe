import type { CapabilityToolResult, RenderedArtifact } from './types';

export interface RenderChartParams {
  code: string;
  title?: string;
  width?: number;
  height?: number;
}

export interface RenderMermaidParams {
  code: string;
  title?: string;
}

function stripCodeFence(code: string): string {
  return code
    .replace(/^```\w*\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function validateMermaid(code: string): string | null {
  const firstLine = code.trim().split(/\r?\n/, 1)[0]?.trim().toLowerCase() || '';
  const allowedStarts = [
    'graph ',
    'flowchart ',
    'sequencediagram',
    'classdiagram',
    'statediagram',
    'erdiagram',
    'journey',
    'gantt',
    'pie',
    'mindmap',
    'timeline',
    'quadrantchart',
    'xychart',
  ];

  if (!allowedStarts.some((prefix) => firstLine.startsWith(prefix))) {
    return 'Mermaid 代码缺少可识别的图表声明';
  }
  return null;
}

export async function renderChart(params: RenderChartParams): Promise<CapabilityToolResult<{ artifact: RenderedArtifact }>> {
  const code = stripCodeFence(params.code);
  if (!code) {
    return {
      success: false,
      toolId: 'chart_render',
      output: '',
      error: 'Chart.js 配置为空',
    };
  }

  if (!/\btype\s*:/.test(code) || !/\bdata\s*:/.test(code)) {
    return {
      success: false,
      toolId: 'chart_render',
      output: '',
      error: 'Chart.js 配置需要包含 type 和 data',
    };
  }

  const width = Math.min(Math.max(params.width || 800, 240), 1600);
  const height = Math.min(Math.max(params.height || 520, 180), 1200);
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(params.title || 'Chart Preview')}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #fff; color: #111827; }
    .wrap { width: ${width}px; max-width: 100vw; height: ${height}px; padding: 16px; box-sizing: border-box; }
    canvas { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div class="wrap"><canvas id="chart"></canvas></div>
  <script>
    ${code}
    const chartConfig = typeof config !== 'undefined' ? config : (typeof chartConfig !== 'undefined' ? chartConfig : null);
    if (!chartConfig) throw new Error('Chart.js config variable not found');
    new Chart(document.getElementById('chart'), chartConfig);
  </script>
</body>
</html>`;

  return {
    success: true,
    toolId: 'chart_render',
    output: 'Chart.js 预览 HTML 已生成',
    metadata: {
      artifact: {
        format: 'html',
        content: html,
        mimeType: 'text/html',
      },
    },
  };
}

export async function renderMermaid(params: RenderMermaidParams): Promise<CapabilityToolResult<{ artifact: RenderedArtifact }>> {
  const code = stripCodeFence(params.code);
  const validationError = validateMermaid(code);
  if (validationError) {
    return {
      success: false,
      toolId: 'mermaid_render',
      output: '',
      error: validationError,
    };
  }

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(params.title || 'Mermaid Preview')}</title>
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: true, securityLevel: 'strict' });
  </script>
  <style>
    body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; background: #fff; color: #111827; }
    .mermaid { max-width: 100%; overflow: auto; }
  </style>
</head>
<body>
  <pre class="mermaid">${escapeHtml(code)}</pre>
</body>
</html>`;

  return {
    success: true,
    toolId: 'mermaid_render',
    output: 'Mermaid 预览 HTML 已生成',
    metadata: {
      artifact: {
        format: 'html',
        content: html,
        mimeType: 'text/html',
      },
    },
  };
}
