import { parentPort, workerData } from 'worker_threads';
import { randomBytes } from 'node:crypto';
import type { RenderAssets } from './engine';
import type { RenderEncryption } from './encryption';

export interface IWasmEngine {
  load_font(name: string, bytes: Uint8Array): void;
  load_image(name: string, bytes: Uint8Array): void;
  load_file(name: string, bytes: Uint8Array): void;
  load_profile(name: string, bytes: Uint8Array): void;
  load_markdown_styles(src: string, xml: string): void;
  set_created_on(iso: string): void;
  render_pdf(
    xml: string, json_data: string | null, user_password: string | null, owner_password: string | null,
    skip_encryption: boolean, entropy: Uint8Array,
  ): Uint8Array;
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
  /** The passwords of an export of a document that asks for encryption, or `skipEncryption` for a preview. */
  encryption: RenderEncryption;
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
 * A render with passwords gets its own 32 random bytes from Node's secure generator, so no two files share
 * a key. The engine takes the cipher and the permissions from the document's `<output>`.
 *
 * Every render is dated with the time it is made, as `created_on`: a document with `<output pdfa>`, `pdfua` or
 * `pdfx` carries its date, and the engine has no clock, so without one the preview and the export of such a document
 * fail.
 * @param wasm The engine module.
 * @param request What to render.
 * @param now The time of the render.
 * @returns The PDF, in a buffer the caller owns.
 */
export function renderRequest(
  wasm: IWasmModule, { xml, jsonData, assets, encryption }: RenderRequest, now: Date = new Date(),
): Uint8Array {
  const engine = new wasm.LpdfEngine('');
  try {
    for (const [key, bytes] of assets.fonts)  { engine.load_font(key, bytes); }
    for (const [key, bytes] of assets.images) { engine.load_image(key, bytes); }
    for (const [key, bytes] of assets.files ?? []) { engine.load_file(key, bytes); }
    for (const [key, bytes] of assets.profiles ?? []) { engine.load_profile(key, bytes); }
    for (const [src, text] of assets.markdownStyles ?? []) { engine.load_markdown_styles(src, text); }
    engine.set_created_on(createdOn(now));
    const { passwords, skipEncryption = false } = encryption;
    const entropy = passwords ? new Uint8Array(randomBytes(ENTROPY_BYTES)) : new Uint8Array(0);
    // Copy into a new buffer to guarantee we own the ArrayBuffer before transferring.
    // This guards against the WASM engine returning a view into shared WASM memory.
    return new Uint8Array(engine.render_pdf(
      xml, jsonData, passwords?.userPassword ?? null, passwords?.ownerPassword ?? null, skipEncryption, entropy,
    ));
  } finally {
    engine.free();
  }
}

/**
 * A time as the engine's `created_on`: ISO 8601 in UTC, to the second, such as `2026-10-31T16:40:12Z`.
 *
 * Whole seconds, the finest a PDF date holds (PDF 1.7, 7.9.4), so the engine is never given the milliseconds
 * of `toISOString()` to drop or to misread.
 * @param time The time.
 * @returns The date for `set_created_on`.
 */
function createdOn(time: Date): string {
  return `${time.toISOString().slice(0, 19)}Z`;
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
