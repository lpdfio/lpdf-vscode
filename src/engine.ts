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

/**
 * Font and image bytes for one render, keyed by the registry key the XML
 * declares in `<assets>` (`ref`, else `name`).
 */
export interface RenderAssets {
  fonts:  Map<string, Uint8Array>;
  images: Map<string, Uint8Array>;
}

type Resolve = (bytes: Uint8Array) => void;
type Reject  = (err: LpdfRenderError) => void;

let _worker: Worker | undefined;
// At most one in-flight render (the one the worker is currently executing).
const _pending = new Map<string, { resolve: Resolve; reject: Reject; timer: ReturnType<typeof setTimeout> }>();
// Latest render request waiting to be sent once the worker becomes free.
let _queued: { xml: string; jsonData: string | null; assets: RenderAssets; resolve: Resolve; reject: Reject } | undefined;

function getWorker(): Worker {
  if (_worker) { return _worker; }

  const workerPath = path.join(__dirname, 'worker.js');
  const wasmPath   = path.join(__dirname, '..', 'wasm', 'lpdf.js');
  const w = new Worker(workerPath, { workerData: { wasmPath } });
  _worker = w;

  w.on('message', (msg: { id: string; bytes?: Uint8Array; error?: string }) => {
    if (w !== _worker) { return; } // stale worker — ignore
    const entry = _pending.get(msg.id);
    if (!entry) {
      // Result arrived for a superseded render. Flush the queued request now.
      flushQueued();
      return;
    }
    clearTimeout(entry.timer);
    _pending.delete(msg.id);
    if (msg.error !== undefined) {
      entry.reject(new LpdfRenderError(msg.error));
    } else {
      entry.resolve(msg.bytes!);
    }
    // Worker is now free — send any waiting request.
    flushQueued();
  });

  w.on('error', (err) => {
    if (w !== _worker) { return; } // stale worker — ignore
    const msg = err.message;
    for (const entry of _pending.values()) { clearTimeout(entry.timer); entry.reject(new LpdfRenderError(msg)); }
    _pending.clear();
    _queued?.reject(new LpdfRenderError(msg));
    _queued = undefined;
    _worker = undefined;
  });

  w.on('exit', () => {
    if (w !== _worker) { return; } // stale worker — ignore
    for (const entry of _pending.values()) { clearTimeout(entry.timer); entry.reject(new LpdfRenderError('Render worker exited unexpectedly')); }
    _pending.clear();
    _queued?.reject(new LpdfRenderError('Render worker exited unexpectedly'));
    _queued = undefined;
    _worker = undefined;
  });

  return w;
}

/** Dispatch the queued request to the (now-idle) worker, if one is waiting. */
function flushQueued(): void {
  if (!_queued || !_worker) { return; }
  const { xml, jsonData, assets, resolve, reject } = _queued;
  _queued = undefined;
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
    _worker.postMessage({ id, xml, jsonData, assets });
  } catch (e) {
    clearTimeout(timer);
    _pending.delete(id);
    reject(new LpdfRenderError(e instanceof Error ? e.message : String(e)));
  }
}

export function renderPdf(xml: string, jsonData: string | null, assets: RenderAssets): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    // If the worker is idle (nothing in-flight), send immediately.
    if (_pending.size === 0) {
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
        getWorker().postMessage({ id, xml, jsonData, assets });
      } catch (e) {
        clearTimeout(timer);
        _pending.delete(id);
        reject(new LpdfRenderError(e instanceof Error ? e.message : String(e)));
      }
    } else {
      // Worker is busy. Supersede any previously queued (but not yet sent) request,
      // then park this one. It will be dispatched once the current render finishes.
      _queued?.reject(new LpdfRenderError('Superseded by a newer render'));
      _queued = { xml, jsonData, assets, resolve, reject };
    }
  });
}

export function cancelRender(): void {
  for (const entry of _pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new LpdfRenderError('Render cancelled'));
  }
  _pending.clear();
  _queued?.reject(new LpdfRenderError('Render cancelled'));
  _queued = undefined;
}

export function disposeRenderWorker(): void {
  for (const entry of _pending.values()) { clearTimeout(entry.timer); }
  _pending.clear();
  _queued = undefined;
  _worker?.terminate();
  _worker = undefined;
}
