// Public API for feature: ollama

/** Shared identifier and API-shape types for the ollama feature. */
export type * from './types';

/** Renders Ollama detection/install-guidance/model-management. */
export * from './controllers/OllamaController';

/** Loads status/models and drives pull/remove — used by OllamaController;
 * exported for direct reuse/testing. */
export * from './hooks/useOllama';

/** Ollama status/model fetchers (used by the shell top-bar model pill). */
export * from "./services/Ollama";
