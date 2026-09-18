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
