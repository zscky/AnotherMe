'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  AlertCircle,
  Camera,
  ChevronDown,
  CheckCircle2,
  Circle,
  CircleDashed,
  Clock,
  Filter,
  Loader2,
  NotebookPen,
  PlayCircle,
  Upload,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

interface ProblemVideoJobCreateResponse {
  success: boolean;
  jobId?: string;
  pollUrl?: string;
  pollIntervalMs?: number;
  error?: string;
}

interface ProblemVideoJobResponse {
  success: boolean;
  status?: 'queued' | 'running' | 'succeeded' | 'failed';
  step?: string;
  progress?: number;
  errorCode?: string;
  errorMessage?: string | null;
  details?: string;
  result?: {
    videoUrl?: string;
    durationSec?: number;
    scriptStepsCount?: number;
    debugBundleUrl?: string | null;
  };
  error?: string;
}

interface RecentVideoItem {
  id: string;
  title: string;
  date: string;
  duration: string;
  videoUrl?: string;
  status: 'succeeded' | 'failed';
  subject?: '数学';
  createdAt?: string;
}

const STORAGE_KEY = 'anotherme:dashboard:recent-problem-videos:v1';
const PROGRESS_STORAGE_KEY = 'anotherme:dashboard:problem-video-progress:v1';
const PROJECT_START_KEY = 'anotherme:dashboard:project-start-flag';
const PROGRESS_SNAPSHOT_VERSION = 1;
const PROGRESS_SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

type StageStatus = 'pending' | 'running' | 'completed' | 'failed';

interface PipelineStage {
  key: string;
  label: string;
  description: string;
}

interface ActiveJobMeta {
  jobId: string;
  pollUrl: string;
  pollIntervalMs: number;
  title: string;
}

interface PersistedProgressSnapshot {
  version: number;
  isGenerating: boolean;
  statusText: string;
  backendStepText: string;
  overallProgress: number;
  stageStatusMap: Record<string, StageStatus>;
  activeJob: ActiveJobMeta | null;
  updatedAt: string;
}

const PIPELINE_STAGES: PipelineStage[] = [
  { key: 'uploading_image', label: '上传图片', description: '将题目图片传输到视频生成网关' },
  { key: 'creating_job', label: '识别题目', description: '分析题目内容并生成讲解计划' },
  { key: 'queueing', label: '排队等待', description: '等待工作进程开始执行任务' },
  { key: 'running_anotherme2', label: '生成语音', description: '生成讲解语音和镜头脚本' },
  { key: 'uploading_artifacts', label: '渲染视频', description: '渲染并上传最终讲解视频' },
  { key: 'completed', label: '生成完成', description: '视频已可播放' },
];

const BACKEND_STEP_TO_STAGE: Record<string, string> = {
  queued: 'queueing',
  running_anotherme2: 'running_anotherme2',
  uploading_artifacts: 'uploading_artifacts',
  completed: 'completed',
  failed: 'completed',
};

const BACKEND_STEP_LABEL: Record<string, string> = {
  queued: '正在识别题目...',
  running_anotherme2: '正在生成讲解语音...',
  uploading_artifacts: '正在渲染视频...',
  completed: '处理完成',
  failed: '处理失败',
};

const RUNNING_TECH_HINTS = ['正在识别题目...', '正在生成讲解语音...', '正在渲染视频...'];

const TIME_OPTIONS = [
  { value: 'all', label: '全部时间' },
  { value: 'this_week', label: '本周' },
  { value: 'this_month', label: '本月' },
] as const;
type TimeFilter = (typeof TIME_OPTIONS)[number]['value'];

const LATEST_LOCAL_VIDEO_URL = '/videos/final_from_template_with_audio_custom_raw.mp4';
const LATEST_LOCAL_VIDEO_TITLE = '菱形折叠坐标法讲解（最新）';
const LATEST_LOCAL_VIDEO_ID = 'latest-local-problem-video';

function buildInitialStageStatus(): Record<string, StageStatus> {
  return PIPELINE_STAGES.reduce<Record<string, StageStatus>>((acc, stage) => {
    acc[stage.key] = 'pending';
    return acc;
  }, {});
}

