'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  User,
  Bell,
  Monitor,
  Sparkles,
  Save,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Server,
  Settings,
  Palette,
  Volume2,
  Mic,
  FileText,
  Image as ImageIcon,
  Video,
  Globe,
  ChevronRight,
  Shield,
  Zap,
  Clock,
  Mail,
  Smartphone,
  GraduationCap,
  UserCircle,
} from 'lucide-react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/hooks/use-theme';
import { AVATAR_OPTIONS, useUserProfileStore } from '@/lib/store/user-profile';
import { useSettingsStore } from '@/lib/store/settings';
import type { ProviderId } from '@/lib/types/provider';
import { SettingsDialog } from '@/features/settings/components';
import type { SettingsSection as AdvancedSettingsSection } from '@/lib/types/settings';

type SettingsSection = 'profile' | 'ai' | 'notifications' | 'appearance';

interface ProviderMap {
  [providerId: string]: {
    baseUrl?: string;
    models?: string[];
  };
}

interface ProvidersResponse {
  success: boolean;
  providers?: ProviderMap;
  tts?: ProviderMap;
  asr?: ProviderMap;
  pdf?: ProviderMap;
  image?: ProviderMap;
  video?: ProviderMap;
  webSearch?: ProviderMap;
  error?: string;
}

interface HealthResponse {
  success: boolean;
  status?: string;
  version?: string;
  error?: string;
}

interface ProfileExtras {
  grade: string;
  email: string;
  phone: string;
}

interface NotificationSettings {
  classReminder: boolean;
  messagePush: boolean;
  weeklyDigest: boolean;
  aiSuggestion: boolean;
}

const PROFILE_EXTRA_STORAGE_KEY = 'anotherme:dashboard:profile:extra';
const PROFILE_EXTRA_LEGACY_STORAGE_KEY = 'openmaic:dashboard:profile:extra';
const NOTIFICATION_STORAGE_KEY = 'anotherme:dashboard:settings:notifications';
const NOTIFICATION_LEGACY_STORAGE_KEY = 'openmaic:dashboard:settings:notifications';

const DEFAULT_PROFILE_EXTRAS: ProfileExtras = {
  grade: '',
  email: '',
  phone: '',
};

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  classReminder: true,
  messagePush: true,
  weeklyDigest: false,
  aiSuggestion: true,
};

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
}

function saveToStorage<T>(key: string, value: T) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function loadWithLegacyKey<T>(key: string, legacyKey: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const hasPrimary = window.localStorage.getItem(key);
  if (hasPrimary) return loadFromStorage<T>(key, fallback);
  const hasLegacy = window.localStorage.getItem(legacyKey);
  if (hasLegacy) return loadFromStorage<T>(legacyKey, fallback);
  return fallback;
}

function maskApiKey(apiKey: string) {
  if (!apiKey) return '未填写';
  if (apiKey.length <= 8) return '已填写';
  return `${apiKey.slice(0, 4)}********${apiKey.slice(-4)}`;
}

const sectionIcons = {
  profile: UserCircle,
  ai: Sparkles,
  notifications: Bell,
  appearance: Palette,
};

const sectionLabels = {
  profile: '个人资料',
  ai: 'AI 偏好',
  notifications: '通知设置',
  appearance: '外观设置',
};

const sectionDescriptions = {
  profile: '管理您的个人信息和头像',
  ai: '配置模型提供商和 API 设置',
  notifications: '自定义消息提醒方式',
  appearance: '调整界面主题和显示',
};

