'use client';

import { useState, useMemo } from 'react';
import { X, Settings, Languages, Volume2, Mic, FileText, Image as ImageIcon, Video, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SettingsSection } from '@/lib/types/settings';
import type { ProviderId } from '@/lib/types/provider';
import type { TTSProviderId } from '@/lib/audio/types';
import type { ASRProviderId } from '@/lib/audio/types';
import type { PDFProviderId } from '@/lib/pdf/types';
import type { ImageProviderId, VideoProviderId } from '@/lib/media/types';
import type { WebSearchProviderId } from '@/lib/web-search/types';
import { TTS_PROVIDERS } from '@/lib/audio/constants';
import { ASR_PROVIDERS } from '@/lib/audio/constants';
import { PDF_PROVIDERS } from '@/lib/pdf/constants';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';
import { PROVIDERS } from '@/lib/ai/providers';
import { TTSSettings } from './tts-settings';
import { ASRSettings } from './asr-settings';
import { PDFSettings } from './pdf-settings';
import { ImageSettings } from './image-settings';
import { VideoSettings } from './video-settings';
import { WebSearchSettings } from './web-search-settings';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: SettingsSection;
}

const SECTIONS: { id: SettingsSection; label: string; icon: React.ElementType }[] = [
  { id: 'providers', label: 'settings.section.providers', icon: Settings },
  { id: 'tts', label: 'settings.section.tts', icon: Volume2 },
  { id: 'asr', label: 'settings.section.asr', icon: Mic },
  { id: 'pdf', label: 'settings.section.pdf', icon: FileText },
  { id: 'image', label: 'settings.section.image', icon: ImageIcon },
  { id: 'video', label: 'settings.section.video', icon: Video },
  { id: 'web-search', label: 'settings.section.webSearch', icon: Globe },
  { id: 'general', label: 'settings.section.general', icon: Settings },
];

