import { Anchor, anchorsOf, lineAtPosition, pairHeadings, positionAtLine } from './markdown-headings';

/** The text of a `.md` file as the editor holds it; a `vscode.TextDocument` is one. */
export interface MarkdownSource {
  /** Changes with every edit of the text. */
  readonly version: number;
  readonly lineCount: number;
  getText(): string;
}

/** What the controller asks of the two sides. */
export interface ScrollSyncOutput {
  /** Scrolls the preview to a position in the PDF; see {@link Anchor}. */
  scrollPreviewTo(position: number): void;
  /** Scrolls the editor so that a line, counting from 0, is at its top. */
  revealLine(line: number): void;
}

/**
 * For how long, in milliseconds, after the preview has scrolled the editor the editor's own scroll events are
 * taken for the editor settling and passed over. Without it the editor would answer by scrolling the preview,
 * which would answer in turn.
 */
export const EDITOR_SETTLE_MS = 500;

/**
 * Keeps the editor and the preview of a `.md` file at the same place. The side the author is moving drives the
 * other: the other's reply to being moved is not taken for the author moving it back.
 *
 * The two agree at the headings that are bookmarks, and between two of them the line at the top of the editor
 * and the place at the top of the preview are the same fraction of the way along their section, so a section
 * with a table or an image in it is only roughly right in the middle, and right again at its ends.
 *
 * - The editor drives the preview: the line at the top of the editor is the place the preview scrolls to.
 * - The preview drives the editor: the place at the top of the preview is the line the editor scrolls to, and
 *   the editor's events for the next {@link EDITOR_SETTLE_MS} are passed over.
 */
export class ScrollSync {
  private _titles: readonly string[] = [];
  /** The line at the top of the editor that both sides were last made to agree on. */
  private _line: number | undefined;
  private _editorSettledAt = Number.NEGATIVE_INFINITY;
  private _anchors: Anchor[] = [];
  private _computedFor: { version: number; lineCount: number } | undefined;

  /**
   * @param _output What moves the editor and the preview.
   * @param _now The time in milliseconds; a test gives its own.
   */
  constructor(
    private readonly _output: ScrollSyncOutput,
    private readonly _now: () => number = Date.now,
  ) {}

  /**
   * The preview has drawn a PDF. Its outline stands in for the one before.
   * @param titles The title of each entry of the outline, in order.
   */
  outlineChanged(titles: readonly string[]): void {
    this._titles = titles;
    this._line = undefined;
    this._computedFor = undefined;
  }

  /** The preview shows no PDF with an outline: it was closed, or shows another file. */
  reset(): void {
    this._titles = [];
    this._line = undefined;
    this._editorSettledAt = Number.NEGATIVE_INFINITY;
    this._anchors = [];
    this._computedFor = undefined;
  }

  /**
   * The editor scrolled.
   * @param source The file.
   * @param line The line at the top of the editor, counting from 0.
   */
  editorMoved(source: MarkdownSource, line: number): void {
    if (this._now() - this._editorSettledAt < EDITOR_SETTLE_MS) { return; }
    const anchors = this._anchorsFor(source);
    if (!anchors || line === this._line) { return; }
    this._line = line;
    this._output.scrollPreviewTo(positionAtLine(anchors, line));
  }

  /**
   * The author scrolled the preview.
   * @param source The file.
   * @param position The place at the top of the preview.
   */
  previewMoved(source: MarkdownSource, position: number): void {
    const anchors = this._anchorsFor(source);
    if (!anchors) { return; }
    const line = Math.round(lineAtPosition(anchors, position));
    if (line === this._line) { return; }
    this._line = line;
    this._editorSettledAt = this._now();
    this._output.revealLine(line);
  }

  /**
   * Where the file and the PDF agree, worked out again only when the text has changed.
   * @returns The anchors, or undefined when no heading of the file is a heading of the outline: there is nothing
   *   to follow then.
   */
  private _anchorsFor(source: MarkdownSource): Anchor[] | undefined {
    if (this._computedFor?.version !== source.version || this._computedFor.lineCount !== source.lineCount) {
      const pairs = pairHeadings(source.getText(), this._titles);
      this._anchors = pairs.length > 0 ? anchorsOf(pairs, this._titles.length, source.lineCount) : [];
      this._computedFor = { version: source.version, lineCount: source.lineCount };
    }
    return this._anchors.length > 0 ? this._anchors : undefined;
  }
}
