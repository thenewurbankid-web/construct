// The Tests API's base path for one feature (the name is encoded; the server validates it against the real feature list).
export const testsBase = (feature: string): string => `/api/tests/${encodeURIComponent(feature)}`;
