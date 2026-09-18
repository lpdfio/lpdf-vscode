# Contributing to Lpdf for VS Code

## CLA required

Before a pull request can be merged, you must agree to the
[Contributor License Agreement](CLA.md). To agree, add this line to the pull
request description or a comment:

```
I have read and agree to the Lpdf CLA.
```

The extension code is MIT licensed. The CLA lets Codesense LLC release future
versions under different terms without asking every contributor again. You keep
ownership of your contribution.

## Getting started

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

## Questions

Open an issue.
