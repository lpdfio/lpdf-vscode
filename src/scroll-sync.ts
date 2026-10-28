import { entryAtLine, lineOfEntry, pairHeadings, PairedHeading } from './markdown-headings';

/** The text of a `.md` file as the editor holds it; a `vscode.TextDocument` is one. */
export interface MarkdownSource {
  /** Changes with every edit of the text. */
  readonly version: number;
  getText(): string;
}

/** What the controller asks of the two sides. */
export interface ScrollSyncOutput {
  /** Scrolls the preview to an entry of the PDF's outline, or to the top of the PDF for -1, the place above the first. */
  scrollPreviewTo(entry: number): void;
  /** Scrolls the editor so that a line, counting from 0, is at its top. */
  revealLine(line: number): void;
}

/**
 * For how long, in milliseconds, after the preview has scrolled the editor the editor's own scroll and cursor
 * events are taken for the editor settling and passed over. Without it the editor would answer by scrolling the
 * preview, which would answer in turn.
 */
export const EDITOR_SETTLE_MS = 500;

/**
 * Keeps the editor and the preview of a `.md` file at the same heading. The side the author is moving drives
 * the other: the other's reply to being moved is not taken for the author moving it back.
 *
 * - The editor drives the preview: the heading above the line at the top of the editor, or at the cursor, is
 *   the one the preview scrolls to. The viewer does not report that scroll as the author's.
 * - The preview drives the editor: when the author scrolls the preview to another heading, the editor scrolls
 *   to that heading's line, and the editor's events for the next {@link EDITOR_SETTLE_MS} are passed over.
 *
 * Both sides move in steps of a heading, so nothing is sent while the view stays in one section.
 */
export class ScrollSync {
  private _titles: readonly string[] = [];
  /** The entry that both sides are at, as far as is known; undefined while there is no outline. */
  private _synced: number | undefined;
  private _editorSettledAt = Number.NEGATIVE_INFINITY;
  private _pairs: PairedHeading[] = [];
  private _pairsVersion: number | undefined;

  /**
   * @param _output What moves the editor and the preview.
   * @param _now The time in milliseconds; a test gives its own.
   */
  constructor(
    private readonly _output: ScrollSyncOutput,
    private readonly _now: () => number = Date.now,
  ) {}

  /**
   * The preview has drawn a PDF. Its outline stands in for the one before, and the preview is at `top`.
   * @param titles The title of each entry of the outline, in order.
   * @param top The entry at the top of the preview, or -1 above the first.
   */
  outlineChanged(titles: readonly string[], top: number): void {
    this._titles = titles;
    this._synced = top;
    this._pairsVersion = undefined;
  }

  /** The preview shows no PDF with an outline: it was closed, or shows another file. */
  reset(): void {
    this._titles = [];
    this._synced = undefined;
    this._editorSettledAt = Number.NEGATIVE_INFINITY;
    this._pairs = [];
    this._pairsVersion = undefined;
  }

  /**
   * The editor scrolled, or the cursor moved.
   * @param source The file.
   * @param line The line at the top of the editor, or the cursor's, counting from 0.
   */
  editorMoved(source: MarkdownSource, line: number): void {
    if (this._now() - this._editorSettledAt < EDITOR_SETTLE_MS) { return; }
    const pairs = this._pairsOf(source);
    if (pairs.length === 0) { return; }
    const entry = entryAtLine(pairs, line);
    if (entry === this._synced) { return; }
    this._synced = entry;
    this._output.scrollPreviewTo(entry);
  }

  /**
   * The preview came to another heading.
   * @param source The file.
   * @param entry The entry at the top of the preview, or -1 above the first.
   * @param byUser Whether the author scrolled it. A move they did not make, such as the preview drawing a new
   *   PDF at the place it was, is noted and does not move the editor.
   */
  previewMoved(source: MarkdownSource, entry: number, byUser: boolean): void {
    if (entry === this._synced) { return; }
    this._synced = entry;
    if (!byUser) { return; }
    const pairs = this._pairsOf(source);
    if (pairs.length === 0) { return; }
    this._editorSettledAt = this._now();
    this._output.revealLine(lineOfEntry(pairs, entry));
  }

  /** The headings of the file paired with the outline, worked out again only when the text has changed. */
  private _pairsOf(source: MarkdownSource): PairedHeading[] {
    if (this._pairsVersion !== source.version) {
      this._pairs = pairHeadings(source.getText(), this._titles);
      this._pairsVersion = source.version;
    }
    return this._pairs;
  }
}
