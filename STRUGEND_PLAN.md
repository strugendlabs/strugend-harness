# Strugend Harness: implementation plan

Status: product foundation implemented; live service qualification pending, 20 September 2026. This plan supersedes the product identity and model roles in [the original build plan](AGENT_OS_BUILD_PLAN.md). It does not describe every proposed phase as shipped.

## Product direction

A minimal assistant for coding and everyday work. Chat is the main workspace. Browser, files, terminal, video editing, and memory inspection appear when a task needs them. Keep groups, subgroups, queued messages, edit/delete/steer controls, recorded skills, and the encrypted vault. The product name is **Strugend Harness**. Product navigation, onboarding, model controls, loading, and task status use role names rather than upstream provider or package branding. Preserve third-party notices and internal protocol identities. User-authored content, website content, source files, terminal output, and old transcripts remain authentic.

The selected design uses graphite backgrounds (`#181a1b`, `#202324`), sage actions (`#b8d4ba`), ivory primary text (`#e8e9e5`), a restrained serif wordmark, and system sans-serif controls. The generated [screen concept](.artifacts/strugend/design/concept.png) is the visual reference. Native controls retain workspace selection and extension access even where those functional controls are absent from the concept. Existing sidebar widths remain user-controlled. Light mode, keyboard navigation, small windows, and reduced motion must remain supported.

## Test distribution and commercial model

The first release is a BYOK test preview for Windows x64 and macOS (Apple Silicon and Intel), with no billing. Testers supply their own provider keys. The commercial product remains a paid Strugend subscription with provider keys held on a future hosted service; BYOK testing is not a commitment to a free commercial release. Billing, sign-in, entitlement checks, and the hosted provider gateway are deferred until the desktop workflow has been tested. See [preview installation and limitations](apps/desktop/PREVIEW.md).

## Responsibilities

| Product role | Implementation | Owns | Does not own |
|---|---|---|---|
| Core | Current DeepSeek text/vision provider | Conversation, plans, code, writing, tool calls, interpreting observations, proposing memory facts | Claiming a task succeeded without evidence |
| Decision | TypeSafe Jev | Narrow typed judgments: task/skill choice, candidate ranking, evidence relevance, ambiguous-result checks | Text generation, long planning, authority to perform actions, replacing tests |
| Memory | Chronograph | Time-aware relationships, source links, scoped recall, correction history | Generating answers, storing passwords, silently converting inferred facts into truth |

