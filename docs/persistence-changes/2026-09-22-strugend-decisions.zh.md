---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-22-strugend-decisions

[English](2026-09-22-strugend-decisions.md) | 中文

## 概述

声明桌面运行时写入的辅助 Decision 请求及结果事件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

新增两个事件类型，不更改已有记录或会话信封。新版本可以读取这些记录；不认识这些必需事件的旧版本拒绝打开相关会话。每个结果引用先前请求的序号；普通插件消息记录传递给 Core 的上下文。

<a id="verification"></a>
## 验证

pnpm exec vitest run apps/desktop-host/tests/strugend-persistence.spec.ts：持久化请求及结果的往返验证通过，未知事件被拒绝。

<a id="dev-note"></a>
## 开发备注

无。
