import { byCategoryThenName } from '@/lib/characterSearch'

type Sortable = { name: string; category: string | null }
const c = (name: string, category: string | null): Sortable => ({ name, category })

const order = (list: Sortable[]) =>
  [...list].sort(byCategoryThenName).map(x => x.name)

describe('byCategoryThenName', () => {
  it('puts main above secondary above tertiary', () => {
    expect(order([c('Tess', 'tertiary'), c('Sam', 'secondary'), c('Mia', 'main')]))
      .toEqual(['Mia', 'Sam', 'Tess'])
  })

  it('sorts alphabetically within a category', () => {
    expect(order([c('Noah', 'main'), c('Chase', 'main'), c('Jared', 'main')]))
      .toEqual(['Chase', 'Jared', 'Noah'])
  })

  it('sorts uncategorised characters last, not first', () => {
    // No category means nobody has said yet — not "least important" — but the
    // top of the list is the part that has to stay meaningful.
    expect(order([c('Unknown', null), c('Tess', 'tertiary'), c('Mia', 'main')]))
      .toEqual(['Mia', 'Tess', 'Unknown'])
  })

  it('still orders uncategorised characters among themselves by name', () => {
    expect(order([c('Zed', null), c('Ana', null)])).toEqual(['Ana', 'Zed'])
  })

  it('ignores an unrecognised category rather than throwing', () => {
    expect(order([c('Weird', 'protagonist'), c('Mia', 'main')])).toEqual(['Mia', 'Weird'])
  })
})
