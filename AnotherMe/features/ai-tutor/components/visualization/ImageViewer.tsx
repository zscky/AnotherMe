'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { Loader2, X, ZoomIn } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImageViewerProps {
  src: string;
  alt?: string;
  filename?: string;
  className?: string;
  onClick?: () => void;
}

// 棋盘格背景样式
const CHECKERBOARD_STYLE = {
  backgroundImage: `
    linear-gradient(45deg, rgba(0,0,0,0.04) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(0,0,0,0.04) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(0,0,0,0.04) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(0,0,0,0.04) 75%)
  `,
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
};

export function ImageViewer({ src, alt, filename, className, onClick }: ImageViewerProps) {
  const { t } = useI18n();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  return (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-100/30 dark:bg-gray-800/30',
        onClick && 'cursor-pointer hover:shadow-md transition-shadow',
        className,
      )}
      style={CHECKERBOARD_STYLE}
      onClick={onClick}
    >
      {state === 'loading' && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-gray-400" />
        </div>
      )}

      {state === 'error' ? (
        <div className="flex flex-col items-center justify-center p-4 text-gray-500">
          <span className="text-[12px]">{t('chat.image.loadError')}</span>
        </div>
      ) : (
        <>
          { }
          <img
            src={src}
            alt={alt || filename || t('chat.image.defaultAlt')}
            className="max-h-48 max-w-[280px] object-contain"
            onLoad={() => setState('ready')}
            onError={() => setState('error')}
          />
          {onClick && state === 'ready' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity hover:bg-black/10 hover:opacity-100">
              <div className="rounded-full bg-white/90 p-2 shadow-lg">
                <ZoomIn size={20} className="text-gray-700" />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// 全屏图片预览组件
interface FullscreenImageViewerProps {
  src: string;
  alt?: string;
  filename?: string;
  isOpen: boolean;
  onClose: () => void;
}

export function FullscreenImageViewer({
  src,
  alt,
  filename,
  isOpen,
  onClose,
}: FullscreenImageViewerProps) {
  const { t } = useI18n();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* 头部工具栏 */}
      <div className="flex shrink-0 items-center justify-between px-4 py-3 text-white">
        <div className="truncate text-[13px] font-medium">
          {filename || alt || t('chat.image.defaultAlt')}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 transition-colors hover:bg-white/20"
        >
          <X size={18} />
        </button>
      </div>

      {/* 图片区域 */}
      <div
        className="flex flex-1 items-center justify-center overflow-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {state === 'loading' && (
          <div className="flex items-center justify-center">
            <Loader2 size={32} className="animate-spin text-white/60" />
          </div>
        )}

        {state === 'error' ? (
          <div className="text-white/60">{t('chat.image.loadError')}</div>
        ) : (
           
          <img
            src={src}
            alt={alt || filename || t('chat.image.defaultAlt')}
            className="max-h-full max-w-full object-contain"
            onLoad={() => setState('ready')}
            onError={() => setState('error')}
          />
        )}
      </div>
    </div>
  );
}

export default ImageViewer;
