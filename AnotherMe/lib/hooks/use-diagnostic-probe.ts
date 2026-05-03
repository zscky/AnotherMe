/**
 * useDiagnosticProbe - React hook for generating and displaying diagnostic probes.
 */

import { useState, useCallback } from 'react';
import type { DiagnosticProbe } from '@/lib/types/diagnostic-probe';
import { fetchDiagnosticProbe } from '@/lib/diagnostic-probe/client';

export interface UseDiagnosticProbeOptions {
  userId: string;
}

export interface UseDiagnosticProbeReturn {
  probe: DiagnosticProbe | null;
  loading: boolean;
  error: string | null;
  generateProbe: (params?: { knowledgePointId?: string; difficulty?: string; probeType?: string }) => Promise<void>;
  clearProbe: () => void;
}

export function useDiagnosticProbe(options: UseDiagnosticProbeOptions): UseDiagnosticProbeReturn {
  const [probe, setProbe] = useState<DiagnosticProbe | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateProbe = useCallback(
    async (params?: { knowledgePointId?: string; difficulty?: string; probeType?: string }) => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchDiagnosticProbe({
          userId: options.userId,
          ...params,
        });
        if (result) {
          setProbe(result);
        } else {
          setError('未能生成诊断题，请稍后重试');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '生成诊断题失败');
      } finally {
        setLoading(false);
      }
    },
    [options.userId],
  );

  const clearProbe = useCallback(() => {
    setProbe(null);
    setError(null);
  }, []);

  return { probe, loading, error, generateProbe, clearProbe };
}
