/**
 * The headings of a `.md` file, and which entry of the PDF's outline each one is. The outline lists the
 * headings that are bookmarks, in the order of the file, so pairing the two gives places where the file and
 * the PDF are known to agree: the editor and the preview move together by them, and between two of them
 * by how far along the section a line, or a position, is.
 *
 * Only headings written with `#` are read. One underlined with `===` or `---` is not a place the two
 * sides agree: its outline entry has no line, and the section before it runs on over it.
 */

/** A heading of a `.md` file. */
export interface MarkdownHeading {
  /** Its line in the file, counting from 0. */
  line: number;
  /** What its words reduce to; see {@link headingKey}. */
  key: string;
}

/** A heading of the file and the entry of the outline that is the same heading. */
export interface PairedHeading {
  /** Its line in the file, counting from 0. */
  line: number;
  /** Its place in the outline, counting from 0 in the order the outline lists its entries, a nested one after its parent. */
  entry: number;
}

/**
 * What the words of a heading as written in the file reduce to, for telling whether a heading of the file and
 * an entry of the outline are the same: the letters and digits of its text in lower case. The outline gives the
 * words without the markup that was around them, so a link keeps its words and loses its address, an image and
 * a footnote mark are dropped, a tag such as `<br>` is a space, and no `*`, `_`, `~`, backtick or backslash is
 * left. What is in a span of code stays, tags included.
 * @param text The words as written in the file.
 * @returns The key; empty when nothing of the text would be a label.
 */
export function headingKey(text: string): string {
  return titleKey(text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\^[^\]]*\]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/(`+)(.+?)\1|<[^>]*>/g, (_match, ticks: string | undefined, code: string) => (ticks ? code : ' '))
    .replace(/&(?:[a-z][a-z0-9]*|#x?[0-9a-f]+);/gi, ''));
}

/**
 * What the title of an outline entry reduces to: the letters and digits of its text in lower case. It is the
 * words of the heading already, with no markup in it, so a `<` in it is a character of the words.
 * @param title The title the outline gives.
 * @returns The key, comparable with {@link headingKey}'s.
 */
export function titleKey(title: string): string {
  return title.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
}

const ATX_HEADING = /^ {0,3}#{1,6}(?=[ \t]|$)(.*)$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** The line after the front matter at the start of a file, or 0 when the file has none. */
function firstLineAfterFrontMatter(lines: readonly string[]): number {
  if (lines[0] !== '---') { return 0; }
  const end = lines.findIndex((line, index) => index > 0 && (line === '---' || line === '...'));
  return end < 0 ? 0 : end + 1;
}

/**
 * The headings of a `.md` file, in the order they are written. The front matter and the fenced code blocks
 * hold none, and neither does a heading with no words.
 * @param text The text of the file.
 * @returns The headings, by line.
 */
export function markdownHeadings(text: string): MarkdownHeading[] {
  const lines = text.split(/\r\n|\r|\n/);
  const headings: MarkdownHeading[] = [];
  let fence: { marker: string; length: number } | undefined;
  for (let line = firstLineAfterFrontMatter(lines); line < lines.length; line++) {
    const source = lines[line];
    if (fence) {
      const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(source);
      if (close && close[1][0] === fence.marker && close[1].length >= fence.length) { fence = undefined; }
      continue;
    }
    const open = FENCE_OPEN.exec(source);
    // The words after a backtick fence cannot hold a backtick; a line that does is a span of code.
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = { marker: open[1][0], length: open[1].length };
      continue;
    }
    const heading = ATX_HEADING.exec(source);
    if (!heading) { continue; }
    const key = headingKey(heading[1].replace(/(^|[ \t]+)#+[ \t]*$/, ''));
    if (key) { headings.push({ line, key }); }
  }
  return headings;
}

/**
 * Pairs the headings of a file with the entries of the outline of its PDF. The outline is the headings
 * that are bookmarks, in the order of the file, so each entry takes the next heading with the same words.
 * An entry that no heading of the file is left over for has none, and a heading with no entry is passed
 * over: the file may have headings the PDF has not been drawn with yet, the unsaved ones, and ones that are
 * not bookmarks.
 * @param text The text of the file, as it is now.
 * @param titles The title of each outline entry, in the outline's order.
 * @returns The pairs, in the order of the file.
 */
export function pairHeadings(text: string, titles: readonly string[]): PairedHeading[] {
  const headings = markdownHeadings(text);
  const pairs: PairedHeading[] = [];
  let next = 0;
  titles.forEach((title, entry) => {
    const key = titleKey(title);
    const found = key ? headings.findIndex((heading, index) => index >= next && heading.key === key) : -1;
    if (found < 0) { return; }
    pairs.push({ line: headings[found].line, entry });
    next = found + 1;
  });
  return pairs;
}

/**
 * A place where a line of the file and a position in the PDF are known to be the same. A position is a
 * number: the entry of the outline whose section it is in, and how far through that section it is, as a
 * fraction. So 2.5 is half way through the section of entry 2, -1 is the top of the PDF, above the first
 * entry, and the number of entries is the end of the PDF.
 */
export interface Anchor {
  /** A line of the file, counting from 0. */
  line: number;
  /** A position in the PDF. */
  position: number;
}

/** The position of the top of the PDF, above the first entry of the outline. */
export const TOP_OF_PDF = -1;

/**
 * The places where the file and the PDF agree: the top of both, the heading of each pair, and the end of both.
 * Between two of them a line and a position are taken to be the same distance along.
 * @param pairs The pairs, in the order of the file.
 * @param entryCount How many entries the outline has; the end of the PDF is at that position.
 * @param lineCount How many lines the file has.
 * @returns The anchors, in the order of the file and of the PDF.
 */
export function anchorsOf(pairs: readonly PairedHeading[], entryCount: number, lineCount: number): Anchor[] {
  const anchors: Anchor[] = [{ line: 0, position: TOP_OF_PDF }];
  for (const pair of pairs) { anchors.push({ line: pair.line, position: pair.entry }); }
  anchors.push({ line: Math.max(lineCount - 1, anchors[anchors.length - 1].line), position: entryCount });
  return anchors;
}

/**
 * The position in the PDF that a line of the file is at: at a heading it is the heading's entry, and between two
 * anchors it is the same fraction of the way along as the line is.
 * @param anchors The anchors, from {@link anchorsOf}.
 * @param line A line of the file, counting from 0.
 * @returns A position, from {@link TOP_OF_PDF} to the end of the PDF.
 */
export function positionAtLine(anchors: readonly Anchor[], line: number): number {
  let from = 0;
  while (from + 1 < anchors.length && anchors[from + 1].line <= line) { from++; }
  const before = anchors[from];
  const after = anchors[from + 1];
  if (!after) { return before.position; }
  return before.position + (line - before.line) / (after.line - before.line) * (after.position - before.position);
}

/**
 * The line of the file that a position in the PDF is at; the other way of {@link positionAtLine}.
 * @param anchors The anchors, from {@link anchorsOf}.
 * @param position A position in the PDF.
 * @returns A line of the file, which may be between two lines.
 */
export function lineAtPosition(anchors: readonly Anchor[], position: number): number {
  let from = 0;
  while (from + 1 < anchors.length && anchors[from + 1].position <= position) { from++; }
  const before = anchors[from];
  const after = anchors[from + 1];
  if (!after) { return before.line; }
  return before.line + (position - before.position) / (after.position - before.position) * (after.line - before.line);
}
