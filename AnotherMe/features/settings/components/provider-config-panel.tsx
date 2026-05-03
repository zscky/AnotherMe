'use client';

import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  RotateCcw,
  Plus,
  Zap,
  Settings2,
  Trash2,
  Sparkles,
  Wrench,
  FileText,
  Send,
} from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { ProviderConfig } from '@/lib/ai/providers';
import type { ProvidersConfig } from '@/lib/types/settings';
import { formatContextWindow } from './utils';
import { cn } from '@/lib/utils';

interface ProviderConfigPanelProps {
  provider: ProviderConfig;
  initialApiKey: string;
  initialBaseUrl: string;
  initialRequiresApiKey: boolean;
  providersConfig: ProvidersConfig;
  onConfigChange: (apiKey: string, baseUrl: string, requiresApiKey: boolean) => void;
  onSave: () => void; // Auto-save on blur
  onEditModel: (index: number) => void;
  onDeleteModel: (index: number) => void;
  onAddModel: () => void;
  onResetToDefault?: () => void; // Reset provider to default configuration
  isBuiltIn: boolean; // To determine if reset button should be shown
}

export function ProviderConfigPanel({
  provider,
  initialApiKey,
  initialBaseUrl,
  initialRequiresApiKey,
  providersConfig,
  onConfigChange,
  onSave,
  onEditModel,
  onDeleteModel,
  onAddModel,
  onResetToDefault,
  isBuiltIn,
}: ProviderConfigPanelProps) {
  const { t } = useI18n();

  // Local state for this provider
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [requiresApiKey, setRequiresApiKey] = useState(initialRequiresApiKey);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [showResetDialog, setShowResetDialog] = useState(false);

  // Update local state when provider changes or initial values change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Sync local state from props on provider change
    setApiKey(initialApiKey);

    setBaseUrl(initialBaseUrl);

    setRequiresApiKey(initialRequiresApiKey);

    setTestStatus('idle');

    setTestMessage('');
  }, [provider.id, initialApiKey, initialBaseUrl, initialRequiresApiKey]);

  // Notify parent of changes
  const handleApiKeyChange = (key: string) => {
    setApiKey(key);
    onConfigChange(key, baseUrl, requiresApiKey);
  };

  const handleBaseUrlChange = (url: string) => {
    setBaseUrl(url);
    onConfigChange(apiKey, url, requiresApiKey);
  };

  const handleRequiresApiKeyChange = (requires: boolean) => {
    setRequiresApiKey(requires);
    onConfigChange(apiKey, baseUrl, requires);
  };

  const handleTestApi = useCallback(async () => {
    setTestStatus('testing');
    setTestMessage('');

    const availableModels = providersConfig[provider.id]?.models || [];

    if (availableModels.length === 0) {
      setTestStatus('error');
      setTestMessage(t('settings.noModelsAvailable') || 'No models available for testing');
      return;
    }

    const testModelId = availableModels[0].id;

    try {
      const response = await fetch('/api/verify-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          baseUrl,
          model: `${provider.id}:${testModelId}`,
          providerType: provider.type,
          requiresApiKey: requiresApiKey,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setTestStatus('success');
        setTestMessage(t('settings.connectionSuccess'));
      } else {
        setTestStatus('error');
        setTestMessage(data.error || t('settings.connectionFailed'));
      }
    } catch (_error) {
      setTestStatus('error');
      setTestMessage(t('settings.connectionFailed'));
    }
  }, [apiKey, baseUrl, provider.id, provider.type, requiresApiKey, providersConfig, t]);

  const models = providersConfig[provider.id]?.models || [];
  const isServerConfigured = providersConfig[provider.id]?.isServerConfigured;

  return (
    <div className="max-w-3xl space-y-5">
      {/* Server-configured notice */}
      {isServerConfigured && (
        <div className="rounded-[24px] border border-[rgba(124,145,174,0.24)] bg-[rgba(238,244,250,0.92)] p-4 text-sm leading-7 text-[rgba(63,87,113,0.88)]">
          {t('settings.serverConfiguredNotice')}
        </div>
      )}

      {/* API Key */}
      <div className="space-y-3 rounded-[28px] border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.84)] p-5 shadow-[0_18px_40px_rgba(99,71,28,0.05)]">
        <Label className="text-sm font-medium text-[rgba(54,41,23,0.92)]">{t('settings.apiSecret')}</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              name={`llm-api-key-${provider.id}`}
              type={showApiKey ? 'text' : 'password'}
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={isServerConfigured ? t('settings.optionalOverride') : 'sk-...'}
              value={apiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              onBlur={onSave}
              disabled={!requiresApiKey && !isServerConfigured}
              className="h-11 rounded-2xl border-[rgba(151,118,75,0.16)] bg-white/88 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgba(108,84,53,0.7)] hover:text-[rgba(57,43,24,0.96)]"
              disabled={!requiresApiKey}
            >
              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestApi}
            disabled={
              testStatus === 'testing' || (requiresApiKey && !apiKey && !isServerConfigured)
            }
            className="h-11 rounded-2xl border-[rgba(151,118,75,0.18)] bg-white/86 px-4 text-[rgba(88,66,37,0.92)] hover:bg-white"
          >
            {testStatus === 'testing' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Zap className="h-3.5 w-3.5" />
                {t('settings.testConnection')}
              </>
            )}
          </Button>
        </div>
        {testMessage && (
          <div
            className={cn(
              'overflow-hidden rounded-2xl border p-3 text-sm',
              testStatus === 'success' &&
                'border-[rgba(95,122,82,0.2)] bg-[rgba(240,247,239,0.92)] text-[rgba(77,104,64,0.92)]',
              testStatus === 'error' &&
                'border-[rgba(179,88,74,0.18)] bg-[rgba(251,242,239,0.94)] text-[rgba(145,64,49,0.92)]',
            )}
          >
            <div className="flex items-start gap-2 min-w-0">
              {testStatus === 'success' && <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
              {testStatus === 'error' && <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
              <p className="flex-1 min-w-0 break-all">{testMessage}</p>
            </div>
          </div>
        )}
        <div className="flex items-center space-x-2">
          <Checkbox
            id={`requires-api-key-${provider.id}`}
            checked={requiresApiKey}
            onCheckedChange={(checked) => {
              handleRequiresApiKeyChange(checked as boolean);
              onSave();
            }}
          />
          <label
            htmlFor={`requires-api-key-${provider.id}`}
            className="cursor-pointer text-sm text-[rgba(103,83,57,0.76)]"
          >
            {t('settings.requiresApiKey')}
          </label>
        </div>
      </div>

      {/* API Host */}
      <div className="space-y-3 rounded-[28px] border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.84)] p-5 shadow-[0_18px_40px_rgba(99,71,28,0.05)]">
        <Label className="text-sm font-medium text-[rgba(54,41,23,0.92)]">{t('settings.apiHost')}</Label>
        <Input
          name={`llm-base-url-${provider.id}`}
          type="url"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={provider.defaultBaseUrl || 'https://api.example.com/v1'}
          value={baseUrl}
          onChange={(e) => handleBaseUrlChange(e.target.value)}
          onBlur={onSave}
          className="h-11 rounded-2xl border-[rgba(151,118,75,0.16)] bg-white/88"
        />
        {(() => {
          const effectiveBaseUrl = baseUrl || provider.defaultBaseUrl || '';
          if (!effectiveBaseUrl) return null;

          // Generate endpoint path based on provider type
          let endpointPath = '';
          switch (provider.type) {
            case 'openai':
              endpointPath = '/chat/completions';
              break;
            case 'anthropic':
              endpointPath = '/messages';
              break;
            case 'google':
              endpointPath = '/models/[model]';
              break;
            default:
              endpointPath = '';
          }

          const fullUrl = effectiveBaseUrl + endpointPath;

          return (
            <p className="break-all text-xs text-[rgba(103,83,57,0.76)]">
              {t('settings.requestUrl')}: {fullUrl}
            </p>
          );
        })()}
      </div>

      {/* Models - No selection state, just list for management */}
      <div className="space-y-3 rounded-[28px] border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.84)] p-5 shadow-[0_18px_40px_rgba(99,71,28,0.05)]">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <Label className="text-base font-medium text-[rgba(54,41,23,0.92)]">{t('settings.models')}</Label>
          <div className="flex items-center gap-2 flex-wrap">
            {isBuiltIn && onResetToDefault && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowResetDialog(true)}
                className="h-10 rounded-2xl border-[rgba(151,118,75,0.18)] bg-white/86 px-4 text-[rgba(88,66,37,0.92)] hover:bg-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('settings.reset')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onAddModel}
              className="h-10 rounded-2xl border-[rgba(151,118,75,0.18)] bg-white/86 px-4 text-[rgba(88,66,37,0.92)] hover:bg-white"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('settings.addNewModel')}
            </Button>
          </div>
        </div>
        <p className="text-xs text-[rgba(103,83,57,0.76)]">{t('settings.modelsManagementDescription')}</p>

        <div className="space-y-2">
          {models.map((model, index) => {
            return (
              <div
                key={model.id}
                className="flex items-center justify-between rounded-2xl border border-[rgba(151,118,75,0.14)] bg-white/86 p-4"
              >
                <div className="flex-1">
                  <div className="mb-1.5 font-mono text-sm font-medium text-[rgba(45,34,20,0.96)]">{model.name}</div>
                  <div className="flex items-center gap-2 text-xs text-[rgba(103,83,57,0.78)]">
                    {/* Capabilities */}
                    <div className="flex items-center gap-1">
                      {model.capabilities?.vision && (
                        <div title={t('settings.capabilities.vision')}>
                          <Sparkles className="h-3 w-3" />
                        </div>
                      )}
                      {model.capabilities?.tools && (
                        <div title={t('settings.capabilities.tools')}>
                          <Wrench className="h-3 w-3" />
                        </div>
                      )}
                      {model.capabilities?.streaming && (
                        <div title={t('settings.capabilities.streaming')}>
                          <Zap className="h-3 w-3" />
                        </div>
                      )}
                    </div>
                    {/* Context Window */}
                    {model.contextWindow && (
                      <span className="flex items-center gap-0.5">
                        <FileText className="h-3 w-3" />
                        <span className="text-[10px]">
                          {formatContextWindow(model.contextWindow)}
                        </span>
                      </span>
                    )}
                    {/* Output Window */}
                    {model.outputWindow && (
                      <span className="flex items-center gap-0.5">
                        <Send className="h-3 w-3" />
                        <span className="text-[10px]">
                          {formatContextWindow(model.outputWindow)}
                        </span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Edit/Delete Buttons */}
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-2xl border-[rgba(151,118,75,0.16)] bg-[rgba(247,241,231,0.72)] px-3 text-[rgba(88,66,37,0.92)] hover:bg-white"
                    onClick={() => onEditModel(index)}
                    title={t('settings.editModel')}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-2xl border-[rgba(179,88,74,0.16)] bg-[rgba(251,242,239,0.8)] px-3 text-[rgba(145,64,49,0.92)] hover:bg-[rgba(251,237,233,0.96)] hover:text-[rgba(145,64,49,0.96)]"
                    onClick={() => onDeleteModel(index)}
                    title={t('settings.deleteModel')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent className="rounded-[28px] border-[rgba(133,88,34,0.14)] bg-[rgba(255,251,245,0.98)] shadow-[0_28px_80px_rgba(61,43,16,0.18)]">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.resetToDefault')}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.resetConfirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('settings.cancelEdit')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowResetDialog(false);
                onResetToDefault?.();
              }}
            >
              {t('settings.confirmReset')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
