<img src="media/icon.png" height="48" alt="Lpdf - PDF as Code" />

**VS Code extension for Lpdf — PDF as Code on every platform**

You describe a document as code or XML. Lpdf renders a compact, pixel-perfect PDF — identical across platforms.

Design PDF documents in XML, preview live, and turn a template into SDK code for your platform — without leaving your editor.

![Lpdf demo](https://raw.githubusercontent.com/lpdfio/lpdf-vscode/HEAD/media/demo.gif)

## Fully Offline

The Lpdf engine, PDF preview, and export all run locally on your machine. No server round-trips, no accounts — your documents stay private. The extension collects no telemetry. The Red Hat XML extension it depends on asks for your consent to its own.

## Features

### Design PDFs in XML

Any `.xml` file whose root element is `<lpdf>` is an Lpdf document, whatever it is named. The extension validates it against the Lpdf schema, with autocomplete, element validation, and inline documentation.

Buttons above the `<lpdf>` element preview, export, generate code, and link a data file. The **Lpdf ◆** item in the status bar opens the preview.

### Live Preview

Run **Lpdf: Preview PDF** to open the rendered PDF beside your XML. It updates each time you save, and its download button saves the PDF.

### Data Files

Templates can bind to JSON data. A `<name>.json` file next to `<name>.xml` is picked up automatically, or choose any JSON file with **Lpdf: Link Data File...**. The preview updates when the data file changes, and export uses the same data.

### Images and Fonts

`<image src="…">` and `<font src="…">` in `<assets>` load from disk. A relative path is looked up next to the XML file first, then in the root of the workspace folder. URLs are not downloaded.

### Export PDF

Run **Lpdf: Export PDF** to render the current document, with its linked data, and save it to disk.

### Code Generation

Run **Lpdf: Generate Code** to turn the saved XML into SDK code that builds the same document. It opens beside your template. Supported languages: TypeScript, C#, Python, and PHP.

### PDF Viewer

Open any `.pdf` file in VS Code: right-click it in the Explorer and select **Lpdf: View PDF**, or use the command palette. To open every PDF this way, turn on the `lpdf.defaultPdfViewer` setting.

### Compare PDF with HEAD

Right-click a `.pdf` in the Explorer and select **Lpdf: Compare PDF with HEAD**, or use the button next to a changed PDF in the Source Control view. The version in your last commit and your working copy open side by side, with synced scrolling. The file needs a committed version in a git repository.

## Requirements

- [Red Hat XML](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-xml) — required for XSD autocomplete and validation (installed automatically)

## Docs

[lpdf.io/docs](https://lpdf.io/docs?utm_source=readme&utm_medium=referral&utm_campaign=vscode)

## License

The extension is free to use, for any purpose. Previews and exports carry a "Made with Lpdf" line on every page.

The extension code is MIT licensed. The bundled Lpdf engine may be used through the extension by anyone, including for the PDFs it produces. See [LICENSE](LICENSE) for the terms. Using the engine in your own app is covered by the [Lpdf License](https://lpdf.io/license).

Pull requests are not accepted. Report bugs and request features at [github.com/lpdfio/lpdf/issues](https://github.com/lpdfio/lpdf/issues). See [CONTRIBUTING](CONTRIBUTING.md).
