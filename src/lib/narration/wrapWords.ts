// The word-wrapper now lives in shared/, because the reader app (LOOM-131)
// needs the SAME implementation, not a copy of it. Its whole contract is that
// the DOM's token boundaries match the ones the server tokenized the narration
// text with; two copies of that rule is two chances for the highlight to drift
// in one app and not the other, which is exactly the bug nobody notices until
// they are eight paragraphs in.
//
// Kept as a re-export so Loom's own imports (and its tests) don't have to care.
export { nearestBlock, unwrapWords, wrapWords } from '@shared/wrapWords'
