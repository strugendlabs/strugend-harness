# Strugend Harness: implementation and qualification

Strugend is a chat-first desktop assistant for coding and everyday tasks. Browser, files, terminal and video tools appear when needed. Groups, queued messages, recorded skills, the encrypted vault and local `soul.md` remain part of the product. Windows x64, macOS arm64 and macOS x64 previews use BYOK for Core; billing remains deferred.

## Model roles

| Role | Runtime | Responsibility |
|---|---|---|
| Core | Configured remote provider | Write, code, plan, execute tools and interpret evidence |
| Vision | Configured vision provider | Inspect the actual sidebar page and screenshots |
| Decision | Bundled multilingual Laya on CPU; optional Impossibl API | Compare small option sets and assess supplied evidence |
| Graph memory | Coming soon, disabled | No graph tool, graph requests or background indexing |

The installer carries a pinned ONNX export, tokenizer, checksums and licenses; local inference needs no key or first-run download. Core owns writing, tools and completion. A separate scheduler starts optional Decision work without returning an inference promise to the agent loop. It admits one background check globally, at most once per five seconds per task, and twelve checks per turn. New evidence invalidates old advice; ending a turn cancels outstanding checks. Exact non-secret requests and typed results remain reconstructable from session events.

Intelligence defaults to Automatic runtime and Observe advice. Automatic tries a configured Impossibl key with a two-second request deadline, then considers local inference; failures start a sixty-second remote cooldown. Without a remote key, it considers local inference directly. Remote never falls back locally. Local still obeys memory admission. Observe records judgments without changing Core context. Optional Assist admits only completed advice less than five seconds old, with every answer meeting the configured confidence threshold (default 0.85); it never waits or adds another agent turn. Explicit `decision_check` and connection tests wait for their own bounded request. The [model card](https://huggingface.co/convaiinnovations/laya) documents calibration limits; confidence does not establish correctness. Tests, browser observations, artifact hashes and provider receipts determine results.

## Resource isolation

Devices below 8 GiB physical RAM never start the local model, including when Local is selected. A cold worker requires 3 GiB free physical memory; queued requests recheck admission immediately before execution. One CPU thread and one shared model limit contention; queued explicit requests are bounded. The worker unloads after 45 seconds idle, on cancellation, or when free memory falls below 768 MiB. These settings are validated and configurable; reducing the minimum device tier below 8 GiB is prohibited. Four-GB devices can use a remote Decision key or run Core alone. This avoids local-model allocation but does not certify the entire app on every four-GB Windows machine. Browser tabs, terminals, builds and other applications still consume memory.

The scheduler never selects or replaces Core. Additional providers use the existing provider editor and the conversation model picker. Observe keeps model inputs independent of Laya output; Assist is explicitly advisory. Background inference still consumes CPU and memory on eligible devices, so zero contention and improved coding quality are not assumed.

## Agent workflow

1. Core interprets the request; optional Decision observation starts concurrently.
2. Implement with Core, recorded skills, workspace tools and the visible browser.
3. Observe significant tool results and failures in the background; Core inspects and tests incomplete evidence.
4. For a new website, commit task-owned source, build and verify it, then use `deliver_project` to create a private GitHub repository and deploy the exact committed files to Vercel production. Respect explicit local-only instructions and existing-project scope.
5. For an app, detect the project and requested target, default desktop builds to the current OS, and run its actual build and verification commands. Verify expected distributables and compute SHA-256 hashes.
6. Read the task-owned delivery job receipt. Missing GitHub/Vercel credentials point to write-only Intelligence settings. Resume saved work after connecting; reuse provider IDs after an interrupted or ambiguous response.
7. Inspect the live website in the sidebar, or provide verified app file paths. Completion never waits for Decision or depends on its approval.

## Desktop behavior

The controlled terminal prompt is `strugend> ` and remains configurable. Product-authored copy uses Strugend branding while user files, command output and historical sessions remain authentic. Finder/Explorer actions use Electron's native shell, validate local paths and show persistent errors with retry and copy-path actions. Graph controls are unavailable and display “Coming soon”; saved legacy configuration remains inactive.

## Qualification

Qualification covers typed responses, provider failure, stale advice, cancellation, memory admission, build failures, clean-commit publishing, duplicate prevention, native folder errors and packaged workflows. A held Decision response must not prevent Core completion. Real local-model tests record cold/warm latency and resident memory before loading, after inference and after unloading. Packaged tests exercise local inference and automatic fallback when the native machine meets memory admission; otherwise they record the resource restriction. Release artifacts require native platform checks; live GitHub/Vercel qualification requires suitable accounts.

Comparative coding superiority remains unmeasured. Evaluate Core-only, Observe and Assist on the same held-out tasks, provider versions, tool permissions and token budgets. Score executable tests and verified artifacts, completion rate, p50/p95 end-to-end latency, cost and peak process-tree memory. Keep Observe as the default until paired results support Assist for a particular workflow. Synthetic memory observations verify policy; an actual four-GB Windows run is required to qualify that hardware tier.
