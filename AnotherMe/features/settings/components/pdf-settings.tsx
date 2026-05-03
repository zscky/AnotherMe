'use client';

import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { PDF_PROVIDERS } from '@/lib/pdf/constants';
import type { PDFProviderId } from '@/lib/pdf/types';
import { CheckCircle2, Eye, EyeOff, Loader2, Zap, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Get display label for feature
 */
function getFeatureLabel(feature: string, t: (key: string) => string): string {
  const labels: Record<string, string> = {
    text: t('settings.featureText'),
    images: t('settings.featureImages'),
    tables: t('settings.featureTables'),
    formulas: t('settings.featureFormulas'),
    'layout-analysis': t('settings.featureLayoutAnalysis'),
    metadata: t('settings.featureMetadata'),
  };
  return labels[feature] || feature;
}

interface PDFSettingsProps {
  selectedProviderId: PDFProviderId;
}

export function PDFSettings({ selectedProviderId }: PDFSettingsProps) {
  const { t } = useI18n();
  const [showApiKey, setShowApiKey] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  const pdfProvidersConfig = useSettingsStore((state) => state.pdfProvidersConfig);
  const setPDFProviderConfig = useSettingsStore((state) => state.setPDFProviderConfig);

  const pdfProvider = PDF_PROVIDERS[selectedProviderId];
  const isServerConfigured = !!pdfProvidersConfig[selectedProviderId]?.isServerConfigured;
  const providerConfig = pdfProvidersConfig[selectedProviderId];
  const hasBaseUrl = !!providerConfig?.baseUrl;
  const needsRemoteConfig = selectedProviderId === 'mineru';

  // Reset state when provider changes
  const [prevSelectedProviderId, setPrevSelectedProviderId] = useState(selectedProviderId);
  if (selectedProviderId !== prevSelectedProviderId) {
    setPrevSelectedProviderId(selectedProviderId);
    setShowApiKey(false);
    setTestStatus('idle');
    setTestMessage('');
  }

  const handleTestConnection = async () => {
    const baseUrl = providerConfig?.baseUrl;
    if (!baseUrl) return;

    setTestStatus('testing');
    setTestMessage('');

    try {
      const response = await fetch('/api/verify-pdf-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: selectedProviderId,
          apiKey: providerConfig?.apiKey || '',
          baseUrl,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setTestStatus('success');
        setTestMessage(t('settings.connectionSuccess'));
      } else {
        setTestStatus('error');
        setTestMessage(`${t('settings.connectionFailed')}: ${data.error}`);
      }
    } catch (err) {
      setTestStatus('error');
      const message = err instanceof Error ? err.message : String(err);
      setTestMessage(`${t('settings.connectionFailed')}: ${message}`);
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      {/* Server-configured notice */}
      {isServerConfigured && (
        <div className="rounded-[24px] border border-[rgba(124,145,174,0.24)] bg-[rgba(238,244,250,0.92)] p-4 text-sm leading-7 text-[rgba(63,87,113,0.88)]">
          {t('settings.serverConfiguredNotice')}
        </div>
      )}

      {/* Base URL + API Key Configuration (for remote providers like MinerU) */}
      {(needsRemoteConfig || isServerConfigured) && (
        <div className="space-y-4 rounded-[28px] border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.84)] p-5 shadow-[0_18px_40px_rgba(99,71,28,0.05)]">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[rgba(54,41,23,0.92)]">{t('settings.pdfBaseUrl')}</Label>
              <div className="flex gap-2">
                <Input
                  name={`pdf-base-url-${selectedProviderId}`}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="http://localhost:8080"
                  value={providerConfig?.baseUrl || ''}
                  onChange={(e) =>
                    setPDFProviderConfig(selectedProviderId, { baseUrl: e.target.value })
                  }
                  className="h-11 rounded-2xl border-[rgba(151,118,75,0.16)] bg-white/88 text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={testStatus === 'testing' || !hasBaseUrl}
                  className="h-11 shrink-0 rounded-2xl border-[rgba(151,118,75,0.18)] bg-white/86 px-4 text-[rgba(88,66,37,0.92)] hover:bg-white"
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
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-[rgba(54,41,23,0.92)]">
                {t('settings.pdfApiKey')}
                <span className="text-muted-foreground ml-1 font-normal">
                  ({t('settings.optional')})
                </span>
              </Label>
              <div className="relative">
                <Input
                  name={`pdf-api-key-${selectedProviderId}`}
                  type={showApiKey ? 'text' : 'password'}
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={
                    isServerConfigured ? t('settings.optionalOverride') : t('settings.enterApiKey')
                  }
                  value={providerConfig?.apiKey || ''}
                  onChange={(e) =>
                    setPDFProviderConfig(selectedProviderId, {
                      apiKey: e.target.value,
                    })
                  }
                  className="h-11 rounded-2xl border-[rgba(151,118,75,0.16)] bg-white/88 pr-10 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgba(108,84,53,0.7)] hover:text-[rgba(57,43,24,0.96)]"
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Test result message */}
          {testMessage && (
            <div
              className={cn(
                'rounded-2xl border p-3 text-sm',
                testStatus === 'success' &&
                  'border-[rgba(95,122,82,0.2)] bg-[rgba(240,247,239,0.92)] text-[rgba(77,104,64,0.92)]',
                testStatus === 'error' &&
                  'border-[rgba(179,88,74,0.18)] bg-[rgba(251,242,239,0.94)] text-[rgba(145,64,49,0.92)]',
              )}
            >
              <div className="flex items-center gap-2">
                {testStatus === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                {testStatus === 'error' && <XCircle className="h-4 w-4 shrink-0" />}
                <span className="break-all">{testMessage}</span>
              </div>
            </div>
          )}

          {/* Request URL Preview */}
          {(() => {
            const effectiveBaseUrl = providerConfig?.baseUrl || '';
            if (!effectiveBaseUrl) return null;
            const fullUrl = effectiveBaseUrl + '/file_parse';
            return (
              <p className="break-all text-xs text-[rgba(103,83,57,0.76)]">
                {t('settings.requestUrl')}: {fullUrl}
              </p>
            );
          })()}
        </div>
      )}

      {/* Features List */}
      <div className="space-y-3 rounded-[28px] border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.84)] p-5 shadow-[0_18px_40px_rgba(99,71,28,0.05)]">
        <Label className="text-sm font-medium text-[rgba(54,41,23,0.92)]">{t('settings.pdfFeatures')}</Label>
        <div className="flex flex-wrap gap-2">
          {pdfProvider.features.map((feature) => (
            <Badge
              key={feature}
              variant="secondary"
              className="rounded-full border border-[rgba(151,118,75,0.14)] bg-[rgba(247,241,231,0.72)] px-3 py-1 font-normal text-[rgba(88,66,37,0.92)]"
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {getFeatureLabel(feature, t)}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
