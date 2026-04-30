<p align="center"><img src="media/icon.png" height="48" alt="Lpdf"></p>

**VS Code extension for Lpdf — PDF as Code on every platform**

You describe a document as code or XML. Lpdf renders a compact, pixel-perfect PDF — identical across platforms.

Design PDF documents in XML, preview live, and generate typed code for your platform — without leaving your editor.

![Lpdf demo](https://raw.githubusercontent.com/lpdfio/lpdf-vscode/HEAD/media/demo.gif)

## Fully Offline

The Lpdf engine, PDF preview, and export all run locally on your machine. No server round-trips, no accounts, no telemetry — your documents stay private.

## Features

### PDF Viewer

Open any `.pdf` file in VS Code. Right-click a PDF in the Explorer and select **Lpdf: Open PDF**, or use the command palette.

### Design PDFs in XML

Author PDF documents in XML with a live preview that updates on every save. The extension automatically validates your files against the Lpdf schema, providing autocomplete, element validation, and inline documentation.

Link a JSON data file to your template to preview with real data.

### Export PDF

Run **Lpdf: Export PDF** to render and save the current document to disk.

### Code Generation

Generate typed model code directly from your XML template. Supported languages: TypeScript, C#, PHP, and Python.

## Requirements

- [Red Hat XML](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-xml) — required for XSD autocomplete and validation (installed automatically)

## Docs

[lpdf.io/docs](https://lpdf.io/docs)

--

The extension source code is [MIT licensed](LICENSE).

Lpdf is Dual-licensed: Community License (free) and Commercial License (paid). See [LICENSE](LICENSE) for full terms.
