'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bell, MessageSquare, Calendar, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

type NotificationItem = {
  id: string;
  type: 'alert' | 'message' | 'system' | 'success';
  title: string;
  message: string;
  time: string;
  read: boolean;
};

interface ClassroomSummary {
  id: string;
  title: string;
  createdAt: string;
  scenesCount: number;
}

interface ClassroomListResponse {
  success: boolean;
  classrooms?: ClassroomSummary[];
  error?: string;
}

interface HealthResponse {
  success: boolean;
  status?: string;
  version?: string;
  capabilities?: {
    webSearch: boolean;
    imageGeneration: boolean;
    videoGeneration: boolean;
    tts: boolean;
  };
  error?: string;
}

function relativeTime(dateText: string) {
  const ts = new Date(dateText).getTime();
  if (!Number.isFinite(ts)) return '刚刚';

  const delta = Date.now() - ts;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < hour) return `${Math.max(1, Math.floor(delta / minute))} 分钟前`;
  if (delta < day) return `${Math.max(1, Math.floor(delta / hour))} 小时前`;
  return `${Math.max(1, Math.floor(delta / day))} 天前`;
}

export default function NotificationsPage() {
  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [warningText, setWarningText] = useState('');
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const [classResult, healthResult] = await Promise.allSettled([
          fetch('/api/classroom?limit=20', { method: 'GET', cache: 'no-store' }).then(async (resp) => {
            const payload = (await resp.json()) as ClassroomListResponse;
            if (!resp.ok || !payload.success) {
              throw new Error(payload.error || '加载课堂通知失败。');
            }
            return payload;
          }),
          fetch('/api/health', { method: 'GET', cache: 'no-store' }).then(async (resp) => {
            const payload = (await resp.json()) as HealthResponse;
            if (!resp.ok || !payload.success) {
              throw new Error(payload.error || '加载系统状态失败。');
            }
            return payload;
          }),
        ]);

        const hasClassroomData = classResult.status === 'fulfilled';
        const hasHealthData = healthResult.status === 'fulfilled';

        if (!hasClassroomData && !hasHealthData) {
          throw new Error('通知加载失败：课堂和系统状态接口均不可用。');
        }

        if (!cancelled) {
          if (hasClassroomData) {
            setClassrooms(classResult.value.classrooms || []);
          }
          if (hasHealthData) {
            setHealth(healthResult.value);
          }

          if (!hasClassroomData || !hasHealthData) {
            setWarningText('部分通知来源暂不可用，当前已展示可获取的数据。');
          }
        }
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : '通知加载失败。');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  const notifications = useMemo<NotificationItem[]>(() => {
    const items: NotificationItem[] = [];

    classrooms.slice(0, 5).forEach((room) => {
      items.push({
        id: `class-${room.id}`,
        type: 'message',
        title: '课堂已生成',
        message: `课堂「${room.title}」已可预览，共 ${room.scenesCount} 个场景。`,
        time: relativeTime(room.createdAt),
        read: readIds.has(`class-${room.id}`),
      });
    });

    if (health?.capabilities) {
      const disabledCaps = Object.entries(health.capabilities)
        .filter(([, enabled]) => !enabled)
        .map(([name]) => name);

      if (disabledCaps.length > 0) {
        items.push({
          id: 'health-capability-alert',
          type: 'alert',
          title: '部分能力未启用',
          message: `当前不可用能力：${disabledCaps.join('、')}。可前往设置补全密钥。`,
          time: '刚刚',
          read: readIds.has('health-capability-alert'),
        });
      } else {
        items.push({
          id: 'health-ok',
          type: 'success',
          title: '系统状态正常',
          message: `后端服务运行正常，版本 ${health.version || 'unknown'}.`,
          time: '刚刚',
          read: readIds.has('health-ok'),
        });
      }
    }

    items.push({
      id: 'system-note',
      type: 'system',
      title: '模板页面已接入真实后端',
      message: '当前通知由课堂接口和健康检查接口实时生成。',
      time: '刚刚',
      read: readIds.has('system-note'),
    });

    return items;
  }, [classrooms, health, readIds]);

  const markAllRead = () => {
    setReadIds(new Set(notifications.map((item) => item.id)));
  };

  if (loading) {
    return (
      <div className="h-[50vh] flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        正在加载通知...
      </div>
    );
  }

  if (errorText) {
    return <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3">{errorText}</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {warningText ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 text-sm">{warningText}</div>
      ) : null}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-foreground tracking-wide uppercase">通知中心</h1>
        <button
          type="button"
          onClick={markAllRead}
          className="text-xs font-bold text-muted-foreground hover:text-foreground tracking-wide transition-colors"
        >
          全部标为已读
        </button>
      </div>

      <div className="bg-card shadow-sm">
        <div className="divide-y divide-gray-100">
          {notifications.map((notification) => {
            const Icon =
              notification.type === 'alert'
                ? AlertCircle
                : notification.type === 'message'
                  ? MessageSquare
                  : notification.type === 'success'
                    ? CheckCircle2
                    : notification.type === 'system'
                      ? Bell
                      : Calendar;

            const color =
              notification.type === 'alert'
                ? 'text-[#E0573D]'
                : notification.type === 'message'
                  ? 'text-[#4A6FA5]'
                  : notification.type === 'success'
                    ? 'text-[#4CAF50]'
                    : 'text-muted-foreground';

            const bg =
              notification.type === 'alert'
                ? 'bg-primary/10'
                : notification.type === 'message'
                  ? 'bg-blue-500/10'
                  : notification.type === 'success'
                    ? 'bg-emerald-500/10'
                    : 'bg-muted';

            return (
              <div
                key={notification.id}
                className={`p-6 flex gap-4 hover:bg-muted transition-colors ${notification.read ? 'opacity-70' : ''}`}
              >
                <div className={`h-12 w-12 rounded-full flex items-center justify-center shrink-0 ${bg}`}>
                  <Icon className={`h-6 w-6 ${color}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-1">
                    <h3 className={`text-sm font-bold text-foreground ${!notification.read ? 'flex items-center gap-2' : ''}`}>
                      {notification.title}
                      {!notification.read ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                    </h3>
                    <span className="text-[10px] font-bold text-muted-foreground tracking-wide">
                      {notification.time}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{notification.message}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
