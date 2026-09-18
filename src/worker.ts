import { parentPort, workerData } from 'worker_threads';
import type { RenderAssets } from './engine';

interface IWasmEngine {
  load_font(name: string, bytes: Uint8Array): void;
  load_image(name: string, bytes: Uint8Array): void;
  render_pdf(xml: string, json_data?: string | null): Uint8Array;
  free(): void;
}
interface IWasmModule {
  LpdfEngine: new (license_key: string) => IWasmEngine;
}

interface RenderRequest {
  id: string;
  xml: string;
  jsonData: string | null;
  assets: RenderAssets;
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

parentPort!.on('message', ({ id, xml, jsonData, assets }: RenderRequest) => {
  // A fresh engine per render, as the Node SDK does: its font and image
  // registries then hold only this document's assets, so bytes loaded for an
  // earlier document can never stand in for one this document fails to load.
  // Construction only allocates two empty registries.
  let engine: IWasmEngine | undefined;
  try {
    engine = new (getWasmModule()).LpdfEngine('');
    for (const [key, bytes] of assets.fonts)  { engine.load_font(key, bytes); }
    for (const [key, bytes] of assets.images) { engine.load_image(key, bytes); }
    const rawBytes = engine.render_pdf(xml, jsonData);
    // Copy into a new buffer to guarantee we own the ArrayBuffer before transferring.
    // This guards against the WASM engine returning a view into shared WASM memory.
    const bytes = new Uint8Array(rawBytes);
    parentPort!.postMessage({ id, bytes }, [bytes.buffer as ArrayBuffer]);
  } catch (e) {
    // Errors thrown by render_pdf are document-level (bad XML, bad image
    // bytes, etc.). A true WASM panic crashes the worker thread, which is
    // handled by the 'exit' event in engine.ts; a new worker is created then.
    parentPort!.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  } finally {
    engine?.free();
  }
});