export default function SettingsPage() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const avatar = useUserProfileStore((s) => s.avatar);
  const nickname = useUserProfileStore((s) => s.nickname);
  const bio = useUserProfileStore((s) => s.bio);
  const setAvatar = useUserProfileStore((s) => s.setAvatar);
  const setNickname = useUserProfileStore((s) => s.setNickname);
  const setBio = useUserProfileStore((s) => s.setBio);

  const providerId = useSettingsStore((s) => s.providerId);
  const providersConfig = useSettingsStore((s) => s.providersConfig);
  const setProviderConfig = useSettingsStore((s) => s.setProviderConfig);
  const fetchServerProviders = useSettingsStore((s) => s.fetchServerProviders);

  const [activeSection, setActiveSection] = useState<SettingsSection>('profile');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedSection, setAdvancedSection] = useState<AdvancedSettingsSection>('providers');

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [serverProviders, setServerProviders] = useState<ProvidersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [warningText, setWarningText] = useState('');

  const [profileDraft, setProfileDraft] = useState({
    nickname: '',
    bio: '',
    grade: '',
    email: '',
    phone: '',
  });
  const [profileSaved, setProfileSaved] = useState(false);

  const [notifications, setNotifications] = useState<NotificationSettings>(DEFAULT_NOTIFICATIONS);
  const [notificationSaved, setNotificationSaved] = useState(false);

  const providerIds = useMemo(
    () =>
      (Object.keys(providersConfig) as ProviderId[]).sort((a, b) =>
        (providersConfig[a]?.name || a).localeCompare(providersConfig[b]?.name || b, 'zh-CN'),
      ),
    [providersConfig],
  );

  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId>(providerId);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [baseUrlDraft, setBaseUrlDraft] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiSaved, setAiSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const profileExtra = loadWithLegacyKey<ProfileExtras>(
      PROFILE_EXTRA_STORAGE_KEY,
      PROFILE_EXTRA_LEGACY_STORAGE_KEY,
      DEFAULT_PROFILE_EXTRAS,
    );
    const notificationSettings = loadWithLegacyKey<NotificationSettings>(
      NOTIFICATION_STORAGE_KEY,
      NOTIFICATION_LEGACY_STORAGE_KEY,
      DEFAULT_NOTIFICATIONS,
    );

    setProfileDraft({
      nickname: nickname || '',
      bio: bio || '',
      ...profileExtra,
    });
    setNotifications(notificationSettings);
  }, [nickname, bio]);

  useEffect(() => {
    if (!providerIds.includes(selectedProviderId) && providerIds.length > 0) {
      setSelectedProviderId(providerIds[0]);
    }
  }, [providerIds, selectedProviderId]);

  useEffect(() => {
    const selected = providersConfig[selectedProviderId];
    setApiKeyDraft(selected?.apiKey || '');
    setBaseUrlDraft(selected?.baseUrl || '');
    setTestResult(null);
  }, [selectedProviderId, providersConfig]);

  useEffect(() => {
    let cancelled = false;

    async function loadBackendData() {
      try {
        const [providerResult, healthResult] = await Promise.allSettled([
          fetch('/api/server-providers', { method: 'GET', cache: 'no-store' }).then(async (resp) => {
            const payload = (await resp.json()) as ProvidersResponse;
            if (!resp.ok || !payload.success) {
              throw new Error(payload.error || '加载服务端提供商配置失败。');
            }
            return payload;
          }),
          fetch('/api/health', { method: 'GET', cache: 'no-store' }).then(async (resp) => {
            const payload = (await resp.json()) as HealthResponse;
            if (!resp.ok || !payload.success) {
              throw new Error(payload.error || '加载系统健康状态失败。');
            }
            return payload;
          }),
        ]);

        const hasProviderData = providerResult.status === 'fulfilled';
        const hasHealthData = healthResult.status === 'fulfilled';

        if (!hasProviderData && !hasHealthData) {
          throw new Error('设置加载失败：后端连接与健康状态都不可用。');
        }

        if (!cancelled) {
          if (hasProviderData) {
            setServerProviders(providerResult.value);
            void fetchServerProviders();
          }
          if (hasHealthData) {
            setHealth(healthResult.value);
          }
          if (!hasProviderData || !hasHealthData) {
            setWarningText('部分后端设置数据暂不可用，当前展示可获取的数据。');
          }
        }
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : '设置加载失败。');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadBackendData();

    return () => {
      cancelled = true;
    };
  }, [fetchServerProviders]);

  const serverConfiguredCount = useMemo(
    () => providerIds.filter((id) => providersConfig[id]?.isServerConfigured).length,
    [providerIds, providersConfig],
  );

  const backendModelCount = useMemo(
    () => Object.values(serverProviders?.providers || {}).reduce((acc, item) => acc + (item.models?.length || 0), 0),
    [serverProviders],
  );

  const selectedProvider = providersConfig[selectedProviderId];

  const handleSaveProfile = () => {
    setNickname(profileDraft.nickname.trim());
    setBio(profileDraft.bio.trim());
    saveToStorage(PROFILE_EXTRA_STORAGE_KEY, {
      grade: profileDraft.grade.trim(),
      email: profileDraft.email.trim(),
      phone: profileDraft.phone.trim(),
    });
    window.localStorage.removeItem(PROFILE_EXTRA_LEGACY_STORAGE_KEY);
    setProfileSaved(true);
    window.setTimeout(() => setProfileSaved(false), 1500);
  };

  const handleSaveAiPreference = () => {
    if (!selectedProvider) return;
    setProviderConfig(selectedProviderId, {
      apiKey: apiKeyDraft.trim(),
      baseUrl: baseUrlDraft.trim(),
    });
    setAiSaved(true);
    window.setTimeout(() => setAiSaved(false), 1500);
  };

  const handleVerifyProvider = async () => {
    if (!selectedProvider) return;
    const modelId = selectedProvider.models?.[0]?.id;
    if (!modelId) {
      setTestResult({ ok: false, text: '当前提供商没有可测试模型。' });
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const resp = await fetch('/api/verify-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKeyDraft.trim(),
          baseUrl: baseUrlDraft.trim(),
          model: `${selectedProviderId}:${modelId}`,
          providerType: selectedProvider.type,
          requiresApiKey: selectedProvider.requiresApiKey,
        }),
      });
      const payload = (await resp.json()) as {
        success: boolean;
        error?: string;
      };

      if (!resp.ok || !payload.success) {
        throw new Error(payload.error || '连接测试失败');
      }
      setTestResult({ ok: true, text: `连接成功（测试模型：${modelId}）` });
    } catch (error) {
      setTestResult({
        ok: false,
        text: error instanceof Error ? error.message : '连接测试失败',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveNotifications = () => {
    saveToStorage(NOTIFICATION_STORAGE_KEY, notifications);
    window.localStorage.removeItem(NOTIFICATION_LEGACY_STORAGE_KEY);
    setNotificationSaved(true);
    window.setTimeout(() => setNotificationSaved(false), 1500);
  };

  const openAdvancedSettings = (section: AdvancedSettingsSection) => {
    setAdvancedSection(section);
    setAdvancedOpen(true);
  };

  if (loading) {
    return (
      <div className="h-[50vh] flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex items-center gap-3 px-6 py-4 bg-card rounded-xl shadow-lg border border-border"
        >
          <Loader2 className="h-5 w-5 animate-spin text-[#E0573D]" />
          <span className="text-muted-foreground font-medium">正在加载设置...</span>
        </motion.div>
      </div>
    );
  }

  if (errorText) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-6 py-4 rounded-xl flex items-center gap-3"
      >
        <AlertCircle className="h-5 w-5 flex-shrink-0" />
        {errorText}
      </motion.div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12 px-4">
      {/* Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">设置</h1>
          <p className="text-muted-foreground mt-1">管理您的账户偏好和系统配置</p>
        </div>
        <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-card rounded-full shadow-sm border border-border">
          <Settings className="h-4 w-4 text-gray-400" />
          <span className="text-sm text-muted-foreground">系统设置</span>
        </div>
      </motion.div>

      {warningText ? (
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 px-5 py-4 rounded-xl flex items-center gap-3 text-sm"
        >
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          {warningText}
        </motion.div>
      ) : null}

      <div className="bg-card rounded-xl shadow-xl shadow-border/50 dark:shadow-slate-950/50 overflow-hidden border border-border flex flex-col md:flex-row min-h-[700px]">
        {/* Sidebar */}
        <div className="w-full md:w-80 bg-gradient-to-b from-gray-50/80 to-gray-100/50 dark:from-slate-950 dark:to-slate-900 p-6 space-y-2 shrink-0 border-b md:border-b-0 md:border-r border-border">
          <div className="mb-6 px-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">设置分类</p>
          </div>
          {(['profile', 'ai', 'notifications', 'appearance'] as const).map((section, index) => {
            const Icon = sectionIcons[section];
            const active = activeSection === section;
            return (
              <motion.button
                key={section}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                type="button"
                onClick={() => setActiveSection(section)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium transition-all duration-300 group',
                  active
                    ? 'bg-foreground text-background shadow-lg shadow-gray-900/25 dark:bg-white dark:text-slate-900 dark:shadow-white/10'
                    : 'text-gray-600 hover:bg-muted/50 dark:text-slate-400 dark:hover:bg-slate-800/50 hover:text-gray-900 dark:hover:text-slate-200'
                )}
              >
                <div className={cn(
                  'p-2 rounded-xl transition-all duration-300',
                  active 
                    ? 'bg-white/20 dark:bg-slate-900/20' 
                    : 'bg-muted/50 dark:bg-slate-800/50 group-hover:bg-gray-300/50 dark:group-hover:bg-slate-700/50'
                )}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 text-left">
                  <div className="font-semibold">{sectionLabels[section]}</div>
                  <div className={cn(
                    'text-xs transition-all duration-300',
                    active ? 'text-white/70 dark:text-slate-700' : 'text-gray-400 dark:text-slate-500'
                  )}>
                    {sectionDescriptions[section]}
                  </div>
                </div>
                <ChevronRight className={cn(
                  'h-4 w-4 transition-all duration-300',
                  active ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2'
                )} />
              </motion.button>
            );
          })}

          {/* Quick Stats */}
          <div className="mt-8 pt-6 border-t border-gray-200 dark:border-slate-800 px-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">系统状态</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Server className="h-3.5 w-3.5" />
                  后端状态
                </span>
                <span className={cn(
                  'flex items-center gap-1.5 font-medium',
                  health?.status === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'
                )}>
                  <span className={cn(
                    'h-2 w-2 rounded-full',
                    health?.status === 'ok' ? 'bg-green-500 animate-pulse' : 'bg-amber-500'
                  )} />
                  {health?.status === 'ok' ? '正常' : '异常'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5" />
                  模型提供商
                </span>
                <span className="font-medium text-foreground">{providerIds.length} 个</span>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-8 overflow-y-auto">
          
            {activeSection === 'profile' ? (
              <motion.div
                key="profile"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="space-y-8"
              >
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-gradient-to-br from-orange-100 to-rose-100 dark:from-orange-900/30 dark:to-rose-900/30 rounded-xl">
                    <User className="h-6 w-6 text-[#E0573D]" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-foreground">个人资料</h2>
                    <p className="text-sm text-muted-foreground">更新您的头像和基本信息</p>
                  </div>
                </div>

                {/* Avatar Section */}
                <motion.div
                  whileHover={{ scale: 1.01 }}
                  className="bg-gradient-to-br from-gray-50 to-white dark:from-slate-800/50 dark:to-slate-900/50 rounded-xl p-6 border border-border"
                >
                  <div className="flex items-center gap-6">
                    <motion.div
                      whileHover={{ scale: 1.05 }}
                      className="relative h-24 w-24 rounded-xl overflow-hidden shadow-xl ring-4 ring-white dark:ring-slate-800"
                    >
                      <Image
                        src={avatar || AVATAR_OPTIONS[0]}
                        alt="User"
                        fill
                        className="object-cover"
                        unoptimized
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
                    </motion.div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-foreground flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-amber-500" />
                        选择头像
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1">点击下方头像即可切换，支持多种风格</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-5 sm:grid-cols-8 gap-3 mt-6">
                    {AVATAR_OPTIONS.map((option, index) => (
                      <motion.button
                        key={option}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: index * 0.03 }}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.95 }}
                        type="button"
                        onClick={() => setAvatar(option)}
                        className={cn(
                          'relative aspect-square rounded-xl overflow-hidden transition-all duration-300',
                          avatar === option
                            ? 'ring-3 ring-[#E0573D] ring-offset-2 dark:ring-offset-slate-900 shadow-lg'
                            : 'hover:shadow-md ring-1 ring-gray-200 dark:ring-slate-700'
                        )}
                      >
                        <Image src={option} alt="avatar" fill className="object-cover" />
                        {avatar === option && (
                          <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="absolute inset-0 bg-primary/20 flex items-center justify-center"
                          >
                            <CheckCircle2 className="h-5 w-5 text-white drop-shadow-md" />
                          </motion.div>
                        )}
                      </motion.button>
                    ))}
                  </div>
                </motion.div>

                {/* Form Fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <User className="h-4 w-4 text-gray-400" />
                      姓名
                    </label>
                    <input
                      type="text"
                      value={profileDraft.nickname}
                      onChange={(e) => setProfileDraft((prev) => ({ ...prev, nickname: e.target.value }))}
                      className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-foreground placeholder:text-gray-400"
                      placeholder="请输入您的姓名"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <GraduationCap className="h-4 w-4 text-gray-400" />
                      年级
                    </label>
                    <input
                      type="text"
                      value={profileDraft.grade}
                      onChange={(e) => setProfileDraft((prev) => ({ ...prev, grade: e.target.value }))}
                      placeholder="例如：高二"
                      className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-foreground placeholder:text-gray-400"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Mail className="h-4 w-4 text-gray-400" />
                      邮箱
                    </label>
                    <input
                      type="email"
                      value={profileDraft.email}
                      onChange={(e) => setProfileDraft((prev) => ({ ...prev, email: e.target.value }))}
                      className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-foreground placeholder:text-gray-400"
                      placeholder="your@email.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Smartphone className="h-4 w-4 text-gray-400" />
                      电话号码
                    </label>
                    <input
                      type="tel"
                      value={profileDraft.phone}
                      onChange={(e) => setProfileDraft((prev) => ({ ...prev, phone: e.target.value }))}
                      className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-foreground placeholder:text-gray-400"
                      placeholder="请输入电话号码"
                    />
                  </div>
                  <div className="md:col-span-2 space-y-2">
                    <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <UserCircle className="h-4 w-4 text-gray-400" />
                      个人简介
                    </label>
                    <textarea
                      rows={4}
                      value={profileDraft.bio}
                      onChange={(e) => setProfileDraft((prev) => ({ ...prev, bio: e.target.value }))}
                      className="w-full px-4 py-3.5 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-foreground resize-none placeholder:text-gray-400"
                      placeholder="介绍一下自己..."
                    />
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    onClick={handleSaveProfile}
                    className="px-8 py-3.5 bg-gradient-to-r from-[#E0573D] to-[#c94d35] hover:from-[#c94d35] hover:to-[#b3452f] text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-[#E0573D]/25 hover:shadow-xl hover:shadow-[#E0573D]/30 inline-flex items-center gap-2"
                  >
                    <motion.span
                      initial={false}
                      animate={{ rotate: profileSaved ? 0 : 0 }}
                    >
                      {profileSaved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                    </motion.span>
                    {profileSaved ? '已保存' : '保存更改'}
                  </motion.button>
                </div>
              </motion.div>
            ) : null}

            {activeSection === 'ai' ? (
              <motion.div
                key="ai"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900/30 dark:to-purple-900/30 rounded-xl">
                      <Sparkles className="h-6 w-6 text-violet-600" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-foreground">AI 偏好</h2>
                      <p className="text-sm text-muted-foreground">配置模型提供商和 API 连接</p>
                    </div>
                  </div>
                  {/* Backend Status Badge */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="hidden sm:flex items-center gap-2 px-4 py-2 bg-card rounded-full shadow-sm border border-border"
                  >
                    <span className={cn(
                      'h-2 w-2 rounded-full',
                      health?.status === 'ok' ? 'bg-green-500 animate-pulse' : 'bg-amber-500'
                    )} />
                    <span className="text-sm font-medium text-foreground">
                      后端 {health?.status === 'ok' ? '正常' : '异常'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      v{health?.version || 'unknown'}
                    </span>
                  </motion.div>
                </div>

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left Column - Provider Selection */}
                  <div className="lg:col-span-2 space-y-4">
                    {/* Provider List */}
                    <div className="bg-gradient-to-br from-gray-50 to-white dark:from-slate-800/50 dark:to-slate-900/50 rounded-xl p-6 border border-border">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-foreground flex items-center gap-2">
                          <Settings className="h-4 w-4 text-violet-500" />
                          选择模型提供商
                        </h3>
                        <span className="text-xs text-muted-foreground">
                          {providerIds.length} 个可用
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {providerIds.map((id, index) => {
                          const item = providersConfig[id];
                          const active = selectedProviderId === id;
                          return (
                            <motion.button
                              key={id}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: 0.1 + index * 0.05 }}
                              whileHover={{ scale: 1.02, y: -2 }}
                              whileTap={{ scale: 0.98 }}
                              type="button"
                              onClick={() => setSelectedProviderId(id)}
                              className={cn(
                                'text-left p-4 rounded-xl border-2 transition-all duration-300 relative overflow-hidden',
                                active
                                  ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 shadow-lg shadow-violet-500/10'
                                  : 'border-border bg-card hover:border-primary/30 hover:shadow-md'
                              )}
                            >
                              {/* Active Indicator Line */}
                              {active && (
                                <motion.div
                                  layoutId="activeProvider"
                                  className="absolute left-0 top-0 bottom-0 w-1 bg-violet-500"
                                />
                              )}
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className={cn(
                                    'font-semibold truncate',
                                    active ? 'text-primary' : 'text-foreground'
                                  )}>
                                    {item?.name || id}
                                  </div>
                                  <div className="text-xs mt-1 text-muted-foreground">
                                    API：{maskApiKey(item?.apiKey || '')}
                                  </div>
                                </div>
                                {active && (
                                  <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className="p-1.5 bg-violet-500 rounded-full text-white"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                  </motion.div>
                                )}
                              </div>
                              {item?.isServerConfigured && (
                                <div className={cn(
                                  'inline-flex items-center gap-1.5 mt-3 px-2 py-0.5 rounded-full text-xs font-medium',
                                  active 
                                    ? 'bg-violet-200 dark:bg-violet-800 text-primary' 
                                    : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                )}>
                                  <Shield className="h-3 w-3" />
                                  服务端已配置
                                </div>
                              )}
                            </motion.button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Connection Settings */}
                    <div className="bg-card rounded-xl p-6 border border-border shadow-sm">
                      <div className="flex items-center gap-3 mb-5">
                        <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-xl">
                          <Server className="h-5 w-5 text-violet-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-foreground">
                            {selectedProvider?.name || selectedProviderId} 连接设置
                          </h3>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground flex items-center gap-2">
                            <Shield className="h-4 w-4 text-gray-400" />
                            API Key
                          </label>
                          <div className="relative">
                            <input
                              type={showApiKey ? 'text' : 'password'}
                              value={apiKeyDraft}
                              onChange={(e) => setApiKeyDraft(e.target.value)}
                              placeholder="请输入你的 API Key"
                              className="w-full px-4 py-3 pr-12 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-foreground text-sm"
                            />
                            <motion.button
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              type="button"
                              onClick={() => setShowApiKey((v) => !v)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </motion.button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground flex items-center gap-2">
                            <Globe className="h-4 w-4 text-gray-400" />
                            Base URL（可选）
                          </label>
                          <input
                            type="url"
                            value={baseUrlDraft}
                            onChange={(e) => setBaseUrlDraft(e.target.value)}
                            placeholder={selectedProvider?.defaultBaseUrl || 'https://api.example.com/v1'}
                            className="w-full px-4 py-3 bg-muted border border-border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none text-foreground text-sm"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3 pt-5">
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          type="button"
                          onClick={handleSaveAiPreference}
                          className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-violet-600/25 inline-flex items-center gap-2"
                        >
                          {aiSaved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                          {aiSaved ? '已保存' : '保存设置'}
                        </motion.button>
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          type="button"
                          onClick={handleVerifyProvider}
                          disabled={testing}
                          className="px-5 py-2.5 bg-muted hover:bg-muted/80 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-200 text-sm font-semibold rounded-xl transition-all inline-flex items-center gap-2 disabled:opacity-70"
                        >
                          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                          测试连接
                        </motion.button>
                      </div>

                      {testResult && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={cn(
                            'mt-4 px-4 py-3 rounded-xl flex items-center gap-3 text-sm',
                            testResult.ok
                              ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
                              : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                          )}
                        >
                          {testResult.ok ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> : <AlertCircle className="h-4 w-4 flex-shrink-0" />}
                          {testResult.text}
                        </motion.div>
                      )}
                    </div>
                  </div>

                  {/* Right Column - Stats & Quick Actions */}
                  <div className="space-y-4">
                    {/* Stats */}
                    <div className="bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl p-6 text-white">
                      <h3 className="font-semibold mb-4 flex items-center gap-2">
                        <Zap className="h-4 w-4" />
                        系统概览
                      </h3>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-violet-100 text-sm">可用提供商</span>
                          <span className="text-2xl font-bold">{providerIds.length}</span>
                        </div>
                        <div className="h-px bg-white/20" />
                        <div className="flex items-center justify-between">
                          <span className="text-violet-100 text-sm">已配置</span>
                          <span className="text-2xl font-bold">{serverConfiguredCount}</span>
                        </div>
                        <div className="h-px bg-white/20" />
                        <div className="flex items-center justify-between">
                          <span className="text-violet-100 text-sm">模型数量</span>
                          <span className="text-2xl font-bold">{backendModelCount}</span>
                        </div>
                      </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="bg-gradient-to-br from-gray-50 to-white dark:from-slate-800/50 dark:to-slate-900/50 rounded-xl p-5 border border-border">
                      <h3 className="font-semibold text-foreground mb-4 text-sm flex items-center gap-2">
                        <Settings className="h-4 w-4 text-amber-500" />
                        更多配置
                      </h3>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: 'TTS', section: 'tts' as const, icon: Volume2, color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' },
                          { label: 'ASR', section: 'asr' as const, icon: Mic, color: 'bg-green-100 dark:bg-green-900/30 text-green-600' },
                          { label: 'PDF', section: 'pdf' as const, icon: FileText, color: 'bg-red-100 dark:bg-red-900/30 text-red-600' },
                          { label: 'Image', section: 'image' as const, icon: ImageIcon, color: 'bg-pink-100 dark:bg-pink-900/30 text-pink-600' },
                          { label: 'Video', section: 'video' as const, icon: Video, color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600' },
                          { label: '搜索', section: 'web-search' as const, icon: Globe, color: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600' },
                        ].map((item) => (
                          <motion.button
                            key={item.label}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            type="button"
                            onClick={() => openAdvancedSettings(item.section)}
                            className="flex items-center gap-2 p-3 rounded-xl bg-card border border-border hover:border-primary/30 hover:shadow-md transition-all"
                          >
                            <div className={cn('p-1.5 rounded-lg', item.color)}>
                              <item.icon className="h-3.5 w-3.5" />
                            </div>
                            <span className="text-sm font-medium text-foreground">{item.label}</span>
                          </motion.button>
                        ))}
                      </div>
                    </div>

                    {/* Help Card */}
                    <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-xl p-5 border border-amber-100 dark:border-amber-800">
                      <div className="flex items-start gap-3">
                        <div className="p-2 bg-amber-100 dark:bg-amber-800 rounded-xl">
                          <Sparkles className="h-4 w-4 text-amber-600" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-amber-900 dark:text-amber-300 text-sm">提示</h4>
                          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 leading-relaxed">
                            配置 API Key 后，系统会自动保存并在所有 AI 功能中使用。点击测试连接可验证配置是否正确。
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : null}

            {activeSection === 'notifications' ? (
              <motion.div
                key="notifications"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="space-y-8"
              >
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-gradient-to-br from-blue-100 to-cyan-100 dark:from-blue-900/30 dark:to-cyan-900/30 rounded-xl">
                    <Bell className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-foreground">通知设置</h2>
                    <p className="text-sm text-muted-foreground">自定义您的消息提醒偏好</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {[
                    { 
                      key: 'classReminder', 
                      label: '课程提醒', 
                      desc: '上课前提醒与学习计划到期提醒',
                      icon: Clock,
                      color: 'amber'
                    },
                    { 
                      key: 'messagePush', 
                      label: '消息推送', 
                      desc: '消息中心会话与互动通知',
                      icon: Bell,
                      color: 'blue'
                    },
                    { 
                      key: 'weeklyDigest', 
                      label: '每周总结', 
                      desc: '每周学习数据摘要',
                      icon: Mail,
                      color: 'violet'
                    },
                    { 
                      key: 'aiSuggestion', 
                      label: 'AI 学习建议', 
                      desc: '根据学习轨迹给出建议任务',
                      icon: Sparkles,
                      color: 'green'
                    },
                  ].map((item, index) => {
                    const checked = notifications[item.key as keyof NotificationSettings];
                    const Icon = item.icon;
                    return (
                      <motion.div
                        key={item.key}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.1 }}
                        whileHover={{ scale: 1.01 }}
                        className={cn(
                          'flex items-center justify-between p-5 rounded-xl border-2 transition-all duration-300',
                          checked
                            ? 'bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20 border-blue-200 dark:border-blue-800'
                            : 'bg-muted border-border'
                        )}
                      >
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            'p-3 rounded-xl transition-colors',
                            checked 
                              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' 
                              : 'bg-gray-200 dark:bg-slate-700 text-muted-foreground'
                          )}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="font-semibold text-foreground">{item.label}</p>
                            <p className="text-sm text-muted-foreground">{item.desc}</p>
                          </div>
                        </div>
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          type="button"
                          onClick={() =>
                            setNotifications((prev) => ({
                              ...prev,
                              [item.key]: !prev[item.key as keyof NotificationSettings],
                            }))
                          }
                          className={cn(
                            'relative inline-flex h-7 w-12 items-center rounded-full transition-all duration-300',
                            checked
                              ? 'bg-blue-600 shadow-lg shadow-blue-600/25'
                              : 'bg-gray-300 dark:bg-slate-600'
                          )}
                        >
                          <motion.span
                            initial={false}
                            animate={{
                              x: checked ? 22 : 3,
                            }}
                            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                            className="inline-block h-5 w-5 rounded-full bg-white shadow-md"
                          />
                        </motion.button>
                      </motion.div>
                    );
                  })}
                </div>

                <div className="pt-4 flex justify-end">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    onClick={handleSaveNotifications}
                    className="px-8 py-3.5 bg-gradient-to-r from-[#E0573D] to-[#c94d35] hover:from-[#c94d35] hover:to-[#b3452f] text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-[#E0573D]/25 inline-flex items-center gap-2"
                  >
                    {notificationSaved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                    {notificationSaved ? '已保存' : '保存设置'}
                  </motion.button>
                </div>
              </motion.div>
            ) : null}

            {activeSection === 'appearance' ? (
              <motion.div
                key="appearance"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="space-y-8"
              >
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-gradient-to-br from-purple-100 to-pink-100 dark:from-purple-900/30 dark:to-pink-900/30 rounded-xl">
                    <Palette className="h-6 w-6 text-purple-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-foreground">外观设置</h2>
                    <p className="text-sm text-muted-foreground">自定义界面主题和显示模式</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {[
                    { 
                      id: 'light', 
                      title: '浅色模式', 
                      desc: '日间学习场景',
                      value: 'light' as const,
                      icon: SunIcon,
                      gradient: 'from-amber-100 to-orange-100',
                      darkGradient: 'from-amber-900/30 to-orange-900/30',
                    },
                    { 
                      id: 'dark', 
                      title: '黑夜模式', 
                      desc: '夜间学习更护眼',
                      value: 'dark' as const,
                      icon: MoonIcon,
                      gradient: 'from-indigo-100 to-purple-100',
                      darkGradient: 'from-indigo-900/30 to-purple-900/30',
                    },
                    { 
                      id: 'system', 
                      title: '跟随系统', 
                      desc: '自动匹配系统主题',
                      value: 'system' as const,
                      icon: Monitor,
                      gradient: 'from-gray-100 to-slate-100',
                      darkGradient: 'from-gray-800/50 to-slate-800/50',
                    },
                  ].map((mode, index) => {
                    const active = theme === mode.value;
                    const Icon = mode.icon;
                    return (
                      <motion.button
                        key={mode.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                        whileHover={{ scale: 1.03, y: -4 }}
                        whileTap={{ scale: 0.98 }}
                        type="button"
                        onClick={() => setTheme(mode.value)}
                        className={cn(
                          'relative text-left p-6 rounded-xl border-2 transition-all duration-300 overflow-hidden',
                          active
                            ? 'border-gray-900 dark:border-white shadow-xl'
                            : 'border-border hover:border-gray-200 dark:hover:border-slate-700 hover:shadow-lg'
                        )}
                      >
                        {/* Background Gradient */}
                        <div className={cn(
                          'absolute inset-0 bg-gradient-to-br transition-opacity duration-300',
                          mode.gradient,
                          mode.darkGradient.replace('from-', 'dark:from-').replace('to-', 'dark:to-'),
                          active ? 'opacity-100' : 'opacity-50'
                        )} />
                        
                        {/* Content */}
                        <div className="relative">
                          <div className={cn(
                            'w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-all duration-300',
                            active 
                              ? 'bg-gray-900 dark:bg-white text-white dark:text-slate-900 shadow-lg' 
                              : 'bg-white/80 dark:bg-slate-800/80 text-gray-600 dark:text-gray-400'
                          )}>
                            <Icon className="h-6 w-6" />
                          </div>
                          <p className={cn(
                            'font-bold text-lg transition-colors',
                            active ? 'text-gray-900 dark:text-white' : 'text-foreground'
                          )}>
                            {mode.title}
                          </p>
                          <p className={cn(
                            'text-sm mt-1 transition-colors',
                            active ? 'text-muted-foreground' : 'text-muted-foreground'
                          )}>
                            {mode.desc}
                          </p>
                          
                          {/* Active Indicator */}
                          {active && (
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className="absolute top-0 right-0 p-2"
                            >
                              <div className="w-6 h-6 rounded-full bg-gray-900 dark:bg-white flex items-center justify-center">
                                <CheckCircle2 className="h-4 w-4 text-white dark:text-slate-900" />
                              </div>
                            </motion.div>
                          )}
                        </div>
                      </motion.button>
                    );
                  })}
                </div>

                <div className="p-6 bg-gradient-to-r from-gray-50 to-white dark:from-slate-800/50 dark:to-slate-900/50 rounded-xl border border-border flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-gray-200 dark:bg-slate-700 rounded-xl">
                      <Monitor className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">当前生效主题</p>
                      <p className="text-sm text-muted-foreground">
                        {resolvedTheme === 'dark' ? '黑夜模式已生效' : '浅色模式已生效'}
                      </p>
                    </div>
                  </div>
                  <div className={cn(
                    'px-4 py-2 rounded-full text-sm font-medium',
                    resolvedTheme === 'dark' 
                      ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' 
                      : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                  )}>
                    {resolvedTheme === 'dark' ? 'Dark Mode' : 'Light Mode'}
                  </div>
                </div>

                <div className="pt-2">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    onClick={() => setTheme('dark')}
                    className="px-8 py-3.5 bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-slate-900 text-sm font-semibold rounded-xl transition-all shadow-lg inline-flex items-center gap-2"
                  >
                    <MoonIcon className="h-4 w-4" />
                    一键切换黑夜模式
                  </motion.button>
                </div>
              </motion.div>
            ) : null}

        </div>
      </div>
      <SettingsDialog
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        initialSection={advancedSection}
      />
    </div>
  );
}

// Icon Components
function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
