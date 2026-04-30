<p align="center"><img src="media/icon.png" height="48" alt="Lpdf"></p>

# lpdfio.lpdf

**VS Code extension for Lpdf — PDF as Code on every platform**

You describe a document as code or XML. Lpdf renders a compact, pixel-perfect PDF — identical across platforms.

**Preview, design, and export PDFs — entirely offline.**

![Lpdf demo](https://raw.githubusercontent.com/lpdfio/lpdf-vscode/HEAD/media/demo.gif)

## Features

### Preview any PDF

Open any `.pdf` file directly in VS Code. Right-click a PDF in the Explorer and select **Lpdf: Open PDF**, or use the command palette.

### Design PDFs using XML

Author PDF documents in XML and see a live preview on every save — rendered by the Lpdf WASM engine entirely on your machine. 

The extension automatically associates the Lpdf XSD schema with your files, giving you attribute autocomplete, element validation, and inline documentation. 

Link a JSON data file to your template to preview with real data substituted in.

### Export PDF

Run **Lpdf: Export PDF** to render the current XML template and write the PDF to disk.

## Requirements

- [Red Hat XML](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-xml) — required for XSD autocomplete and validation (installed automatically)
- A valid Lpdf license key to remove the watermark from exported PDFs (configure via `lpdf.licenseKey` in Settings)

## Extension Settings

| Setting | Description |
|---|---|
| `lpdf.licenseKey` | Your Lpdf license key. Removes the watermark from the preview and exports. |

## Fully Offline

The WASM renderer, PDF preview, and export all run locally. No server round-trips, no accounts, no data leaves your machine.

## Docs

[lpdf.io/docs](https://lpdf.io/docs)

--

The extension source code is [MIT licensed](LICENSE).

Lpdf is Dual-licensed: Community License (free) and Commercial License (paid). See [LICENSE](LICENSE) for full terms.
