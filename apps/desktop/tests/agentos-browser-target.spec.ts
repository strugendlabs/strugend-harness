/** Exercise the actual page script with controlled layout samples and no host clock. */
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { elementTargetScript } from '../src/agentos-browser-target.ts'

function fixture() {
  const samples = new Map<number, () => void>()
  let nextTimer = 1
  let deadline: (() => void) | undefined
  let box = { x: 10, y: 20, width: 100, height: 40 }
  let covered = false
  let disabled = false
  let sensitive = false
  const effects: string[] = []
  const element = {
    isConnected: true,
    name: 'save', id: '', getAttribute: () => null,
    ownerDocument: {} as { defaultView: unknown; elementFromPoint: (x: number,y: number) => unknown },
    matches: (selector: string) => selector.includes(':disabled') ? disabled : sensitive,
    focus: () => { effects.push('focus'); box = { ...box, y: 120 } },
    scrollIntoView: () => { effects.push('scroll') },
    getBoundingClientRect: () => { effects.push('measure'); return box },
    contains: (target: unknown) => target === element,
  }
  const world = {
    __agentOSNodes: new Map([['e1', element]]), __agentOSIdentities: new Map([['e1', 'save']]),
    __agentOSIdentity: () => element.name, innerWidth: 600, innerHeight: 500,
    document: { elementFromPoint: () => covered ? {} : element },
    requestAnimationFrame: () => { throw new Error('Hidden views do not produce animation frames') },
    setTimeout: (callback: () => void, milliseconds: number) => {
      if (milliseconds === 5000) { deadline = callback; return 1 }
      samples.set(++nextTimer, callback); return nextTimer
    },
    clearTimeout: (id: number) => { if (id === 1) deadline = undefined; else samples.delete(id) },
  }
  const topView={ get innerWidth(){return world.innerWidth},get innerHeight(){return world.innerHeight} }
  Object.assign(world,{ window:topView })
  element.ownerDocument={ defaultView:topView,elementFromPoint:world.document.elementFromPoint }
  return {
    effects, element, world, topView,
    run: () => runInNewContext(elementTargetScript('e1'), world) as Promise<{ x: number; y: number }>,
    sample: () => { const callbacks = [...samples.values()]; samples.clear(); for (const callback of callbacks) callback() },
    move: (y: number) => { box = { ...box, y } },
    cover: () => { covered = true },
    disable: () => { disabled = true },
    sensitive: () => { sensitive = true },
    expire: () => { if (!deadline) throw new Error('Missing action deadline'); deadline() },
    pending: () => ({ samples: samples.size, deadline: deadline !== undefined }),
  }
}

it('measures after focus changes layout and waits for two stable viewport samples without animation frames', async () => {
  const f = fixture()
  const point = f.run()
  expect(f.effects).toEqual(['focus', 'scroll'])
  f.sample()
  f.move(180)
  f.sample()
  f.world.innerWidth = 480
  f.sample()
  expect(f.pending()).toEqual({ samples: 1, deadline: true })
  f.sample()
  await expect(point).resolves.toEqual({ x: 60, y: 200 })
  expect(f.pending()).toEqual({ samples: 0, deadline: false })
})

it('chooses the visible portion of a partially clipped element', async () => {
  const f = fixture()
  const point = f.run()
  f.move(-20)
  f.sample(); f.sample()
  await expect(point).resolves.toEqual({ x: 60, y: 10 })
})

it.each(['covered', 'hidden', 'detached'] as const)('rejects a %s target before pointer input and releases its timer', async (state) => {
  const f = fixture()
  const point = f.run()
  const rejected = expect(point).rejects.toThrow(state === 'covered' ? 'covered' : state === 'hidden' ? 'not visible' : 'changed')
  if (state === 'covered') f.cover()
  if (state === 'hidden') f.move(1000)
  if (state === 'detached') f.element.isConnected = false
  f.sample(); f.sample()
  await rejected
  expect(f.pending()).toEqual({ samples: 0, deadline: false })
})

it.each(['disabled', 'sensitive'] as const)('refuses a %s target before focusing it', (state) => {
  const f = fixture()
  if (state === 'disabled') f.disable()
  else f.sensitive()
  expect(f.run).toThrow(state === 'disabled' ? 'disabled' : 'vault')
  expect(f.effects).toEqual([])
  expect(f.pending()).toEqual({ samples: 0, deadline: false })
})

it('bounds a continuously moving target and cancels its outstanding callback', async () => {
  const f = fixture()
  const point = f.run()
  const rejected = expect(point).rejects.toThrow('did not become stable')
  f.sample(); f.move(230); f.sample(); f.move(330); f.sample()
  f.expire()
  await rejected
  expect(f.pending()).toEqual({ samples: 0, deadline: false })
})

it('accepts subpixel layout jitter without dropping hit testing', async () => {
  const f = fixture(), point = f.run()
  f.sample(); f.move(120.2); f.sample()
  await expect(point).resolves.toEqual({ x: 60, y: 140.2 })
  expect(f.pending()).toEqual({ samples: 0, deadline: false })
})

it('rejects a control whose identity changes before the click', async () => {
  const f = fixture(), point = f.run()
  const rejected = expect(point).rejects.toThrow('label or destination changed')
  f.sample(); f.element.name = 'delete'; f.sample()
  await rejected
  expect(f.pending()).toEqual({ samples: 0, deadline: false })
})

it.each([false, true])('maps a same-origin editor through its frame and checks parent occlusion: %s', async (covered) => {
  const f = fixture()
  const frame = {
    isConnected: true, offsetWidth: 400, offsetHeight: 300, clientLeft: 2, clientTop: 2,
    getBoundingClientRect: () => ({ x: 100, y: 50, width: 400, height: 300 }),
    scrollIntoView: () => {},
    ownerDocument: { defaultView: f.topView, elementFromPoint: (): unknown => covered ? {} : frame },
  }
  f.element.ownerDocument.defaultView = { innerWidth: 396, innerHeight: 296, frameElement: frame }
  const point = f.run()
  const checked = covered ? expect(point).rejects.toThrow('frame is covered') : expect(point).resolves.toEqual({ x: 162, y: 192 })
  f.sample(); f.sample()
  await checked
  expect(f.pending()).toEqual({ samples: 0, deadline: false })
})
