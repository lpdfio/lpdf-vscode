# The PDF viewer (media/viewer/)

The extension shows PDFs with [PDF.js](https://mozilla.github.io/pdf.js/). One copy of it lives
here, and two pages run on it: the full viewer and the diff view. This file is for whoever
upgrades that copy. It is not in the package.

## What is here

Lpdf's own files, edited by hand:

| File | What it does |
| --- | --- |
| `lpdf-pdfjs.mjs` | Loads the PDF.js library for every page: the worker as a blob, the Map polyfill, the locations of the fonts, character maps and decoders. |
| `lpdf-bytes.mjs` | PDF bytes to and from base64, the form in which a PDF travels between the extension host and a page. |
| `lpdf-host.mjs` | Starts the stock viewer as a read-only viewer and talks to the extension. Lists the viewer internals it relies on. |
| `lpdf-toolbar.mjs` | The Lpdf header: moves the viewer's controls and adds the zoom field, fit toggle, two-page and cover buttons. Lists the markup it relies on. |
| `lpdf-theme.css` | The viewer's palette and the icons Lpdf draws, loaded by the full viewer and the diff view so they look alike. A test fails if an upgrade changes a colour it mirrors. |
| `lpdf-diff-zoom.mjs` | The zoom arithmetic of the diff view: pinch and Ctrl-wheel, the zoom range (10% to 1000%, as the full viewer's), anchoring under the pointer. |
| `lpdf-diff-info.mjs` | The document properties of the diff view: HEAD and working copy side by side, in the formats of the viewer's own dialog. |

PDF.js's files, never edited by hand: `build/`, `web/`, `LICENSE`. `vendored.json` records the
versions, the one change the script makes to them (below), and the SHA-256 of each file. `npm test`
fails if one has changed.

## Upgrading PDF.js

You need Node and, on Windows, PowerShell. Everything is downloaded to a temporary folder.

```powershell
$v = '6.3.289'                      # the PDF.js release to bring in
$work = Join-Path $env:TEMP 'pdfjs-upgrade'
New-Item -ItemType Directory -Force $work | Out-Null

# PDF.js: the LEGACY release zip (see "Which VS Code" below), not the npm package (it has no viewer).
Invoke-WebRequest "https://github.com/mozilla/pdf.js/releases/download/v$v/pdfjs-$v-legacy-dist.zip" -OutFile "$work\pdfjs.zip"
Expand-Archive "$work\pdfjs.zip" "$work\pdfjs" -Force

# Liberation Sans 2.x (SIL Open Font License). Keep the version that is in vendored.json, unless
# you mean to change it: https://github.com/liberationfonts/liberation-fonts/releases
Invoke-WebRequest 'https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz' -OutFile "$work\liberation.tar.gz"
tar -xzf "$work\liberation.tar.gz" -C $work

node scripts/vendor-pdfjs.mjs --pdfjs "$work\pdfjs" --liberation "$work\liberation-fonts-ttf-2.1.5"
```

The script replaces `build/`, `web/`, `LICENSE` and `vendored.json` here and nothing else. It keeps
what the extension uses, leaves out the rest of the release, and writes the new `vendored.json`.
It refuses the standard build. It also lowers the highest zoom of `web/viewer.mjs`, `MAX_SCALE`,
from 25 (2500%) to 10 (1000%): nothing in the viewer sets that limit, and the buttons, the keys,
the wheel and pinch all share it. The first line of the file says it was changed. If a release no
longer has the constant as it was, the script stops and says so; look at whether the cap is still
needed. The diff view (`lpdf-diff-zoom.mjs`) and the zoom field (`lpdf-toolbar.mjs`) use the same
1000%, and a test fails if the three drift apart. Then:

1. `node scripts/vendor-pdfjs.mjs --check`, and `npm test`. The tests run the header code on the
   new `web/viewer.html`; if PDF.js moved a control, the failure names it (a `ToolbarMarkupError`).
2. Look at the two lists of internals, in `lpdf-host.mjs` and `lpdf-toolbar.mjs`, against the new
   `web/viewer.mjs`. They are not a published interface. The ones that break quietly are the
   replaced methods (`rotatePages`, `requestPresentationMode`, `downloadManager.download`), the
   events (`scalechanging`, `spreadmodechanged`, `updateviewarea`) and the option names.
3. `npm run build && npm run test:browser` runs the viewer and the diff view in a real browser and
   covers most of the list below. Then build and install (`make install-vscode`), reload the
   window, and open a PDF in VS Code. Check: the header,
   search, the page box, zoom (field, buttons, Ctrl and wheel), the fit toggle, two page and cover,
   Save, document properties, the Pages panel, and that Ctrl+Alt+P does nothing. Then
   **Lpdf: Compare PDF with HEAD** for the diff view: synced scrolling, zoom (buttons, typed, fit
   toggle, pinch), the properties dialog, and a long PDF scrolled from top to bottom.
4. Update `THIRD_PARTY_LICENSES` if the version or a licence changed (the legacy build bundles
   core-js, whose version is in `build/pdf.mjs`), and the release notes.
5. Run the viewer and the diff view in the Chromium of the oldest VS Code that `engines.vscode`
   allows, which is the real test of the next section.
6. Check the PDF.js notes for anything the viewer now needs that the page does not allow: a new
   file type under `media/viewer/`, or a change to the CSP in `src/pdfjs-csp.ts`.

## Which VS Code

`engines.vscode` in `package.json` is 1.95, which has Chromium 128 (Electron 32). Two things set it:

- The standard build of PDF.js takes the browser to have JavaScript that only a recent Chromium
  has: `URL.parse`, `Promise.try`, `Uint8Array.prototype.toHex`, `RegExp.escape` and more. In
  Chromium 124 (VS Code 1.92) it fails to open any PDF (`URL.parse is not a function`), and in
  128 too (`toHex is not a function`). The legacy build bundles polyfills for them, so the
  extension uses it, and `vendor-pdfjs.mjs` refuses the standard one.
- Polyfills cannot help with CSS. The viewer sizes its text layer with `round()`, which
  Chromium 124 does not have: the text layer is 0px high there, so text cannot be selected.
  Chromium 125 and later have it, and VS Code 1.95 is the first with one (1.92 to 1.94 have 124).
  The extension's own CSS needs less: `light-dark()` and nesting, which Chromium 123 has.

To check a version, run the browser tests in the matching Chrome, which is quicker than installing
that VS Code: `npx @puppeteer/browsers install chrome@128.0.6613.186`, then set `BROWSER_EXE` to
the `chrome` it installed and run `npm run test:browser`. Raise `engines.vscode` if an upgrade of PDF.js needs more.

## What is dropped, and why

| Left out | Reason |
| --- | --- |
| Source maps, `build/pdf.sandbox.mjs` | Debugging only. The sandbox runs the scripts inside PDFs, which is switched off. |
| `web/debugger.*`, the sample PDF | Not used. |
| Every viewer language but English (about 3 MB) | The viewer falls back to English. Lpdf's own header strings are English as well. |

Kept, though it would save space to drop them: **the character maps** (`web/cmaps/`, about 1.5 MB,
Adobe's CMap resources). A PDF that names a CJK font by one of the predefined encodings, such as
`UniJIS-UCS2-H`, needs the matching map to show its text. Lpdf's own PDFs never do (none of the
sample PDFs asks for one), but the viewer opens any PDF, and it fetches a map only when one is
needed. To drop them anyway, remove `web/cmaps/` from `KEPT_FOLDERS` in `scripts/vendor-pdfjs.mjs`.

## Fonts

PDF.js draws the standard fonts a PDF names but does not embed (Helvetica, Times, Courier) from
files in `web/standard_fonts/`, when the system has nothing better. The Foxit fonts there are
BSD-3-Clause. The Liberation Sans ones are replaced by the script with Liberation 2.x, under the
SIL Open Font License; the ones in the PDF.js release are 1.x, under the GNU GPL with font
exceptions. The files are used whole: the OFL reserves the name "Liberation" for modified versions.
