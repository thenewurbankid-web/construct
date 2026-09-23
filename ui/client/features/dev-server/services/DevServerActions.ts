// Driving the target app's dev server (#378). Nothing here is ever called on its own: each is reached from a
// click. A refusal comes back as a status with `ok: false` and the reason in `refusal` or `failure`, so it is
// returned, not thrown.
import { postJson } from '@/lib/http';
import type { DevServerStatus } from '../types';

/** Start it. `port` is only sent for "Use port N". */
export const startDevServer = (port?: number) => postJson<DevServerStatus>('/api/dev-server/start', port ? { port } : {});

export const restartDevServer = (port?: number) => postJson<DevServerStatus>('/api/dev-server/restart', port ? { port } : {});

export const stopDevServer = () => postJson<DevServerStatus>('/api/dev-server/stop', {});
