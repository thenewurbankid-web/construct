// Reading the target app's dev server status (#378). A thin wrapper: no policy here. The server decides what
// state it is in and why a start is refused (workspace, script, port); this layer only asks and reports.
import { getJson } from '@/lib/http';
import type { DevServerStatus } from '../types';

export const fetchDevServer = () => getJson<DevServerStatus>('/api/dev-server');
