# Changelog

## v0.25.1 — 2026-10-12
- The extension is no longer marked as Preview on the Marketplace

## v0.25.0 (core) — 2026-10-11
### Documents
- Bookmarks: `<bookmark>` adds an entry to the PDF's outline, the viewer's bookmark panel, nested by `level` (1 to 6). It marks the element that follows it, and directly inside a section it marks the section's first page
- Links within the document: `href="#id"` on `<link>` and `<span>` jumps to the bookmark with that id
- A table of contents: `<section type="toc">` is laid out after the other sections, with the data `$toc`, one entry per bookmark with its label, level and page number. Entries are indented by level with `toc-indent-step` (12pt by default), and `href="#"` inside an entry links to its bookmark

### Layout
- `widows` and `orphans` on `<text>`: the fewest lines, 1 to 10, that a paragraph split across pages may leave at the top of the next page or at the bottom of the first
- Both default to 2, so some documents break pages differently than in v0.24.0: a split paragraph keeps at least two lines on each page where it can. `widows="1"` and `orphans="1"` turn this off

### SDKs
- The `L` builder has a `bookmark` element, the section attributes `type` and `tocIndentStep` with a `SectionType` constant, and `widows` and `orphans` on text

### VS Code extension
- Autocomplete and validation cover bookmarks, the table of contents section, and `widows` and `orphans`

## v0.24.1 — 2026-10-05
The first release on the VS Code Marketplace.

- Live preview of Lpdf XML documents as you edit, and PDF export
- XML autocomplete and validation against the Lpdf schema, through Red Hat XML, which installs with the extension
- Link a JSON data file to a document, and preview it with the data filled in
- Generate TypeScript, C#, Python or PHP builder code from an XML document
- Start a document with **Lpdf: New Document**
- Open PDFs in VS Code, and compare a modified PDF with its version at your last commit

Earlier versions were not published to the Marketplace, and have no release notes.
