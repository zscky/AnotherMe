'use client';

import { Button } from '@/components/ui/button';
import { Box, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { ProviderId, ProviderConfig } from '@/lib/ai/providers';

interface ProviderWithServerInfo extends ProviderConfig {
  isServerConfigured?: boolean;
}

interface ProviderListProps {
  providers: ProviderWithServerInfo[];
  selectedProviderId: ProviderId;
  onSelect: (providerId: ProviderId) => void;
  onAddProvider: () => void;
  width?: number;
}

export function ProviderList({
  providers,
  selectedProviderId,
  onSelect,
  onAddProvider,
  width,
}: ProviderListProps) {
  const { t } = useI18n();

  // Helper function to get translated provider name
  const getProviderDisplayName = (provider: ProviderConfig) => {
    const translationKey = `settings.providerNames.${provider.id}`;
    const translated = t(translationKey);
    // If translation exists (not equal to key), use it; otherwise fallback to provider.name
    return translated !== translationKey ? translated : provider.name;
  };

  return (
    <div
      className="flex-shrink-0 flex flex-col border-r border-[rgba(133,88,34,0.12)] bg-[rgba(250,246,239,0.72)]"
      style={{ width: width ?? 192 }}
    >
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {providers.map((provider) => (
          <button
            key={provider.id}
            onClick={() => onSelect(provider.id)}
            className={cn(
              'w-full flex items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-all duration-200',
              selectedProviderId === provider.id
                ? 'border-[rgba(151,118,75,0.32)] bg-white/92 text-foreground shadow-[0_14px_34px_rgba(102,72,28,0.08)]'
                : 'border-transparent bg-transparent text-foreground/86 hover:border-[rgba(151,118,75,0.16)] hover:bg-white/72',
            )}
          >
            {provider.icon ? (
              <img
                src={provider.icon}
                alt={getProviderDisplayName(provider)}
                className="h-5 w-5 rounded-md"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[rgba(151,118,75,0.14)] bg-[rgba(255,255,255,0.88)]">
                <Box className="h-4 w-4 text-[rgba(120,90,54,0.82)]" />
              </span>
            )}
            <span className="flex-1 truncate text-sm font-medium">
              {getProviderDisplayName(provider)}
            </span>
            {provider.isServerConfigured && (
              <span className="shrink-0 rounded-full border border-[rgba(151,118,75,0.18)] bg-[rgba(245,238,226,0.95)] px-2 py-0.5 text-[10px] leading-4 text-[rgba(120,90,54,0.9)]">
                {t('settings.serverConfigured')}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Add Provider Button */}
      <div className="border-t border-[rgba(133,88,34,0.12)] p-4">
        <Button
          variant="outline"
          size="sm"
          className="h-11 w-full gap-1.5 rounded-2xl border-[rgba(151,118,75,0.2)] bg-white/85 text-[rgba(87,63,34,0.92)] shadow-none hover:bg-white"
          onClick={onAddProvider}
        >
          <Plus className="h-3.5 w-3.5" />
          {t('settings.addProviderButton')}
        </Button>
      </div>
    </div>
  );
}
