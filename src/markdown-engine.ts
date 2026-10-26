import * as path from 'node:path';

/**
 * The functions of the engine, outside any one render, that deal with a `.md` file: the template it is
 * wrapped in, the data it gives that template, and the images it names. They are the same ones the command
 * line uses, so a file renders alike in both.
 */
export interface MarkdownWasm {
  markdown_template(): string;
  markdown_default_styles(): string;
  markdown_file_data(markdown: string): string;
  markdown_file_images(markdown: string): string;
  markdown_declare_images(template: string, srcs: string): string;
}

let _module: MarkdownWasm | undefined;

function engineFunctions(): MarkdownWasm {
  if (!_module) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _module = require(path.join(__dirname, '..', 'wasm', 'lpdf.js')) as MarkdownWasm;
  }
  return _module;
}

/** What the name of the asset an image of a `.md` file is loaded under starts with. */
const MARKDOWN_IMAGE_PREFIX = 'markdown-image-';

/** The asset name the image at `index` of `PreparedMarkdown.images` is loaded under. */
export function markdownImageName(index: number): string {
  return `${MARKDOWN_IMAGE_PREFIX}${index + 1}`;
}

/** What it takes to render a `.md` file: the template with its images declared, its data and its images. */
export interface PreparedMarkdown {
  /** The template, with an `<image>` declared for each image of the Markdown. */
  xml: string;
  /** The text of the file and the fields of its front matter, as the data of the template. */
  jsonData: string;
  /** The images of the Markdown as written, relative to the `.md`; the one at `i` is `markdownImageName(i)`. */
  images: string[];
}

/**
 * Wraps a `.md` file in a template.
 * @param markdown The text of the file, including unsaved edits.
 * @param template The template to wrap it in, or null for the default one.
 * @param engine The engine's functions; the real ones unless a test gives its own.
 */
export function prepareMarkdown(markdown: string, template: string | null, engine: MarkdownWasm = engineFunctions()): PreparedMarkdown {
  const images = JSON.parse(engine.markdown_file_images(markdown)) as string[];
  const xml = engine.markdown_declare_images(template ?? engine.markdown_template(), JSON.stringify(images));
  return { xml, jsonData: engine.markdown_file_data(markdown), images };
}

/** The file name the default styles are written under, beside a `.md` file. */
export const STYLES_FILE_NAME = 'markdown-styles.xml';

/** The file name the default template is written under, beside a `.md` file. */
export const TEMPLATE_FILE_NAME = 'markdown-template.xml';

/**
 * The default template, reading its styles from `stylesFile`, to start a template of one's own from. The
 * styles file holds the default rules, so the template renders as the default one does until either is edited.
 */
export function starterTemplate(stylesFile: string = STYLES_FILE_NAME, engine: MarkdownWasm = engineFunctions()): string {
  const template = engine.markdown_template();
  const content = '<markdown-content';
  if (template.split(content).length !== 2) {
    throw new Error('The default template has changed: it no longer holds one <markdown-content> to put the styles before.');
  }
  return template.replace(content, `<markdown-styles src="${stylesFile}"/>\n                ${content}`);
}

/** The default rules, to start a styles file of one's own from. */
export function starterStyles(engine: MarkdownWasm = engineFunctions()): string {
  return engine.markdown_default_styles();
}
