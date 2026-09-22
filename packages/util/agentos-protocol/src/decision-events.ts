/** Host-only persistence declarations for auxiliary Decision requests and results. */
import type {} from '@deepseek-ai/dsh-session/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { DecisionPayload } from './index.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Exact auxiliary model request; Core context is separately logged as a user/plugin message. */
    'strugend/decision-request': { checkpoint: string; runtime: 'local' | 'remote'; payload: DecisionPayload }
    /** Validated judgment or explicit unavailable outcome linked to its earlier request sequence. */
    'strugend/decision-result': { checkpoint: string; requestSeq: number; result: Record<string, JsonValue> }
  }
}
