'use client';

import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';
import type { WebSearchProviderId } from '@/lib/web-search/types';
import { Eye, EyeOff, CheckCircle2 } from 'lucide-react';

interface WebSearchSettingsProps {
  selectedProviderId: WebSearchProviderId;
}

export function WebSearchSettings({ selectedProviderId }: WebSearchSettingsProps) {
  const { t } = useI18n();
  const [showApiKey, setShowApiKey] = useState(false);

  const webSearchProvidersConfig = useSettingsStore((state) => state.webSearchProvidersConfig);
  const setWebSearchProviderConfig = useSettingsStore((state) => state.setWebSearchProviderConfig);

  const provider = WEB_SEARCH_PROVIDERS[selectedProviderId];
  const isServerConfigured = !!webSearchProvidersConfig[selectedProviderId]?.isServerConfigured;

  // Reset showApiKey when provider changes (derived state pattern)
  const [prevSelectedProviderId, setPrevSelectedProviderId] = useState(selectedProviderId);
  if (selectedProviderId !== prevSelectedProviderId) {
    setPrevSelectedProviderId(selectedProviderId);
    setShowApiKey(false);
  }

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

      {/* API Key + Base URL Configuration */}
      {(provider.requiresApiKey || isServerConfigured) && (
        <div className="rounded-2xl border border-[rgba(133,88,34,0.12)] bg-[rgba(255,252,247,0.85)] p-5 shadow-[0_8px_24px_rgba(61,43,16,0.04)] backdrop-blur-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2.5">
              <Label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                {t('settings.webSearchApiKey')}
              </Label>
              <div className="relative">
                <Input
                  name={`web-search-api-key-${selectedProviderId}`}
                  type={showApiKey ? 'text' : 'password'}
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={
                    isServerConfigured ? t('settings.optionalOverride') : t('settings.enterApiKey')
                  }
                  value={webSearchProvidersConfig[selectedProviderId]?.apiKey || ''}
                  onChange={(e) =>
                    setWebSearchProviderConfig(selectedProviderId, {
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
              <p className="text-xs text-[rgba(123,111,99,0.65)]">{t('settings.webSearchApiKeyHint')}</p>
            </div>

            <div className="space-y-2.5">
              <Label className="text-[0.8rem] font-semibold text-[rgba(93,80,68,0.92)] tracking-wide">
                {t('settings.webSearchBaseUrl')}
              </Label>
              <Input
                name={`web-search-base-url-${selectedProviderId}`}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={provider.defaultBaseUrl || 'https://api.tavily.com'}
                value={webSearchProvidersConfig[selectedProviderId]?.baseUrl || ''}
                onChange={(e) =>
                  setWebSearchProviderConfig(selectedProviderId, {
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
              webSearchProvidersConfig[selectedProviderId]?.baseUrl ||
              provider.defaultBaseUrl ||
              '';
            if (!effectiveBaseUrl) return null;
            const fullUrl = effectiveBaseUrl + '/search';
            return (
              <div className="mt-4 rounded-xl bg-[rgba(248,242,234,0.72)] px-4 py-3">
                <p className="text-xs text-[rgba(123,111,99,0.78)] break-all">
                  <span className="font-medium text-[rgba(93,80,68,0.85)]">{t('settings.requestUrl')}:</span>{' '}
                  <span className="font-mono text-[rgba(100,85,70,0.72)]">{fullUrl}</span>
                </p>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
