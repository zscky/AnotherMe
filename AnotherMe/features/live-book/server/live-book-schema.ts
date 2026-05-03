export const LIVE_BOOK_BLOCK_SCHEMA_VERSION = 1;

export interface LiveBookBlockStorageShape {
  paramsJson: Record<string, unknown>;
  metadataJson: Record<string, unknown>;
  payloadJson: Record<string, unknown>;
  sourceRefsJson: Array<Record<string, unknown>>;
  error?: string;
}

export function normalizeLiveBookBlockStorage(input: {
  paramsJson?: Record<string, unknown>;
  metadataJson?: Record<string, unknown>;
  payloadJson?: Record<string, unknown>;
  sourceRefsJson?: Array<Record<string, unknown>>;
  error?: string;
}): LiveBookBlockStorageShape {
  const payloadJson = input.payloadJson || {};
  const paramsJson = input.paramsJson || payloadJson || {};
  const sourceRefsJson = input.sourceRefsJson || [];
  const metadataJson = {
    schemaVersion: LIVE_BOOK_BLOCK_SCHEMA_VERSION,
    sourceRefsCount: sourceRefsJson.length,
    ...(input.metadataJson || {}),
  };

  return {
    paramsJson,
    metadataJson,
    payloadJson,
    sourceRefsJson,
    ...(input.error ? { error: input.error } : {}),
  };
}
