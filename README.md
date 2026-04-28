<p align="center"><img src="media/icon.png" height="48" alt="Lpdf"></p>

# Lpdf for VS Code

**Preview any PDF. Author documents using XML.**

![Lpdf demo](https://raw.githubusercontent.com/lpdfio/lpdf-vscode/HEAD/media/demo.gif)

---

## Features

### Live PDF Preview

Open any Lpdf XML file and trigger **Lpdf: Preview PDF** to see a live PDF preview rendered via the WASM engine — entirely on your machine, no server required. The preview updates on every save.

### Export PDF

**Lpdf: Export PDF** renders the current XML template and writes the PDF to disk.

### XSD Autocomplete & Validation

The extension registers the Lpdf XSD schema automatically when you open an Lpdf XML file. Get attribute autocomplete, element validation, and inline documentation — no configuration needed. Requires the [Red Hat XML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-xml).

---

## Requirements

- [Red Hat XML](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-xml) — required for XSD autocomplete and validation (installed automatically as a dependency)
- A valid Lpdf license key to remove the preview watermark (configure via `lpdf.licenseKey` in Settings)

---

## Extension Settings

| Setting | Description |
|---|---|
| `lpdf.licenseKey` | Your Lpdf license key. Removes the watermark from the preview. |

---

## Fully Offline

The WASM renderer, PDF preview, and export all run locally. No server round-trips, no accounts, no data leaves your machine.

---

## Roadmap

The following features are planned and in development:

- **Code generation** — convert an XML template to typed builder code (TypeScript, C#, Python, PHP)
- **Data binding** — bind a JSON file to the template and preview with live data substituted
- **Visual layout editor** — drag-and-drop layout authoring with XML kept in sync

---

## VS Code Extension

The extension provides live preview, PDF export, code generation, and XSD-backed XML validation for `.lpdf` files.

| Command | Description |
|---|---|
| `make build-adapter-vscode` | Compile TypeScript, copy WASM + schema |
| `make package-adapter-vscode` | Package into `src/adapters/vscode/lpdf.vsix` |
| `make install-adapter-vscode` | Package and install into VS Code |

To update the extension after making changes (schema, WASM, or TypeScript source):

```sh
make install-adapter-vscode
```

Then **restart VS Code** (or run **Developer: Restart Extension Host** from the Command Palette) to load the new version. The install step automatically rebuilds and repackages before installing.

> **Note:** `build-adapter-vscode` copies `docs/schema/lpdf.xsd` from the project root into the extension. Always edit the canonical schema at `docs/schema/lpdf.xsd`; changes made directly to `src/adapters/vscode/schema/lpdf.xsd` will be overwritten on the next build.

---

## License

Free for individuals, open-source projects, non-profits, and organizations with annual gross revenue under 1,000,000 USD (Community License). A paid license is required for production use by larger organizations.

Visit [lpdf.io/pricing](https://lpdf.io/pricing) to purchase a license. Once you have a key, set it in VS Code Settings under `lpdf.licenseKey`.

See [LICENSE](LICENSE) for full terms.

---

## More Information

- [Documentation](https://lpdf.io/docs)
- [GitHub](https://github.com/lpdf-io/lpdf)
- [lpdf.io](https://lpdf.io)
