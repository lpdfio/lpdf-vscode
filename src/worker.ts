import { parentPort, workerData } from 'worker_threads';
import { randomBytes } from 'node:crypto';
import type { RenderAssets } from './engine';
import type { EncryptionRequest } from './encryption';

export interface IWasmEngine {
  load_font(name: string, bytes: Uint8Array): void;
  load_image(name: string, bytes: Uint8Array): void;
  set_encryption(user_password: string, owner_password: string, permissions_json: string, algorithm: string, entropy: Uint8Array): void;
  render_pdf(xml: string, json_data?: string | null): Uint8Array;
  free(): void;
}
export interface IWasmModule {
  LpdfEngine: new (license_key: string) => IWasmEngine;
}

export interface RenderRequest {
  id: string;
  xml: string;
  jsonData: string | null;
  assets: RenderAssets;
  /** Set for an encrypted export; a preview and a plain export leave it out. */
  encryption?: EncryptionRequest;
}

/** The random bytes AES-256 needs from the host, one 256-bit key's worth. The engine makes none itself. */
export const ENTROPY_BYTES = 32;

let _module: IWasmModule | undefined;
function getWasmModule(): IWasmModule {
  if (!_module) {
    const wasmPath = (workerData as { wasmPath: string }).wasmPath;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _module = require(wasmPath) as IWasmModule;
  }
  return _module;
}

/**
 * Renders one document on a fresh engine.
 *
 * A fresh engine per render, as the Node SDK does: its font and image registries then hold only this
 * document's assets, so bytes loaded for an earlier document can never stand in for one this document
 * fails to load. Construction only allocates two empty registries.
 *
 * An encrypted render gets its own 32 random bytes from Node's secure generator, so no two files share
 * a key. RC4-128 needs none.
 * @param wasm The engine module.
 * @param request What to render.
 * @returns The PDF, in a buffer the caller owns.
 */
export function renderRequest(wasm: IWasmModule, { xml, jsonData, assets, encryption }: RenderRequest): Uint8Array {
  const engine = new wasm.LpdfEngine('');
  try {
    for (const [key, bytes] of assets.fonts)  { engine.load_font(key, bytes); }
    for (const [key, bytes] of assets.images) { engine.load_image(key, bytes); }
    if (encryption) {
      const entropy = encryption.algorithm === 'aes-256' ? new Uint8Array(randomBytes(ENTROPY_BYTES)) : new Uint8Array(0);
      engine.set_encryption(
        encryption.userPassword,
        encryption.ownerPassword,
        JSON.stringify(encryption.permissions),
        encryption.algorithm,
        entropy,
      );
    }
    // Copy into a new buffer to guarantee we own the ArrayBuffer before transferring.
    // This guards against the WASM engine returning a view into shared WASM memory.
    return new Uint8Array(engine.render_pdf(xml, jsonData));
  } finally {
    engine.free();
  }
}

// Not a worker thread when a test imports this file.
parentPort?.on('message', (request: RenderRequest) => {
  const { id } = request;
  try {
    const bytes = renderRequest(getWasmModule(), request);
    parentPort!.postMessage({ id, bytes }, [bytes.buffer as ArrayBuffer]);
  } catch (e) {
    // Errors thrown by render_pdf are document-level (bad XML, bad image
    // bytes, etc.). A true WASM panic crashes the worker thread, which is
    // handled by the 'exit' event in engine.ts; a new worker is created then.
    parentPort!.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
});
