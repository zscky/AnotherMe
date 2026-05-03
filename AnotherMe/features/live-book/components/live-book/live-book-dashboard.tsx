'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type WorkspaceTone = 'sky' | 'peach' | 'mint' | 'violet' | 'rose' | 'sun' | 'teal' | 'coral';

const TONE_STYLES: Record<WorkspaceTone, string> = {
  sky: 'border-gray-200 bg-white',
  peach: 'border-gray-200 bg-white',
  mint: 'border-gray-200 bg-white',
  violet: 'border-gray-200 bg-white',
  rose: 'border-gray-200 bg-white',
  sun: 'border-gray-200 bg-white',
  teal: 'border-gray-200 bg-white',
  coral: 'border-gray-200 bg-white',
};

export function workspaceToneClass(tone: WorkspaceTone) {
  return TONE_STYLES[tone];
}

interface WorkspacePanelProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  tone?: WorkspaceTone;
  className?: string;
  headerSlot?: ReactNode;
  children: ReactNode;
}

export function WorkspacePanel({
  title,
  subtitle,
  icon: Icon,
  tone = 'sky',
  className,
  headerSlot,
  children,
}: WorkspacePanelProps) {
  return (
    <section className={cn('rounded-lg border bg-white p-6 shadow-sm', workspaceToneClass(tone), className)}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
            {title}
          </p>
          {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
        </div>
        {headerSlot ? (
          <div className="shrink-0">{headerSlot}</div>
        ) : Icon ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-gray-500">
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
      </div>

      {children}
    </section>
  );
}

interface WorkspaceMetricCardProps {
  label: string;
  value: string;
  note: string;
  tone?: WorkspaceTone;
  icon?: LucideIcon;
  className?: string;
}

export function WorkspaceMetricCard({
  label,
  value,
  note,
  tone = 'peach',
  icon: Icon,
  className,
}: WorkspaceMetricCardProps) {
  return (
    <div className={cn('rounded-lg border bg-white p-4 shadow-sm', workspaceToneClass(tone), className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            {label}
          </p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
          <p className="mt-1 text-sm text-gray-500">{note}</p>
        </div>
        {Icon ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-gray-500">
            <Icon className="h-4 w-4" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface MiniBarChartProps {
  values: number[];
  labels?: string[];
  className?: string;
  barClassName?: string;
}

export function MiniBarChart({ values, labels, className, barClassName }: MiniBarChartProps) {
  const max = Math.max(...values, 1);

  function barHeightClass(value: number) {
    const ratio = value / max;
    if (ratio >= 0.92) return 'h-[132px]';
    if (ratio >= 0.78) return 'h-[116px]';
    if (ratio >= 0.64) return 'h-[100px]';
    if (ratio >= 0.5) return 'h-[84px]';
    if (ratio >= 0.36) return 'h-[68px]';
    if (ratio >= 0.22) return 'h-[52px]';
    return 'h-[36px]';
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex h-36 items-end gap-2">
        {values.map((value, index) => (
          <div key={`${value}-${index}`} className="flex flex-1 flex-col items-center gap-2">
            <div
              className={cn(
                'w-full rounded-full bg-gradient-to-t from-gray-200 to-gray-400',
                barHeightClass(value),
                barClassName,
              )}
            />
            {labels?.[index] ? (
              <span className="text-[11px] font-medium text-gray-500">{labels[index]}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

interface ProgressDonutProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  label?: string;
}

export function ProgressDonut({
  value,
  size = 132,
  strokeWidth = 12,
  className,
  label,
}: ProgressDonutProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (Math.max(0, Math.min(100, value)) / 100) * circumference;

  return (
    <div className={cn('relative inline-flex items-center justify-center', className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#111827"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-2xl font-bold text-gray-900">{value}%</p>
        {label ? (
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            {label}
          </p>
        ) : null}
      </div>
    </div>
  );
}
