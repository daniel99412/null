import { describe, expect, it } from 'vitest'
import { cleanText } from '../src/tools/rss-fetcher.js'

describe('cleanText', () => {
  it('removes CDATA wrappers and decodes entities', () => {
    expect(cleanText('<![CDATA[México buscará mantener ventaja arancelaria en T-MEC: Ebrard]]>'))
      .toBe('México buscará mantener ventaja arancelaria en T-MEC: Ebrard')

    expect(cleanText('&lt;![CDATA[México &amp; T-MEC]]&gt;'))
      .toBe('México & T-MEC')
  })
})
