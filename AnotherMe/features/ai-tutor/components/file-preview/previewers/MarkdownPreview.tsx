'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  return (
    <div
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none',
        'prose-headings:font-semibold prose-headings:text-gray-900 dark:prose-headings:text-gray-100',
        'prose-p:text-gray-700 dark:prose-p:text-gray-300',
        'prose-a:text-purple-600 dark:prose-a:text-purple-400 prose-a:no-underline hover:prose-a:underline',
        'prose-code:text-purple-600 dark:prose-code:text-purple-400 prose-code:bg-gray-100 dark:prose-code:bg-gray-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded',
        'prose-pre:bg-gray-900 prose-pre:text-gray-100',
        'prose-blockquote:border-l-purple-500 prose-blockquote:bg-gray-50 dark:prose-blockquote:bg-gray-800/50 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r',
        'prose-ul:list-disc prose-ol:list-decimal',
        'prose-li:marker:text-gray-400',
        'prose-table:border-collapse prose-table:w-full',
        'prose-th:border prose-th:border-gray-200 dark:prose-th:border-gray-700 prose-th:bg-gray-50 dark:prose-th:bg-gray-800 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:text-sm prose-th:font-semibold',
        'prose-td:border prose-td:border-gray-200 dark:prose-td:border-gray-700 prose-td:px-3 prose-td:py-2 prose-td:text-sm',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

export default MarkdownPreview;
