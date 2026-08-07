/**
 * The class string that styles authored prose, shared by Loom's read view and
 * the reader app.
 *
 * It is long, fragile and load-bearing: paragraph indent, justification, the
 * empty-paragraph min-height that preserves deliberate blank lines, and the
 * section divider (`hr` as a third-width centred hairline). It was repeated
 * three times inside ReaderView alone, which is three chances to drift — and a
 * fourth copy in another app would be worse, because published prose renders
 * against whichever copy that app happens to have.
 */
export const PROSE_CLASS =
  "prose prose-invert max-w-none text-ink leading-relaxed " +
  "[&_p]:text-justify [&_p]:indent-8 [&_p.no-indent]:indent-0 " +
  "[&_p[style*='center']]:indent-0 [&_p:empty]:min-h-[1em] " +
  "[&_hr]:border-none [&_hr]:h-px [&_hr]:bg-current [&_hr]:opacity-20 " +
  "[&_hr]:w-1/3 [&_hr]:mx-auto [&_hr]:my-6"
