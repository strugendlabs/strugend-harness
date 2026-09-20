// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BootPage } from '../src/boot-page.ts'

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function mount() {
  const el = document.createElement('div')
  document.body.append(el)
  return { el, page: new BootPage(el) }
}

describe('BootPage', () => {
  it('uses Strugend branding while retaining actionable startup failures', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'Strugend Harness')
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
    const { el, page } = mount()
    expect(el.querySelector('img')?.getAttribute('src')).toBe('/assets/strugend/mark-512.png')
    expect(el.textContent).toMatchInlineSnapshot('"Strugend HarnessFrom thought to actionPreparing your workspace…"')
    page.setState('@deepseek-ai/dsh-client-ui-layout', 'failed')
    page.fail('DeepSeek Harness: @deepseek-ai/dsh-client-ui-layout needs a service.')
    expect(el.querySelector('[role="alert"]')?.textContent).toMatchInlineSnapshot('"Workspace could not startclient-ui-layoutStrugend Harness: client-ui-layout needs a service."')
    expect(el.textContent).not.toMatch(/deepseek|\bdsh\b/iu)
    expect(el.querySelector('[data-dsh-boot-spinner]')).toBeNull()
  })
  it('draws the loading skeleton before any plugin state arrives', () => {
    const { el } = mount()
    expect(el.firstElementChild?.getAttribute('data-dsh-boot')).toBe('')
    expect(el.textContent).toContain('HARNESS')
    expect(el.textContent).toContain('Loading plugins…')
  })

  it('keeps loading while entries are active or loading', () => {
    const { el, page } = mount()
    page.setTotal(2)
    const spinner = el.querySelector<HTMLElement>('[data-dsh-boot-spinner]')
    expect(spinner?.style.getPropertyValue('--dsh-boot-arc')).toBe('72deg')
    page.setState('a', 'active')
    expect(spinner?.style.getPropertyValue('--dsh-boot-arc')).toBe('180deg')
    page.setState('b', 'loading')
    expect(el.querySelector('[data-dsh-boot-spinner]')).toBe(spinner)
    page.setState('b', 'active')
    expect(spinner?.style.getPropertyValue('--dsh-boot-arc')).toBe('288deg')
    expect(el.textContent).toContain('Loading plugins…')
    expect(el.textContent).not.toContain('Failed to load plugins')
  })

  it('lists failed entries', () => {
    const { el, page } = mount()
    page.setState('@deepseek-ai/dsh-client-ui-layout', 'failed')
    page.setState('ok', 'active')
    page.setState('@deepseek-ai/dsh-client-ui-tool', 'failed')
    expect(el.textContent).toContain('@deepseek-ai/dsh-client-ui-layout')
    expect(el.textContent).toContain('@deepseek-ai/dsh-client-ui-tool')
    expect(el.textContent).not.toContain('ok')
    expect(el.textContent).not.toContain('Loading plugins…')
  })

  it('shows the complete sweep report', () => {
    const { el, page } = mount()
    const report = 'web boot: 1 entry did not activate\nx: pending (waiting for service: y)'
    page.fail(report)
    page.setState('a', 'active')
    expect(el.textContent).toContain(report)
    expect(el.textContent).not.toContain('Loading plugins…')
  })

  it('detaches on disposal', () => {
    const { el, page } = mount()
    page.dispose()
    expect(el.childNodes).toHaveLength(0)
  })

  it('keeps the Agent OS mark through loading and exposes failures without a running indicator', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'Agent OS')
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
    const { el, page } = mount()
    const image = el.querySelector('img')
    expect(image?.getAttribute('src')).toBe('/assets/agent-os/mark-512.png')
    expect(el.textContent).toMatchInlineSnapshot('"Agent OSFrom thought to actionPreparing your workspace…"')
    expect(el.querySelector('[role="status"]')?.textContent).toBe('Preparing your workspace…')
    page.setState('workspace', 'active')
    expect(el.querySelector('img')).toBe(image)
    page.fail('The local service could not start.')
    expect(el.querySelector('img')).toBe(image)
    expect(el.querySelector('[data-dsh-boot-spinner]')).toBeNull()
    expect(el.querySelector('[role="alert"]')?.textContent)
      .toMatchInlineSnapshot('"Workspace could not startThe local service could not start."')
    page.dispose()
    expect(el.childNodes).toHaveLength(0)
  })

  it('localizes Agent OS startup before plugins deliver their dictionaries', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'Agent OS')
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN')
    const { el, page } = mount()
    expect(el.textContent).toMatchInlineSnapshot('"Agent OS从想法到行动正在准备工作区…"')
    page.fail('offline')
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('工作区未能启动offline')
  })
})
