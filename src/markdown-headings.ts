/**
 * The headings of a `.md` file, and which entry of the PDF's outline each one is. The outline lists the
 * headings that are bookmarks, in the order of the file, so pairing the two lets the editor and the
 * preview move together: a line of the file is in the section of its entry, and an entry is at the
 * heading's line.
 *
 * Only headings written with `#` are read. One underlined with `===` or `---` is not a place the two
 * sides meet: its outline entry has no line, and the heading before it stands for its section.
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
 * What the words of a heading reduce to, for telling whether a heading of the file and an entry of the outline
 * are the same: the letters and digits of its text in lower case. The outline gives the words without the
 * markup that was around them, so a link keeps its words and loses its address, an image and a footnote mark
 * are dropped, and no `*`, `_`, `~`, backtick, backslash or tag is left on either side.
 * @param text The words as written in the file, or as the outline gives them.
 * @returns The key; empty when nothing of the text would be a label.
 */
export function headingKey(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\^[^\]]*\]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:[a-z][a-z0-9]*|#x?[0-9a-f]+);/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
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
    const key = headingKey(title);
    const found = key ? headings.findIndex((heading, index) => index >= next && heading.key === key) : -1;
    if (found < 0) { return; }
    pairs.push({ line: headings[found].line, entry });
    next = found + 1;
  });
  return pairs;
}

/** The value of `entryAtLine` for a line above the first heading. */
export const BEFORE_FIRST_ENTRY = -1;

/**
 * The entry whose section a line is in: that of the last heading at or above the line.
 * @param pairs The pairs, in the order of the file.
 * @param line A line of the file, counting from 0.
 * @returns The entry, or {@link BEFORE_FIRST_ENTRY} for a line above the first heading.
 */
export function entryAtLine(pairs: readonly PairedHeading[], line: number): number {
  let entry = BEFORE_FIRST_ENTRY;
  for (const pair of pairs) {
    if (pair.line > line) { break; }
    entry = pair.entry;
  }
  return entry;
}

/**
 * The line to show for an entry: its heading's. An entry with no heading of the file is shown at the heading
 * before it, and one above the first heading at the top of the file.
 * @param pairs The pairs, in the order of the file.
 * @param entry An entry of the outline, or {@link BEFORE_FIRST_ENTRY}.
 * @returns A line of the file, counting from 0.
 */
export function lineOfEntry(pairs: readonly PairedHeading[], entry: number): number {
  let line = 0;
  for (const pair of pairs) {
    if (pair.entry > entry) { break; }
    line = pair.line;
  }
  return line;
}
