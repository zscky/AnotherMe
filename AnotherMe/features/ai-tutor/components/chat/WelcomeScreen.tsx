'use client';

import { useState, memo } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  Sparkles,
  Calculator,
  BookOpen,
  Microscope,
  Palette,
  Code,
  ArrowRight,
  Lightbulb,
} from 'lucide-react';

interface WelcomeScreenProps {
  onSuggestionClick?: (suggestion: string) => void;
}

// 建议卡片数据
const SUGGESTIONS = [
  {
    icon: Calculator,
    title: 'Solve a math problem',
    description: 'Get step-by-step solutions',
    prompt: 'Help me solve this math problem step by step',
    color: 'from-blue-500 to-cyan-500',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
  },
  {
    icon: BookOpen,
    title: 'Explain a concept',
    description: 'Learn any topic in depth',
    prompt: 'Explain quantum mechanics in simple terms',
    color: 'from-emerald-500 to-teal-500',
    bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
  },
  {
    icon: Code,
    title: 'Write code',
    description: 'Generate and debug code',
    prompt: 'Write a Python function to sort a list',
    color: 'from-violet-500 to-purple-500',
    bgColor: 'bg-violet-50 dark:bg-violet-900/20',
  },
  {
    icon: Microscope,
    title: 'Deep research',
    description: 'Comprehensive analysis',
    prompt: 'Research the latest developments in AI',
    color: 'from-orange-500 to-red-500',
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
  },
  {
    icon: Palette,
    title: 'Visualize ideas',
    description: 'Create diagrams and charts',
    prompt: 'Create a flowchart for machine learning workflow',
    color: 'from-pink-500 to-rose-500',
    bgColor: 'bg-pink-50 dark:bg-pink-900/20',
  },
  {
    icon: Lightbulb,
    title: 'Brainstorm',
    description: 'Generate creative ideas',
    prompt: 'Brainstorm ideas for a science project',
    color: 'from-amber-500 to-yellow-500',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
  },
];

// 快速提示
const QUICK_PROMPTS = [
  'Explain photosynthesis',
  'Help me write an essay',
  'Solve this equation: 2x + 5 = 15',
  'What are the causes of climate change?',
  'How does a neural network work?',
];

const SuggestionCard = memo(function SuggestionCard({
  suggestion,
  onClick,
  index,
}: {
  suggestion: (typeof SUGGESTIONS)[0];
  onClick: () => void;
  index: number;
}) {
  const Icon = suggestion.icon;

  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      onClick={onClick}
      className={cn(
        'group relative flex flex-col items-start p-5 rounded-2xl',
        'border border-gray-200 dark:border-gray-700',
        'bg-white dark:bg-gray-800',
        'hover:border-gray-300 dark:hover:border-gray-600',
        'hover:shadow-lg hover:shadow-gray-200/50 dark:hover:shadow-black/20',
        'transition-all duration-300 text-left',
        'hover:-translate-y-1'
      )}
    >
      {/* 图标背景 */}
      <div
        className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center mb-3',
          'bg-gradient-to-br',
          suggestion.color,
          'text-white shadow-lg'
        )}
      >
        <Icon className="w-5 h-5" />
      </div>

      {/* 标题 */}
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {suggestion.title}
      </h3>

      {/* 描述 */}
      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        {suggestion.description}
      </p>

      {/* 悬停箭头 */}
      <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <ArrowRight className="w-4 h-4 text-gray-400" />
      </div>
    </motion.button>
  );
});

export function WelcomeScreen({ onSuggestionClick }: WelcomeScreenProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 py-12">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="text-center"
      >
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white mb-4 shadow-xl shadow-indigo-500/20">
          <Sparkles className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          {t('chat.welcomeTitle') || 'What would you like to learn?'}
        </h1>
        <p className="text-gray-500 dark:text-gray-400">
          {t('chat.welcomeSubtitle') || 'Your personal AI tutor is here to help'}
        </p>
      </motion.div>
    </div>
  );
}

export default WelcomeScreen;
