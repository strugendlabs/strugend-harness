// @vitest-environment jsdom
/** Native form values use observed targets, validated formats and the target document's events. */
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it } from 'vitest'
import { OBSERVE, selectEditableScript } from '../src/agentos-browser-page.ts'

afterEach(() => { document.body.replaceChildren() })

function fixture(markup: string) {
  document.body.innerHTML = markup
  for (const el of document.querySelectorAll('input,select'))
    el.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 30 } as DOMRect)
  const world = { document, innerWidth: 800, innerHeight: 600 }
  const observed = runInNewContext(OBSERVE, world) as { elements: Array<{ ref: string; inputType?: string; options?: unknown[] }> }
  return {
    observed,
    fill: (ref: string, value: string, select = true) => runInNewContext(selectEditableScript(ref, select, value), world) as unknown,
  }
}

it('exposes native date and dropdown types and fills their exact values', () => {
  const f = fixture('<input type="date" aria-label="Birth date"><select aria-label="Work type"><option value="full">Full time</option><option value="part">Part time</option></select>')
  expect(f.observed.elements[0]?.inputType).toBe('date')
  expect(f.observed.elements[1]?.options).toEqual([{ value: 'full', label: 'Full time' }, { value: 'part', label: 'Part time' }])
  const events: string[] = []
  document.body.addEventListener('input', () => events.push('input'), { once: true })
  document.body.addEventListener('change', () => events.push('change'), { once: true })
  f.fill('e0', '2000-02-29', false)
  expect(document.querySelector('input')!.value).toBe('')
  expect(events).toEqual([])
  expect(f.fill('e0', '2000-02-29')).toBe('native')
  expect(document.querySelector('input')!.value).toBe('2000-02-29')
  expect(events).toEqual(['input', 'change'])
  f.fill('e1', 'Part time')
  expect(document.querySelector('select')!.value).toBe('part')
})

it.each(['2001-02-29', '29/02/2000', '2999-01-01'])('rejects invalid or out-of-range date %s without mutation', (value) => {
  const f = fixture('<input type="date" max="2020-01-01" value="2000-01-01">')
  expect(() => f.fill('e0', value)).toThrow('Invalid control value')
  expect(document.querySelector('input')!.value).toBe('2000-01-01')
})

it('rejects disabled and ambiguous dropdown choices and stale target identities', () => {
  const f = fixture('<select><option value="a">Same</option><option value="b">Same</option><option value="c" disabled>Blocked</option></select>')
  expect(() => f.fill('e0', 'Same')).toThrow('one exact')
  expect(() => f.fill('e0', 'c')).toThrow('one exact')
  document.querySelector('select')!.setAttribute('aria-label', 'Changed destination')
  expect(() => f.fill('e0', 'a')).toThrow('Editor changed')
})
