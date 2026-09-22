---
description: "Shared types for desktop commands, browser observations, media edits, and personal workspace state."
kind: "package-library"
---

# @deepseek-ai/dsh-agentos-protocol

English | [中文](README.zh.md)

## Summary

This package defines command/event unions and data interfaces shared by the trusted Electron renderer, desktop main process, and Harness host. It contains no runtime service, storage, network client, or executable capability.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Import types from `@deepseek-ai/dsh-agentos-protocol` when implementing desktop IPC or consuming browser, media, group, and skill events. Types do not authenticate IPC or validate untrusted runtime values; callers must use the main process's operation validation.

The host-only `decision-events` export declares logged auxiliary model requests and results. These records retain the exact redacted input, runtime and validated outcome; Core context is separately persisted through ordinary plugin messages. `location.open` opens a directory or reveals a file through the authenticated desktop bridge.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/index.ts`](src/index.ts) owns the command and event unions. No runtime invariant companion is published because this package owns no mutable state or event dispatch. The [desktop tests](../../../apps/desktop/tests) cover operation validation and persistence; the packaged application smoke checks browser behavior through Electron.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Desktop application](../../../apps/desktop/README.md) — IPC ownership and packaging.
- [Strugend development guide](../../../AGENT_OS_README.md) — local features and service configuration.

## Known Limitations and Deferred Work

- The protocol describes local browser/video workflows. It does not provide native desktop control, cloud synchronization, or a portable password-vault backup format.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
