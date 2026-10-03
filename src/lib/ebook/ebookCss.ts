/**
 * The EPUB's stylesheet. Replaces pandoc's default (which gives block
 * paragraphs with a blank line between them) with book typography: every
 * paragraph's first line indented — the opening one too — and no gap.
 *
 * Typeface, size, line height and justification are deliberately left alone —
 * those are the reader's settings in Apple Books, and fixing them here would
 * fight the reader rather than help.
 *
 * The POV and date colors are the manuscript export's (Settings → Export), so
 * the EPUB and the Pages manuscript agree and one setting changes both.
 */
export type EbookCssColors = { pov: string; date: string }

/**
 * A lighter mix of `hex` toward white, for dark reading themes. The export's
 * colors are chosen for a white page; on black, a #535e64 gray is barely
 * legible. Unparseable input comes back unchanged.
 */
export function lighten(hex: string, amount: number): string {
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i)
  if (!m) return hex
  const ch = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16))
  return '#' + ch.map(c => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0')).join('')
}

export const ebookCss = (colors: EbookCssColors) => `
p {
  margin: 0;
  text-indent: 1.5em;
}

/* Chapter opening: "1." centered, the POV centered beneath it, a touch
   larger than the body text, then the date (below). */
h1.chapter {
  text-align: center;
  font-size: 2.4em;
  /* Padding, not margin: Apple Books drops a top margin at a page start. */
  padding-top: 2.5em;
  margin: 0 0 0.3em;
  page-break-before: always;
  break-before: page;
}
div.pov p {
  text-align: center;
  text-indent: 0;
  font-size: 1.05em;
  color: ${colors.pov};
  margin: 0 0 2.5em;
}

/* In-story date: left, flush, set off from the prose below it. */
div.date p {
  text-align: left;
  text-indent: 0;
  color: ${colors.date};
  margin: 0 0 0.5em;
}

@media (prefers-color-scheme: dark) {
  div.pov p { color: ${lighten(colors.pov, 0.25)}; }
  div.date p { color: ${lighten(colors.date, 0.45)}; }
}

/* A deliberate blank line in the prose. */
div.blank p { text-indent: 0; }

div.scene-break p {
  text-align: center;
  text-indent: 0;
  margin: 1em 0;
}

div.no-indent p { text-indent: 0; }
div.align-center p { text-align: center; text-indent: 0; }
div.align-right p { text-align: right; text-indent: 0; }

ol, ul { margin: 0.5em 0; }
li p { text-indent: 0; }

/* Footnotes */
a.footnote-ref { text-decoration: none; }
a.footnote-ref sup { font-size: 0.7em; line-height: 0; }
aside p, section.footnotes p { text-indent: 0; font-size: 0.9em; }

/* The title page pandoc generates. */
h1.title { text-align: center; margin-top: 30%; }
p.author { text-align: center; text-indent: 0; }

nav#toc ol, nav#landmarks ol { list-style-type: none; padding: 0; }
nav#toc li { margin: 0.25em 0; }
`
