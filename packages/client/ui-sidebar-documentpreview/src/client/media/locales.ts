/** Locale-owned media renderer labels and status text. */
export const zh = {
  title: '影音',
  preview: '影音预览：{name}',
  loading: '正在读取…',
  failed: '无法播放这个文件；可能是浏览器不支持的编码格式。',
  unsupported: '影音预览需要完整文件内容',
} satisfies Record<string, string>

/** Media renderer dictionary keys. */
export type MediaPreviewKey = keyof typeof zh

/** English dictionary with the same keys as the Chinese dictionary. */
export const en = {
  title: 'Media',
  preview: 'Media preview: {name}',
  loading: 'Reading…',
  failed: 'This file could not be played; the browser may not support its encoding.',
  unsupported: 'Media preview requires the complete file contents.',
} satisfies Record<MediaPreviewKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Media preview selection, accessible name, and status text. */
    sidebarMedia: MediaPreviewKey
  }
}
