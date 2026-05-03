'use client';

import { useMemo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/lib/utils';

interface CodePreviewProps {
  content: string;
  filename?: string;
  className?: string;
}

// 从文件名推断语言
function getLanguageFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    py: 'python',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    cs: 'csharp',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    r: 'r',
    m: 'matlab',
    sql: 'sql',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    ps1: 'powershell',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',
    json: 'json',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    ini: 'ini',
    md: 'markdown',
    tex: 'latex',
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    cmake: 'cmake',
    graphql: 'graphql',
    vue: 'vue',
    svelte: 'svelte',
  };
  return languageMap[ext || ''] || 'text';
}

export function CodePreview({ content, filename, className }: CodePreviewProps) {
  const language = useMemo(() => {
    if (!filename) return 'text';
    return getLanguageFromFilename(filename);
  }, [filename]);

  return (
    <div className={cn('h-full', className)}>
      {filename && (
        <div className="sticky top-0 z-10 border-b border-gray-700 bg-[#1e1e1e] px-4 py-2 text-xs text-gray-400">
          {filename}
        </div>
      )}
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          padding: '1rem',
          fontSize: '13px',
          lineHeight: '1.5',
          background: '#1e1e1e',
        }}
        showLineNumbers
        lineNumberStyle={{
          minWidth: '2.5em',
          paddingRight: '1em',
          color: '#6e7681',
          textAlign: 'right',
        }}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
}

export default CodePreview;
