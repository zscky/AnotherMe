'use client';

import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { TTS_PROVIDERS, DEFAULT_TTS_VOICES } from '@/lib/audio/constants';
import type { TTSProviderId } from '@/lib/audio/types';
import { Volume2, Loader2, CheckCircle2, XCircle, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';
import { useTTSPreview } from '@/lib/audio/use-tts-preview';

const log = createLogger('TTSSettings');

interface TTSSettingsProps {
  selectedProviderId: TTSProviderId;
}

export function TTSSettings({ selectedProviderId }: TTSSettingsProps) {
  const { t } = useI18n();

  const ttsVoice = useSettingsStore((state) => state.ttsVoice);
  const ttsSpeed = useSettingsStore((state) => state.ttsSpeed);
  const ttsProvidersConfig = useSettingsStore((state) => state.ttsProvidersConfig);
  const setTTSProviderConfig = useSettingsStore((state) => state.setTTSProviderConfig);
  const activeProviderId = useSettingsStore((state) => state.ttsProviderId);

  // When testing a non-active provider, use that provider's default voice
  // instead of the active provider's voice (which may be incompatible).
  const effectiveVoice =
    selectedProviderId === activeProviderId
      ? ttsVoice
      : DEFAULT_TTS_VOICES[selectedProviderId] || 'default';

  const ttsProvider = TTS_PROVIDERS[selectedProviderId] ?? TTS_PROVIDERS['openai-tts'];
  const isServerConfigured = !!ttsProvidersConfig[selectedProviderId]?.isServerConfigured;

  const [showApiKey, setShowApiKey] = useState(false);
  const [testText, setTestText] = useState(t('settings.ttsTestTextDefault'));
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const { previewing: testingTTS, startPreview, stopPreview } = useTTSPreview();

  // Doubao TTS uses compound "appId:accessKey" — split for separate UI fields
  const isDoubao = selectedProviderId === 'doubao-tts';
  const rawApiKey = ttsProvidersConfig[selectedProviderId]?.apiKey || '';
  const doubaoColonIdx = rawApiKey.indexOf(':');
  const doubaoAppId = isDoubao && doubaoColonIdx > 0 ? rawApiKey.slice(0, doubaoColonIdx) : '';
  const doubaoAccessKey =
    isDoubao && doubaoColonIdx > 0
      ? rawApiKey.slice(doubaoColonIdx + 1)
      : isDoubao
        ? rawApiKey
        : '';

  const setDoubaoCompoundKey = (appId: string, accessKey: string) => {
    const combined = appId && accessKey ? `${appId}:${accessKey}` : appId || accessKey;
    setTTSProviderConfig(selectedProviderId, { apiKey: combined });
  };

  // Keep the sample text in sync with locale changes.
  useEffect(() => {
    setTestText(t('settings.ttsTestTextDefault'));
  }, [t]);

  // Reset transient UI state when switching providers.
  useEffect(() => {
    stopPreview();
    setShowApiKey(false);
    setTestStatus('idle');
    setTestMessage('');
  }, [selectedProviderId, stopPreview]);

  const handleTestTTS = async () => {
    if (!testText.trim()) return;

    setTestStatus('testing');
    setTestMessage('');

    try {
      await startPreview({
        text: testText,
        providerId: selectedProviderId,
        modelId: ttsProvidersConfig[selectedProviderId]?.modelId || ttsProvider.defaultModelId,
        voice: effectiveVoice,
        speed: ttsSpeed,
        apiKey: ttsProvidersConfig[selectedProviderId]?.apiKey,
        baseUrl: ttsProvidersConfig[selectedProviderId]?.baseUrl,
      });
      setTestStatus('success');
      setTestMessage(t('settings.ttsTestSuccess'));
    } catch (error) {
      log.error('TTS test failed:', error);
      setTestStatus('error');
      setTestMessage(
        error instanceof Error && error.message
          ? `${t('settings.ttsTestFailed')}: ${error.message}`
          : t('settings.ttsTestFailed'),
      );
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Server-configured notice */}
      {isServerConfigured && (
        <div className="rounded-2xl border border-[rgba(100,130,180,0.25)] bg-[rgba(235,245,255,0.72)] p-4 text-sm text-[rgba(60,90,130,0.92)] backdrop-blur-sm">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(100,130,180,0.18)]">
              <CheckCircle2 className="h-3 w-3 text-[rgba(60,90,130,0.92)]" />
            </div>
            <p className="leading-relaxed">{t('settings.serverConfiguredNotice')}</p>
          </div>
        </div>
      )}

      {/* API Key & Base URL */}
      {(ttsProvider.requiresApiKey || isServerConfigured) && (
        <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
          <div className={cn('grid gap-5', isDoubao ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2')}>
            {isDoubao ? (
              <>
                <div className="space-y-2.5">
                  <Label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                    {t('settings.doubaoAppId')}
                  </Label>
                  <div className="relative">
                    <Input
                      name={`tts-app-id-${selectedProviderId}`}
                      type={showApiKey ? 'text' : 'password'}
                      autoComplete="new-password"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder={
                        isServerConfigured
                          ? t('settings.optionalOverride')
                          : t('settings.enterApiKey')
                      }
                      value={doubaoAppId}
                      onChange={(e) => setDoubaoCompoundKey(e.target.value, doubaoAccessKey)}
                      className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] pr-10 text-sm font-mono text-[rgba(46,39,33,0.92)] placeholder:text-[rgba(115,102,88,0.5)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgba(120,106,93,0.65)] hover:text-[rgba(93,80,68,0.92)] transition-colors"
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2.5">
                  <Label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                    {t('settings.doubaoAccessKey')}
                  </Label>
                  <div className="relative">
                    <Input
                      name={`tts-access-key-${selectedProviderId}`}
                      type={showApiKey ? 'text' : 'password'}
                      autoComplete="new-password"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder={
                        isServerConfigured
                          ? t('settings.optionalOverride')
                          : t('settings.enterApiKey')
                      }
                      value={doubaoAccessKey}
                      onChange={(e) => setDoubaoCompoundKey(doubaoAppId, e.target.value)}
                      className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] pr-10 text-sm font-mono text-[rgba(46,39,33,0.92)] placeholder:text-[rgba(115,102,88,0.5)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgba(120,106,93,0.65)] hover:text-[rgba(93,80,68,0.92)] transition-colors"
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-2.5">
                <Label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                  {t('settings.ttsApiKey')}
                </Label>
                <div className="relative">
                  <Input
                    name={`tts-api-key-${selectedProviderId}`}
                    type={showApiKey ? 'text' : 'password'}
                    autoComplete="new-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={
                      isServerConfigured
                        ? t('settings.optionalOverride')
                        : t('settings.enterApiKey')
                    }
                    value={ttsProvidersConfig[selectedProviderId]?.apiKey || ''}
                    onChange={(e) =>
                      setTTSProviderConfig(selectedProviderId, {
                        apiKey: e.target.value,
                      })
                    }
                    className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] pr-10 text-sm font-mono text-[rgba(46,39,33,0.92)] placeholder:text-[rgba(115,102,88,0.5)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgba(120,106,93,0.65)] hover:text-[rgba(93,80,68,0.92)] transition-colors"
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}
            <div className="space-y-2.5">
              <Label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                {t('settings.ttsBaseUrl')}
              </Label>
              <Input
                name={`tts-base-url-${selectedProviderId}`}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={ttsProvider.defaultBaseUrl || t('settings.enterCustomBaseUrl')}
                value={ttsProvidersConfig[selectedProviderId]?.baseUrl || ''}
                onChange={(e) =>
                  setTTSProviderConfig(selectedProviderId, {
                    baseUrl: e.target.value,
                  })
                }
                className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] placeholder:text-[rgba(115,102,88,0.5)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]"
              />
            </div>
          </div>
          
          {/* Request URL Preview */}
          {(() => {
            const effectiveBaseUrl =
              ttsProvidersConfig[selectedProviderId]?.baseUrl || ttsProvider.defaultBaseUrl || '';
            if (!effectiveBaseUrl) return null;
            let endpointPath = '';
            switch (selectedProviderId) {
              case 'openai-tts':
              case 'glm-tts':
                endpointPath = '/audio/speech';
                break;
              case 'azure-tts':
                endpointPath = '/cognitiveservices/v1';
                break;
              case 'qwen-tts':
                endpointPath = '/services/aigc/multimodal-generation/generation';
                break;
              case 'elevenlabs-tts':
                endpointPath = '/text-to-speech';
                break;
              case 'doubao-tts':
                endpointPath = '/unidirectional';
                break;
            }
            if (!endpointPath) return null;
            return (
              <div className="mt-4 rounded-xl bg-[rgba(248,242,234,0.72)] px-4 py-3">
                <p className="text-xs text-[rgba(123,111,99,0.78)] break-all">
                  <span className="font-medium text-[rgba(93,80,68,0.85)]">{t('settings.requestUrl')}:</span>{' '}
                  <span className="font-mono text-[rgba(100,85,70,0.72)]">{effectiveBaseUrl + endpointPath}</span>
                </p>
              </div>
            );
          })()}
        </div>
      )}

      {/* Test TTS */}
      <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
        <div className="space-y-3">
          <Label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
            {t('settings.testTTS')}
          </Label>
          <div className="flex gap-3">
            <Input
              placeholder={t('settings.ttsTestTextPlaceholder')}
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              className="flex-1 h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] placeholder:text-[rgba(115,102,88,0.5)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]"
            />
            <Button
              onClick={handleTestTTS}
              disabled={
                testingTTS ||
                !testText.trim() ||
                (ttsProvider.requiresApiKey &&
                  !ttsProvidersConfig[selectedProviderId]?.apiKey?.trim() &&
                  !isServerConfigured)
              }
              className="gap-2 h-11 px-5 rounded-xl font-medium bg-[rgba(71,54,31,0.92)] hover:bg-[rgba(55,41,24,0.96)] text-white shadow-[0_8px_20px_rgba(71,54,31,0.18)] disabled:opacity-60 transition-all duration-200"
            >
              {testingTTS ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
              {t('settings.testTTS')}
            </Button>
          </div>
        </div>

        {testMessage && (
          <div
            className={cn(
              'mt-4 rounded-xl p-4 text-sm overflow-hidden backdrop-blur-sm',
              testStatus === 'success' &&
                'bg-[rgba(220,245,220,0.72)] text-[rgba(50,110,50,0.92)] border border-[rgba(120,180,120,0.25)]',
              testStatus === 'error' &&
                'bg-[rgba(255,230,230,0.72)] text-[rgba(150,60,60,0.92)] border border-[rgba(220,140,140,0.25)]',
            )}
          >
            <div className="flex items-start gap-3 min-w-0">
              <div className={cn(
                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                testStatus === 'success' ? 'bg-[rgba(120,180,120,0.2)]' : 'bg-[rgba(220,140,140,0.2)]'
              )}>
                {testStatus === 'success' && <CheckCircle2 className="h-3 w-3" />}
                {testStatus === 'error' && <XCircle className="h-3 w-3" />}
              </div>
              <p className="flex-1 min-w-0 break-all leading-relaxed">{testMessage}</p>
            </div>
          </div>
        )}
      </div>

      {/* Available Models */}
      {ttsProvider.models.length > 0 && (
        <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
          <div className="space-y-3">
            <Label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
              {t('settings.availableModels')}
            </Label>
            <div className="flex flex-wrap gap-2">
              {ttsProvider.models.map((model) => (
                <div
                  key={model.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[rgba(248,242,234,0.85)] border border-[rgba(133,88,34,0.1)] text-xs font-medium text-[rgba(93,80,68,0.85)]"
                >
                  <span className="size-1.5 rounded-full bg-[rgba(120,160,100,0.72)]" />
                  {model.name}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[rgba(123,111,99,0.65)]">
              {t('settings.modelSelectedViaVoice')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
