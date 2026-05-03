'use client';

import { useState, useCallback } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { clearDatabase } from '@/lib/utils/database';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';

const log = createLogger('GeneralSettings');

export function GeneralSettings() {
  const { t } = useI18n();

  // Clear cache state
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [clearing, setClearing] = useState(false);

  const confirmPhrase = t('settings.clearCacheConfirmPhrase');
  const isConfirmValid = confirmInput === confirmPhrase;

  const handleClearCache = useCallback(async () => {
    if (!isConfirmValid) return;
    setClearing(true);
    try {
      // 1. Clear IndexedDB
      await clearDatabase();
      // 2. Clear localStorage
      localStorage.clear();
      // 3. Clear sessionStorage
      sessionStorage.clear();

      toast.success(t('settings.clearCacheSuccess'));

      // Reload page after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      log.error('Failed to clear cache:', error);
      toast.error(t('settings.clearCacheFailed'));
      setClearing(false);
    }
  }, [isConfirmValid, t]);

  const clearCacheItems =
    t('settings.clearCacheConfirmItems').split('、').length > 1
      ? t('settings.clearCacheConfirmItems').split('、')
      : t('settings.clearCacheConfirmItems').split(', ');

  return (
    <div className="flex flex-col gap-8">
      {/* Danger Zone - Clear Cache */}
      <div className="relative overflow-hidden rounded-[28px] border border-[rgba(179,88,74,0.18)] bg-[linear-gradient(180deg,rgba(255,248,246,0.98)_0%,rgba(250,240,236,0.96)_100%)] shadow-[0_18px_40px_rgba(124,54,42,0.06)]">
        {/* Subtle diagonal stripe pattern for danger emphasis */}
        <div
          className="absolute inset-0 opacity-[0.015] dark:opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: `repeating-linear-gradient(
              -45deg,
              transparent,
              transparent 10px,
              currentColor 10px,
              currentColor 11px
            )`,
          }}
        />

        <div className="relative space-y-4 p-5">
          {/* Header */}
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-[rgba(179,88,74,0.1)] p-2 text-[rgba(145,64,49,0.92)]">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <h3 className="font-serif text-lg font-semibold text-[rgba(125,53,41,0.96)]">
              {t('settings.dangerZone')}
            </h3>
          </div>

          {/* Content */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[rgba(63,45,32,0.94)]">{t('settings.clearCache')}</p>
              <p className="mt-1 text-xs leading-relaxed text-[rgba(121,86,74,0.78)]">
                {t('settings.clearCacheDescription')}
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="shrink-0 rounded-2xl bg-[rgba(145,64,49,0.96)] px-4 text-white hover:bg-[rgba(125,53,41,0.96)]"
              onClick={() => {
                setConfirmInput('');
                setShowClearDialog(true);
              }}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              {t('settings.clearCache')}
            </Button>
          </div>
        </div>
      </div>

      {/* Clear Cache Confirmation Dialog */}
      <AlertDialog
        open={showClearDialog}
        onOpenChange={(open) => {
          if (!clearing) {
            setShowClearDialog(open);
            if (!open) setConfirmInput('');
          }
        }}
      >
        <AlertDialogContent className="rounded-[28px] border-[rgba(179,88,74,0.18)] bg-[rgba(255,250,247,0.98)] shadow-[0_28px_80px_rgba(124,54,42,0.18)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-[rgba(125,53,41,0.96)]">
              <AlertTriangle className="w-5 h-5" />
              {t('settings.clearCacheConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>{t('settings.clearCacheConfirmDescription')}</p>
                <ul className="space-y-1.5 ml-1">
                  {clearCacheItems.map((item, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[rgba(145,64,49,0.62)]" />
                      {item.trim()}
                    </li>
                  ))}
                </ul>
                <div className="pt-1">
                  <Label className="text-xs font-medium text-[rgba(63,45,32,0.94)]">
                    {t('settings.clearCacheConfirmInput')}
                  </Label>
                  <Input
                    className="mt-1.5 h-11 rounded-2xl border-[rgba(179,88,74,0.16)] bg-white/92 text-sm"
                    placeholder={confirmPhrase}
                    value={confirmInput}
                    onChange={(e) => setConfirmInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && isConfirmValid) {
                        handleClearCache();
                      }
                    }}
                    autoFocus
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={clearing}
              className="rounded-2xl border-[rgba(151,118,75,0.18)] bg-white/88 text-[rgba(88,66,37,0.92)] hover:bg-white"
            >
              {t('common.cancel')}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={!isConfirmValid || clearing}
              className="rounded-2xl bg-[rgba(145,64,49,0.96)] text-white hover:bg-[rgba(125,53,41,0.96)]"
              onClick={handleClearCache}
            >
              {clearing ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-1.5" />
              )}
              {t('settings.clearCacheButton')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