function formatDuration(durationSec?: number) {
  if (!durationSec || durationSec <= 0) return '--';
  const total = Math.round(durationSec);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatDateLabel(date: Date) {
  const now = new Date();
  const sameDay =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();
  if (sameDay) {
    return `今天 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function buildLatestLocalVideoItem(): RecentVideoItem {
  return {
    id: LATEST_LOCAL_VIDEO_ID,
    title: LATEST_LOCAL_VIDEO_TITLE,
    date: formatDateLabel(new Date()),
    duration: '01:54',
    videoUrl: LATEST_LOCAL_VIDEO_URL,
    status: 'succeeded',
    subject: '数学',
    createdAt: new Date().toISOString(),
  };
}

function readRecentVideos(): RecentVideoItem[] {
  const latestVideo = buildLatestLocalVideoItem();
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [latestVideo];
    const parsed = JSON.parse(raw) as RecentVideoItem[];
    if (!Array.isArray(parsed)) return [latestVideo];
    const normalized = parsed.map((item) => ({
      ...item,
      subject: '数学' as const,
      createdAt: item.createdAt || new Date().toISOString(),
    }));
    const withoutDuplicate = normalized.filter(
      (item) => item.id !== LATEST_LOCAL_VIDEO_ID && item.videoUrl !== LATEST_LOCAL_VIDEO_URL,
    );
    return [latestVideo, ...withoutDuplicate].slice(0, 12);
  } catch {
    return [latestVideo];
  }
}

function saveRecentVideos(items: RecentVideoItem[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 12)));
}

function normalizeStageStatusMap(
  map: Record<string, StageStatus> | null | undefined,
): Record<string, StageStatus> {
  const base = buildInitialStageStatus();
  if (!map) return base;
  PIPELINE_STAGES.forEach((stage) => {
    const value = map[stage.key];
    if (value === 'pending' || value === 'running' || value === 'completed' || value === 'failed') {
      base[stage.key] = value;
    }
  });
  return base;
}

function clearProgressSnapshot() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(PROGRESS_STORAGE_KEY);
}

function readProgressSnapshot(): PersistedProgressSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedProgressSnapshot;
    if (!parsed || parsed.version !== PROGRESS_SNAPSHOT_VERSION) return null;
    const updatedAtMs = Date.parse(String(parsed.updatedAt || ''));
    if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > PROGRESS_SNAPSHOT_MAX_AGE_MS) {
      clearProgressSnapshot();
      return null;
    }

    return {
      version: PROGRESS_SNAPSHOT_VERSION,
      isGenerating: Boolean(parsed.isGenerating),
      statusText: String(parsed.statusText || ''),
      backendStepText: String(parsed.backendStepText || ''),
      overallProgress: Number(parsed.overallProgress || 0),
      stageStatusMap: normalizeStageStatusMap(parsed.stageStatusMap),
      activeJob: parsed.activeJob || null,
      updatedAt: String(parsed.updatedAt || ''),
    };
  } catch {
    return null;
  }
}

function shouldClearStaleJobProgress(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes('job not found') ||
    lowered.includes('404') ||
    lowered.includes('not found') ||
    lowered.includes('任务不存在')
  );
}

function hasRunningHintText(text: string): boolean {
  return text.includes('正在');
}

function saveProgressSnapshot(snapshot: PersistedProgressSnapshot) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(snapshot));
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isThisWeek(date: Date) {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(now.getDate() + mondayOffset);
  return date >= startOfWeek;
}

function isThisMonth(date: Date) {
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

export default function PhotoToVideoPage() {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [selectedImagePreviewUrl, setSelectedImagePreviewUrl] = useState('');
  const [isUploadDragActive, setIsUploadDragActive] = useState(false);
  const [problemText, setProblemText] = useState('');
  const generationSubject = '数学' as const;
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOpeningCamera, setIsOpeningCamera] = useState(false);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [statusText, setStatusText] = useState('');
  const [backendStepText, setBackendStepText] = useState('');
  const [runningHintIndex, setRunningHintIndex] = useState(0);
  const [errorText, setErrorText] = useState('');
  const [overallProgress, setOverallProgress] = useState(0);
  const [stageStatusMap, setStageStatusMap] = useState<Record<string, StageStatus>>(buildInitialStageStatus);
  const [activeJob, setActiveJob] = useState<ActiveJobMeta | null>(null);
  const [resumeJobOnLoad, setResumeJobOnLoad] = useState<ActiveJobMeta | null>(null);
  const [hasRestoredProgress, setHasRestoredProgress] = useState(false);
  const [recentVideos, setRecentVideos] = useState<RecentVideoItem[]>([]);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [autoAddAuxiliaryLines, setAutoAddAuxiliaryLines] = useState(true);

  const stopCameraStream = () => {
    const stream = cameraStreamRef.current;
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
  };

  useEffect(() => {
    setRecentVideos(readRecentVideos());

    // 检查是否是项目重启（sessionStorage 会被清除）
    const isProjectRestart = typeof window !== 'undefined' && !sessionStorage.getItem(PROJECT_START_KEY);

    if (isProjectRestart) {
      // 项目重启时，设置标志并清除进度
      sessionStorage.setItem(PROJECT_START_KEY, 'true');
      clearProgressSnapshot();
      setIsGenerating(false);
      setStatusText('');
      setBackendStepText('');
      setOverallProgress(0);
      setStageStatusMap(buildInitialStageStatus());
      setActiveJob(null);
      setResumeJobOnLoad(null);
      setHasRestoredProgress(true);
    } else {
      // 页面刷新时，恢复之前的进度
      const snapshot = readProgressSnapshot();
      if (snapshot) {
        const hasStaleRunningTextWithoutJob =
          !snapshot.isGenerating &&
          !snapshot.activeJob &&
          (hasRunningHintText(snapshot.statusText) || hasRunningHintText(snapshot.backendStepText));

        if (hasStaleRunningTextWithoutJob) {
          clearProgressSnapshot();
          setIsGenerating(false);
          setStatusText('');
          setBackendStepText('');
          setOverallProgress(0);
          setStageStatusMap(buildInitialStageStatus());
          setActiveJob(null);
          setResumeJobOnLoad(null);
          setHasRestoredProgress(true);
          return;
        }

        if (snapshot.isGenerating && !snapshot.activeJob) {
          clearProgressSnapshot();
          setIsGenerating(false);
          setStatusText('');
          setBackendStepText('');
          setOverallProgress(0);
          setStageStatusMap(buildInitialStageStatus());
          setActiveJob(null);
          setResumeJobOnLoad(null);
          setHasRestoredProgress(true);
          return;
        }

        setIsGenerating(snapshot.isGenerating);
        setStatusText(snapshot.statusText);
        setBackendStepText(snapshot.backendStepText);
        setOverallProgress(Math.max(0, Math.min(100, Math.round(snapshot.overallProgress))));
        setStageStatusMap(normalizeStageStatusMap(snapshot.stageStatusMap));
        setActiveJob(snapshot.activeJob);
        if (snapshot.isGenerating && snapshot.activeJob) {
          setResumeJobOnLoad(snapshot.activeJob);
        }
      }
      setHasRestoredProgress(true);
    }

    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
      stopCameraStream();
    };
  }, []);

  useEffect(() => {
    if (!hasRestoredProgress) return;
    saveProgressSnapshot({
      version: PROGRESS_SNAPSHOT_VERSION,
      isGenerating,
      statusText,
      backendStepText,
      overallProgress,
      stageStatusMap: normalizeStageStatusMap(stageStatusMap),
      activeJob,
      updatedAt: new Date().toISOString(),
    });
  }, [
    hasRestoredProgress,
    isGenerating,
    statusText,
    backendStepText,
    overallProgress,
    stageStatusMap,
    activeJob,
  ]);

  useEffect(() => {
    if (!isCameraModalOpen) return;
    const video = videoPreviewRef.current;
    const stream = cameraStreamRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    void video.play().catch(() => {
      setCameraError('摄像头预览启动失败，请检查权限后重试。');
    });

    return () => {
      video.srcObject = null;
    };
  }, [isCameraModalOpen]);

  useEffect(() => {
    if (!selectedImage) {
      setSelectedImagePreviewUrl('');
      return;
    }
    const nextUrl = URL.createObjectURL(selectedImage);
    setSelectedImagePreviewUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [selectedImage]);

  useEffect(() => {
    if (!isGenerating || !backendStepText || !backendStepText.includes('正在')) return;
    const timer = window.setInterval(() => {
      setRunningHintIndex((prev) => (prev + 1) % RUNNING_TECH_HINTS.length);
    }, 1800);
    return () => {
      window.clearInterval(timer);
    };
  }, [isGenerating, backendStepText]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!filterMenuRef.current) return;
      if (!filterMenuRef.current.contains(event.target as Node)) {
        setIsFilterMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, []);

  const canGenerate = useMemo(() => selectedImage && !isGenerating, [selectedImage, isGenerating]);

  const filteredRecentVideos = useMemo(() => {
    return recentVideos.filter((item) => {
      const itemDate = item.createdAt ? new Date(item.createdAt) : null;

      let hitTime = true;
      if (timeFilter === 'this_week') {
        hitTime = !!itemDate && isThisWeek(itemDate);
      } else if (timeFilter === 'this_month') {
        hitTime = !!itemDate && isThisMonth(itemDate);
      }
      return hitTime;
    });
  }, [recentVideos, timeFilter]);

  const activeProgressHint = useMemo(() => {
    if (!isGenerating) return backendStepText;
    if (!backendStepText || backendStepText === BACKEND_STEP_LABEL.running_anotherme2) {
      return RUNNING_TECH_HINTS[runningHintIndex];
    }
    return backendStepText;
  }, [isGenerating, backendStepText, runningHintIndex]);

  const setSelectedImageFromSource = (
    file: File,
    source: 'upload' | 'camera' | 'drag',
  ) => {
    if (!file.type.startsWith('image/')) {
      setErrorText('仅支持上传图片文件。');
      return;
    }
    setSelectedImage(file);
    setErrorText('');
    if (source === 'camera') {
      setStatusText('已拍照完成，可直接生成讲解视频。');
    } else if (source === 'drag') {
      setStatusText('已拖拽导入图片，可直接生成讲解视频。');
    } else {
      setStatusText('已选择本地图片，可直接生成讲解视频。');
    }
  };

  const openUploadPicker = async () => {
    setErrorText('');
    const pickerWindow = window as Window & {
      showOpenFilePicker?: (options?: unknown) => Promise<Array<{ getFile: () => Promise<File> }>>;
    };

    if (pickerWindow.showOpenFilePicker) {
      try {
        const handles = await pickerWindow.showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: '图片文件',
              accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.bmp'] },
            },
          ],
        });
        if (handles.length > 0) {
          const file = await handles[0].getFile();
          setSelectedImageFromSource(file, 'upload');
          return;
        }
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'name' in error &&
          (error as { name?: string }).name === 'AbortError'
        ) {
          return;
        }
      }
    }

    uploadInputRef.current?.click();
  };

  const openCameraCapture = async () => {
    if (isGenerating || isOpeningCamera) return;
    setErrorText('');
    setCameraError('');

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorText('当前浏览器不支持摄像头拍照，请改用“上传图片”。');
      return;
    }

    try {
      setIsOpeningCamera(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      stopCameraStream();
      cameraStreamRef.current = stream;
      setIsCameraModalOpen(true);
    } catch {
      setErrorText('无法访问摄像头，请检查浏览器权限设置。');
    } finally {
      setIsOpeningCamera(false);
    }
  };

  const closeCameraModal = () => {
    setIsCameraModalOpen(false);
    stopCameraStream();
  };

  const capturePhoto = async () => {
    const video = videoPreviewRef.current;
    if (!video) {
      setCameraError('摄像头尚未就绪，请稍后再试。');
      return;
    }

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      setCameraError('拍照失败：无法初始化画布。');
      return;
    }

    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92);
    });

    if (!blob) {
      setCameraError('拍照失败：未获取到图片数据。');
      return;
    }

    const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
    setSelectedImageFromSource(file, 'camera');
    closeCameraModal();
  };

  const appendRecentVideo = (item: RecentVideoItem) => {
    setRecentVideos((prev) => {
      const next = [item, ...prev.filter((video) => video.id !== item.id)].slice(0, 12);
      saveRecentVideos(next);
      return next;
    });
  };

  const resetProgressState = () => {
    setStageStatusMap(buildInitialStageStatus());
    setOverallProgress(0);
    setBackendStepText('');
  };

  const markStageAsActive = (stageKey: string) => {
    const stageIndex = PIPELINE_STAGES.findIndex((stage) => stage.key === stageKey);
    if (stageIndex < 0) return;
    setStageStatusMap((prev) => {
      const next = { ...prev };
      PIPELINE_STAGES.forEach((stage, index) => {
        if (index < stageIndex) next[stage.key] = 'completed';
        else if (index === stageIndex) next[stage.key] = 'running';
        else if (next[stage.key] !== 'failed') next[stage.key] = 'pending';
      });
      return next;
    });
  };

  const markAllStagesCompleted = () => {
    setStageStatusMap((prev) => {
      const next = { ...prev };
      PIPELINE_STAGES.forEach((stage) => {
        next[stage.key] = 'completed';
      });
      return next;
    });
    setOverallProgress(100);
    setBackendStepText(BACKEND_STEP_LABEL.completed);
  };

  const markStageFailed = (stageKey?: string) => {
    setStageStatusMap((prev) => {
      const failedKey =
        stageKey && PIPELINE_STAGES.some((stage) => stage.key === stageKey)
          ? stageKey
          : PIPELINE_STAGES.find((stage) => prev[stage.key] === 'running')?.key || 'completed';
      return {
        ...prev,
        [failedKey]: 'failed',
      };
    });
  };

  const applyBackendProgress = (step?: string, progress?: number) => {
    if (typeof progress === 'number') {
      setOverallProgress(Math.max(0, Math.min(100, Math.round(progress))));
    }
    if (!step) return;

    setBackendStepText(BACKEND_STEP_LABEL[step] || step);
    const stageKey = BACKEND_STEP_TO_STAGE[step];
    if (!stageKey) return;
    if (stageKey === 'completed' && step === 'completed') {
      markAllStagesCompleted();
      return;
    }
    markStageAsActive(stageKey);
  };

  const pollJobUntilTerminal = async (params: {
    jobMeta: ActiveJobMeta;
    controller: AbortController;
    redirectOnSuccess: boolean;
    pollImmediately?: boolean;
  }) => {
    const { jobMeta, controller, redirectOnSuccess, pollImmediately = false } = params;
    const maxPollAttempts = 240;

    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      if (!isMountedRef.current || controller.signal.aborted) {
        return;
      }

      if (!(pollImmediately && attempt === 0)) {
        await sleep(jobMeta.pollIntervalMs);
      }

      const pollResp = await fetch(jobMeta.pollUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });

      const pollPayload = (await pollResp.json()) as ProblemVideoJobResponse;
      if (!pollResp.ok || !pollPayload.success) {
        throw new Error(
          pollPayload.error ||
            pollPayload.errorMessage ||
            pollPayload.details ||
            '查询视频生成状态失败。',
        );
      }

      applyBackendProgress(pollPayload.step, pollPayload.progress);
      const progressText =
        typeof pollPayload.progress === 'number' ? ` (${Math.round(pollPayload.progress)}%)` : '';
      if (!isMountedRef.current || controller.signal.aborted) {
        return;
      }

      setStatusText(
        `${BACKEND_STEP_LABEL[pollPayload.step || ''] || pollPayload.step || '视频生成中'}${progressText}`,
      );

      if (pollPayload.status === 'failed') {
        setActiveJob(null);
        markStageFailed(BACKEND_STEP_TO_STAGE[pollPayload.step || ''] || undefined);
        setBackendStepText(BACKEND_STEP_LABEL.failed);
        setStatusText('任务执行失败，请重新生成。');
        setOverallProgress(100);
        throw new Error(pollPayload.errorMessage || '拍题视频生成失败。');
      }

      if (pollPayload.status === 'succeeded') {
        setActiveJob(null);
        markAllStagesCompleted();
        const result = pollPayload.result || {};
        const item: RecentVideoItem = {
          id: jobMeta.jobId,
          title: jobMeta.title,
          date: formatDateLabel(new Date()),
          duration: formatDuration(result.durationSec),
          videoUrl: result.videoUrl,
          status: 'succeeded',
          subject: generationSubject,
          createdAt: new Date().toISOString(),
        };

        appendRecentVideo(item);

        if (result.videoUrl && redirectOnSuccess) {
          toast.success('讲解视频已生成完成', {
            description: '正在为你打开播放页面。',
          });
          setStatusText('讲解视频已生成完成，正在跳转播放页...');
          await sleep(1200);
          const titleParam = encodeURIComponent(jobMeta.title);
          const urlParam = encodeURIComponent(result.videoUrl);
          window.location.href = `/question-explanation?title=${titleParam}&videoUrl=${urlParam}`;
          return;
        }

        setStatusText(result.videoUrl ? '讲解视频已生成完成，可在最近讲解记录中查看。' : '视频生成成功，但暂未返回可播放地址。');
        return;
      }
    }

    throw new Error('视频生成超时，请稍后重试。');
  };

  useEffect(() => {
    if (!resumeJobOnLoad) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setStatusText((prev) => prev || '正在恢复任务进度...');
    setResumeJobOnLoad(null);

    void pollJobUntilTerminal({
      jobMeta: resumeJobOnLoad,
      controller,
      redirectOnSuccess: false,
      pollImmediately: true,
    })
      .catch((error) => {
        if (!isMountedRef.current || controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : '恢复任务进度失败。';

        if (shouldClearStaleJobProgress(message)) {
          clearProgressSnapshot();
          setStatusText('');
          setBackendStepText('');
          setStageStatusMap(buildInitialStageStatus());
          setOverallProgress(0);
          setErrorText('');
          setActiveJob(null);
          return;
        }

        setStatusText('任务执行失败，请重新生成。');
        setBackendStepText(BACKEND_STEP_LABEL.failed);
        setOverallProgress(100);
        setErrorText(message);
        setActiveJob(null);
        markStageFailed();
      })
      .finally(() => {
        if (isMountedRef.current && !controller.signal.aborted) {
          setIsGenerating(false);
        }
      });
  }, [resumeJobOnLoad]);

  const handleGenerate = async () => {
    if (!selectedImage) {
      setErrorText('请先上传题目图片。');
      return;
    }

    setErrorText('');
    setIsGenerating(true);
    setStatusText('正在上传图片...');
    resetProgressState();
    markStageAsActive('uploading_image');
    setOverallProgress(5);
    const jobTitle = problemText.trim() || '拍题讲解';
    let createdJobMeta: ActiveJobMeta | null = null;

    try {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const formData = new FormData();
      formData.append('image', selectedImage);
      if (problemText.trim()) {
        formData.append('problemText', problemText.trim());
      }
      formData.append('autoAddAuxiliaryLines', autoAddAuxiliaryLines ? 'true' : 'false');

      const createResp = await fetch('/api/problem-video', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      const createPayload = (await createResp.json()) as ProblemVideoJobCreateResponse;
      if (!createResp.ok || !createPayload.success || !createPayload.jobId) {
        throw new Error(createPayload.error || '创建拍题讲解任务失败。');
      }

      markStageAsActive('creating_job');
      setOverallProgress((prev) => Math.max(prev, 8));
      await sleep(150);
      
      const pollUrl = createPayload.pollUrl || `/api/problem-video/${createPayload.jobId}`;
      const pollIntervalMs = createPayload.pollIntervalMs || 3000;
      createdJobMeta = {
        jobId: createPayload.jobId,
        pollUrl,
        pollIntervalMs,
        title: jobTitle,
      };
      
      // 关键修复：使用 flushSync 确保状态变化被同步更新并保存到 localStorage
      // 避免用户在轮询开始前刷新页面时看到过时的状态
      flushSync(() => {
        markStageAsActive('queueing');
        setStatusText('任务已创建，等待处理...');
        setOverallProgress((prev) => Math.max(prev, 10));
        setActiveJob(createdJobMeta);
      });

      await pollJobUntilTerminal({
        jobMeta: createdJobMeta,
        controller,
        redirectOnSuccess: true,
      });
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      markStageFailed();
      const message = error instanceof Error ? error.message : '生成失败，请稍后重试。';
      setStatusText('任务执行失败，请重新生成。');
      setBackendStepText(BACKEND_STEP_LABEL.failed);
      setOverallProgress(100);
      setErrorText(message);
      setActiveJob(null);
      toast.error('视频生成失败', { description: message });
      appendRecentVideo({
        id: `failed-${createdJobMeta?.jobId || Date.now()}`,
        title: jobTitle,
        date: formatDateLabel(new Date()),
        duration: '--',
        status: 'failed',
        subject: generationSubject,
        createdAt: new Date().toISOString(),
      });
    } finally {
      if (isMountedRef.current) {
        setIsGenerating(false);
      }
    }
  };

  const handleUploadInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    setSelectedImageFromSource(file, 'upload');
  };

  const handleUploadDrop: React.DragEventHandler<HTMLButtonElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsUploadDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    setSelectedImageFromSource(file, 'drag');
  };

  const handleUploadDragOver: React.DragEventHandler<HTMLButtonElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    if (!isUploadDragActive) setIsUploadDragActive(true);
  };

  const handleUploadDragLeave: React.DragEventHandler<HTMLButtonElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsUploadDragActive(false);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 tracking-wide uppercase">拍照答疑</h1>
      </div>

      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUploadInputChange}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <button
          type="button"
          onClick={openCameraCapture}
          disabled={isGenerating || isOpeningCamera}
          className="bg-[#4A6FA5] p-8 shadow-sm flex flex-col items-center justify-center text-center min-h-[300px] cursor-pointer hover:bg-[#3d5c8a] transition-colors group relative overflow-hidden"
        >
          <div className="absolute inset-0 opacity-10">
            <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#FFFFFF" strokeWidth="1" />
              </pattern>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>
          </div>
          <div className="h-20 w-20 bg-white rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform relative z-10 shadow-lg">
            {isOpeningCamera ? (
              <Loader2 className="h-10 w-10 text-gray-900 animate-spin" />
            ) : (
              <Camera className="h-10 w-10 text-gray-900" />
            )}
          </div>
          <h2 className="text-lg font-bold text-white uppercase tracking-wide relative z-10">拍照</h2>
          <p className="text-sm text-blue-100 mt-2 relative z-10">
            {selectedImage ? `当前图片：${selectedImage.name}` : '仅调用摄像头拍照'}
          </p>
        </button>

        <button
          type="button"
          onClick={openUploadPicker}
          disabled={isGenerating}
          onDrop={handleUploadDrop}
          onDragOver={handleUploadDragOver}
          onDragLeave={handleUploadDragLeave}
          className={`bg-white p-8 shadow-sm border-2 border-dashed flex flex-col items-center justify-center text-center min-h-[300px] cursor-pointer transition-colors group ${
            isUploadDragActive
              ? 'border-[#4A6FA5] bg-[#eef4ff]'
              : 'border-gray-300 hover:bg-[#F4F3F0]'
          }`}
        >
          {selectedImagePreviewUrl ? (
            <div className="w-full space-y-3">
              <div className="relative aspect-video w-full overflow-hidden border border-gray-200 bg-gray-50">
                <img
                  src={selectedImagePreviewUrl}
                  alt="题目预览"
                  className="h-full w-full object-contain"
                  draggable={false}
                />
              </div>
              <h2 className="text-lg font-bold text-gray-900 uppercase tracking-wide">上传图片</h2>
              <p className="text-xs text-gray-500 break-all">{selectedImage?.name}</p>
              <p className="text-xs text-gray-400">可继续拖拽替换，或点击重新选择</p>
            </div>
          ) : (
            <>
              <div className="h-20 w-20 bg-black rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform shadow-lg">
                <Upload className="h-10 w-10 text-white" />
              </div>
              <h2 className="text-lg font-bold text-gray-900 uppercase tracking-wide">上传图片</h2>
              <p className="text-sm text-gray-500 mt-2">仅从本地已有图片中选择</p>
              <p className="text-xs text-gray-400 mt-1">支持拖拽图片到此区域上传</p>
            </>
          )}
        </button>
      </div>

      <div className="bg-white p-6 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
          <div className="space-y-2">
            <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide">学科</label>
            <div className="inline-flex items-center px-3 py-2 text-sm font-semibold bg-[#F4F3F0] text-gray-800">
              数学（固定）
            </div>
          </div>
          <div className="text-xs text-gray-500">已选图片：{selectedImage ? selectedImage.name : '未选择'}</div>
        </div>
        <label className="block text-xs font-bold text-gray-900 uppercase tracking-wide">题目补充描述 (选填)</label>
        <textarea
          rows={3}
          value={problemText}
          onChange={(event) => setProblemText(event.target.value)}
          placeholder="例如：已知抛物线方程，求离心率并说明步骤"
          className="w-full px-4 py-3 bg-[#F4F3F0] border-none focus:ring-2 focus:ring-gray-300 outline-none transition-all resize-none text-sm"
        />
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="autoAddAuxiliaryLines"
            checked={autoAddAuxiliaryLines}
            onChange={(event) => setAutoAddAuxiliaryLines(event.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-[#4A6FA5] focus:ring-[#4A6FA5]"
          />
          <label htmlFor="autoAddAuxiliaryLines" className="text-sm text-gray-700 cursor-pointer">
            自动添加必要辅助线（严格按原图讲解）
          </label>
        </div>
        {statusText ? <p className="text-sm text-gray-600">{statusText}</p> : null}
        {(isGenerating || overallProgress > 0 || backendStepText) ? (
          <div className="rounded-md border border-[#dbe4f6] bg-[linear-gradient(135deg,#f8fbff_0%,#f3f7ff_60%,#edf4ff_100%)] p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-gray-700">
              <span>生成进度</span>
              <span>{overallProgress}%</span>
            </div>
            <div className="relative h-2 w-full bg-gray-200 overflow-hidden rounded-full">
              <div
                className="h-full bg-[#4A6FA5] transition-all duration-300"
                style={{ width: `${overallProgress}%` }}
              />
              <div className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-white/45 to-transparent animate-pulse" />
            </div>
            <div className="flex items-center gap-2 text-xs text-[#2f4a74] bg-white/60 border border-[#d9e4f7] px-3 py-2">
              <CircleDashed className="h-3.5 w-3.5 animate-spin" />
              <span>{activeProgressHint || '任务处理中...'}</span>
            </div>
            {backendStepText ? <p className="text-xs text-gray-600">当前阶段：{backendStepText}</p> : null}
            <div className="space-y-2">
              {PIPELINE_STAGES.map((stage) => {
                const stageStatus = stageStatusMap[stage.key] || 'pending';
                return (
                  <div key={stage.key} className="flex items-start gap-2 text-xs">
                    <div className="mt-0.5">
                      {stageStatus === 'completed' ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : null}
                      {stageStatus === 'running' ? (
                        <CircleDashed className="h-4 w-4 text-[#4A6FA5] animate-spin" />
                      ) : null}
                      {stageStatus === 'failed' ? (
                        <AlertCircle className="h-4 w-4 text-red-600" />
                      ) : null}
                      {stageStatus === 'pending' ? <Circle className="h-4 w-4 text-gray-400" /> : null}
                    </div>
                    <div>
                      <p
                        className={
                          stageStatus === 'running'
                            ? 'font-semibold text-[#314a71]'
                            : stageStatus === 'failed'
                              ? 'font-semibold text-red-700'
                              : 'font-medium text-gray-700'
                        }
                      >
                        {stage.label}
                      </p>
                      <p className="text-[11px] text-gray-500">{stage.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {errorText ? <p className="text-sm text-red-600">{errorText}</p> : null}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="inline-flex items-center gap-2 px-6 py-3 bg-[#E0573D] hover:bg-[#c94d35] text-white font-bold uppercase tracking-wide transition-all disabled:opacity-60 disabled:cursor-not-allowed text-sm"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              生成中...
            </>
          ) : (
            <>
              <PlayCircle className="h-4 w-4" />
              生成讲解视频
            </>
          )}
        </button>
      </div>

      {isCameraModalOpen ? (
        <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-bold uppercase tracking-wide text-gray-900">摄像头拍照</h3>
              <button
                type="button"
                onClick={closeCameraModal}
                className="inline-flex items-center justify-center h-8 w-8 text-gray-700 hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="relative aspect-video w-full bg-black overflow-hidden">
                <video ref={videoPreviewRef} className="h-full w-full object-cover" autoPlay muted playsInline />
              </div>
              {cameraError ? <p className="text-sm text-red-600">{cameraError}</p> : null}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeCameraModal}
                  className="px-4 py-2 text-sm font-semibold bg-gray-100 hover:bg-gray-200 text-gray-800"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={capturePhoto}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-[#E0573D] hover:bg-[#c94d35] text-white"
                >
                  <Camera className="h-4 w-4" />
                  拍照并使用
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="bg-white p-8 shadow-sm mt-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">最近讲解记录</h2>
          <div ref={filterMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setIsFilterMenuOpen((prev) => !prev)}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wide bg-[#F4F3F0] text-gray-800 hover:bg-[#e7e6e1]"
            >
              <Filter className="h-3.5 w-3.5" />
              筛选
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isFilterMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {isFilterMenuOpen ? (
              <div className="absolute right-0 top-11 z-20 w-64 bg-white border border-gray-200 shadow-lg p-3 space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-wide mb-1">科目</label>
                  <div className="w-full px-2 py-2 text-xs bg-[#F4F3F0] text-gray-700">数学（固定）</div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-wide mb-1">时间</label>
                  <select
                    value={timeFilter}
                    onChange={(event) => setTimeFilter(event.target.value as TimeFilter)}
                    className="w-full px-2 py-2 text-xs bg-[#F4F3F0] border-none outline-none"
                  >
                    {TIME_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {recentVideos.length === 0 ? (
          <p className="text-sm text-gray-500">暂无视频记录，先上传题目图片开始生成。</p>
        ) : filteredRecentVideos.length === 0 ? (
          <p className="text-sm text-gray-500">当前筛选条件下暂无记录。</p>
        ) : (
          <div className="max-h-[520px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {filteredRecentVideos.map((video) => (
                <Link
                  key={video.id}
                  href={
                    video.videoUrl
                      ? `/question-explanation?title=${encodeURIComponent(video.title)}&videoUrl=${encodeURIComponent(video.videoUrl)}`
                      : '/question-explanation'
                  }
                  className="group block"
                >
                  <div className="relative aspect-video rounded-none overflow-hidden bg-gray-100 mb-4">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#4A6FA5] via-[#6d89ba] to-[#9cb5de]" />
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                      <PlayCircle className="h-12 w-12 text-white opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all" />
                    </div>
                    <div className="absolute bottom-2 right-2 bg-black/80 text-white text-[10px] font-bold px-2 py-1 uppercase tracking-wide">
                      {video.duration}
                    </div>
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm mt-1 group-hover:text-[#E0573D] transition-colors line-clamp-2">
                      {video.title}
                    </h3>
                    <div className="mt-2 text-[10px] font-bold uppercase tracking-wide text-[#4A6FA5]">
                      学科：{video.subject || '未知'}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-gray-400 mt-2 uppercase tracking-wide font-bold">
                      <Clock className="h-3 w-3" />
                      {video.date}
                    </div>
                    <div className="mt-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                      状态：{video.status === 'succeeded' ? '成功' : '失败'}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white p-6 shadow-sm border border-[#ece8df]">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-gray-900">
              <NotebookPen className="h-4 w-4 text-[#4A6FA5]" />
              拍题笔记本
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              把拍题讲解内容沉淀为可编辑笔记，支持粘贴课堂知识卡片与剪贴板内容。
            </p>
          </div>
          <Link
            href="/notebook"
            className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-gray-800"
          >
            打开笔记本
          </Link>
        </div>
      </div>
    </div>
  );
}
