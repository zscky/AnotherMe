/**
 * Diagnostic Probe client - frontend API for generating diagnostic probes.
 */

import type { DiagnosticProbe, DiagnosticProbeRequest } from '@/lib/types/diagnostic-probe';

export interface FetchDiagnosticProbeInput extends DiagnosticProbeRequest {
  userId: string;
}

export async function fetchDiagnosticProbe(input: FetchDiagnosticProbeInput): Promise<DiagnosticProbe | null> {
  if (typeof window === 'undefined') return null;

  const response = await fetch(`/api/students/${encodeURIComponent(input.userId)}/diagnostic-probe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      knowledgePointId: input.knowledgePointId,
      difficulty: input.difficulty,
      probeType: input.probeType,
    }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: '', message: '', details: '' })) as {
      error?: string;
      message?: string;
      details?: string;
    };
    const message =
      (typeof error.error === 'string' && error.error) ||
      (typeof error.message === 'string' && error.message) ||
      `HTTP ${response.status}`;
    throw new Error(message);
  }

  const data = (await response.json()) as { probe: DiagnosticProbe };
  return data.probe;
}
