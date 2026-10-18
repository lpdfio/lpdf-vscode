# Changelog

## v0.27.0 (core) — 2026-10-18
### Layers
- **Breaking:** `<canvas>` is removed, and layers go directly in the section. Layers before the section's `<layout>` paint under it, and layers after it paint over it, so one section can draw both under and over its flow. A document that uses `<canvas>`, or `"type": "canvas"` in a JSON tree, fails with an error that says its layers go directly in the section
- **Breaking:** a section takes at most one `<layout>`. A second one was joined to the first, and now fails with an error
- **Breaking:** text and images in a layer are `<text-at>` and `<img-at>`, and `<text>` or `<img>` in a layer fails with an error that names the new element. They are the layout's own text and images, placed at `x` and `y`: a `<text-at>` draws its spans and fills in `{page}` and `{pages}`, which count within the section
- **Breaking:** `w` and `h` are now `width` and `height` on `<rect>`, `<text-at>` and `<img-at>`. Circles and ellipses lose `cx` and `cy`: `x` and `y` place their box, as for a `<rect>`, and `anchor` attaches the box's matching point. Each old attribute fails with an error that names its replacement
- **Breaking:** `opacity` is set on `<layer>` only. On a shape or text in a layer it is an error: to fade one element, put it in a layer of its own. A shape's own opacity was ignored until now
- Text in a layer has the same defaults as the layout's: the document's font or Helvetica, 11pt and the `text` colour (`#1a1a1a` unless the document redefines it). It was Helvetica, 12pt and black whatever the document set, so layer text without a font, size or colour of its own now looks different
- `<text-at>` is one line by default. With `width`, a longer line is cut off at the width, or ends in an ellipsis with `ellipsis="true"`, and `max-lines` wraps the text within the width, drawing whole lines only. `line-height` sets the distance between lines, 1.2 times the font size by default
- `<barcode-at>` places a barcode in a layer
- `data-if` and `data-if-not` work on `<layer>`, `<text-at>`, `<img-at>` and `<barcode-at>`, and `data-value` fills in a `<text-at>` or a `<barcode-at>`
- A layer with an `opacity` below 1 is faded as one: shapes that overlap inside it no longer show through each other
- A layer at `opacity="0"` draws nothing. It was drawn at full strength

### Layout
- **Breaking:** `margin` moves from `<document>` and `<section>` to `<layout>`, since only the flow uses it: layers measure from the page edges. It now defaults to 36pt, where it was 0, so a layout without a margin gets one: set `margin="0"` on it to keep the old pages. `margin` on a document or a section fails with an error that says it goes on `<layout>`
- **Breaking:** barcodes lose `size`, in the flow and in layers: a QR code takes `width` or `height`. A barcode's printed digits (`hrt`) now sit inside its height, where they added 12pt below it: add 12pt to `height` to keep the bars as tall. `size` fails with an error that names its replacement
- Images and barcodes keep their proportions, in the flow and in layers. Given `width` or `height`, the other follows: an image's own proportions, a square for a QR code, the standard symbol's for an EAN-13, and the bars at a default bar width for a Code 128. Given both, they are a maximum: the image or barcode takes the largest size that fits, and its box becomes that size, so `anchor` in a layer and the parent's `align` in the flow place the image itself. One that was stretched to both now comes out smaller in one direction, which can move what follows it. For slots of the same size, such as a row of logos, put each in a `<frame>` of that size

### SDKs
- **Breaking:** `L.canvas` is removed, and `L.section` takes layers and one `L.layout`. A layer's text, images and barcodes are `textAt`, `imgAt` and `barcodeAt` (`TextAt`, `ImgAt` and `BarcodeAt` in .NET, `text_at`, `img_at` and `barcode_at` in Python), with `TextAtAttr`, `ImgAtAttr` and `BarcodeAtAttr`
- **Breaking:** `margin` leaves `DocumentAttr` and `SectionAttr`, and `L.layout` takes it in a `LayoutAttr`
- **Breaking:** the attribute classes follow the schema: `width` and `height` in place of `w` and `h`, no `cx` or `cy` on circles and ellipses, no `size` on barcodes, and `opacity` on layers only
- **Breaking:** the strings and spans of a text are read as XML reads them, so a space falls between two of them only where a string has one: `["Total: ", L.span(…)]` reads "Total: 5", and `["Total:", L.span(…)]` now reads "Total:5". A text and the XML written from it render the same PDF
- A document built with the `L` builder uses the document's `font`, as its XML does. It was always Helvetica

### VS Code extension
- Hover, autocomplete and validation cover layers in the section, `text-at`, `img-at` and `barcode-at`, and `margin` on the layout, and the document templates use them

## v0.26.0 (core) — 2026-10-16
### Layout
- **Breaking:** `<stack>` is now `<column>`, and `<cluster>` is now `<row>`, so each name says which way it lays out. Both work exactly as before, with the same attributes. A document that uses an old name fails with an error that names the new one, such as `<stack> at line 4, col 9: renamed to <column>`, and so does `"type": "stack"` in a JSON tree
- **Breaking:** `<flank>` and `<split>` are removed, with their `end` and `equal` attributes, since a row now does what each did. `<flank>` becomes a `<row>` whose last child has `width="fill"` (its first child, for `end="true"`). `<split>` becomes `<row justify="between">`, and `<split equal="true">` a `<row>` with `width="fill"` on both children. A converted document renders the same PDF, except where a split's second child was wider than the space left: a row moves it to the next line, so give it `width="fill"`. A document that still uses either element fails with an error that says what to write instead
- `width="fill"` on a child of a row takes the width its line leaves after the other children, shared equally when several on the line use it. A fill child never moves to the next line. In a column it takes the full width
- `justify="between"` on a row puts each line's first child at the left edge, its last at the right, and the others evenly between

### SDKs
- **Breaking:** the `L` builder's `stack` and `cluster` are now `column` and `row`, with `ColumnAttr` and `RowAttr` in place of `StackAttr` and `ClusterAttr`. `flank` and `split` are removed, with `FlankAttr` and `SplitAttr`: use `row` with `width` set to `fill` or `justify` set to `between`, as under Layout

### VS Code extension
- Autocomplete and validation cover `column`, `row`, `width="fill"` and `justify="between"`, and the document templates use them

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
