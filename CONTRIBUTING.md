# Contributing to Lpdf for VS Code

## Reporting issues

Lpdf is not open contribution: we don't accept pull requests. The most valuable
contribution is a bug report with the smallest Lpdf XML that reproduces it. We
fix it and credit you in the release notes.

Report bugs and request features at
[github.com/lpdfio/lpdf/issues](https://github.com/lpdfio/lpdf/issues), the one
tracker for the engine, the SDKs and this extension.

## Building it yourself

The extension code is MIT licensed, so you can build and modify your own copy.
The Lpdf engine is not in this repository. Download it from the Lpdf releases
into `wasm/`, then build:

```bash
gh release download --repo lpdfio/lpdf --pattern lpdf.js --pattern lpdf_bg.wasm --dir wasm
npm install
npm run build
```

`npx vsce package` builds `lpdf.vsix`, which you can install with
**Extensions: Install from VSIX...**.

The engine files are not MIT licensed. See Part 2 of [LICENSE](LICENSE).

## Tracing

The extension can write a trace of what it does (renders and their timings, messages to and from
the webviews) to an **Lpdf** channel in the Output panel. It is off for users and has no setting.
It is on when the extension runs in an Extension Development Host (F5), and when VS Code was
started with `LPDF_TRACE` set, which also works for an installed `.vsix`:

```powershell
$env:LPDF_TRACE = '1'; code .
```

The code writes to it with `trace()` from `src/trace.ts`; errors still go to `console.error`.

## Tests

```bash
npm test                 # unit tests (Vitest): fast, no browser
npm run test:browser     # the viewer and the diff view in a real browser
```

The browser tests are in `test/browser/`. They serve the pages the way a VS Code webview gets
them, open the fixture PDFs in `test/browser/fixtures/`, and check what a user would see: the
header, zoom (buttons, keys, wheel, pinch, the 1000% limit), scrolling and memory in the diff view,
the properties dialogs, the page shadow. They need `npm run build` first, and a Chromium-based
browser: Edge or Chrome is found on the usual paths, or set `BROWSER_EXE` to one. Screenshots go to
`test/browser/.out/`. A run takes about three minutes.

To run one suite, `node test/browser/diff.mjs dark`. The suites for the themes take `dark` or
`light`; those for display scaling take `2` or `3`.

CI runs both on every push and pull request, and before a release package is built.

## Upgrading PDF.js

The PDF viewer and the diff view both run on one vendored copy of PDF.js in
`media/viewer/`. Do not edit its files by hand: `npm test` checks them against
`media/viewer/vendored.json`. To bring in a new release, run `scripts/vendor-pdfjs.mjs`, which
keeps only what the extension uses; the steps, and what to test afterwards, are in
[media/viewer/README.md](media/viewer/README.md). It must be PDF.js's legacy build, which is what
lets the viewer run in the oldest VS Code the extension supports, 1.95.
