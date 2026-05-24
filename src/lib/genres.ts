// Fixed list of genres a series can be tagged with. The set mirrors
// what Wattpad-style discovery pages use — broad enough to cover most
// books, narrow enough that the chip cloud on a landing page stays
// readable. Order is alphabetical except for the "Other" catch-all.
export const GENRES = [
  'Adventure',
  'Comedy',
  'Contemporary',
  'Crime',
  'Drama',
  'Dystopian',
  'Fantasy',
  'Historical',
  'Horror',
  'LGBTQ+',
  'Mystery',
  'Paranormal',
  'Romance',
  'Sci-Fi',
  'Thriller',
  'Young Adult',
] as const

export type Genre = typeof GENRES[number]
