---
description: "桌面命令、浏览器观察、媒体编辑与个人工作区状态的共享类型。"
kind: "package-library"
---

# @deepseek-ai/dsh-agentos-protocol

[English](README.md) | 中文

## 概述

此包定义可信 Electron 渲染进程、桌面主进程与 Harness Host 共享的命令/事件联合类型及数据接口。它不包含运行时服务、存储、网络客户端或可执行能力。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

实现桌面 IPC 或消费浏览器、媒体、分组及技能事件时，从 `@deepseek-ai/dsh-agentos-protocol` 导入类型。类型不会认证 IPC 或验证不可信的运行时值；调用方必须使用主进程的操作验证。

仅供 Host 使用的 `decision-events` 导出声明辅助模型请求及结果的持久化事件。这些记录保留脱敏后的准确输入、运行时及已验证结果；Core 上下文另外通过普通插件消息持久化。`location.open` 通过经过认证的桌面桥接打开目录或显示文件。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

[`src/index.ts`](src/index.ts) 定义命令及事件联合类型。此包不拥有可变状态或事件分发，因此不发布运行时不变量伴随模块。[桌面测试](../../../apps/desktop/tests) 覆盖操作验证和持久化；打包应用冒烟检查通过 Electron 验证浏览器行为。

</details>

<a id="further-exploration"></a>
## 进一步阅读

- [桌面应用](../../../apps/desktop/README.zh.md) — IPC 归属及打包。
- [Strugend 开发指南](../../../AGENT_OS_README.md) — 本地功能和服务配置。

## 已知限制与延期工作

- 此协议描述本地浏览器/视频工作流，不提供原生桌面控制、云同步或可移植的密码库备份格式。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
