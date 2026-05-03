'use client';

import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { Check, Copy, Download, X, FileText, Image as ImageIcon, FileCode, File } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';
import { sanitizeSvg } from '@/lib/utils/sanitize-html';
import dynamic from 'next/dynamic';

// 动态导入较重的预览组件
const MarkdownPreview = dynamic(() => import('./previewers/MarkdownPreview'), { ssr: false });
const CodePreview = dynamic(() => import('./previewers/CodePreview'), { ssr: false });

const ANIM_MS = 220;

export type FilePreviewType = 'image' | 'svg' | 'pdf' | 'markdown' | 'code' | 'text' | 'fallback';

export interface FilePreviewSource {
  filename: string;
  mimeType?: string;
  type: FilePreviewType;
  url?: string;
  base64?: string;
  extractedText?: string;
  size?: number;
}

interface FilePreviewDrawerProps {
  open: boolean;
  source: FilePreviewSource | null;
  onClose: () => void;
}

// 文件图标映射
function getFileIcon(type: FilePreviewType) {
  switch (type) {
    case 'image':
    case 'svg':
      return ImageIcon;
    case 'markdown':
      return FileText;
    case 'code':
    case 'text':
      return FileCode;
    default:
      return File;
  }
}

// 文件类型标签
function getFileLabel(type: FilePreviewType, mimeType?: string): string {
  switch (type) {
    case 'image':
      return 'Image';
    case 'svg':
      return 'SVG';
    case 'pdf':
      return 'PDF';
    case 'markdown':
      return 'Markdown';
    case 'code':
      return 'Code';
    case 'text':
      return 'Text';
    default:
      return mimeType?.split('/')[1]?.toUpperCase() || 'File';
  }
}

// 格式化文件大小
function formatBytes(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 图片预览组件
function ImagePreview({ source }: { source: FilePreviewSource }) {
  const src = source.url || (source.base64 ? `data:${source.mimeType};base64,${source.base64}` : '');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  if (!src) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        No image data available
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full w-full items-center justify-center"
      style={{
        backgroundImage: `
          linear-gradient(45deg, rgba(0,0,0,0.04) 25%, transparent 25%),
          linear-gradient(-45deg, rgba(0,0,0,0.04) 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, rgba(0,0,0,0.04) 75%),
          linear-gradient(-45deg, transparent 75%, rgba(0,0,0,0.04) 75%)
        `,
        backgroundSize: '16px 16px',
        backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
      }}
    >
      {state === 'loading' && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
        </div>
      )}
      {state === 'error' ? (
        <div className="text-gray-500">Failed to load image</div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={source.filename}
          className="max-h-full max-w-full object-contain"
          onLoad={() => setState('ready')}
          onError={() => setState('error')}
        />
      )}
    </div>
  );
}

// SVG 预览组件
function SvgPreview({ source }: { source: FilePreviewSource }) {
  let svgContent = '';
  let error: string | null = null;

  if (source.base64) {
    try {
      svgContent = atob(source.base64);
    } catch {
      error = 'Invalid SVG data';
    }
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-500">
        {error}
      </div>
    );
  }

  return (
    <div
      className="flex h-full w-full items-center justify-center overflow-auto p-4"
      dangerouslySetInnerHTML={{ __html: sanitizeSvg(svgContent) }}
    />
  );
}

// 回退预览组件
function FallbackPreview({ source }: { source: FilePreviewSource }) {
  const iconType = getFileIcon(source.type);

  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
        {iconType({ size: 32, className: 'text-gray-400' })}
      </div>
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {source.filename}
      </p>
      <p className="mt-1 text-xs text-gray-500">
        {getFileLabel(source.type, source.mimeType)}
      </p>
      {source.extractedText && (
        <div className="mt-4 max-h-64 w-full overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
          <pre className="whitespace-pre-wrap text-xs text-gray-600 dark:text-gray-400">
            {source.extractedText}
          </pre>
        </div>
      )}
    </div>
  );
}

// 预览主体组件
const PreviewBody = memo(function PreviewBody({
  source,
}: {
  source: FilePreviewSource;
}) {
  switch (source.type) {
    case 'image':
      return <ImagePreview source={source} />;
    case 'svg':
      return <SvgPreview source={source} />;
    case 'markdown':
      return (
        <div className="h-full overflow-y-auto p-4">
          <MarkdownPreview content={source.extractedText || ''} />
        </div>
      );
    case 'code':
    case 'text':
      return (
        <div className="h-full overflow-y-auto">
          <CodePreview
            content={source.extractedText || ''}
            filename={source.filename}
          />
        </div>
      );
    case 'fallback':
    default:
      return <FallbackPreview source={source} />;
  }
});

export function FilePreviewDrawer({ open, source, onClose }: FilePreviewDrawerProps) {
  const { t } = useI18n();
  const [renderedSource, setRenderedSource] = useState<FilePreviewSource | null>(null);
  const [bodyMounted, setBodyMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // 同步更新渲染源
  if (open && source && source !== renderedSource) {
    setRenderedSource(source);
    setBodyMounted(false);
  }

  // 关闭后延迟卸载内容
  useEffect(() => {
    if (!open && renderedSource) {
      const timer = setTimeout(() => setRenderedSource(null), ANIM_MS);
      return () => clearTimeout(timer);
    }
  }, [open, renderedSource]);

  // 动画完成后挂载内容
  useEffect(() => {
    if (open && renderedSource && !bodyMounted) {
      const timer = setTimeout(() => setBodyMounted(true), ANIM_MS);
      return () => clearTimeout(timer);
    }
  }, [open, renderedSource, bodyMounted]);

  // 聚焦关闭按钮
  useEffect(() => {
    if (open) closeBtnRef.current?.focus();
  }, [open]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleCopy = async () => {
    if (!renderedSource?.extractedText) return;
    try {
      await navigator.clipboard.writeText(renderedSource.extractedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const headerIcon = renderedSource ? getFileIcon(renderedSource.type) : File;
  const sizeLabel = renderedSource?.size ? formatBytes(renderedSource.size) : '';

  return (
    <div
      role="dialog"
      aria-hidden={!open}
      aria-label={renderedSource ? `File preview: ${renderedSource.filename}` : 'File preview'}
      className={cn(
        'fixed right-0 top-0 z-[90] flex h-full w-[min(560px,92vw)] flex-col border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl transition-transform ease-out',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
      style={{
        willChange: 'transform',
        transitionDuration: `${ANIM_MS}ms`,
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      {renderedSource && (
        <>
          {/* 头部 */}
          <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 dark:bg-gray-800">
              {headerIcon({ size: 18, className: 'text-gray-500' })}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-gray-900 dark:text-gray-100">
                {renderedSource.filename}
              </div>
              <div className="truncate text-[10px] uppercase tracking-wide text-gray-500">
                {sizeLabel
                  ? `${getFileLabel(renderedSource.type, renderedSource.mimeType)} · ${sizeLabel}`
                  : getFileLabel(renderedSource.type, renderedSource.mimeType)}
              </div>
            </div>

            {renderedSource.extractedText && (
              <button
                type="button"
                onClick={handleCopy}
                title="Copy content"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-300"
              >
                {copied ? (
                  <Check size={14} className="text-emerald-500" />
                ) : (
                  <Copy size={14} />
                )}
              </button>
            )}

            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              title={t('common.close')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-300"
            >
              <X size={15} />
            </button>
          </div>

          {/* 内容区域 */}
          <div className="relative flex-1 overflow-hidden">
            {bodyMounted && <PreviewBody source={renderedSource} />}
          </div>
        </>
      )}
    </div>
  );
}

export default FilePreviewDrawer;
