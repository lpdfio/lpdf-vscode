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

## Templates

**Lpdf: New Document...** offers the templates in `templates/`, one folder each:

```
templates/<id>/template.json   { "label": "...", "description": "...", "fileName": "...", "order": 1 }
templates/<id>/document.xml    the document, with an <lpdf> root and no schema location
templates/<id>/document.json   its data, optional; saved next to the new document under its name
templates/<id>/preview.png     a picture of it, optional; for a gallery later, not shown yet
```

To add one, add a folder; nothing else lists them. `label` and `description` are what the list
shows, `fileName` is the name the save dialog offers (letters, digits, `-` and `_`), and `order`
sorts the list, lowest first (100 when left out). `npm test` reads every template and renders it with
the engine, with its data and without, so a template that the engine no longer accepts fails
the build. Check a new template against the schema in the editor too: the tests do not. The text inside each element is what shows without data, so a template
should render sensibly on its own.

## README screenshots

The README's pictures are in `docs/images/`. They are not in the package: `vsce` points the README at
them on GitHub (`raw/HEAD/docs/images/...`), so they must be on the default branch, in a public
repository, before a release is published.

Each one is made from a raw screenshot in `docs/images/source/`, taken in VS Code in a dark theme
(Dark Modern; `light.png` is Light Modern), cropped, and given numbered labels. `docs/images/labels.json`
says how to crop each and where the labels go, in pixels of the raw screenshot. After replacing a raw
screenshot or moving a label:

```bash
npm run docs:images            # all of them, or: npm run docs:images -- diff hover
```

The numbers on a picture must match the list under it in the README, because text in an image is not
read out or searched. A full-window screenshot goes the full width of the README; only a tight crop
is wide enough in half the width to read, and the `<table>` rows with text next to an image use those.

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
