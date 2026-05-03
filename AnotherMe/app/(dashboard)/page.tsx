'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BookOpen, Target, CheckCircle2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from 'recharts';

interface ClassroomSummary {
  id: string;
  title: string;
  language?: string;
  createdAt: string;
  scenesCount: number;
  sceneTypes: string[];
}

interface ClassroomListResponse {
  success: boolean;
  classrooms?: ClassroomSummary[];
  error?: string;
}

const SCENE_COLORS: Record<string, string> = {
  slide: '#111827',
  quiz: '#E0573D',
  interactive: '#4A6FA5',
  pbl: '#F4D03F',
};

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function toMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function toMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-');
  return `${year.slice(2)}年${Number(month)}月`;
}

function sceneTypeName(sceneType: string) {
  switch (sceneType) {
    case 'slide':
      return '讲解';
    case 'quiz':
      return '测验';
    case 'interactive':
      return '互动';
    case 'pbl':
      return '项目';
    default:
      return sceneType;
  }
}

function estimateStudyHours(scenesCount: number) {
  return Math.max(0.5, scenesCount * 0.5);
}

export default function LearningPlanPage() {
  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [timeView, setTimeView] = useState<'month' | 'week'>('month');

  useEffect(() => {
    let cancelled = false;

    async function loadClassrooms() {
      try {
        const response = await fetch('/api/classroom?limit=120', {
          method: 'GET',
          cache: 'no-store',
        });
        const payload = (await response.json()) as ClassroomListResponse;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || '加载学习看板失败。');
        }

        if (!cancelled) {
          setClassrooms(payload.classrooms || []);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : '加载看板失败。');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadClassrooms();

    return () => {
      cancelled = true;
    };
  }, []);

  const recentClassrooms = useMemo(() => {
    const now = Date.now();
    const withinDays = 30 * 24 * 60 * 60 * 1000;
    const filtered = classrooms.filter((room) => {
      const ts = new Date(room.createdAt).getTime();
      return Number.isFinite(ts) && now - ts <= withinDays;
    });
    return filtered.length > 0 ? filtered : classrooms;
  }, [classrooms]);

  const sceneTypePieData = useMemo(() => {
    const counts = new Map<string, number>();

    recentClassrooms.forEach((room) => {
      room.sceneTypes.forEach((sceneType) => {
        counts.set(sceneType, (counts.get(sceneType) || 0) + 1);
      });
    });

    return Array.from(counts.entries()).map(([type, value]) => ({
      name: sceneTypeName(type),
      value,
      color: SCENE_COLORS[type] || '#9CA3AF',
    }));
  }, [recentClassrooms]);

  const learningTimeMonth = useMemo(() => {
    const now = new Date();
    const monthKeys: string[] = [];
    for (let i = 5; i >= 0; i -= 1) {
      monthKeys.push(toMonthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    }

    const bucket = new Map(monthKeys.map((key) => [key, 0]));
    classrooms.forEach((room) => {
      const created = new Date(room.createdAt);
      if (Number.isNaN(created.getTime())) return;
      const key = toMonthKey(created);
      if (!bucket.has(key)) return;
      bucket.set(key, (bucket.get(key) || 0) + estimateStudyHours(room.scenesCount));
    });

    return monthKeys.map((monthKey) => ({
      name: toMonthLabel(monthKey),
      hours: Number((bucket.get(monthKey) || 0).toFixed(1)),
    }));
  }, [classrooms]);

  const learningTimeWeek = useMemo(() => {
    const bucket = WEEKDAY_LABELS.map((name) => ({ name, hours: 0 }));

    recentClassrooms.forEach((room) => {
      const created = new Date(room.createdAt);
      if (Number.isNaN(created.getTime())) return;
      const day = created.getDay();
      const weekIndex = day === 0 ? 6 : day - 1;
      bucket[weekIndex].hours += estimateStudyHours(room.scenesCount);
    });

    return bucket.map((item) => ({ ...item, hours: Number(item.hours.toFixed(1)) }));
  }, [recentClassrooms]);

  const totalUnits = classrooms.reduce((sum, room) => sum + room.scenesCount, 0);
  const pendingUnits = totalUnits > 0 ? Math.max(1, Math.round(totalUnits * 0.17)) : 0;
  const completedUnits = Math.max(totalUnits - pendingUnits, 0);
  const completionRate = totalUnits > 0 ? (completedUnits / totalUnits) * 100 : 0;

  const recommendedTasks = classrooms.slice(0, 3).map((room) => ({
    id: room.id,
    title: room.title,
    type: room.sceneTypes[0] ? sceneTypeName(room.sceneTypes[0]) : '学习',
    duration: `约 ${Math.max(15, Math.round(estimateStudyHours(room.scenesCount) * 60))} 分钟`,
  }));

  if (loading) {
    return (
      <div className="h-[50vh] flex items-center justify-center text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        正在加载学习看板...
      </div>
    );
  }

  if (errorText) {
    return <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3">{errorText}</div>;
  }

  const pieProgressData = [
    { name: '已完成', value: completedUnits, color: '#111827' },
    { name: '待学习', value: pendingUnits, color: '#E5E7EB' },
  ];
  const topicData = sceneTypePieData.length
    ? sceneTypePieData
    : [{ name: '暂无数据', value: 1, color: '#D1D5DB' }];
  const startLearningHref = recommendedTasks.length
    ? `/preview-class?classroomId=${encodeURIComponent(recommendedTasks[0].id)}`
    : '/create-class';

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 tracking-wide uppercase">学习看板</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 bg-white p-6 shadow-sm flex flex-col">
          <div className="flex justify-between items-start mb-4">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">课程完成度</h2>
          </div>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm font-medium">{completionRate.toFixed(1)}%</span>
            <div className="h-4 w-4 rounded-full bg-[#E8F5E9] flex items-center justify-center">
              <ArrowUpRight className="h-3 w-3 text-[#4CAF50]" />
            </div>
          </div>

          <div className="flex-1 min-h-[160px] w-full" style={{ minHeight: 160 }}>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie
                  data={pieProgressData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                >
                  {pieProgressData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip
                  contentStyle={{
                    borderRadius: '8px',
                    border: 'none',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="bg-[#F4F3F0] p-4 text-center hover:bg-gray-100 transition-colors cursor-pointer rounded-lg">
              <p className="text-2xl font-bold text-gray-900">{completedUnits}</p>
              <p className="text-xs text-gray-500 mt-1">已完成课时</p>
            </div>
            <div className="bg-[#F4F3F0] p-4 text-center hover:bg-gray-100 transition-colors cursor-pointer rounded-lg">
              <p className="text-2xl font-bold text-gray-900">{pendingUnits}</p>
              <p className="text-xs text-gray-500 mt-1">待学习课时</p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-8 bg-white p-6 shadow-sm flex flex-col">
          <div className="flex justify-between items-start mb-8">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">学习时长</h2>
            <select
              className="text-xs border-none bg-[#F4F3F0] px-3 py-1.5 rounded-md text-gray-700 font-medium outline-none cursor-pointer hover:bg-gray-200 transition-colors"
              value={timeView}
              onChange={(e) => setTimeView(e.target.value as 'month' | 'week')}
            >
              <option value="month">按月视图</option>
              <option value="week">按周视图</option>
            </select>
          </div>

          <div className="flex-1 w-full min-h-[250px]" style={{ minHeight: 250 }}>
            <ResponsiveContainer width="100%" height={250}>
              {timeView === 'month' ? (
                <LineChart data={learningTimeMonth} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} />
                  <RechartsTooltip
                    cursor={{ stroke: '#E5E7EB', strokeWidth: 2, strokeDasharray: '4 4' }}
                    contentStyle={{
                      borderRadius: '8px',
                      border: 'none',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="hours"
                    name="学习时长(小时)"
                    stroke="#111827"
                    strokeWidth={3}
                    dot={{ r: 4, fill: '#111827', strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: '#E0573D', strokeWidth: 0 }}
                    animationDuration={1500}
                  />
                </LineChart>
              ) : (
                <BarChart data={learningTimeWeek} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} />
                  <RechartsTooltip
                    cursor={{ fill: '#F3F4F6' }}
                    contentStyle={{
                      borderRadius: '8px',
                      border: 'none',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    }}
                  />
                  <Bar
                    dataKey="hours"
                    name="学习时长(小时)"
                    fill="#111827"
                    radius={[4, 4, 0, 0]}
                    animationDuration={1000}
                  />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-4 bg-[#4A6FA5] p-6 shadow-sm relative overflow-hidden flex flex-col justify-between min-h-[300px] group rounded-xl">
          <div className="flex justify-between items-start relative z-10">
            <h2 className="text-sm font-bold text-white uppercase tracking-wide">升级高级版</h2>
            <Link
              href="/settings"
              className="h-8 w-8 bg-white rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors group-hover:scale-110"
            >
              <ArrowUpRight className="h-4 w-4 text-gray-900" />
            </Link>
          </div>

          <div className="absolute inset-0 opacity-20 transition-transform duration-700 group-hover:scale-110">
            <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
              <pattern id="hexagons" width="50" height="43.4" patternUnits="userSpaceOnUse" patternTransform="scale(2)">
                <path d="M25 0 L50 14.4 L50 43.3 L25 57.7 L0 43.3 L0 14.4 Z" fill="none" stroke="#FFFFFF" strokeWidth="1" />
              </pattern>
              <rect width="100%" height="100%" fill="url(#hexagons)" />
            </svg>
          </div>

          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-48 h-48 z-0 transition-transform duration-500 group-hover:-translate-y-2">
            <Image
              src="https://picsum.photos/seed/student/400/400"
              alt="Student"
              fill
              loading="eager"
              sizes="192px"
              className="object-cover rounded-full opacity-80 mix-blend-luminosity"
              referrerPolicy="no-referrer"
            />
          </div>

          <Link
            href="/settings"
            className="w-full py-3 bg-white text-gray-900 font-bold text-sm relative z-10 hover:bg-gray-50 transition-colors shadow-lg active:scale-95 rounded-lg text-center"
          >
            14天免费试用
          </Link>
        </div>

        <div className="lg:col-span-4 bg-white p-6 shadow-sm flex flex-col rounded-xl">
          <div className="flex justify-between items-start mb-2">
            <div>
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">最近学习知识点</h2>
              <p className="text-xs text-gray-500 mt-1">基于课堂场景统计</p>
            </div>
          </div>

          <div className="flex-1 w-full min-h-[200px] mt-4" style={{ minHeight: 200 }}>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <Pie
                  data={topicData}
                  cx="50%"
                  cy="45%"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                >
                  {topicData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(value) => `${value}`}
                  contentStyle={{
                    borderRadius: '8px',
                    border: 'none',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                  }}
                />
                <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#4B5563' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-4 bg-white p-6 shadow-sm flex flex-col rounded-xl">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center gap-2">
              <Target className="h-4 w-4 text-[#E0573D]" />
              今日建议学习
            </h2>
            <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-md">
              共 {recommendedTasks.length} 项
            </span>
          </div>

          <div className="flex-1 flex flex-col gap-3">
            {recommendedTasks.length ? (
              recommendedTasks.map((task) => (
                <Link
                  key={task.id}
                  href={`/preview-class?classroomId=${encodeURIComponent(task.id)}`}
                  className="group flex items-start gap-3 p-3 bg-[#F9F9F9] hover:bg-gray-50 rounded-lg transition-all border border-transparent hover:border-gray-200 cursor-pointer"
                >
                  <div className="mt-0.5">
                    <CheckCircle2 className="h-5 w-5 text-gray-300 group-hover:text-[#4CAF50] transition-colors" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
                        {task.type}
                      </span>
                      <span className="text-xs text-gray-400 flex items-center gap-1">{task.duration}</span>
                    </div>
                    <p className="text-sm font-medium text-gray-900 group-hover:text-[#E0573D] transition-colors">{task.title}</p>
                  </div>
                </Link>
              ))
            ) : (
              <p className="text-sm text-gray-500">暂无推荐任务，先创建课堂吧。</p>
            )}
          </div>

          <Link
            href={startLearningHref}
            className="mt-4 w-full py-2.5 bg-[#111827] hover:bg-black text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <BookOpen className="h-4 w-4" />
            开始今日学习
          </Link>
        </div>
      </div>
    </div>
  );
}
