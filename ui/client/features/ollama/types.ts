export type OllamaModelId = string;

/** Same shape ui/server's GET /api/ollama/status returns (see
 * ui/server/src/ollama.mjs) — a non-running daemon is a normal, reportable
 * state, not an error. */
export type OllamaStatus = {
  running: boolean;
  version?: string | null;
  host?: string;
};

/** One entry from Ollama's own `/api/tags`, passed through as-is. */
export type OllamaModel = {
  name: string;
  size?: number;
  modified_at?: string;
  digest?: string;
};

/** One newline-delimited JSON event from Ollama's own `/api/pull` stream. */
export type PullProgress = {
  status: string;
  completed?: number;
  total?: number;
  error?: string;
};
