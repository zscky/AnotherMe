/**
 * Diagnostic Probe types - frontend contract for the diagnostic probe system.
 */

export interface DiagnosticProbe {
  probeId: string;
  knowledgePointId: string;
  question: string;
  options: string[] | null;
  correctAnswer: string;
  explanation: string;
  difficulty: string;
  probeType: 'choice' | 'fill_blank' | 'step_by_step';
  hints: string[];
  teachingAction: string;
  reason: string;
}

export interface DiagnosticProbeRequest {
  knowledgePointId?: string;
  difficulty?: string;
  probeType?: string;
}

export interface DiagnosticProbeResult {
  probe: DiagnosticProbe;
}
