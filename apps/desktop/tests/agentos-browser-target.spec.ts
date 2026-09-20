/** Exercise the actual page script with controlled layout frames and no host clock. */
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { elementTargetScript } from '../src/agentos-browser-target.ts'

function fixture() {
  const frames = new Map<number, () => void>()
  let nextFrame = 0
  let deadline: (() => void) | undefined
  let box = { x: 10, y: 20, width: 100, height: 40 }
  let covered = false
  let disabled = false
  let sensitive = false
  const effects: string[] = []
  const element = {
    isConnected: true,
    name: 'save', id: '',
    matches: (selector: string) => selector.includes(':disabled') ? disabled : sensitive,
    focus: () => { effects.push('focus'); box = { ...box, y: 120 } },
    scrollIntoView: () => { effects.push('scroll') },
    getBoundingClientRect: () => { effects.push('measure'); return box },
    contains: (target: unknown) => target === element,
  }
  const world = {
    __agentOSNodes: new Map([['e1', element]]), innerWidth: 600, innerHeight: 500,
    document: { elementFromPoint: () => covered ? {} : element },
    requestAnimationFrame: (callback: () => void) => { frames.set(++nextFrame, callback); return nextFrame },
    cancelAnimationFrame: (id: number) => { frames.delete(id) },
    setTimeout: (callback: () => void) => { deadline = callback; return 1 },
    clearTimeout: () => { deadline = undefined },
  }
  return {
    effects, element, world,
    run: () => runInNewContext(elementTargetScript('e1'), world) as Promise<{ x: number; y: number }>,
    frame: () => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback() },
    move: (y: number) => { box = { ...box, y } },
    cover: () => { covered = true },
    disable: () => { disabled = true },
    sensitive: () => { sensitive = true },
    expire: () => { if (!deadline) throw new Error('Missing action deadline'); deadline() },
    pending: () => ({ frames: frames.size, deadline: deadline !== undefined }),
  }
}

it('measures after focus changes layout and waits for two stable viewport frames', async () => {
  const f = fixture()
  const point = f.run()
  expect(f.effects).toEqual(['focus', 'scroll'])
  f.frame()
  f.move(180)
  f.frame()
  f.world.innerWidth = 480
  f.frame()
  expect(f.pending()).toEqual({ frames: 1, deadline: true })
  f.frame()
  await expect(point).resolves.toEqual({ x: 60, y: 200 })
  expect(f.pending()).toEqual({ frames: 0, deadline: false })
})

it('chooses the visible portion of a partially clipped element', async () => {
  const f = fixture()
  const point = f.run()
  f.move(-20)
  f.frame(); f.frame()
  await expect(point).resolves.toEqual({ x: 60, y: 10 })
})

it.each(['covered', 'hidden', 'detached'] as const)('rejects a %s target before pointer input and releases its frame', async (state) => {
  const f = fixture()
  const point = f.run()
  const rejected = expect(point).rejects.toThrow(state === 'covered' ? 'covered' : state === 'hidden' ? 'not visible' : 'changed')
  if (state === 'covered') f.cover()
  if (state === 'hidden') f.move(1000)
  if (state === 'detached') f.element.isConnected = false
  f.frame(); f.frame()
  await rejected
  expect(f.pending()).toEqual({ frames: 0, deadline: false })
})

it.each(['disabled', 'sensitive'] as const)('refuses a %s target before focusing it', (state) => {
  const f = fixture()
  if (state === 'disabled') f.disable()
  else f.sensitive()
  expect(f.run).toThrow(state === 'disabled' ? 'disabled' : 'vault')
  expect(f.effects).toEqual([])
  expect(f.pending()).toEqual({ frames: 0, deadline: false })
})

it('bounds a page that stops producing frames and cancels its outstanding callback', async () => {
  const f = fixture()
  const point = f.run()
  const rejected = expect(point).rejects.toThrow('did not become stable')
  f.expire()
  await rejected
  expect(f.pending()).toEqual({ frames: 0, deadline: false })
})
