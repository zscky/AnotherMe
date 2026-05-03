'use client';

import { useEffect, useMemo, useState } from 'react';
import { PlayCircle, Users, FileText, Clock, Edit3, Loader2 } from 'lucide-react';
import Link from 'next/link';
import type { Scene, Stage } from '@/lib/types/stage';

interface ClassroomPayload {
  id: string;
  stage: Stage;
  scenes: Scene[];
}

interface ClassroomResponse {
  success: boolean;
  classroom?: ClassroomPayload;
  error?: string;
}

function estimateSceneMinutes(scene: Scene): number {
  switch (scene.content.type) {
    case 'slide':
      return 8;
    case 'quiz':
      return 6;
    case 'interactive':
      return 10;
    case 'pbl':
      return 12;
    default:
      return 8;
  }
}

export default function PreviewClassPage() {
  const [classroomId, setClassroomId] = useState('');
  const [queryReady, setQueryReady] = useState(false);
  const [classroom, setClassroom] = useState<ClassroomPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('classroomId') || '';
    setClassroomId(id);
    setQueryReady(true);
  }, []);

  useEffect(() => {
    if (!queryReady) {
      return;
    }

    let cancelled = false;

    async function loadClassroom(id: string) {
      if (!id) {
        setErrorText('缺少课堂 ID，请先在“创建课堂”生成课堂。');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setErrorText('');

        const response = await fetch(`/api/classroom?id=${encodeURIComponent(id)}`, {
          method: 'GET',
          cache: 'no-store',
        });
        const payload = (await response.json()) as ClassroomResponse;
        if (!response.ok || !payload.success || !payload.classroom) {
          throw new Error(payload.error || '加载课堂预览失败。');
        }

        if (!cancelled) {
          setClassroom(payload.classroom);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : '加载课堂失败。');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadClassroom(classroomId);

    return () => {
      cancelled = true;
    };
  }, [classroomId, queryReady]);

  const orderedScenes = useMemo(() => {
    return (classroom?.scenes || []).slice().sort((a, b) => a.order - b.order);
  }, [classroom]);

  const totalMinutes = useMemo(() => {
    return orderedScenes.reduce((sum, scene) => sum + estimateSceneMinutes(scene), 0);
  }, [orderedScenes]);

  const quizCount = useMemo(
    () => orderedScenes.filter((scene) => scene.content.type === 'quiz').length,
    [orderedScenes],
  );

  const agentProfiles = classroom?.stage.generatedAgentConfigs || [];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-wide uppercase">课堂预览</h1>
        </div>
        <Link
          href={classroom?.id ? `/classroom/${classroom.id}` : '/classes'}
          className="flex items-center gap-2 px-6 py-3 bg-[#E0573D] hover:bg-[#c94d35] text-white font-bold uppercase tracking-wide transition-all text-sm"
        >
          <PlayCircle className="h-4 w-4" />
          开始上课
        </Link>
      </div>

      {loading ? (
        <div className="h-52 flex items-center justify-center text-gray-500 bg-white shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          正在加载课堂预览...
        </div>
      ) : errorText ? (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3">{errorText}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-8 shadow-sm">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center gap-2">
                  <FileText className="h-4 w-4 text-gray-400" />
                  大纲与脚本
                </h2>
                <button
                  type="button"
                  className="text-xs font-bold text-gray-500 hover:text-gray-900 uppercase tracking-wide flex items-center gap-1"
                >
                  <Edit3 className="h-3 w-3" /> 查看
                </button>
              </div>

              {orderedScenes.length === 0 ? (
                <p className="text-sm text-gray-500">当前课堂暂无场景内容。</p>
              ) : (
                <div className="space-y-8 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-px before:bg-gray-200">
                  {orderedScenes.map((scene, index) => (
                    <div
                      key={scene.id}
                      className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active"
                    >
                      <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white bg-black text-white font-bold text-sm shadow-sm shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                        {index + 1}
                      </div>
                      <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-5 bg-[#F4F3F0] shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="font-bold text-gray-900 text-sm">{scene.title}</h3>
                          <span className="text-[10px] font-bold text-gray-900 bg-white px-2 py-1 uppercase tracking-wide">
                            约 {estimateSceneMinutes(scene)} 分钟
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mt-2 uppercase tracking-wide">
                          场景类型：{scene.content.type}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white p-6 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center gap-2 mb-6">
                <Users className="h-4 w-4 text-gray-400" />
                AI 导师团队
              </h2>
              <div className="space-y-4">
                {agentProfiles.length ? (
                  agentProfiles.map((agent) => (
                    <div key={agent.id} className="flex items-center gap-4 p-4 bg-[#F4F3F0]">
                      <div className="h-10 w-10 bg-black text-white flex items-center justify-center text-sm font-bold">
                        {agent.name.slice(0, 1)}
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 text-sm">{agent.name}</h3>
                        <p className="text-[10px] uppercase tracking-wide text-gray-500 mt-0.5">
                          {agent.role}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500">当前课堂未配置导师团队信息。</p>
                )}
              </div>
            </div>

            <div className="bg-white p-6 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-6">
                课堂信息
              </h2>
              <div className="space-y-4">
                <div className="flex justify-between items-center pb-4 border-b border-gray-100">
                  <span className="text-gray-500 text-xs font-bold uppercase tracking-wide">时长</span>
                  <span className="font-bold text-gray-900 text-sm">约 {totalMinutes} 分钟</span>
                </div>
                <div className="flex justify-between items-center pb-4 border-b border-gray-100">
                  <span className="text-gray-500 text-xs font-bold uppercase tracking-wide">知识点</span>
                  <span className="font-bold text-gray-900 text-sm">{orderedScenes.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500 text-xs font-bold uppercase tracking-wide">测验题场景</span>
                  <span className="font-bold text-gray-900 text-sm">{quizCount}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
