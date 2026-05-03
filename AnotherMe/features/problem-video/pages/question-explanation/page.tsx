'use client';

import { useRef, useState } from 'react';
import { ArrowLeft, MessageSquare, ThumbsUp, Bookmark, Share2, FileText } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { buildPhotoVideoNoteId, upsertNotebookNote } from '@/lib/notebook/storage';
import { recordLearningEvent } from '@/lib/learning-events/client';

const LATEST_VIDEO_URL = '/videos/final_from_template_with_audio_custom_raw.mp4';
const LATEST_VIDEO_TITLE = '菱形折叠坐标法讲解（最新）';

export default function QuestionExplanationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const title = searchParams.get('title') || LATEST_VIDEO_TITLE;
  const videoUrl = searchParams.get('videoUrl') || LATEST_VIDEO_URL;
  const [savedToNotebook, setSavedToNotebook] = useState(false);
  const maxWatchedRatioRef = useRef(0);
  const videoWatchRecordedRef = useRef(false);

  const knowledgePoints = [title.replace(/\s+/g, ' ').trim().slice(0, 80) || '拍题讲解'];

  const recordVideoWatch = (forceComplete = false) => {
    if (videoWatchRecordedRef.current) return;
    const watchedRatio = forceComplete ? 1 : maxWatchedRatioRef.current;
    if (watchedRatio < 0.5) return;
    videoWatchRecordedRef.current = true;
    void recordLearningEvent({
      eventType: 'video_watched',
      knowledgePoints,
      payload: {
        subject: '数学',
        title,
        video_url: videoUrl,
        watched_ratio: watchedRatio,
      },
      weight: watchedRatio >= 0.8 ? 1 : 0.6,
    });
  };

  const handleSaveToNotebook = () => {
    const noteContent = [
      '## 讲解步骤',
      '- 识别题型与已知条件：系统先对图片进行 OCR 与题型归类。',
      '- 生成解题路径：根据题型自动生成分步讲解脚本。',
      '- 合成语音与视频：通过真实后端任务输出最终讲解视频。',
      '',
      '## 学习建议',
      '如果视频中有步骤不清楚，建议补充文字条件并重新生成。',
      '',
      `视频地址：${videoUrl}`,
    ].join('\n');

    upsertNotebookNote({
      id: buildPhotoVideoNoteId(videoUrl),
      title: `${title} · 拍题讲解`,
      content: noteContent,
      subject: '数学',
      source: 'photo-video',
      tags: ['拍题视频', '解题讲解'],
    });

    setSavedToNotebook(true);
    void recordLearningEvent({
      eventType: 'notebook_saved',
      knowledgePoints,
      payload: {
        subject: '数学',
        title,
        source: 'photo-video',
        video_url: videoUrl,
      },
      weight: 1,
    });
    toast.success('已收藏到笔记本');
  };

  const handleHelpful = () => {
    void recordLearningEvent({
      eventType: 'feedback_like',
      knowledgePoints,
      payload: {
        subject: '数学',
        title,
        source: 'question-explanation',
      },
      weight: 0.7,
    });
    toast.success('已记录反馈');
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/photo-to-video" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <ArrowLeft className="h-5 w-5 text-gray-900" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 tracking-wide uppercase">{title}</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-black rounded-none aspect-video relative overflow-hidden group shadow-sm">
            {videoUrl ? (
              <video
                src={videoUrl}
                controls
                autoPlay
                className="h-full w-full"
                preload="metadata"
                onTimeUpdate={(event) => {
                  const video = event.currentTarget;
                  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
                  maxWatchedRatioRef.current = Math.max(
                    maxWatchedRatioRef.current,
                    Math.min(1, video.currentTime / video.duration),
                  );
                }}
                onEnded={() => recordVideoWatch(true)}
                onPause={() => recordVideoWatch(false)}
              >
                你的浏览器不支持视频播放。
              </video>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                <div className="text-center">
                  <div className="text-2xl font-semibold text-white mb-4">暂无可播放视频</div>
                  <p className="text-gray-400 text-sm uppercase tracking-wide font-bold">
                    请返回“拍照答疑”重新生成
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-black flex items-center justify-center text-xl">👨‍🏫</div>
              <div>
                <p className="font-bold text-gray-900 text-sm">AI 数学导师</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide font-bold mt-0.5">
                  专属讲解
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleHelpful}
                className="flex items-center gap-1.5 px-4 py-2 hover:bg-[#F4F3F0] text-gray-600 text-xs font-bold uppercase tracking-wide transition-colors"
              >
                <ThumbsUp className="h-4 w-4" /> 有用
              </button>
              <button
                onClick={handleSaveToNotebook}
                className="flex items-center gap-1.5 px-4 py-2 hover:bg-[#F4F3F0] text-gray-600 text-xs font-bold uppercase tracking-wide transition-colors"
              >
                <Bookmark className="h-4 w-4" /> 收藏
              </button>
              <button className="flex items-center gap-1.5 px-4 py-2 hover:bg-[#F4F3F0] text-gray-600 text-xs font-bold uppercase tracking-wide transition-colors">
                <Share2 className="h-4 w-4" /> 分享
              </button>
            </div>
          </div>
          {savedToNotebook ? (
            <div className="flex items-center justify-between bg-[#eef4ff] px-4 py-3 text-xs text-[#2f4a74]">
              <span>已加入笔记本，可继续粘贴或补充个人理解。</span>
              <button
                type="button"
                onClick={() => router.push('/notebook')}
                className="font-semibold underline underline-offset-2"
              >
                打开笔记本
              </button>
            </div>
          ) : null}
        </div>

        <div className="space-y-6">
          <div className="bg-white p-6 shadow-sm">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-6 flex items-center gap-2">
              <FileText className="h-4 w-4 text-gray-400" />
              步骤解析
            </h2>
            <div className="space-y-4">
              <div className="p-4 bg-[#F4F3F0]">
                <p className="text-sm font-bold text-gray-900">1. 识别题型与已知条件</p>
                <p className="text-xs text-gray-500 mt-1">系统先对图片进行 OCR 与题型归类。</p>
              </div>
              <div className="p-4 bg-[#F4F3F0]">
                <p className="text-sm font-bold text-gray-900">2. 生成解题路径</p>
                <p className="text-xs text-gray-500 mt-1">根据题型自动生成分步讲解脚本。</p>
              </div>
              <div className="p-4 bg-[#F4F3F0]">
                <p className="text-sm font-bold text-gray-900">3. 合成语音与视频</p>
                <p className="text-xs text-gray-500 mt-1">通过真实后端任务输出最终讲解视频。</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 shadow-sm">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-6 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-gray-400" />
              使用建议
            </h2>
            <p className="text-sm text-gray-600 leading-7">
              如果视频中有步骤不清楚，建议回到“拍照答疑”补充文字条件，例如“请详细展开第二步推导”。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
