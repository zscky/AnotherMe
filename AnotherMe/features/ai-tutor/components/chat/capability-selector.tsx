'use client';

import { useCallback, useRef, useState } from 'react';
import {
  Brain,
  BarChart3,
  ChevronDown,
  Clapperboard,
  CircleHelp,
  MessageSquare,
  Microscope,
  type LucideIcon,
} from 'lucide-react';

export type CapabilityId =
  | ''
  | 'deep_solve'
  | 'quiz_practice'
  | 'deep_research'
  | 'math_animator'
  | 'visualize';

export interface CapabilityDef {
  id: CapabilityId;
  label: string;
  description: string;
  icon: LucideIcon;
  category: 'chat' | 'generation' | 'visualization';
}

export const CAPABILITIES: CapabilityDef[] = [
  {
    id: '',
    label: 'Chat',
    description: '灵活对话，可使用多种工具',
    icon: MessageSquare,
    category: 'chat',
  },
  {
    id: 'deep_solve',
    label: 'Deep Solve',
    description: '多阶段深度解题',
    icon: Brain,
    category: 'chat',
  },
  {
    id: 'quiz_practice',
    label: 'Quiz Generation',
    description: '生成练习题与答案解析',
    icon: CircleHelp,
    category: 'generation',
  },
  {
    id: 'deep_research',
    label: 'Deep Research',
    description: '多源搜索与深度研究',
    icon: Microscope,
    category: 'generation',
  },
  {
    id: 'math_animator',
    label: 'Math Animator',
    description: '生成数学动画或分镜',
    icon: Clapperboard,
    category: 'visualization',
  },
  {
    id: 'visualize',
    label: 'Visualize',
    description: '生成SVG、图表、Mermaid',
    icon: BarChart3,
    category: 'visualization',
  },
];

export function getCapability(id: CapabilityId): CapabilityDef {
  return CAPABILITIES.find((c) => c.id === id) ?? CAPABILITIES[0];
}

interface CapabilitySelectorProps {
  value: CapabilityId;
  onChange: (id: CapabilityId) => void;
  disabled?: boolean;
}

export function CapabilitySelector({ value, onChange, disabled }: CapabilitySelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const activeCap = getCapability(value);
  const ActiveIcon = activeCap.icon;

  const handleSelect = useCallback(
    (id: CapabilityId) => {
      onChange(id);
      setOpen(false);
    },
    [onChange]
  );

  const handleToggle = useCallback(() => {
    if (!disabled) {
      setOpen((prev) => !prev);
    }
  }, [disabled]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-[13px] font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)]/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ActiveIcon size={14} strokeWidth={1.7} />
        <span>{activeCap.label}</span>
        <ChevronDown
          size={14}
          className={`text-[var(--muted-foreground)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 shadow-lg">
          {CAPABILITIES.map((cap) => {
            const Icon = cap.icon;
            const isActive = cap.id === value;

            return (
              <button
                key={cap.id}
                type="button"
                onClick={() => handleSelect(cap.id)}
                className={`flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                  isActive
                    ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
                    : 'text-[var(--foreground)] hover:bg-[var(--muted)]'
                }`}
              >
                <Icon size={16} strokeWidth={1.7} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">{cap.label}</div>
                  <div className="text-[11px] text-[var(--muted-foreground)]">{cap.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface CapabilityChipProps {
  capability: CapabilityDef;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export function CapabilityChip({ capability, active, onClick, disabled }: CapabilityChipProps) {
  const Icon = capability.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-[32px] items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-[background-color,color,box-shadow] ${
        active
          ? 'bg-[var(--muted)] text-[var(--foreground)] shadow-[0_1px_2px_rgba(15,23,42,0.05)] ring-1 ring-[var(--border)]/55'
          : 'text-[var(--muted-foreground)]/75 hover:bg-[var(--muted)]/55 hover:text-[var(--foreground)]'
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <Icon size={13} strokeWidth={1.7} />
      {capability.label}
    </button>
  );
}

interface CapabilityBarProps {
  value: CapabilityId;
  onChange: (id: CapabilityId) => void;
  disabled?: boolean;
}

export function CapabilityBar({ value, onChange, disabled }: CapabilityBarProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {CAPABILITIES.map((cap) => (
        <CapabilityChip
          key={cap.id}
          capability={cap}
          active={cap.id === value}
          onClick={() => onChange(cap.id)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
