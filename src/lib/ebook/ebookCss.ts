/**
 * The EPUB's stylesheet. Replaces pandoc's default (which gives block
 * paragraphs with a blank line between them) with book typography: every
 * paragraph's first line indented — the opening one too — and no gap.
 *
 * Typeface, size, line height and justification are deliberately left alone —
 * those are the reader's settings in Apple Books, and fixing them here would
 * fight the reader rather than help.
 */
export const EBOOK_CSS = `
p {
  margin: 0;
  text-indent: 1.5em;
}

/* Chapter opening: "1." centered, the POV centered beneath it, a touch
   larger than the body text, then the date (below). */
h1.chapter {
  text-align: center;
  font-size: 1.6em;
  margin: 3em 0 0.4em;
  page-break-before: always;
  break-before: page;
}
div.pov p {
  text-align: center;
  text-indent: 0;
  font-size: 1.15em;
  margin: 0 0 2.5em;
}

/* In-story date: left, flush, set off from the prose below it. */
div.date p {
  text-align: left;
  text-indent: 0;
  margin: 0 0 1em;
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
