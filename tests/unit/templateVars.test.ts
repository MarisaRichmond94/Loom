import { findAllTemplateRanges, findVarTemplates, substituteVarTemplates } from '@/lib/templateVars'

const identity = (s: string) => s
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

describe('substituteVarTemplates — plain {{var}}', () => {
  it('substitutes known plain vars', () => {
    expect(substituteVarTemplates('hi {{name}}', { name: 'Jared' }, identity)).toBe('hi Jared')
  })
  it('leaves unknown plain vars literal', () => {
    expect(substituteVarTemplates('hi {{name}}', {}, identity)).toBe('hi {{name}}')
  })
  it('handles multiple templates in one string', () => {
    const out = substituteVarTemplates('{{a}} and {{b}}', { a: '1', b: '2' }, identity)
    expect(out).toBe('1 and 2')
  })
})

describe('substituteVarTemplates — ternary truthy/falsy', () => {
  it('boolean true → branch A', () => {
    expect(substituteVarTemplates('{{x ? a : b}}', { x: true }, identity)).toBe('a')
  })
  it('boolean false → branch B', () => {
    expect(substituteVarTemplates('{{x ? a : b}}', { x: false }, identity)).toBe('b')
  })
  it('number 0 → B, number 5 → A', () => {
    expect(substituteVarTemplates('{{x ? a : b}}', { x: 0 }, identity)).toBe('b')
    expect(substituteVarTemplates('{{x ? a : b}}', { x: 5 }, identity)).toBe('a')
  })
  it("empty string → B, 'hi' → A", () => {
    expect(substituteVarTemplates('{{x ? a : b}}', { x: '' }, identity)).toBe('b')
    expect(substituteVarTemplates('{{x ? a : b}}', { x: 'hi' }, identity)).toBe('a')
  })
  it('unknown variable → entire template left literal', () => {
    expect(substituteVarTemplates('{{x ? a : b}}', {}, identity)).toBe('{{x ? a : b}}')
  })
})

describe('substituteVarTemplates — comparison operators', () => {
  it('> works', () => {
    expect(substituteVarTemplates('{{c > 3 ? a : b}}', { c: 2 }, identity)).toBe('b')
    expect(substituteVarTemplates('{{c > 3 ? a : b}}', { c: 4 }, identity)).toBe('a')
  })
  it('< works', () => {
    expect(substituteVarTemplates('{{c < 3 ? a : b}}', { c: 2 }, identity)).toBe('a')
    expect(substituteVarTemplates('{{c < 3 ? a : b}}', { c: 4 }, identity)).toBe('b')
  })
  it('>= works at boundary', () => {
    expect(substituteVarTemplates('{{c >= 3 ? a : b}}', { c: 3 }, identity)).toBe('a')
    expect(substituteVarTemplates('{{c >= 3 ? a : b}}', { c: 2 }, identity)).toBe('b')
  })
  it('<= works at boundary', () => {
    expect(substituteVarTemplates('{{c <= 3 ? a : b}}', { c: 3 }, identity)).toBe('a')
    expect(substituteVarTemplates('{{c <= 3 ? a : b}}', { c: 4 }, identity)).toBe('b')
  })
  it('== with number literal compares numerically', () => {
    expect(substituteVarTemplates('{{c == 3 ? a : b}}', { c: 3 }, identity)).toBe('a')
    expect(substituteVarTemplates('{{c == 3 ? a : b}}', { c: 4 }, identity)).toBe('b')
  })
  it('!= with number literal', () => {
    expect(substituteVarTemplates('{{c != 3 ? a : b}}', { c: 3 }, identity)).toBe('b')
    expect(substituteVarTemplates('{{c != 3 ? a : b}}', { c: 4 }, identity)).toBe('a')
  })
  it("== with quoted string literal", () => {
    expect(substituteVarTemplates("{{pov == 'Jared' ? a : b}}", { pov: 'Jared' }, identity)).toBe('a')
    expect(substituteVarTemplates("{{pov == 'Jared' ? a : b}}", { pov: 'Chase' }, identity)).toBe('b')
  })
  it('type-mismatch numeric == on a non-numeric string → branch B', () => {
    expect(substituteVarTemplates("{{c == 3 ? a : b}}", { c: 'three' }, identity)).toBe('b')
  })
})

describe('substituteVarTemplates — quoted branches', () => {
  it('quoted empty string substitutes empty', () => {
    expect(substituteVarTemplates("{{x ? 'hi' : ''}}", { x: false }, identity)).toBe('')
    expect(substituteVarTemplates("{{x ? 'hi' : ''}}", { x: true }, identity)).toBe('hi')
  })
  it('preserves apostrophes and spaces inside double quotes', () => {
    const out = substituteVarTemplates(`{{x ? "dead grandpa's" : ''}}`, { x: true }, identity)
    expect(out).toBe("dead grandpa's")
  })
  it('quoted branches may contain a colon', () => {
    expect(substituteVarTemplates("{{ok ? 'time: 5pm' : 'time: 6pm'}}", { ok: true }, identity))
      .toBe('time: 5pm')
    expect(substituteVarTemplates("{{ok ? 'time: 5pm' : 'time: 6pm'}}", { ok: false }, identity))
      .toBe('time: 6pm')
  })
})

