/**
 * The desktop application's own opener, reached from the preview header.
 *
 * A preview only knows the absolute Host path its file metadata reports. The
 * application renderer is the one surface that can hand that path to the
 * operating system, so this module asks it there and reports its refusal to the
 * caller instead of failing silently: a file that moved since it was listed
 * says so, and the reader can act on it.
 */

/** The single bridge call this surface needs, as the application renderer exposes it. */
interface DesktopLocationBridge {
  request(command: { type: 'location.open'; path: string; reveal?: boolean }): Promise<unknown>
}

/** The application renderer's bridge, when this surface runs inside it. */
function desktopBridge(): DesktopLocationBridge | undefined {
  return (globalThis as { agentOS?: DesktopLocationBridge }).agentOS
}

/** Whether this renderer can hand a path to the desktop's own opener at all. */
export function canOpenOnHost(): boolean {
  return desktopBridge() !== undefined
}

/**
 * Open one absolute Host path with its default application, or reveal it in
 * the file manager beside its folder.
 * @param path - absolute path reported by the Host's file metadata.
 * @param reveal - reveal the file in the file manager instead of opening it.
 * @returns after the desktop acknowledged the handoff.
 */
export async function openOnHost(path: string, reveal: boolean): Promise<void> {
  const desktop = desktopBridge()
  if (desktop === undefined) throw new Error('This surface cannot reach the desktop opener.')
  await desktop.request({ type: 'location.open', path, ...(reveal ? { reveal: true } : {}) })
}
