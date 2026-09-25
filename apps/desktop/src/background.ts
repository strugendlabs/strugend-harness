/** Background scheduling presence and explicit login-start preferences. */
import { app, Menu, Tray, nativeImage, Notification, type BrowserWindow } from 'electron'

/** Native strings selected from the desktop locale. */
export interface BackgroundCopy { open: string; quit: string; active: string; attention: string }
/** One menu-bar/tray presence; no additional model or renderer process is created. */
export class DesktopBackground {
  private tray: Tray | undefined
  private enabled = false
  private readonly notifications = new Set<Notification>()
  /** @param window - Current owned application window. @param focus - Open the application. @param copy - Localized native menu text. */
  constructor(
    private readonly window: () => BrowserWindow | undefined,
    private readonly focus: () => void, private readonly copy: BackgroundCopy,
  ) {}
  /** @returns Whether closing the window should keep scheduled work alive. */
  get keepRunning(): boolean { return this.enabled }
  /** @returns Current scheduling presence and OS login preference. */
  status(): { enabled: boolean; openAtLogin: boolean } {
    return { enabled: this.enabled, openAtLogin: app.getLoginItemSettings({ args: ['--background'] }).openAtLogin }
  }
  /** @param enabled - User-selected launch-at-login preference. */
  login(enabled: boolean): void { app.setLoginItemSettings({ openAtLogin: enabled, args: ['--background'] }) }
  /** @param enabled - Whether any saved automation remains enabled. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) { this.tray?.destroy(); this.tray = undefined; return }
    if (this.tray) return
    // A tiny monochrome clock remains legible in both macOS and Windows status areas.
    const size = 20, pixels = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const radius = Math.hypot(x - 9.5, y - 9.5)
      if ((radius >= 7 && radius <= 8.5) || (x === 10 && y >= 4 && y <= 10) || (y === 10 && x >= 10 && x <= 14)) {
        const i = (y * size + x) * 4; pixels[i] = 205; pixels[i + 1] = 205; pixels[i + 2] = 205; pixels[i + 3] = 255
      }
    }
    const icon = nativeImage.createFromBitmap(pixels, { width: size, height: size })
    if (process.platform === 'darwin') icon.setTemplateImage(true)
    this.tray = new Tray(icon)
    this.tray.setToolTip(this.copy.active)
    this.tray.setContextMenu(Menu.buildFromTemplate([{ label: this.copy.open, click: this.focus }, { type: 'separator' }, { label: this.copy.quit, click: () =>{  app.quit() } }]))
    this.tray.on('click', this.focus)
  }
  /** @param title - Saved task name. @param sessionId - Durable result task; no personal result text is exposed on the lock screen. */
  notify(title: string, sessionId: string): void {
    if (!Notification.isSupported()) return
    const notification = new Notification({ title: title.slice(0, 160), body: this.copy.attention })
    this.notifications.add(notification)
    notification.once('click', () => { this.focus(); this.window()?.webContents.send('agent-os:event', { type: 'automation.open', sessionId }) })
    notification.once('close', () => { this.notifications.delete(notification) })
    notification.show()
  }
  /** Release native presence and notification callbacks. */
  dispose(): void { this.tray?.destroy(); for (const item of this.notifications) item.close(); this.notifications.clear() }
}