describe('substituteVarTemplates — malformed', () => {
  it('missing colon → literal', () => {
    expect(substituteVarTemplates('{{x ? a}}', { x: true }, identity)).toBe('{{x ? a}}')
  })
  it('number as condition → literal', () => {
    expect(substituteVarTemplates('{{ 123 }}', { }, identity)).toBe('{{ 123 }}')
  })
  it('empty inner → literal', () => {
    expect(substituteVarTemplates('{{ }}', { }, identity)).toBe('{{ }}')
  })
  it('comparison with non-literal rhs → literal', () => {
    expect(substituteVarTemplates('{{x > y ? a : b}}', { x: 5, y: 3 }, identity)).toBe('{{x > y ? a : b}}')
  })
})

describe('substituteVarTemplates — escaping', () => {
  it('runs the supplied escape on plain {{var}} substitutions', () => {
    const out = substituteVarTemplates('{{name}}', { name: '<b>hi</b>' }, escapeHtml)
    expect(out).toBe('&lt;b&gt;hi&lt;/b&gt;')
  })
  it('emits ternary branches as raw HTML (TipTap already escaped writer input)', () => {
    // Mid-template italic boundary: branch text contains the real <em> tags
    // generated by TipTap. They must reach the DOM as markup, not text.
    const out = substituteVarTemplates(
      '{{x ? Four<em> </em> : Three<em> </em>}}',
      { x: true },
      escapeHtml,
    )
    expect(out).toBe('Four<em> </em>')
  })
})

describe('substituteVarTemplates — nested ternaries', () => {
  it("evaluates a ternary nested inside another ternary's branch", () => {
    const tmpl = '{{outer ? {{inner ? a : b}} : c}}'
    expect(substituteVarTemplates(tmpl, { outer: true, inner: true }, identity)).toBe('a')
    expect(substituteVarTemplates(tmpl, { outer: true, inner: false }, identity)).toBe('b')
    expect(substituteVarTemplates(tmpl, { outer: false, inner: true }, identity)).toBe('c')
  })
  it("preserves surrounding text in the outer branch when nested fires", () => {
    const tmpl = '{{outer ? {{inner ? four : three}} people : anyone}}'
    expect(substituteVarTemplates(tmpl, { outer: true, inner: true }, identity)).toBe('four people')
    expect(substituteVarTemplates(tmpl, { outer: true, inner: false }, identity)).toBe('three people')
    expect(substituteVarTemplates(tmpl, { outer: false, inner: true }, identity)).toBe('anyone')
  })
  it("doesn't confuse the outer split with the nested template's ? and :", () => {
    // Without nesting-aware findTopLevel, the first `?` belongs to the
    // INNER ternary and the outer would either fail to parse or pick the
    // wrong branch boundaries.
    const tmpl = "{{a ? {{b ? 'x : y' : 'p : q'}} : default}}"
    expect(substituteVarTemplates(tmpl, { a: true, b: true }, identity)).toBe('x : y')
    expect(substituteVarTemplates(tmpl, { a: true, b: false }, identity)).toBe('p : q')
  })
  it("handles a plain {{var}} inside a ternary branch", () => {
    expect(substituteVarTemplates('{{x ? hi {{name}} : bye}}', { x: true, name: 'Jared' }, identity))
      .toBe('hi Jared')
  })
  it("leaves the whole outer literal when the chosen branch's nested template is unresolvable", () => {
    // Outer fires the inner branch, inner var is unknown → the inner stays
    // literal inside the substituted output. Writer sees the typo.
    const out = substituteVarTemplates('{{x ? {{missing ? a : b}} : z}}', { x: true }, identity)
    expect(out).toBe('{{missing ? a : b}}')
  })
})

describe('findAllTemplateRanges', () => {
  it('emits both outer and nested ranges with absolute offsets', () => {
    const text = '{{outer ? {{inner ? a : b}} : c}}'
    const ranges = findAllTemplateRanges(text)
    // Outer span covers the whole thing; nested span covers just the inner.
    const outer = ranges.find(r => r.name === 'outer')!
    const inner = ranges.find(r => r.name === 'inner')!
    expect(text.slice(outer.start, outer.end)).toBe(text)
    expect(text.slice(inner.start, inner.end)).toBe('{{inner ? a : b}}')
  })
})

describe('findVarTemplates', () => {
  it('reports parsed=null for malformed and parsed for valid', () => {
    const matches = findVarTemplates('plain {{var}} bad {{ ? }} ternary {{x ? a : b}}')
    expect(matches.map(m => m.parsed?.kind ?? null)).toEqual(['var', null, 'ternary'])
  })
  it('records spans that cover the full {{ ... }}', () => {
    const text = 'a {{x}} b'
    const [m] = findVarTemplates(text)
    expect(text.slice(m.start, m.end)).toBe('{{x}}')
    expect(m.raw).toBe('{{x}}')
  })
})
