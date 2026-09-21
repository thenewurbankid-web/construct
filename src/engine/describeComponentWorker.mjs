// Worker thread for describeComponent (#434): parses one source text with the docgen adapter and posts the
// JSON result back. Runs in its own thread so a pathological file can be cut off by a timeout (the parent
// terminates the worker) instead of stalling the server. Nothing here touches the disk or the network.
import { parentPort, workerData } from 'node:worker_threads';
import { describeSource } from './describeDocgen.mjs';

parentPort.postMessage(describeSource(workerData.source, workerData.filename));
