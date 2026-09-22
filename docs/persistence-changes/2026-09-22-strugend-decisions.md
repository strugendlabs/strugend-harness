---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-22-strugend-decisions

English | [中文](2026-09-22-strugend-decisions.zh.md)

## Summary

Declares auxiliary Decision request and result events written by the desktop runtime.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-22-strugend-decisions
baseline: false
changes:
  - root: "event:strugend/decision-request"
    previous: null
    after: "83a9cee19062525bb336a68f75bd39857823649856afadf3df466399747d46b4"
    decision: same-version
  - root: "event:strugend/decision-result"
    previous: null
    after: "4345aefd1785c9b24d26179c610b8330534eacd1a357ace958fddc5289c9f412"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Adds two event types without changing existing records or the session envelope. New builds can read these records. Older builds that do not know these required events refuse affected sessions. Each result references the earlier request sequence; the ordinary plugin message records the context delivered to Core.

<a id="verification"></a>
## Verification

pnpm exec vitest run apps/desktop-host/tests/strugend-persistence.spec.ts: the persisted request/result round trip passes and unknown events are rejected.

<a id="dev-note"></a>
## Dev Note

None.
