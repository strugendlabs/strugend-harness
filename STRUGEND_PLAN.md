# Strugend Harness: implementation and qualification

Strugend is a chat-first desktop assistant for coding and everyday tasks. Browser, files and terminal appear when needed; Video studio is Coming soon. Groups, queued messages, recorded skills, the encrypted vault and local `soul.md` remain part of the product. Windows x64, macOS arm64 and macOS x64 previews use BYOK for Core; billing remains deferred.

## Model roles

| Role | Runtime | Responsibility |
|---|---|---|
| Core | Configured remote provider | Write, code, plan, execute tools and interpret evidence |
| Vision | Selected image-capable primary model | Inspect the actual sidebar page and screenshots |
| Decision | Optional multilingual Laya download on CPU; optional Impossibl API | Compare small option sets and assess supplied evidence |
| Graph memory | Coming soon, disabled | No graph tool, graph requests or background indexing |

The base installer excludes model weights, ONNX, Python and Office-rendering engines. Windows installation offers optional components; macOS asks at first launch. Skip, download, cancel and remove are available through Settings. Target-specific archives are versioned and checked against pinned lengths and SHA-256 digests before activation. Core requires none of these packs.

A separate scheduler starts optional Decision work after mutating tools and repeated failures, without returning an inference promise to the agent loop. It resolves the executing agent's tools, including preset-owned editing and shell commands. It admits one background check globally, at most once per five seconds per task, and eight checks per turn. New evidence invalidates pending advice; ending a turn cancels outstanding checks. Exact redacted requests and typed results remain reconstructable from session events. The model-facing tool accepts `intent`, `goal`, `evidence` and optional named candidates; the harness owns all provider question formatting.

Automatic runtime tries a configured Impossibl key with a two-second deadline, then considers installed local inference. Failure starts a sixty-second remote cooldown. Without a remote key it considers the installed local component; Remote never falls back locally. Missing or disabled components contribute no decision tool or standing prompt. Observe records judgments; Assist may offer already-completed advice only for release-qualified model revisions and intents. At most three suggestions and 1,500 characters may enter a turn, each younger than five seconds and above the configured confidence threshold (default 0.9). Qualification also requires measured precision and paired-task value; confidence alone is insufficient. The checked-in qualification manifest currently has no enabled intents. Explicit `decision_check` and connection tests wait for their own bounded request. Tests, observed artifacts and provider receipts determine completion.

## Resource isolation

Devices below 8 GiB physical RAM never start the local model, including when Local is selected. A cold helper process requires 3 GiB free physical memory; queued requests recheck admission immediately before execution. One CPU thread and one shared model limit contention; one active evaluation and one pending request bound explicit work. Cold startup has a fifteen-second deadline; warm requests have two seconds. The private helper receives only inference data and a scrubbed environment. The helper process exits after 45 seconds idle, on cancellation, or when free memory falls below 768 MiB. These settings are validated and configurable; reducing the minimum device tier below 8 GiB is prohibited. Four-GB devices can use a remote Decision key or run Core alone. This avoids local-model allocation but does not certify the entire app on every four-GB Windows machine. Browser tabs, terminals, builds and other applications still consume memory.

The scheduler never selects or replaces Core. Additional providers use the existing provider editor and the conversation model picker. Observe keeps model inputs independent of Laya output; Assist is explicitly advisory. Background inference still consumes CPU and memory on eligible devices, so zero contention and improved coding quality are not assumed.

## Agent workflow

1. Core interprets the request using the selected connected provider.
2. Implement with Core, recorded skills, workspace tools and the visible browser.
3. Observe significant tool results and failures in the background; Core inspects and tests incomplete evidence.
4. For a new website, commit task-owned source, build and verify it, then use `deliver_project` to create a private GitHub repository and deploy the exact committed files to Vercel production. Respect explicit local-only instructions and existing-project scope.
5. For an app, detect the project and requested target, default desktop builds to the current OS, and run its actual build and verification commands. Verify expected distributables and compute SHA-256 hashes.
6. Read the task-owned delivery job receipt. Missing GitHub/Vercel credentials point to write-only Connections settings. Resume saved work after connecting; reuse provider IDs after an interrupted or ambiguous response.
7. Inspect the live website in the sidebar, or provide verified app file paths. Completion never waits for Decision or depends on its approval.

## Desktop behavior

The controlled terminal prompt is `strugend> ` and remains configurable. Product-authored copy uses Strugend branding while user files, command output and historical sessions remain authentic. Finder/Explorer actions use Electron's native shell, validate local paths and show persistent errors with retry and copy-path actions. Graph controls are unavailable and display “Coming soon”; saved legacy configuration remains inactive.

## Qualification

Qualification covers typed responses, provider failure, stale advice, cancellation, memory admission, build failures, clean-commit publishing, duplicate prevention, native folder errors and packaged workflows. A held Decision response must not prevent Core completion. Real local-model tests record cold/warm latency and resident memory before loading, after inference and after unloading. Packaged tests exercise local inference and automatic fallback when the native machine meets memory admission; otherwise they record the resource restriction. Release artifacts require native platform checks; live GitHub/Vercel qualification requires suitable accounts.

Comparative coding superiority remains unmeasured. Evaluate Core-only, Observe and Assist on the same held-out tasks, provider versions, tool permissions and token budgets. Score executable tests and verified artifacts, completion rate, p50/p95 end-to-end latency, cost and peak process-tree memory. Automatic assistance remains unqualified until paired results support a particular model revision and workflow. Synthetic memory observations verify policy; an actual four-GB Windows run is required to qualify that hardware tier.
