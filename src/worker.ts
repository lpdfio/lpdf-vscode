import { parentPort, workerData } from 'worker_threads';

interface IWasmEngine {
  render_pdf(xml: string, json_data?: string | null): Uint8Array;
  free(): void;
}
interface IWasmModule {
  LpdfEngine: new (licenseKey: string) => IWasmEngine;
}

interface RenderRequest {
  id: string;
  xml: string;
  licenseKey: string;
  jsonData: string | null;
}

let _module: IWasmModule | undefined;
function getWasmModule(): IWasmModule {
  if (!_module) {
    const wasmPath = (workerData as { wasmPath: string }).wasmPath;
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

parentPort!.on('message', ({ id, xml, licenseKey, jsonData }: RenderRequest) => {
  try {
    const engine = getEngine(licenseKey);
    const rawBytes = engine.render_pdf(xml, jsonData);
    // Copy into a new buffer to guarantee we own the ArrayBuffer before transferring.
    // This guards against the WASM engine returning a view into shared WASM memory.
    const bytes = new Uint8Array(rawBytes);
    parentPort!.postMessage({ id, bytes }, [bytes.buffer as ArrayBuffer]);
  } catch (e) {
    // Do NOT dispose the cached engine here. Errors thrown by render_pdf are
    // document-level (bad XML, missing image, etc.) — the engine itself remains
    // in a valid state and can be reused for the next request. A true WASM panic
    // crashes the worker thread, which is handled by the 'exit' event in engine.ts;
    // a new worker (and therefore a fresh engine) will be created automatically.
    parentPort!.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
});
