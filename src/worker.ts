import { parentPort } from 'worker_threads';
import * as path from 'node:path';

interface IWasmEngine {
  render_pdf(xml: string, json_data?: string | null): Uint8Array;
  free(): void;
}
interface IWasmModule {
  LpdfEngine: new (licenseKey: string) => IWasmEngine;
}

interface RenderRequest {
  id: number;
  xml: string;
  licenseKey: string;
}

let _module: IWasmModule | undefined;
function getWasmModule(): IWasmModule {
  if (!_module) {
    const wasmPath = path.join(__dirname, '..', 'wasm', 'lpdf.js');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _module = require(wasmPath) as IWasmModule;
  }
  return _module;
}

// Cached engine instance — avoids re-initialising WASM and re-validating the
// license key on every render request.
let _engine: IWasmEngine | undefined;
let _engineKey: string | undefined;

function getEngine(licenseKey: string): IWasmEngine {
  if (_engine && _engineKey === licenseKey) { return _engine; }
  _engine?.free();
  _engine = new (getWasmModule()).LpdfEngine(licenseKey);
  _engineKey = licenseKey;
  return _engine;
}

parentPort!.on('message', ({ id, xml, licenseKey }: RenderRequest) => {
  try {
    const engine = getEngine(licenseKey);
    const rawBytes = engine.render_pdf(xml);
    // Copy into a new buffer to guarantee we own the ArrayBuffer before transferring.
    // This guards against the WASM engine returning a view into shared WASM memory.
    const bytes = new Uint8Array(rawBytes);
    parentPort!.postMessage({ id, bytes }, [bytes.buffer as ArrayBuffer]);
  } catch (e) {
    // Dispose the cached engine on error to prevent stale state on the next request.
    _engine?.free();
    _engine = undefined;
    _engineKey = undefined;
    parentPort!.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
});
