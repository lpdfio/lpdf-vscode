<p align="center"><img src="media/icon.png" height="48" alt="Lpdf"></p>

# Lpdf for VS Code

**Preview, design, and export PDFs — entirely offline.**

![Lpdf demo](https://raw.githubusercontent.com/lpdfio/lpdf-vscode/HEAD/media/demo.gif)

---

## Features

### Preview any PDF

Open any `.pdf` file directly in VS Code. Right-click a PDF in the Explorer and select **Lpdf: Open PDF**, or use the command palette.

### Design PDFs using XML

Author PDF documents in XML and see a live preview on every save — rendered by the Lpdf WASM engine entirely on your machine. 

The extension automatically associates the Lpdf XSD schema with your files, giving you attribute autocomplete, element validation, and inline documentation. 

Link a JSON data file to your template to preview with real data substituted in.

### Export PDF

Run **Lpdf: Export PDF** to render the current XML template and write the PDF to disk.

---

## Requirements

- [Red Hat XML](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-xml) — required for XSD autocomplete and validation (installed automatically)
- A valid Lpdf license key to remove the watermark from exported PDFs (configure via `lpdf.licenseKey` in Settings)

---

## Extension Settings

| Setting | Description |
|---|---|
| `lpdf.licenseKey` | Your Lpdf license key. Removes the watermark from the preview and exports. |

---

## Fully Offline

The WASM renderer, PDF preview, and export all run locally. No server round-trips, no accounts, no data leaves your machine.

---

## License

The extension source code is [MIT licensed](LICENSE).

The Lpdf engine bundled inside is proprietary. It is free for individuals, open-source projects, non-profits, and organizations with annual gross revenue under 1,000,000 USD. A paid license is required for production use by larger organizations — and removes the watermark from generated PDFs.

Visit [lpdf.io/pricing](https://lpdf.io/pricing) to purchase a license. See [LICENSE](LICENSE) for full terms.

---

## More Information

- [Documentation](https://lpdf.io/docs)
- [GitHub](https://github.com/lpdf-io/lpdf)
- [lpdf.io](https://lpdf.io)
