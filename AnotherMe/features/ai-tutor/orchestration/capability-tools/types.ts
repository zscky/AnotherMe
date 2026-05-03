import type { ToolId } from '../capability-registry';

export interface CapabilityToolResult<TMetadata extends Record<string, unknown> = Record<string, unknown>> {
  success: boolean;
  toolId: ToolId;
  output: string;
  metadata?: TMetadata;
  error?: string;
}

export interface RenderedArtifact {
  format: string;
  content?: string;
  url?: string;
  path?: string;
  mimeType?: string;
}
