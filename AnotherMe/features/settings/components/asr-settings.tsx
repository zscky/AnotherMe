'use client';

import { useState, useRef } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { ASR_PROVIDERS } from '@/lib/audio/constants';
import type { ASRProviderId } from '@/lib/audio/types';
import { Mic, MicOff, CheckCircle2, XCircle, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';

const log = createLogger('ASRSettings');

interface ASRSettingsProps {
  selectedProviderId: ASRProviderId;
}

export function ASRSettings({ selectedProviderId }: ASRSettingsProps) {
  const { t } = useI18n();

  const asrLanguage = useSettingsStore((state) => state.asrLanguage);
  const asrProvidersConfig = useSettingsStore((state) => state.asrProvidersConfig);
  const setASRProviderConfig = useSettingsStore((state) => state.setASRProviderConfig);

  const asrProvider = ASR_PROVIDERS[selectedProviderId] ?? ASR_PROVIDERS['openai-whisper'];
  const isServerConfigured = !!asrProvidersConfig[selectedProviderId]?.isServerConfigured;

  const [showApiKey, setShowApiKey] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [asrResult, setASRResult] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Reset state when provider changes (derived state pattern)
  const [prevProviderId, setPrevProviderId] = useState(selectedProviderId);
  if (selectedProviderId !== prevProviderId) {
    setPrevProviderId(selectedProviderId);
    setShowApiKey(false);
    setTestStatus('idle');
    setTestMessage('');
    setASRResult('');
  }

  const handleToggleASRRecording = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
    } else {
      setASRResult('');
      setTestStatus('testing');
      setTestMessage('');

      if (selectedProviderId === 'browser-native') {
        const SpeechRecognitionCtor =
          (window as unknown as Record<string, unknown>).SpeechRecognition ||
          (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
        if (!SpeechRecognitionCtor) {
          setTestStatus('error');
          setTestMessage(t('settings.asrNotSupported'));
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Vendor-prefixed API without standard typings
        const recognition = new (SpeechRecognitionCtor as new () => any)();
        recognition.lang = asrLanguage || 'zh-CN';
        recognition.onresult = (event: {
          results: {
            [index: number]: { [index: number]: { transcript: string } };
          };
        }) => {
          const transcript = event.results[0][0].transcript;
          setASRResult(transcript);
          setTestStatus('success');
          setTestMessage(t('settings.asrTestSuccess'));
        };
        recognition.onerror = (event: { error: string }) => {
          setTestStatus('error');
          setTestMessage(t('settings.asrTestFailed') + ': ' + event.error);
        };
        recognition.onend = () => {
          setIsRecording(false);
        };
        recognition.start();
        setIsRecording(true);
      } else {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          const mediaRecorder = new MediaRecorder(stream);
          mediaRecorderRef.current = mediaRecorder;
          const audioChunks: Blob[] = [];
          mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
          };
          mediaRecorder.onstop = async () => {
            stream.getTracks().forEach((track) => track.stop());
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');
            formData.append('providerId', selectedProviderId);
            formData.append(
              'modelId',
              asrProvidersConfig[selectedProviderId]?.modelId || asrProvider.defaultModelId,
            );
            formData.append('language', asrLanguage);
            const apiKeyValue = asrProvidersConfig[selectedProviderId]?.apiKey;
            if (apiKeyValue?.trim()) formData.append('apiKey', apiKeyValue);
            const baseUrlValue = asrProvidersConfig[selectedProviderId]?.baseUrl;
            if (baseUrlValue?.trim()) formData.append('baseUrl', baseUrlValue);

            try {
              const response = await fetch('/api/transcription', {
                method: 'POST',
                body: formData,
              });
              if (response.ok) {
                const data = await response.json();
                setASRResult(data.text);
                setTestStatus('success');
                setTestMessage(t('settings.asrTestSuccess'));
              } else {
                setTestStatus('error');
                const errorData = await response
                  .json()
                  .catch(() => ({ error: response.statusText }));
                setTestMessage(errorData.details || errorData.error || t('settings.asrTestFailed'));
              }
            } catch (error) {
              log.error('ASR test failed:', error);
              setTestStatus('error');
              setTestMessage(t('settings.asrTestFailed'));
            }
          };
          mediaRecorder.start();
          setIsRecording(true);
        } catch (error) {
          log.error('Failed to access microphone:', error);
          setTestStatus('error');
          setTestMessage(t('settings.microphoneAccessFailed'));
        }
      }
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
      {(asrProvider.requiresApiKey || isServerConfigured) && (
        <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2.5">
              <Label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                {t('settings.asrApiKey')}
              </Label>
              <div className="relative">
                <Input
                  name={`asr-api-key-${selectedProviderId}`}
                  type={showApiKey ? 'text' : 'password'}
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={
                    isServerConfigured ? t('settings.optionalOverride') : t('settings.enterApiKey')
                  }
                  value={asrProvidersConfig[selectedProviderId]?.apiKey || ''}
                  onChange={(e) =>
                    setASRProviderConfig(selectedProviderId, {
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
            <div className="space-y-2.5">
              <Label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                {t('settings.asrBaseUrl')}
              </Label>
              <Input
                name={`asr-base-url-${selectedProviderId}`}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={asrProvider.defaultBaseUrl || t('settings.enterCustomBaseUrl')}
                value={asrProvidersConfig[selectedProviderId]?.baseUrl || ''}
                onChange={(e) =>
                  setASRProviderConfig(selectedProviderId, {
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
              asrProvidersConfig[selectedProviderId]?.baseUrl || asrProvider.defaultBaseUrl || '';
            if (!effectiveBaseUrl) return null;
            let endpointPath = '';
            switch (selectedProviderId) {
              case 'openai-whisper':
                endpointPath = '/audio/transcriptions';
                break;
              case 'qwen-asr':
                endpointPath = '/services/aigc/multimodal-generation/generation';
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

      {/* Test ASR */}
      <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
        <div className="space-y-3">
          <Label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
            {t('settings.testASR')}
          </Label>
          <div className="flex gap-3">
            <Input
              value={asrResult}
              readOnly
              placeholder={t('settings.asrResultPlaceholder')}
              className="flex-1 h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(248,242,234,0.65)] text-sm text-[rgba(46,39,33,0.92)] placeholder:text-[rgba(115,102,88,0.5)]"
            />
            <Button
              onClick={handleToggleASRRecording}
              disabled={
                asrProvider.requiresApiKey &&
                !asrProvidersConfig[selectedProviderId]?.apiKey?.trim() &&
                !isServerConfigured
              }
              className={cn(
                'gap-2 h-11 px-5 rounded-xl font-medium transition-all duration-200',
                isRecording
                  ? 'bg-[rgba(200,80,70,0.92)] hover:bg-[rgba(180,65,55,0.95)] text-white shadow-[0_8px_20px_rgba(200,80,70,0.25)]'
                  : 'bg-[rgba(71,54,31,0.92)] hover:bg-[rgba(55,41,24,0.96)] text-white shadow-[0_8px_20px_rgba(71,54,31,0.18)]'
              )}
            >
              {isRecording ? (
                <>
                  <MicOff className="h-4 w-4" />
                  {t('settings.stopRecording')}
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" />
                  {t('settings.startRecording')}
                </>
              )}
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

      {/* Model Selection */}
      {asrProvider.models.length > 0 && (
        <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
          <div className="space-y-3">
            <Label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
              {t('settings.ttsModel')}
            </Label>
            <Select
              value={asrProvidersConfig[selectedProviderId]?.modelId || asrProvider.defaultModelId}
              onValueChange={(value) => setASRProviderConfig(selectedProviderId, { modelId: value })}
            >
              <SelectTrigger className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)]">
                {asrProvider.models.map((model) => (
                  <SelectItem 
                    key={model.id} 
                    value={model.id}
                    className="text-sm text-[rgba(46,39,33,0.92)] focus:bg-[rgba(248,242,234,0.85)]"
                  >
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
