import { Worker } from 'worker_threads';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { RENDER_TIMEOUT_MS } from './constants';

export class LpdfRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LpdfRenderError';
  }
}

type Resolve = (bytes: Uint8Array) => void;
type Reject  = (err: LpdfRenderError) => void;

let _worker: Worker | undefined;
const _pending = new Map<string, { resolve: Resolve; reject: Reject; timer: ReturnType<typeof setTimeout> }>();

function getWorker(): Worker {
  if (_worker) { return _worker; }

  const workerPath = path.join(__dirname, 'worker.js');
  const wasmPath   = path.join(__dirname, '..', 'wasm', 'lpdf.js');
  const w = new Worker(workerPath, { workerData: { wasmPath } });
  _worker = w;

  w.on('message', (msg: { id: string; bytes?: Uint8Array; error?: string }) => {
    if (w !== _worker) { return; } // stale worker — ignore
    const entry = _pending.get(msg.id);
    if (!entry) { return; }
    clearTimeout(entry.timer);
    _pending.delete(msg.id);
    if (msg.error !== undefined) {
      entry.reject(new LpdfRenderError(msg.error));
    } else {
      entry.resolve(msg.bytes!);
    }
  });

  w.on('error', (err) => {
    if (w !== _worker) { return; } // stale worker — ignore
    const msg = err.message;
    for (const entry of _pending.values()) { clearTimeout(entry.timer); entry.reject(new LpdfRenderError(msg)); }
    _pending.clear();
    _worker = undefined;
  });

  w.on('exit', () => {
    if (w !== _worker) { return; } // stale worker — ignore
    for (const entry of _pending.values()) { clearTimeout(entry.timer); entry.reject(new LpdfRenderError('Render worker exited unexpectedly')); }
    _pending.clear();
    _worker = undefined;
  });

  return w;
}

export function renderPdf(xml: string, jsonData: string | null = null): Promise<Uint8Array> {
  // Cancel any in-flight render before starting a new one.
  // The stale-worker guard in the event handlers ensures the old worker's exit
  // event cannot clobber the new pending entry.
  if (_pending.size > 0) {
    for (const entry of _pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new LpdfRenderError('Superseded by a newer render'));
    }
    _pending.clear();
    _worker?.terminate();
    _worker = undefined;
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      if (_pending.delete(id)) {
        reject(new LpdfRenderError('Render timed out after 30 seconds'));
        _worker?.terminate();
        _worker = undefined;
      }
    }, RENDER_TIMEOUT_MS);
    _pending.set(id, { resolve, reject, timer });
    try {
      getWorker().postMessage({ id, xml, jsonData });
    } catch (e) {
      clearTimeout(timer);
      _pending.delete(id);
      reject(new LpdfRenderError(e instanceof Error ? e.message : String(e)));
    }
  });
}

export function cancelRender(): void {
  for (const entry of _pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new LpdfRenderError('Render cancelled'));
  }
  _pending.clear();
  _worker?.terminate();
  _worker = undefined;
}

export function disposeRenderWorker(): void {
  for (const entry of _pending.values()) { clearTimeout(entry.timer); }
  _pending.clear();
  _worker?.terminate();
  _worker = undefined;
}
