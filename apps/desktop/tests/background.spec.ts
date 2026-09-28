/** Linux scheduling remains usable without Electron's macOS/Windows login-item API. */
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopBackground } from '../src/background.ts'
const login = vi.hoisted(() => ({ getLoginItemSettings: vi.fn(), setLoginItemSettings: vi.fn() }))
vi.mock('electron', () => ({ app: login }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
it('reports Linux scheduling state without invoking unsupported login-item methods', () => {
  vi.stubGlobal('process', { ...process, platform: 'linux' })
  const background = new DesktopBackground(() => undefined, () => {}, { open: 'Open', quit: 'Quit', active: 'Active', attention: 'Attention' })
  expect(background.status()).toEqual({ enabled: false, openAtLogin: false })
  expect(() => { background.login(true) }).toThrow('Startup Applications')
  background.login(false)
  expect(login.getLoginItemSettings).not.toHaveBeenCalled()
  expect(login.setLoginItemSettings).not.toHaveBeenCalled()
  background.dispose()
})
