/**
 * Framework-free boot page and failure report. It remains available when a
 * client plugin fails because React arrives only with the UI renderer.
 * @module @deepseek-ai/dsh-client-web/src/boot-page
 */
import type { LoaderEntryState } from './loader-status.ts'
import css from './boot-page.module.css'

/** Create a div with one module class and optional text. */
function div(className: string | undefined, text?: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className ?? ''
  if (text !== undefined) el.textContent = text
  return el
}

/** Kernel-owned page mounted below the application's root element. */
export class BootPage {
  private readonly root: HTMLDivElement
  private readonly card: HTMLDivElement
  private readonly wordmark: HTMLDivElement
  private readonly spinner: HTMLDivElement
  private readonly hint: HTMLDivElement
  private readonly states = new Map<string, LoaderEntryState>()
  private readonly active = new Set<string>()
  private total = 0
  private failure: string | undefined
  private readonly agentOs = ['Agent OS', 'Strugend Harness'].includes(process.env.DSH_CLIENT_TITLE ?? '')
  private readonly strugend = process.env.DSH_CLIENT_TITLE === 'Strugend Harness'
  private readonly copy = navigator.language.toLowerCase().startsWith('zh')
    ? { tagline: '从想法到行动', loading: '正在准备工作区…', failed: '工作区未能启动' }
    : { tagline: 'From thought to action', loading: 'Preparing your workspace…', failed: 'Workspace could not start' }

  /**
   * Build and attach the boot page.
   * @param container - Application mount point.
   */
  constructor(container: HTMLElement) {
    this.root = div([css.boot, this.strugend ? css.strugend : this.agentOs ? css.agentOs : ''].join(' '))
    this.root.dataset.dshBoot = ''
    this.card = div(css.card)
    this.wordmark = div(css.wordmark, 'HARNESS')
    if (this.agentOs) {
      const image = document.createElement('img')
      image.src = this.strugend ? '/assets/strugend/mark-512.png' : '/assets/agent-os/mark-512.png'
      image.width = 160
      image.height = 160
      image.alt = ''
      image.draggable = false
      image.className = css.mark ?? ''
      const name = div(css.name, this.strugend ? 'Strugend Harness' : 'Agent OS')
      this.wordmark.replaceChildren(image, name, div(css.tagline, this.copy.tagline))
    }
    this.spinner = div(css.spinner)
    this.spinner.dataset.dshBootSpinner = ''
    this.spinner.setAttribute('aria-hidden', 'true')
    this.hint = div(css.hint, this.agentOs ? this.copy.loading : 'Loading plugins…')
    this.hint.setAttribute('role', 'status')
    this.card.append(this.wordmark, this.spinner, this.hint)
    this.root.append(this.card)
    container.append(this.root)
    this.updateProgress()
  }

  /**
   * Set the number of loader entries represented by the progress arc.
   * @param total - Complete boot roster size.
   */
  setTotal(total: number): void {
    this.total = total
    this.updateProgress()
  }

  /**
   * Project one loader entry's fiber state.
   * @param id - Loader entry name.
   * @param state - Projected fiber state.
   */
  setState(id: string, state: LoaderEntryState): void {
    this.states.set(id, state)
    if (state === 'active') this.active.add(id)
    this.updateProgress()
    this.render()
  }

  /**
   * Display the boot failure report.
   * @param message - Failure report text.
   */
  fail(message: string): void {
    this.failure = message
    this.render()
  }

  /** Detach the page before or after the UI renderer takes the mount point. */
  dispose(): void {
    this.root.remove()
  }

  /** Redraw the state-dependent content below the wordmark. */
  private render(): void {
    const failed = [...this.states].filter(([, state]) => state === 'failed').map(([id]) => id)
    if (this.failure === undefined && failed.length === 0) {
      this.root.classList.remove(css.stopped ?? '')
      if (this.spinner.parentElement !== this.card) {
        this.card.replaceChildren(this.wordmark, this.spinner, this.hint)
      }
      return
    }
    const report = div(css.failed)
    this.root.classList.add(css.stopped ?? '')
    report.setAttribute('role', 'alert')
    report.append(div(css.failedTitle, this.agentOs ? this.copy.failed : 'Failed to load plugins'))
    for (const id of failed) report.append(div(css.failedItem, this.strugend ? id.replace('@deepseek-ai/dsh-', '') : id))
    if (this.failure !== undefined) report.append(div(css.failedItem, this.strugend ? this.failure.replaceAll('@deepseek-ai/dsh-', '').replaceAll('DeepSeek Harness', 'Strugend Harness') : this.failure))
    this.card.replaceChildren(this.wordmark, report)
  }

  /** Grow the rotating arc monotonically as loader entries activate. */
  private updateProgress(): void {
    const ratio = this.total === 0 ? 0 : Math.min(this.active.size / this.total, 1)
    this.spinner.style.setProperty('--dsh-boot-arc', `${String(Math.round(72 + ratio * 216))}deg`)
  }
}
