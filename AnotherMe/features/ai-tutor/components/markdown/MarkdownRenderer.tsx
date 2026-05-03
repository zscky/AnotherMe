'use client';

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Options as ReactMarkdownOptions } from 'react-markdown';
import type { CSSProperties } from 'react';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/lib/utils';
import 'katex/dist/katex.min.css';

type MarkdownPluginList = NonNullable<ReactMarkdownOptions['remarkPlugins']>;
type SyntaxHighlighterStyle = { [key: string]: CSSProperties };

interface MarkdownRendererProps {
  content: string;
  className?: string;
  variant?: 'default' | 'compact' | 'prose' | 'trace';
  enableMath?: boolean;
  enableCode?: boolean;
}

// 检测数学内容
function detectMathContent(content: string): boolean {
  if (/(^|[^\\])\$\$[\s\S]+?\$\$/.test(content)) return true;
  if (/\\\(|\\\[/.test(content)) return true;
  if (
    /(?:^|[^$\\])\$(?!\$|\s)(?:[^$\n]*(?:\\[a-zA-Z]+|[{}_^]))[^$\n]*\$(?!\$)/m.test(
      content,
    )
  )
    return true;
  return false;
}

// 检测代码内容
function detectCodeContent(content: string): boolean {
  return /```[A-Za-z0-9_+#.-]+/.test(content);
}

export function MarkdownRenderer({
  content,
  className,
  variant = 'default',
  enableMath: enableMathProp,
  enableCode: enableCodeProp,
}: MarkdownRendererProps) {
  const enableMath = enableMathProp ?? detectMathContent(content);
  const enableCode = enableCodeProp ?? detectCodeContent(content);

  const remarkPlugins = useMemo(() => {
    const plugins: MarkdownPluginList = [remarkGfm];
    if (enableMath) plugins.push(remarkMath);
    return plugins;
  }, [enableMath]);

  const rehypePlugins = useMemo(() => {
    const plugins: NonNullable<ReactMarkdownOptions['rehypePlugins']> = [];
    if (enableMath) plugins.push(rehypeKatex);
    return plugins;
  }, [enableMath]);

  const proseClassNames = {
    default: 'prose prose-sm dark:prose-invert max-w-none',
    compact: 'prose prose-xs dark:prose-invert max-w-none',
    prose: 'prose dark:prose-invert max-w-none',
    trace: 'text-[11px] leading-relaxed',
  };

  const customComponents = useMemo(
    () => ({
      code({ inline, className, children, ...props }: React.ComponentPropsWithoutRef<'code'> & { inline?: boolean }) {
        const match = /language-(\w+)/.exec(className || '');
        const language = match ? match[1] : 'text';

        if (!inline && enableCode) {
          return (
            <SyntaxHighlighter
              {...props}
              style={vscDarkPlus as unknown as SyntaxHighlighterStyle}
              language={language}
              PreTag="div"
              customStyle={{
                margin: '0.5em 0',
                borderRadius: '0.5rem',
                fontSize: '0.875em',
              }}
            >
              {String(children).replace(/\n$/, '')}
            </SyntaxHighlighter>
          );
        }

        return (
          <code
            className={cn(
              'rounded bg-gray-100 dark:bg-gray-800 px-1 py-0.5 font-mono text-sm',
              className,
            )}
            {...props}
          >
            {children}
          </code>
        );
      },
      // 自定义表格样式
      table({ children }: React.ComponentPropsWithoutRef<'table'>) {
        return (
          <div className="overflow-x-auto my-4">
            <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700">
              {children}
            </table>
          </div>
        );
      },
      th({ children }: React.ComponentPropsWithoutRef<'th'>) {
        return (
          <th className="border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-left text-sm font-semibold">
            {children}
          </th>
        );
      },
      td({ children }: React.ComponentPropsWithoutRef<'td'>) {
        return (
          <td className="border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm">
            {children}
          </td>
        );
      },
      // 自定义引用样式
      blockquote({ children }: React.ComponentPropsWithoutRef<'blockquote'>) {
        return (
          <blockquote className="border-l-4 border-purple-500 bg-gray-50 dark:bg-gray-800/50 my-4 py-2 px-4 rounded-r">
            {children}
          </blockquote>
        );
      },
      // 自定义链接样式
      a({ children, href }: React.ComponentPropsWithoutRef<'a'>) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-600 dark:text-purple-400 hover:underline"
          >
            {children}
          </a>
        );
      },
    }),
    [enableCode],
  );

  if (variant === 'trace') {
    return (
      <div className={cn('text-[11px] leading-relaxed text-gray-600 dark:text-gray-400', className)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => <span>{children}</span>,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div
      className={cn(
        proseClassNames[variant],
        // 自定义 prose 样式
        'prose-headings:font-semibold prose-headings:text-gray-900 dark:prose-headings:text-gray-100',
        'prose-p:text-gray-700 dark:prose-p:text-gray-300 prose-p:leading-relaxed',
        'prose-a:text-purple-600 dark:prose-a:text-purple-400 prose-a:no-underline hover:prose-a:underline',
        'prose-strong:text-gray-900 dark:prose-strong:text-gray-100',
        'prose-code:text-purple-600 dark:prose-code:text-purple-400 prose-code:bg-gray-100 dark:prose-code:bg-gray-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none',
        'prose-pre:bg-transparent prose-pre:p-0',
        'prose-ul:list-disc prose-ol:list-decimal prose-li:marker:text-gray-400',
        'prose-hr:border-gray-200 dark:prose-hr:border-gray-700',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={customComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownRenderer;
