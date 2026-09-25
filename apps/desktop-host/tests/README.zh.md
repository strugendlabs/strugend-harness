# Decision 运行时验证

[English](README.md) | 中文

## 概述

本地 Decision 辅助进程在 Desktop Host 之外执行原生推理。生命周期夹具不加载权重，用于验证进程退出、队列限制、截止时间、凭据隔离、内存准入和恢复。移除组件会拒绝活动和排队中的任务，并阻止新推理，直到所有所属任务和进程停止。可选原生测试独立使用实际组件和生产评审提示词进行评估。
`agentos-vision.spec.ts` 检查有时限的辅助请求、可用回退和自动图像。`agentos-team.spec.ts` 使用真实子智能体运行时检查合成证据，要求 QA 结果之前进行独立检查；不衡量模型判断质量。


## 运行验证

运行 `pnpm exec vitest run apps/desktop-host/tests/strugend-laya-local.spec.ts apps/desktop-host/tests/strugend-decision-quality.spec.ts --maxWorkers=1` 执行确定性的生命周期和验证检查。构建 Desktop Host 和可选 Decision 组件后，运行 `LAYA_MODEL_TEST=1 pnpm exec vitest run apps/desktop-host/tests/strugend-laya.built.spec.ts --maxWorkers=1`。将 `LAYA_COMPONENT_ROOT` 设置为包含 `model/` 和 `node_modules/` 的已解压组件；`LAYA_PACKAGED_ROOT` 从已准备的桌面产物中选择编译后的辅助进程。未设置这些变量时，测试使用 `apps/desktop-host/lib` 和 `.artifacts/components/decision`。原生推理需要 8 GiB 物理内存和 3 GiB 可用内存。准入被拒绝时会写入明确的跳过报告，且不会加载模型。

原生报告分别记录冷启动和热推理延迟、Host RSS、辅助进程 RSS 和峰值 RSS、资源观测、各项回答、失败及每类意图的精确率。输出路径为 `.artifacts/strugend/local-laya-[payload-]<platform>-<arch>.json`。辅助进程退出后释放其进程内存；这些观测不测量浏览器或构建工具的总内存。

`STRUGEND_COMPONENT_TEST=1 LAYA_PACKAGED_ROOT=apps/desktop/.desktop-build/targets/<target> pnpm exec vitest run apps/desktop-host/tests/optional-components.built.spec.ts --maxWorkers=1` 通过下载管理器安装实际发布归档。它验证哈希和解压、解析已安装 SDK、运行 Python 文档导入、创建 DOCX 并渲染原生 PDF，随后移除文档组件。

## 解读结果

语料包含 72 个合成任务：每种生产评审意图有四个校准案例和二十个保留案例。通过验证需要至少十二条被采纳的建议达到 90% 精确率，至少三个弃答控制案例中没有错误建议，且保留案例中没有缺失或失败的推理。校准回答不计入结果。低置信度和弃答不能构造通过结果。`LAYA_REQUIRE_QUALIFIED=1` 使原生测试拒绝未通过验证的意图；普通原生测量仍在报告中记录该失败。

合成评审精确率不代表编码结果改善。自动激活还需要经过评审的配对任务比较，使用等价的 Core 提供方、工具、输入和预算，并通过可执行测试和已验证产物评分。只有两类证据均支持特定模型版本后，才向 `../src/strugend-review-qualification.json` 发布清单添加记录。安装组件或更改运行时设置不会使其通过验证。

## 远程和配对任务验证

`LAYA_REMOTE_MODEL_TEST=1 pnpm exec vitest run apps/desktop-host/tests/strugend-laya-remote.spec.ts --maxWorkers=1` 使用进程环境或根目录 `.env` 中的 `IMPOSSIBL_API_KEY`，针对 Impossibl 执行相同的生产评审配方。输出文件为 `.artifacts/strugend/remote-laya-quality.json`；缺少凭据时明确跳过。密钥不会进入报告。如果提供方未标明模型版本，远程精确率不能使该版本通过验证。

配对脚手架使用受支持的 `dsh` ACP profile 和共享子进程测试启动器。设置 `STRUGEND_PAIRED_TEST=1`、`STRUGEND_PAIRED_BASELINE_PATCH` 和 `STRUGEND_PAIRED_ASSIST_PATCH`，指向经过评审、具有相同主提供方、工具和预算的 ACP overlay。提供 `STRUGEND_PAIRED_CORE_KEY_REF` 指定的主提供方凭据（默认 `DEEPSEEK_API_KEY`）以及 `IMPOSSIBL_API_KEY`，然后运行 `pnpm exec vitest run apps/desktop-host/tests/strugend-decision-paired.spec.ts --maxWorkers=1`。缺少输入会记录为跳过。每个变体都有私有工作区和 profile；独立检查为带符号数求和和已保存的费用汇总评分。报告包含耗时、工具调用数和 overlay 摘要。这两个任务只验证运行器流程：仍需要更广的任务覆盖、真实建议归因、token 用量和进程树内存。脚手架始终报告 `qualified: false`，且不能更改生产激活状态。
