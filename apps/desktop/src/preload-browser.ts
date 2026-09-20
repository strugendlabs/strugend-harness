/** Isolated recorder for user demonstrations; exposes no API to the website. */
import { ipcRenderer } from 'electron'
let recording = false
ipcRenderer.on('agent-os:recording', (_event, enabled: unknown) => {
  recording = enabled === true
})

function capture(event: Event): void {
  if (!recording || !event.isTrusted || !(event.target instanceof Element)) return
  const element = event.target.closest('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')
  if (element === null) return
  const identity = [
    element.getAttribute('name'),
    element.id,
    element.getAttribute('aria-label'),
    element.getAttribute('autocomplete'),
  ].join(' ')
  if (
    element.matches('input[type="password"]') ||
    /password|passcode|secret|token|api.?key|credit.?card|cc-|cvv|one-time-code/iu.test(identity)
  )
    return
  const url = new URL(location.href)
  url.search = ''
  url.hash = ''
  const label =
    element.getAttribute('aria-label') ||
    element.getAttribute('placeholder') ||
    element.textContent ||
    element.getAttribute('name') ||
    element.tagName
  ipcRenderer.send('agent-os:record-step', {
    action: event.type,
    url: url.href,
    target: label.trim().slice(0, 200),
    time: Date.now(),
    ...(event.type === 'change'
      ? { value: `{{${(element.getAttribute('name') || 'value').replace(/[^a-z0-9_]/giu, '_')}}}` }
      : {}),
  })
}
document.addEventListener('click', capture, true)
document.addEventListener('change', capture, true)
