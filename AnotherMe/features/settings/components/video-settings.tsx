'use client';

import { useState, useCallback, useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Zap,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VideoProviderId } from '@/lib/media/types';

interface VideoSettingsProps {
  selectedProviderId: VideoProviderId;
}

export function VideoSettings({ selectedProviderId }: VideoSettingsProps) {
  const { t } = useI18n();

  const videoModelId = useSettingsStore((state) => state.videoModelId);
  const videoProvidersConfig = useSettingsStore((state) => state.videoProvidersConfig);
  const setVideoProviderConfig = useSettingsStore((state) => state.setVideoProviderConfig);

  const [showApiKey, setShowApiKey] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  // Model dialog state
  const [showModelDialog, setShowModelDialog] = useState(false);
  const [editingModelIndex, setEditingModelIndex] = useState<number | null>(null);
  const [modelForm, setModelForm] = useState({ id: '', name: '' });

  // Reset test state when provider changes (derived state pattern)
  const [prevSelectedProviderId, setPrevSelectedProviderId] = useState(selectedProviderId);
  if (selectedProviderId !== prevSelectedProviderId) {
    setPrevSelectedProviderId(selectedProviderId);
    setTestStatus('idle');
    setTestMessage('');
  }

  const currentConfig = videoProvidersConfig[selectedProviderId];
  const currentProvider = VIDEO_PROVIDERS[selectedProviderId];
  const builtInModels = currentProvider?.models || [];
  const customModels = useMemo(
    () => currentConfig?.customModels || [],
    [currentConfig?.customModels],
  );
  const isServerConfigured = !!currentConfig?.isServerConfigured;

  const handleApiKeyChange = (apiKey: string) => {
    setVideoProviderConfig(selectedProviderId, { apiKey });
  };

  const handleBaseUrlChange = (baseUrl: string) => {
    setVideoProviderConfig(selectedProviderId, { baseUrl });
  };

  const handleTest = async () => {
    setTestLoading(true);
    setTestStatus('idle');
    setTestMessage('');
    try {
      const response = await fetch('/api/verify-video-provider', {
        method: 'POST',
        headers: {
          'x-video-provider': selectedProviderId,
          'x-video-model': videoModelId || '',
          'x-api-key': currentConfig?.apiKey || '',
          'x-base-url': currentConfig?.baseUrl || '',
        },
      });
      const data = await response.json();
      if (data.success) {
        setTestStatus('success');
        setTestMessage(t('settings.videoConnectivitySuccess'));
      } else {
        setTestStatus('error');
        setTestMessage(`${t('settings.videoConnectivityFailed')}: ${data.message}`);
      }
    } catch (err) {
      setTestStatus('error');
      setTestMessage(`${t('settings.videoConnectivityFailed')}: ${err}`);
    } finally {
      setTestLoading(false);
    }
  };

  // Model CRUD
  const handleOpenAddModel = () => {
    setEditingModelIndex(null);
    setModelForm({ id: '', name: '' });
    setShowModelDialog(true);
  };

  const handleOpenEditModel = (index: number) => {
    setEditingModelIndex(index);
    setModelForm({ ...customModels[index] });
    setShowModelDialog(true);
  };

  const handleSaveModel = useCallback(() => {
    if (!modelForm.id.trim()) return;
    const newCustomModels = [...customModels];
    if (editingModelIndex !== null) {
      newCustomModels[editingModelIndex] = {
        id: modelForm.id.trim(),
        name: modelForm.name.trim() || modelForm.id.trim(),
      };
    } else {
      newCustomModels.push({
        id: modelForm.id.trim(),
        name: modelForm.name.trim() || modelForm.id.trim(),
      });
    }
    setVideoProviderConfig(selectedProviderId, {
      customModels: newCustomModels,
    });
    setShowModelDialog(false);
  }, [modelForm, editingModelIndex, customModels, selectedProviderId, setVideoProviderConfig]);

  const handleDeleteModel = (index: number) => {
    const newCustomModels = customModels.filter((_, i) => i !== index);
    setVideoProviderConfig(selectedProviderId, {
      customModels: newCustomModels,
    });
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

      {/* API Key + Test inline */}
      <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
        <div className="space-y-3">
          <Label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
            API Key
          </Label>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Input
                name={`video-api-key-${selectedProviderId}`}
                type={showApiKey ? 'text' : 'password'}
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={
                  isServerConfigured
                    ? t('settings.optionalOverride')
                    : selectedProviderId === 'kling'
                      ? 'accessKey:secretKey'
                      : t('settings.enterApiKey')
                }
                value={currentConfig?.apiKey || ''}
                onChange={(e) => handleApiKeyChange(e.target.value)}
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
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testLoading || (!currentConfig?.apiKey && !isServerConfigured)}
              className="gap-2 h-11 px-4 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-[rgba(71,54,31,0.92)] hover:bg-[rgba(248,242,234,0.85)] transition-all"
            >
              {testLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Zap className="h-4 w-4" />
                  {t('settings.testConnection')}
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

      {/* Base URL */}
      <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
        <div className="space-y-3">
          <Label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
            Base URL
          </Label>
          <Input
            name={`video-base-url-${selectedProviderId}`}
            type="url"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={currentConfig?.baseUrl || ''}
            onChange={(e) => handleBaseUrlChange(e.target.value)}
            placeholder={
              currentConfig?.serverBaseUrl ||
              currentProvider?.defaultBaseUrl ||
              t('settings.enterCustomBaseUrl')
            }
            className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] placeholder:text-[rgba(115,102,88,0.5)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]"
          />
          {(() => {
            const effectiveBaseUrl =
              currentConfig?.baseUrl ||
              currentConfig?.serverBaseUrl ||
              currentProvider?.defaultBaseUrl ||
              '';
            if (!effectiveBaseUrl) return null;
            return (
              <div className="mt-3 rounded-xl bg-[rgba(248,242,234,0.72)] px-4 py-3">
                <p className="text-xs text-[rgba(123,111,99,0.78)] break-all">
                  <span className="font-medium text-[rgba(93,80,68,0.85)]">{t('settings.requestUrl')}:</span>{' '}
                  <span className="font-mono text-[rgba(100,85,70,0.72)]">{effectiveBaseUrl}</span>
                </p>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Model list */}
      <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <Label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
            {t('settings.models')}
          </Label>
          <Button 
            variant="outline" 
            onClick={handleOpenAddModel} 
            className="gap-2 h-9 px-4 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-[rgba(71,54,31,0.92)] hover:bg-[rgba(248,242,234,0.85)] transition-all"
          >
            <Plus className="h-4 w-4" />
            {t('settings.addNewModel')}
          </Button>
        </div>

        <div className="space-y-2">
          {/* Built-in models */}
          {builtInModels.map((model) => (
            <div
              key={model.id}
              className="flex items-center justify-between p-4 rounded-xl border border-[rgba(133,88,34,0.1)] bg-[rgba(248,242,234,0.65)]"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-[rgba(46,39,33,0.92)]">{model.name}</div>
                <div className="text-xs text-[rgba(123,111,99,0.72)] font-mono mt-0.5">{model.id}</div>
              </div>
            </div>
          ))}

          {/* Custom models */}
          {customModels.map((model, index) => (
            <div
              key={`custom-${index}`}
              className="flex items-center justify-between p-4 rounded-xl border border-[rgba(133,88,34,0.1)] bg-[rgba(255,253,250,0.95)]"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-[rgba(46,39,33,0.92)]">{model.name}</div>
                <div className="text-xs text-[rgba(123,111,99,0.72)] font-mono mt-0.5">{model.id}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 p-0 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-[rgba(71,54,31,0.72)] hover:bg-[rgba(248,242,234,0.85)]"
                  onClick={() => handleOpenEditModel(index)}
                  title={t('settings.editModel')}
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 w-9 p-0 rounded-xl border-[rgba(200,80,70,0.2)] bg-[rgba(255,253,250,0.95)] text-[rgba(180,70,60,0.82)] hover:bg-[rgba(255,230,230,0.65)]"
                  onClick={() => handleDeleteModel(index)}
                  title={t('settings.deleteModel')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add/Edit Model Dialog */}
      <Dialog open={showModelDialog} onOpenChange={setShowModelDialog}>
        <DialogContent className="sm:max-w-md rounded-2xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,252,247,0.98)] shadow-[0_28px_80px_rgba(61,43,16,0.18)]">
          <DialogTitle className="text-[rgba(46,39,33,0.92)]">
            {editingModelIndex !== null ? t('settings.editModel') : t('settings.addNewModel')}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {editingModelIndex !== null ? t('settings.editModel') : t('settings.addNewModel')}
          </DialogDescription>
          <div className="space-y-4 pt-2">
            <div className="space-y-2.5">
              <Label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)]">{t('settings.modelId')}</Label>
              <Input
                value={modelForm.id}
                onChange={(e) => setModelForm((prev) => ({ ...prev, id: e.target.value }))}
                placeholder="e.g. my-custom-model-v1"
                className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] font-mono text-sm text-[rgba(46,39,33,0.92)] placeholder:text-[rgba(115,102,88,0.5)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]"
              />
            </div>
            <div className="space-y-2.5">
              <Label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)]">{t('settings.modelName')}</Label>
              <Input
                value={modelForm.name}
                onChange={(e) => setModelForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. My Custom Model"
                className="h-11 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-sm text-[rgba(46,39,33,0.92)] placeholder:text-[rgba(115,102,88,0.5)] focus:border-[rgba(193,154,110,0.6)] focus:ring-2 focus:ring-[rgba(193,154,110,0.12)]"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button 
                variant="outline" 
                onClick={() => setShowModelDialog(false)}
                className="h-10 px-5 rounded-xl border-[rgba(133,88,34,0.14)] bg-[rgba(255,253,250,0.95)] text-[rgba(71,54,31,0.92)] hover:bg-[rgba(248,242,234,0.85)]"
              >
                {t('settings.cancelEdit')}
              </Button>
              <Button 
                onClick={handleSaveModel} 
                disabled={!modelForm.id.trim()}
                className="h-10 px-5 rounded-xl bg-[rgba(71,54,31,0.92)] hover:bg-[rgba(55,41,24,0.96)] text-white shadow-[0_8px_20px_rgba(71,54,31,0.18)] disabled:opacity-60"
              >
                {t('settings.saveModel')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