Jev is a structured decision model, not another chat model. Its documented API is `POST https://api.typesafe.ai/v1/systemone`; the current alias is `jev-latest`. Choice returns a selected option and distribution; Score evaluates ordered rubric levels; Noul estimates whether one statement holds. Choice/Score confidence describes the distribution, not the probability that a whole workflow is safe or correct. Independent questions sharing a small state can be batched. [Introduction](https://docs.typesafe.ai/introduction), [API](https://docs.typesafe.ai/api), [confidence](https://docs.typesafe.ai/confidence).

Chronograph is an embedded Rust temporal graph database with an authenticated optional HTTP/MCP service. It is not a learned graph model. The inspected Community checkout is an alpha; the first integration uses the existing bounded HTTP read API. Node IDs and microsecond timestamps travel as decimal strings. Graph payloads are 16 bytes, so full text and artifacts need a separate referenced store. [Repository](https://github.com/enablewmodels-sys/chronograph), [API](https://github.com/enablewmodels-sys/chronograph/blob/main/docs/API.md), [MCP](https://github.com/enablewmodels-sys/chronograph/blob/main/docs/MCP.md).

## Task flow

1. Accept a task and its current workspace, saved grants, attachments, and chosen skill. Resolve explicit instructions first.
2. Core gathers the minimum relevant context. For tasks that depend on earlier work, read the local memory file or the connected graph and retain source references and dates.
3. Use Jev when there is a real choice: classify the task, rank a small candidate set, or evaluate independent criteria. Skip it for greetings, obvious actions, and checks that ordinary code can perform.
4. Core plans and executes through existing logged tools. Open the actual browser view for website work. Keep message steering, cancellation, and user takeover authoritative.
5. Verify with tests, file inspection, browser observations, media probes, or submission receipts. Jev may flag inconsistent evidence, but cannot turn missing evidence into success.
6. Deliver the result and evidence. Later phases propose useful memory updates with source links and let the user inspect or correct them.

Each decision tool call records its state, explicit requested model, and question map in the existing tool-call log; its result records answers, returned model, and usage. No hidden full-history upload. Graph query inputs and returned pages are also recorded through normal tools. Auxiliary outages produce a visible result and leave Core usable. No automatic retry of ambiguous external writes.

## Jev workloads

| Workflow | Atomic questions | Deterministic follow-through |
|---|---|---|
| Coding | Which supplied skill best fits this change? Which candidate files are relevant? Does this test output support the named requirement? | Inspect code, apply the patch, run the actual checks, inspect the diff |
| Browser work | Which observed labeled control matches the requested action? Does the latest page contain the required confirmation? | Use fresh element references, execute once, observe the result |
| Research and mail | Which supplied items address the task? Which explicit deadline category applies? | Cite sources and dates; draft or send only within the user's instruction |
| Video and social | Which supplied clip meets one rubric? Does the export metadata meet the named destination requirement? | Render with the editor, probe/play the real export, upload and verify the receipt |
| Memory | Is this proposed fact supported by its source? Which known entity does it refer to? | Resolve identity, preserve source/time, require review of ambiguous or conflicting facts |

Do not chain Jev questions as though earlier answers were visible to later questions in the same batch. Evaluate dependent questions in a later call with their evidence explicitly supplied. Do not set a universal confidence threshold. Measure each question family against labeled examples first. Low confidence falls back to Core inspection or more evidence; ask the user only when their decision is needed.

## Memory design

Use a graph workspace per project or personal scope. A graph service token currently covers a whole workspace; a query filter is not tenant isolation. Start with read-only tokens for retrieval. The vault remains the sole password store.

Proposed entities: project, file, symbol, task, skill, artifact, person, organization, account reference, and source record. Proposed relations: `depends_on`, `implements`, `verified_by`, `uses_skill`, `produced`, `assigned_to`, `related_to`, and `supersedes`. Only record task-relevant facts. A persistent identity registry maps stable application IDs to graph IDs; never derive IDs from floating-point JavaScript numbers or treat file paths alone as immutable identities.

Before automatic writes, add a durable local outbox with an application event ID, source content hash, relation kind, observed/valid time, and delivery state. Store full text and source references locally; use the graph's typed asset/schema features only after their pinned API is tested. Payload references must survive reopen and backup. Unknown outcomes require reconciliation before retry. Request fsync for acknowledged durable writes. Never overwrite the session log with graph state.

Recall begins with exact entity lookup and bounded neighborhood/time queries. Page through `next_cursor`; restart a query on revision conflict. Record truncation. Rank retrieved candidates with Jev only if it reduces context or improves relevance in evaluation. Avoid whole-graph scans on the normal chat path. Deleted or revoked sources must stop being eligible for recall, even if historical graph versions remain.

## Delivery order and acceptance

### 1. Product foundation and usable connectors

- Rebrand the app shell, icon/loading, welcome text, normal model controls, and native menu/about presentation.
- Preserve the native storage/encryption identity and existing app data. Change display names without moving databases or resetting browser profiles.
- Add Intelligence settings with write-only Core, Decision, and Memory credentials. A saved credential must not imply a successful live connection.
- Mount Decision and read-only Memory tools in the shipped desktop composition; configure endpoints and limits through settings.
- Test valid/invalid question batches and responses, HTTP failures, redirects, byte limits, cancellation, disposal, absent keys, and graph pagination inputs. Run a real Electron composition with isolated service fixtures.

### 2. Live provider qualification

- Enter the Jev API key and graph token in the app. Connect a running, version-pinned Chronograph workspace; do not auto-start an unrelated service on port 8080.
- Run a small synthetic live Choice/Score/Noul probe. Check the returned model, usage, response validation, cancellation, and latency. Keep test credentials and outputs private.
- Exercise graph stats, a dated query, pagination, revoked/expired tokens, and restart. Verify actual graph revision and rows against a known fixture.
- Treat upstream latency statements as claims until measured on this Mac and connection.

### 3. Automatic routing and memory capture

- Add recorded turn-boundary classification only where measured benefit justifies its latency; preserve steering inputs and cancellation.
- Use versioned question templates, explicit capability availability, bounded candidate lists, and a per-turn call budget.
- Add fact extraction, identity resolution, the durable outbox, deduplication, source deletion, correction UI, and backup/recovery before enabling graph writes.
- Extend session-driven replay snapshots and persistence acknowledgements for any new durable types. Keep upgrades additive and reversible through backups.

### 4. Demonstrations and evaluation

Use the same tasks and fixed inputs for Core alone, Core + Decision, Core + Memory, and all three. Report actual outcomes, p50/p95 end-to-end latency, provider time, tokens/cost when known, calls, retries, human interventions, recall relevance, and false-success rate. Do not advertise speed or quality gains without this comparison.

- **Coding:** resume a repository change, recall a previous architectural constraint, select the relevant skill/files, implement it, run tests, and show the diff and evidence.
- **Everyday task:** read an explicitly selected mail item, retrieve relevant project context, draft the requested output, and show sources. Keep sending separate unless already authorized.
- **Video/social:** select real footage, edit/export for a destination, verify duration/dimensions/playback, prepare a post, and publish only within the requested account/action scope. Store the actual receipt as evidence.
- **Recovery:** stop during a service call, resume a queued task, take over the browser, restart the app, disconnect Decision/Memory, and confirm Core plus local history remain usable.

## Operational constraints

Core and Jev use their configured remote APIs directly. A local Electron host carries UI/tools; a local Chronograph address is a memory service, not a model proxy. No localhost model override is inherited by the ordinary launcher. Keys never appear in transcripts, screenshots, URLs, or command arguments. Service redirects are rejected; requests have bounded bodies, responses, and deadlines. The graph adapter issues only its enumerated read operations.

Keep upstream package names and versioned persistence keys internal. Remove upstream branding from product-authored presentation without rewriting user content or falsifying the underlying provider. Distribution packaging must retain required notices and use the selected Chronograph edition's terms.

## Current verification record

The product foundation is implemented: Strugend branding and chat-first layout, Intelligence settings, the Decision tool, and read-only graph retrieval. The production desktop fixture run passed nine checks covering missing optional services, credentials, Decision → Memory → sidebar actions, restart persistence, small windows, and loading handoff. Focused service and client regressions passed. Live Jev inference and a real Chronograph workspace still require credentials and qualification; automatic graph writes and measured routing remain later phases. The client test-type aggregate hit the local heap limit, full lint/doc-sync did not complete, and the documentation quick check reports six pre-existing failures. See the [verification record](.artifacts/strugend/review/verification.md) and [design review](.artifacts/strugend/review/design-review.md).
