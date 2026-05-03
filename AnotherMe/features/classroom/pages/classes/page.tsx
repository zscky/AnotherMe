'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock, PlayCircle, Search, Plus, Loader2, GraduationCap } from 'lucide-react';
import Link from 'next/link';

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

function toRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '未知时间';

  const deltaMs = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (deltaMs < hour) {
    return `${Math.max(1, Math.floor(deltaMs / minute))} 分钟前`;
  }
  if (deltaMs < day) {
    return `${Math.max(1, Math.floor(deltaMs / hour))} 小时前`;
  }
  return `${Math.max(1, Math.floor(deltaMs / day))} 天前`;
}

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassroomSummary[]>([]);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadClasses() {
      try {
        setLoading(true);
        setErrorText('');
        const response = await fetch('/api/classroom?limit=60', {
          method: 'GET',
          cache: 'no-store',
        });
        const payload = (await response.json()) as ClassroomListResponse;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || '加载课程列表失败。');
        }
        if (!cancelled) {
          setClasses(payload.classrooms || []);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : '加载课程失败。');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadClasses();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredClasses = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return classes;
    return classes.filter((item) => item.title.toLowerCase().includes(keyword));
  }, [classes, searchText]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <h1 className="text-2xl font-bold text-gray-900 tracking-wide uppercase">我的课程</h1>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索课程..."
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              className="pl-9 pr-4 py-2 bg-white border border-gray-200 text-sm focus:ring-2 focus:ring-gray-300 outline-none transition-all placeholder:text-gray-500 w-64"
            />
          </div>
          <Link
            href="/create-class"
            className="flex items-center gap-2 px-4 py-2 bg-black text-white text-xs font-bold hover:bg-gray-800 transition-colors uppercase tracking-wide"
          >
            <Plus className="h-4 w-4" /> 新建课程
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="h-48 flex items-center justify-center text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          正在加载课程...
        </div>
      ) : errorText ? (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3">{errorText}</div>
      ) : filteredClasses.length === 0 ? (
        <div className="bg-white shadow-sm p-10 text-center text-gray-500">
          <p className="text-sm font-semibold">还没有课程</p>
          <p className="text-xs mt-1">先去“创建课堂”生成第一节课。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredClasses.map((cls) => (
            <Link
              key={cls.id}
              href={`/preview-class?classroomId=${encodeURIComponent(cls.id)}`}
              className="bg-white group shadow-sm hover:shadow-md transition-all duration-300 flex flex-col"
            >
              <div className="h-40 bg-gradient-to-br from-[#f4f3f0] to-[#ece8df] flex items-center justify-center">
                <div className="h-14 w-14 rounded-full bg-black text-white flex items-center justify-center">
                  <GraduationCap className="h-7 w-7" />
                </div>
              </div>

              <div className="p-5 flex-1 flex flex-col">
                <div className="mb-2 flex items-center gap-2">
                  <span className="px-2.5 py-1 bg-black/80 text-white text-[10px] font-bold uppercase tracking-wide">
                    {cls.language === 'en-US' ? 'EN' : '中文'}
                  </span>
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                    {cls.scenesCount} 场景
                  </span>
                </div>

                <h3 className="font-bold text-gray-900 text-lg line-clamp-2">{cls.title}</h3>

                <div className="flex items-center gap-4 text-[10px] font-bold text-gray-500 uppercase tracking-wide mt-4 mb-4">
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> {toRelativeTime(cls.createdAt)}
                  </span>
                </div>

                <div className="mt-auto flex items-center justify-between">
                  <p className="text-xs text-gray-500 line-clamp-1">
                    {cls.sceneTypes.join(' / ') || '课程场景'}
                  </p>
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-[#E0573D] uppercase tracking-wide">
                    <PlayCircle className="h-4 w-4" /> 预览
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
