'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, PlayCircle, Presentation, ArrowRight } from 'lucide-react';

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

function formatDate(dateText: string) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString();
}

export default function InteractiveClassPage() {
  const router = useRouter();

  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const response = await fetch('/api/classroom?limit=50', {
          method: 'GET',
          cache: 'no-store',
        });
        const payload = (await response.json()) as ClassroomListResponse;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || '加载课堂失败。');
        }

        const list = payload.classrooms || [];
        if (cancelled) return;

        setClassrooms(list);

        let queryClassroomId = '';
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          queryClassroomId = params.get('classroomId') || '';
        }

        const resolvedId =
          list.find((item) => item.id === queryClassroomId)?.id || list[0]?.id || queryClassroomId;

        if (resolvedId) {
          setSelectedId(resolvedId);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : '互动课堂加载失败。');
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

  const selectedClassroom = useMemo(() => {
    return classrooms.find((room) => room.id === selectedId) || null;
  }, [classrooms, selectedId]);

  const handleLaunch = () => {
    if (!selectedClassroom) return;
    router.push(`/classroom/${encodeURIComponent(selectedClassroom.id)}`);
  };

  if (loading) {
    return (
      <div className="h-[50vh] flex items-center justify-center text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        正在加载互动课堂...
      </div>
    );
  }

  if (errorText) {
    return <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3">{errorText}</div>;
  }

  return (
    <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[360px,1fr] gap-6">
      <div className="bg-white shadow-sm border border-gray-100">
        <div className="p-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">可用课堂</h2>
          <p className="text-xs text-gray-500 mt-1">从真实 /api/classroom 列表中选择</p>
        </div>

        <div className="max-h-[70vh] overflow-y-auto">
          {classrooms.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">暂无课堂，先到创建页生成课堂。</div>
          ) : (
            classrooms.map((room) => (
              <button
                key={room.id}
                type="button"
                onClick={() => setSelectedId(room.id)}
                className={`w-full text-left p-4 border-b border-gray-50 transition-colors ${selectedId === room.id ? 'bg-[#F4F3F0]' : 'hover:bg-[#F9F9F8]'}`}
              >
                <div className="text-sm font-bold text-gray-900 truncate">{room.title}</div>
                <div className="mt-1 text-xs text-gray-500">{room.scenesCount} 场景</div>
                <div className="text-xs text-gray-400 mt-1">{formatDate(room.createdAt)}</div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="bg-white shadow-sm border border-gray-100 p-8 flex flex-col justify-between min-h-[520px]">
        {selectedClassroom ? (
          <>
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#E0573D] mb-4">
                <Presentation className="h-4 w-4" />
                Interactive Session Ready
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-3">{selectedClassroom.title}</h1>
              <p className="text-gray-600 mb-6">
                该课堂已生成 {selectedClassroom.scenesCount} 个场景，可直接进入沉浸式互动课堂。
              </p>

              <div className="grid grid-cols-2 gap-4 max-w-md">
                <div className="p-4 bg-[#F9F9F8]">
                  <div className="text-[11px] text-gray-500 uppercase tracking-wide font-bold mb-1">课堂 ID</div>
                  <div className="text-sm font-mono text-gray-800 break-all">{selectedClassroom.id}</div>
                </div>
                <div className="p-4 bg-[#F9F9F8]">
                  <div className="text-[11px] text-gray-500 uppercase tracking-wide font-bold mb-1">创建时间</div>
                  <div className="text-sm text-gray-800">{formatDate(selectedClassroom.createdAt)}</div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleLaunch}
              className="inline-flex items-center justify-center gap-2 bg-black text-white px-6 py-3 text-sm font-semibold hover:bg-gray-800 transition-colors self-start"
            >
              <PlayCircle className="h-4 w-4" />
              进入互动课堂
              <ArrowRight className="h-4 w-4" />
            </button>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-500">请选择一个课堂开始互动</div>
        )}
      </div>
    </div>
  );
}
