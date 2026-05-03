'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  isSameMonth,
  isSameDay,
  addDays,
} from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, Clock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Task = {
  id: string;
  title: string;
  time: string;
  type: 'study' | 'exam' | 'homework';
  date: string;
  classroomId?: string;
};

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

function toTaskType(sceneTypes: string[]): Task['type'] {
  if (sceneTypes.includes('quiz')) return 'exam';
  if (sceneTypes.includes('interactive') || sceneTypes.includes('pbl')) return 'homework';
  return 'study';
}

function toDefaultTime(index: number) {
  const hour = 9 + (index % 6) * 2;
  return `${String(hour).padStart(2, '0')}:00`;
}

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isAddingTask, setIsAddingTask] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadTasksFromBackend() {
      try {
        const response = await fetch('/api/classroom?limit=120', {
          method: 'GET',
          cache: 'no-store',
        });
        const payload = (await response.json()) as ClassroomListResponse;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || '加载日历任务失败。');
        }

        if (cancelled) return;

        const generatedTasks = (payload.classrooms || []).map((room, index) => {
          const date = format(new Date(room.createdAt), 'yyyy-MM-dd');
          return {
            id: room.id,
            title: room.title,
            time: toDefaultTime(index),
            type: toTaskType(room.sceneTypes),
            date,
            classroomId: room.id,
          } as Task;
        });

        setTasks(generatedTasks);
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : '加载日历失败。');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadTasksFromBackend();

    return () => {
      cancelled = true;
    };
  }, []);

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const jumpToToday = () => setCurrentDate(new Date());

  const handleAddTask = (dateStr: string) => {
    if (!newTaskTitle.trim()) {
      setIsAddingTask(null);
      return;
    }
    const newTask: Task = {
      id: `custom-${Date.now()}`,
      title: newTaskTitle,
      time: '12:00',
      type: 'study',
      date: dateStr,
    };
    setTasks((prev) => [...prev, newTask]);
    setNewTaskTitle('');
    setIsAddingTask(null);
  };

  const taskCountInMonth = useMemo(() => {
    const monthKey = format(currentDate, 'yyyy-MM');
    return tasks.filter((task) => task.date.startsWith(monthKey)).length;
  }, [currentDate, tasks]);

  const renderHeader = () => {
    return (
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-foreground tracking-wide">
            {format(currentDate, 'yyyy年 M月', { locale: zhCN })}
          </h1>
          <span className="text-xs font-bold text-muted-foreground tracking-wide">
            本月任务 {taskCountInMonth}
          </span>
          <div className="flex items-center gap-1 bg-card border border-border rounded-md p-1 shadow-sm">
            <button onClick={prevMonth} className="p-1 hover:bg-muted rounded transition-colors">
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </button>
            <button onClick={jumpToToday} className="px-3 py-1 text-xs font-medium text-foreground hover:bg-muted rounded transition-colors">
              今天
            </button>
            <button onClick={nextMonth} className="p-1 hover:bg-muted rounded transition-colors">
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderDays = () => {
    const dateFormat = 'EEEE';
    const days = [];
    const startDate = startOfWeek(currentDate, { weekStartsOn: 1 });

    for (let i = 0; i < 7; i += 1) {
      days.push(
        <div key={i} className="text-xs font-bold text-muted-foreground tracking-wider text-center py-3 border-b border-border">
          {format(addDays(startDate, i), dateFormat, { locale: zhCN }).replace('星期', '周')}
        </div>,
      );
    }
    return <div className="grid grid-cols-7 bg-muted rounded-t-xl border border-border border-b-0">{days}</div>;
  };

  const renderCells = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

    const rows = [];
    let days = [];
    let day = startDate;

    while (day <= endDate) {
      for (let i = 0; i < 7; i += 1) {
        const cloneDay = day;
        const dateStr = format(cloneDay, 'yyyy-MM-dd');
        const dayTasks = tasks.filter((t) => t.date === dateStr);
        const isToday = isSameDay(day, new Date());
        const isCurrentMonth = isSameMonth(day, monthStart);

        days.push(
          <div
            key={day.toString()}
            className={cn(
              'min-h-[120px] bg-card border-r border-b border-border p-2 transition-colors group relative',
              !isCurrentMonth ? 'bg-muted/50 text-muted-foreground' : 'text-foreground',
              isToday ? 'bg-blue-50/10' : '',
            )}
          >
            <div className="flex justify-between items-start mb-2">
              <span className={cn('text-sm font-medium h-7 w-7 flex items-center justify-center rounded-full', isToday ? 'bg-primary text-primary-foreground shadow-sm' : '')}>
                {format(day, 'd')}
              </span>
              <button onClick={() => setIsAddingTask(dateStr)} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-all">
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              {dayTasks.map((task) => (
                <a
                  key={task.id}
                  href={task.classroomId ? `/preview-class?classroomId=${encodeURIComponent(task.classroomId)}` : '#'}
                  className={cn(
                    'block px-2 py-1.5 rounded text-xs font-medium truncate border shadow-sm',
                    task.type === 'homework' ? 'bg-blue-50 text-blue-700 border-blue-100' : task.type === 'exam' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-amber-50 text-amber-700 border-amber-100',
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Clock className="h-3 w-3 opacity-70" />
                    <span className="opacity-80 text-[10px]">{task.time}</span>
                  </div>
                  <div className="truncate">{task.title}</div>
                </a>
              ))}

              {isAddingTask === dateStr ? (
                <div className="mt-2">
                  <input
                    autoFocus
                    type="text"
                    placeholder="任务名称..."
                    className="w-full text-xs px-2 py-1.5 border border-gray-300 rounded shadow-sm outline-none focus:border-black focus:ring-1 focus:ring-black"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddTask(dateStr);
                      if (e.key === 'Escape') {
                        setIsAddingTask(null);
                        setNewTaskTitle('');
                      }
                    }}
                    onBlur={() => handleAddTask(dateStr)}
                  />
                </div>
              ) : null}
            </div>
          </div>,
        );

        day = addDays(day, 1);
      }
      rows.push(
        <div className="grid grid-cols-7" key={day.toString()}>
          {days}
        </div>,
      );
      days = [];
    }

    return <div className="border-l border-t border-border rounded-b-xl overflow-hidden">{rows}</div>;
  };

  if (loading) {
    return (
      <div className="h-[50vh] flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        正在加载日历...
      </div>
    );
  }

  if (errorText) {
    return <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3">{errorText}</div>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="bg-card p-6 shadow-sm rounded-xl border border-border">
        {renderHeader()}
        <div className="shadow-sm rounded-xl overflow-hidden">
          {renderDays()}
          {renderCells()}
        </div>
      </div>
    </div>
  );
}