export function SettingsDialog({ open, onOpenChange, initialSection = 'providers' }: SettingsDialogProps) {
  const { t, locale, setLocale } = useI18n();
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const [mounted, setMounted] = useState(false);

  // Provider selection states
  const providerId = useSettingsStore((s) => s.providerId);
  const providersConfig = useSettingsStore((s) => s.providersConfig);
  const setProviderId = useSettingsStore((s) => s.setProvider);

  const ttsProviderId = useSettingsStore((s) => s.ttsProviderId);
  const ttsProvidersConfig = useSettingsStore((s) => s.ttsProvidersConfig);
  const setTTSProviderId = useSettingsStore((s) => s.setTTSProvider);

  const asrProviderId = useSettingsStore((s) => s.asrProviderId);
  const asrProvidersConfig = useSettingsStore((s) => s.asrProvidersConfig);
  const setASRProviderId = useSettingsStore((s) => s.setASRProvider);

  const pdfProviderId = useSettingsStore((s) => s.pdfProviderId);
  const pdfProvidersConfig = useSettingsStore((s) => s.pdfProvidersConfig);
  const setPDFProviderId = useSettingsStore((s) => s.setPDFProvider);

  const imageProviderId = useSettingsStore((s) => s.imageProviderId);
  const imageProvidersConfig = useSettingsStore((s) => s.imageProvidersConfig);
  const setImageProviderId = useSettingsStore((s) => s.setImageProvider);

  const videoProviderId = useSettingsStore((s) => s.videoProviderId);
  const videoProvidersConfig = useSettingsStore((s) => s.videoProvidersConfig);
  const setVideoProviderId = useSettingsStore((s) => s.setVideoProvider);

  const webSearchProviderId = useSettingsStore((s) => s.webSearchProviderId);
  const webSearchProvidersConfig = useSettingsStore((s) => s.webSearchProvidersConfig);
  const setWebSearchProviderId = useSettingsStore((s) => s.setWebSearchProvider);

  const asrLanguage = useSettingsStore((s) => s.asrLanguage);
  const setASRLanguage = useSettingsStore((s) => s.setASRLanguage);

  const ttsVoice = useSettingsStore((s) => s.ttsVoice);
  const setTTSVoice = useSettingsStore((s) => s.setTTSVoice);
  const ttsSpeed = useSettingsStore((s) => s.ttsSpeed);
  const setTTSSpeed = useSettingsStore((s) => s.setTTSSpeed);

  // Derive mounted state during render to avoid setState in effect
  const isClient = typeof window !== 'undefined';
  if (!mounted && isClient) {
    setMounted(true);
  }

  // Derive active section during render to avoid setState in effect
  if (open && activeSection !== initialSection) {
    setActiveSection(initialSection);
  }

  const providerIds = useMemo(
    () =>
      (Object.keys(providersConfig) as ProviderId[]).sort((a, b) =>
        (providersConfig[a]?.name || a).localeCompare(providersConfig[b]?.name || b, 'zh-CN'),
      ),
    [providersConfig],
  );

  const ttsProviderIds = useMemo(
    () =>
      (Object.keys(TTS_PROVIDERS) as TTSProviderId[]).sort((a, b) =>
        (TTS_PROVIDERS[a]?.name || a).localeCompare(TTS_PROVIDERS[b]?.name || b, 'zh-CN'),
      ),
    [],
  );

  const asrProviderIds = useMemo(
    () =>
      (Object.keys(ASR_PROVIDERS) as ASRProviderId[]).sort((a, b) =>
        (ASR_PROVIDERS[a]?.name || a).localeCompare(ASR_PROVIDERS[b]?.name || b, 'zh-CN'),
      ),
    [],
  );

  const pdfProviderIds = useMemo(
    () =>
      (Object.keys(PDF_PROVIDERS) as PDFProviderId[]).sort((a, b) =>
        (PDF_PROVIDERS[a]?.name || a).localeCompare(PDF_PROVIDERS[b]?.name || b, 'zh-CN'),
      ),
    [],
  );

  const imageProviderIds = useMemo(
    () =>
      (Object.keys(IMAGE_PROVIDERS) as ImageProviderId[]).sort((a, b) =>
        (IMAGE_PROVIDERS[a]?.name || a).localeCompare(IMAGE_PROVIDERS[b]?.name || b, 'zh-CN'),
      ),
    [],
  );

  const videoProviderIds = useMemo(
    () =>
      (Object.keys(VIDEO_PROVIDERS) as VideoProviderId[]).sort((a, b) =>
        (VIDEO_PROVIDERS[a]?.name || a).localeCompare(VIDEO_PROVIDERS[b]?.name || b, 'zh-CN'),
      ),
    [],
  );

  const webSearchProviderIds = useMemo(
    () =>
      (Object.keys(WEB_SEARCH_PROVIDERS) as WebSearchProviderId[]).sort((a, b) =>
        (WEB_SEARCH_PROVIDERS[a]?.name || a).localeCompare(WEB_SEARCH_PROVIDERS[b]?.name || b, 'zh-CN'),
      ),
    [],
  );

  const currentTTSProvider = TTS_PROVIDERS[ttsProviderId];
  const currentTTSVoice = currentTTSProvider?.voices.find((v) => v.id === ttsVoice);

  if (!mounted) return null;

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 sm:pt-16">
          <div
            className="absolute inset-0 bg-[rgba(61,43,16,0.35)] backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />
          <div className="relative z-10 flex w-full max-w-6xl mx-4 h-[calc(100vh-6rem)] max-h-[800px] rounded-3xl overflow-hidden shadow-[0_48px_120px_rgba(61,43,16,0.28)]">
            {/* Sidebar */}
            <div className="w-64 shrink-0 bg-[rgba(255,252,247,0.98)] border-r border-[rgba(133,88,34,0.1)] flex flex-col">
              <div className="p-6 border-b border-[rgba(133,88,34,0.08)]">
                <h2 className="text-lg font-bold text-[rgba(46,39,33,0.92)]">{t('settings.title')}</h2>
                <p className="text-xs text-[rgba(123,111,99,0.72)] mt-1">{t('settings.subtitle')}</p>
              </div>
              <nav className="flex-1 overflow-y-auto p-4 space-y-1">
                {SECTIONS.map((section) => {
                  const Icon = section.icon;
                  const isActive = activeSection === section.id;
                  return (
                    <button
                      key={section.id}
                      onClick={() => setActiveSection(section.id)}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
                        isActive
                          ? 'bg-[rgba(71,54,31,0.92)] text-white shadow-[0_8px_20px_rgba(71,54,31,0.18)]'
                          : 'text-[rgba(93,80,68,0.82)] hover:bg-[rgba(248,242,234,0.72)] hover:text-[rgba(46,39,33,0.92)]'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {t(section.label)}
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Content */}
            <div className="flex-1 bg-[rgba(255,252,247,0.95)] flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-8 py-5 border-b border-[rgba(133,88,34,0.08)]">
                <h3 className="text-base font-semibold text-[rgba(46,39,33,0.92)]">
                  {t(SECTIONS.find((s) => s.id === activeSection)?.label || '')}
                </h3>
                <button
                  onClick={() => onOpenChange(false)}
                  className="p-2 rounded-xl text-[rgba(120,106,93,0.65)] hover:text-[rgba(93,80,68,0.92)] hover:bg-[rgba(248,242,234,0.85)] transition-all"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto p-8">
                {activeSection === 'providers' && (
                  <div className="space-y-6 max-w-3xl">
                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-3">
                        <label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                          {t('settings.selectProvider')}
                        </label>
                        <Select value={providerId} onValueChange={(v) => setProviderId(v as ProviderId)}>
                          <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                            {providerIds.map((id) => (
                              <SelectItem 
                                key={id} 
                                value={id}
                                className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]"
                              >
                                {providersConfig[id]?.name || id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-5">
                        <div className="space-y-3">
                          <label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                            {t('settings.apiKey')}
                          </label>
                          <input
                            type="password"
                            placeholder={t('settings.enterApiKey')}
                            value={providersConfig[providerId]?.apiKey || ''}
                            readOnly
                            className="w-full h-11 px-4 rounded-xl border border-[rgba(133,88,34,0.14)] bg-[rgba(248,242,234,0.65)] text-sm text-[rgba(46,39,33,0.72)]"
                          />
                        </div>
                        <div className="space-y-3">
                          <label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                            {t('settings.baseUrl')}
                          </label>
                          <input
                            type="url"
                            placeholder={PROVIDERS[providerId]?.defaultBaseUrl}
                            value={providersConfig[providerId]?.baseUrl || ''}
                            readOnly
                            className="w-full h-11 px-4 rounded-xl border border-[rgba(133,88,34,0.14)] bg-[rgba(248,242,234,0.65)] text-sm text-[rgba(46,39,33,0.72)]"
                          />
                        </div>
                      </div>
                      <p className="mt-4 text-xs text-[rgba(123,111,99,0.65)]">
                        {t('settings.quickConfigOnly')}
                      </p>
                    </div>
                  </div>
                )}

                {activeSection === 'tts' && (
                  <div className="space-y-6">
                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-3">
                        <label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                          {t('settings.selectTTSProvider')}
                        </label>
                        <Select value={ttsProviderId} onValueChange={(v) => setTTSProviderId(v as TTSProviderId)}>
                          <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                            {ttsProviderIds.map((id) => (
                              <SelectItem 
                                key={id} 
                                value={id}
                                className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]"
                              >
                                {TTS_PROVIDERS[id]?.name || id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* TTS Voice Selection */}
                    {currentTTSProvider && currentTTSProvider.voices.length > 0 && (
                      <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                        <div className="space-y-3">
                          <label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                            {t('settings.ttsVoice')}
                          </label>
                          <Select value={ttsVoice} onValueChange={setTTSVoice}>
                            <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                              <SelectValue placeholder={t('settings.selectVoice')} />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)] max-h-[280px]">
                              {currentTTSProvider.voices.map((voice) => (
                                <SelectItem 
                                  key={voice.id} 
                                  value={voice.id}
                                  className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]"
                                >
                                  {voice.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {currentTTSVoice && (
                            <p className="text-xs text-[rgba(123,111,99,0.65)]">
                              {currentTTSVoice.description}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* TTS Speed Control */}
                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                            {t('settings.ttsSpeed')}
                          </label>
                          <span className="text-sm font-medium text-[rgba(71,54,31,0.92)] px-3 py-1 rounded-lg bg-[rgba(248,242,234,0.85)]">
                            {ttsSpeed.toFixed(1)}x
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="2.0"
                          step="0.1"
                          value={ttsSpeed}
                          onChange={(e) => setTTSSpeed(parseFloat(e.target.value))}
                          className="w-full h-2 bg-[rgba(133,88,34,0.12)] rounded-lg appearance-none cursor-pointer accent-[rgba(71,54,31,0.92)]"
                        />
                        <div className="flex justify-between text-xs text-[rgba(123,111,99,0.65)]">
                          <span>0.5x</span>
                          <span>1.0x</span>
                          <span>1.5x</span>
                          <span>2.0x</span>
                        </div>
                      </div>
                    </div>

                    <TTSSettings selectedProviderId={ttsProviderId} />
                  </div>
                )}

                {activeSection === 'asr' && (
                  <div className="space-y-6">
                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-3">
                        <label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                          {t('settings.selectASRProvider')}
                        </label>
                        <Select value={asrProviderId} onValueChange={(v) => setASRProviderId(v as ASRProviderId)}>
                          <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                            {asrProviderIds.map((id) => (
                              <SelectItem 
                                key={id} 
                                value={id}
                                className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]"
                              >
                                {ASR_PROVIDERS[id]?.name || id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-3">
                        <label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                          {t('settings.asrLanguage')}
                        </label>
                        <Select value={asrLanguage} onValueChange={setASRLanguage}>
                          <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                            <SelectItem value="zh-CN" className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]">
                              {t('settings.languageZhCN')}
                            </SelectItem>
                            <SelectItem value="en-US" className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]">
                              {t('settings.languageEnUS')}
                            </SelectItem>
                            <SelectItem value="ja-JP" className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]">
                              {t('settings.languageJaJP')}
                            </SelectItem>
                            <SelectItem value="ko-KR" className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]">
                              {t('settings.languageKoKR')}
                            </SelectItem>
                            <SelectItem value="fr-FR" className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]">
                              {t('settings.languageFrFR')}
                            </SelectItem>
                            <SelectItem value="de-DE" className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]">
                              {t('settings.languageDeDE')}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <ASRSettings selectedProviderId={asrProviderId} />
                  </div>
                )}

                {activeSection === 'pdf' && (
                  <div className="space-y-6">
                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-3">
                        <label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                          {t('settings.selectPDFProvider')}
                        </label>
                        <Select value={pdfProviderId} onValueChange={(v) => setPDFProviderId(v as PDFProviderId)}>
                          <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                            {pdfProviderIds.map((id) => (
                              <SelectItem 
                                key={id} 
                                value={id}
                                className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]"
                              >
                                {PDF_PROVIDERS[id]?.name || id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <PDFSettings selectedProviderId={pdfProviderId} />
                  </div>
                )}

                {activeSection === 'image' && (
                  <div className="space-y-6">
                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-3">
                        <label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                          {t('settings.selectImageProvider')}
                        </label>
                        <Select
                          value={imageProviderId}
                          onValueChange={(v) => setImageProviderId(v as ImageProviderId)}
                        >
                          <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                            {imageProviderIds.map((id) => (
                              <SelectItem 
                                key={id} 
                                value={id}
                                className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]"
                              >
                                {IMAGE_PROVIDERS[id]?.name || id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <ImageSettings selectedProviderId={imageProviderId} />
                  </div>
                )}

                {activeSection === 'video' && (
                  <div className="space-y-6">
                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-3">
                        <label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                          {t('settings.selectVideoProvider')}
                        </label>
                        <Select
                          value={videoProviderId}
                          onValueChange={(v) => setVideoProviderId(v as VideoProviderId)}
                        >
                          <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                            {videoProviderIds.map((id) => (
                              <SelectItem 
                                key={id} 
                                value={id}
                                className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]"
                              >
                                {VIDEO_PROVIDERS[id]?.name || id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <VideoSettings selectedProviderId={videoProviderId} />
                  </div>
                )}

                {activeSection === 'web-search' && (
                  <div className="space-y-6">
                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-3">
                        <label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                          {t('settings.selectWebSearchProvider')}
                        </label>
                        <Select
                          value={webSearchProviderId}
                          onValueChange={(v) => setWebSearchProviderId(v as WebSearchProviderId)}
                        >
                          <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                            {webSearchProviderIds.map((id) => (
                              <SelectItem 
                                key={id} 
                                value={id}
                                className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]"
                              >
                                {WEB_SEARCH_PROVIDERS[id]?.name || id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <WebSearchSettings selectedProviderId={webSearchProviderId} />
                  </div>
                )}

                {activeSection === 'general' && (
                  <div className="space-y-6 max-w-3xl">
                    <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
                      <div className="space-y-3">
                        <label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide flex items-center gap-2">
                          <Languages className="h-4 w-4" />
                          {t('settings.language')}
                        </label>
                        <Select value={locale} onValueChange={(v) => setLocale(v as 'zh-CN' | 'en-US')}>
                          <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                            <SelectItem value="zh-CN" className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]">
                              简体中文
                            </SelectItem>
                            <SelectItem value="en-US" className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]">
                              English
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
