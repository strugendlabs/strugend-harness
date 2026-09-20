# Strugend Harness for macOS

Strugend Harness is a local Electron assistant with an agent-controlled sidebar browser, nested chat groups, video editing, recorded skills, a password vault, and personal memory. It uses the upstream Harness runtime; internal package names and existing profile paths remain stable. The initial Windows and macOS distribution is a BYOK test preview; hosted subscriptions and billing are deferred. See the [preview installation notes](apps/desktop/PREVIEW.md).

## Open this build

Open `dist/Strugend Harness.app` in Finder. This local launcher uses this checkout's installed Electron runtime and built files; keep the repository in place. It is not a portable, signed installer. It launches without developer tools or exposed debugging ports.

The Strugend identity uses a serif wordmark, an S app icon, graphite surfaces, and sage accents. Browser, files, and terminal appear beside the conversation when needed. The loading screen uses local assets, respects reduced motion, and disappears when the workspace is ready.

Alternatively, from this directory:

```sh
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
pnpm run agent-os:start
```

The development command uses a separate development profile under `apps/desktop/.desktop-build/development/`. The Finder launcher uses `~/Library/Application Support/Agent OS/harness/`. They do not share settings.

1. Choose a workspace folder.
2. Open Settings → Intelligence and enter the Core API key.
3. Add the Decision key for Jev and, optionally, the Memory token and Chronograph service origin.
4. Describe a task, use a recorded skill, or open Video studio.

## Intelligence services

Core plans, writes, codes, sees screenshots, and executes tools. It uses the existing official model provider directly; no local inference proxy is required. Decision calls Jev for independent choice, score, or evidence questions through `decision_check`. It does not generate prose or grant permission. Memory queries existing temporal relationships through `memory_graph`; it does not automatically ingest files or write graph records. Ordinary tasks can continue when either optional service is absent.

Credentials are stored through the desktop credential provider and never read back into settings. A configured indicator means a key was saved, not that the remote service has been verified. Deployment credentials are read-only in the form. The Core credential reference follows its provider settings; Decision resolves `TYPESAFE_API_KEY`, and Memory resolves `CHRONOGRAPH_TOKEN`.

The `strugend-intelligence` settings section controls the exact `decisionUrl`, allowed `decisionModels`, `graphUrl`, `timeoutMs`, `maxBytes`, `maxQuestions`, and `maxGraphRows`. The decision endpoint defaults to `https://api.typesafe.ai/v1/systemone` with `jev-latest`. The graph origin defaults to empty (disconnected). Remote services require HTTPS; HTTP is supported only on loopback. The Memory address must be an origin without path, credentials, query, or fragment. Use a graph token with read scope.

Each service request and response is recorded as a tool call. Requests send only the selected state and questions or graph query; keys are added outside model-visible arguments. Requests have a 10-second deadline, 256-KiB request/response caps, up to eight independent questions, and up to 50 graph rows by default. Cancellation and shutdown abort active requests. Redirects are rejected and failed requests are not retried automatically. Decision answers are validated against their questions; confidence remains advisory. Graph pagination uses an opaque cursor with the original query, and IDs and microsecond timestamps remain decimal strings.

See the [implementation plan](STRUGEND_PLAN.md) for task examples, calibration, memory ingestion, and the comparative showcase. Live service qualification requires credentials and a running graph workspace.

## Full access and autonomous work

New desktop chats default to **Full access**: file and shell tools can use paths available to the app without workspace sandbox approval prompts. The access picker remains available. A saved default in Settings → Permissions or the `DSH_PERMISSION_MODE` deployment override can select a restricted mode. Other Harness CLI/server profiles retain their own defaults.

Existing chats retain their recorded access setting. Enter `/power` to enable Full access in the current chat, `/power off` to restore workspace access, or `/power status` to inspect it. These commands record the change through Harness’s permission service; they do not rewrite other chats or future-chat preferences.

The agent is instructed to finish authorized work, resolve routine implementation choices, verify results, and recover from tool errors without repeatedly asking to continue. Foreground shell commands default to five minutes and accept overrides up to thirty minutes; existing Shell settings take precedence. Long-running work uses managed background jobs, which have no foreground timeout and can be inspected or stopped. Cancellation, human browser takeover, credential isolation, chat ownership, and hung-operation deadlines remain active. Full access does not supply missing credentials, macOS permissions, or unavailable provider capabilities.

## Browser search and Rust crawling

The desktop address bar accepts website addresses and Brave Search queries. Entering `mail` searches Brave; entering `mail.google.com` opens that website. Explicit URLs retain their meaning, including intranet names. A failed address shows a recovery message and a **Search with Brave** button.

The agent can use `crawl_website` for bulk reading with [Spider’s open-source Rust engine](https://github.com/spider-rs/spider-nodejs). It returns page URLs, status codes, titles, readable text, and links. The default is 10 pages at depth 2; requests can select up to 25 pages, depth 4, and a 30-second deadline. The crawler respects robots.txt, excludes other origins, and disables redirects. If a site redirects, open it in the visible browser and crawl its final URL. The crawler uses a separate process without browser cookies or API keys; cancellation and application shutdown terminate and drain that process.

Use the visible browser for JavaScript rendering, sign-in, forms, uploads, and posting. Brave in this build means **Brave Search**, not an embedded Brave Browser binary. Sidebar actions still operate Electron’s Chromium view. Rust accelerates the HTTP crawling path; it does not replace the rendering engine, and it does not guarantee that every site permits crawling.

Desktop workflow instructions direct the agent to open local development servers in the sidebar and inspect that preview when testing. `desktop_browser observe` and `analyze_browser_vision` can inspect the current chat’s visible tab without a tab ID; `list` disambiguates multiple visible panes. Canvas and game interaction supports normalized `click_point` coordinates, letter/digit keys, arrows, Space, and key holds up to one second. Input commands await Chromium’s acknowledgement before returning an observation, and held keys release on cancellation or human takeover. Shell-based project test suites remain available; they do not replace inspection of the visible preview.

The native dependency is pinned to `@spider-rs/spider-rs@0.0.157`, whose published package declares its platform binaries. Version 0.0.163 does not declare the required native package and failed the installation smoke test. The build is qualified on macOS arm64; other platforms need their own runtime checks.

## Video editing and social posting

Import videos in **Video studio**, add clips to the sequence, adjust their in/out times, choose portrait, square, or landscape, and choose cropping or letterboxing. Optional captions use one cue per line, for example:

```text
0 - 3 | Meet our new product
3 - 6.5 | Available today
```

Export produces an actual H.264/AAC MP4, a JSON edit recipe, and a playable library item. Original footage remains unchanged. **Reopen this edit** restores an export's recipe. The agent can also use `edit_video` to replace audio with a workspace music file. Unsaved changes to the editor are currently held in the open tab; export before closing it.

Example task:

> Use agent-os-video-social. Make a square video from my imported footage, trim the first
> clip to five seconds, add “Available today”, and prepare a LinkedIn post with it.

The LinkedIn and Instagram buttons open their websites in the same native browser used by the agent. Sign in there, or fill a saved login from Vault. The agent uploads the actual export with `desktop_browser`, prepares the caption, and can submit when the request includes publishing. The workflow requires a visible confirmation or permalink before reporting publication. Authentication, CAPTCHA, account restrictions, and site changes may require user takeover. No live social account was used during this build's testing.

FFmpeg and ffprobe must be installed locally:

```sh
brew install ffmpeg
```

The renderer uses Sharp for caption images, so it does not depend on FFmpeg having libass/subtitles support. Executable overrides are `AGENT_OS_FFMPEG` and `AGENT_OS_FFPROBE`; both require absolute paths. Video generation from a text prompt, speech generation, and automatic transcription require additional provider integrations and are not included.

## Groups, queues, skills, and memory

- **Groups:** create groups and subgroups, rename, collapse, move by drag and drop,
  assign the current chat, pin chats, and manage assignments through Organize.
  Deleting a group reparents its children and keeps the chats. Group membership is an
  organizational view alongside the underlying workspace list.
- **Queue:** sending while a task runs adds a queued message above the composer.
  Edit, remove, or Steer it into the active task. Harness remains the authoritative
  owner of queue delivery and resolves races with messages that have begun sending.
- **Record skill:** open a website in the sidebar, choose Record skill, demonstrate the
  workflow, then stop. Skills shows scrubbed steps for review and saving as `SKILL.md`.
  The agent can use `list_recordings` and `save_recorded_skill` to analyze and save a
  reusable procedure. New versions require new names; existing skill bundles are kept.
- **Memory:** edit `soul.md` in Memory. Saves use a content revision and retain prior
  versions. The agent reads it through the logged `read_soul` tool. Store passwords in Vault.
- **Vault:** passwords and managed provider credentials are encrypted through Electron
  safeStorage backed by macOS Keychain. Passwords stay out of inventory responses and
  the model's browser observations. Autofill requires an exact HTTPS origin and does
  not submit the form. Copied passwords are cleared after 30 seconds if unchanged.

Five bundled skills cover video/social posting, forms, job applications, mail, and recording reuse. They are installed into the application's skill directory and discovered by Harness's filesystem skill provider. They are workflow instructions, not claims that all external platforms have passed account-based acceptance tests.

## Verification and coverage

| Area | Status in this build |
|---|---|
| Electron shell and isolated data | Built and launched on this Apple Silicon Mac |
| Nested groups, memory, encrypted vault | Unit tests and real desktop interaction passed |
| Queue edit/remove/Steer | Focused UI tests and an active Harness session with queued input passed |
| Brave Search and Rust crawling | Address/query routing, native Spider process, bounded read-only page collection |
| Native sidebar browser | Real Chromium WebContentsView; observation, click, fill, navigation, uploads, takeover, recording |
| Video editor | Real captioned export, preview playback, byte-range seeking, preserved source, recipe reload, shutdown cancellation tested |
| Browser upload and submission | Export attached and submitted to a local test feed; password redaction and chat ownership checked |
| Recorded workflows | Trusted input capture, redaction, review, portable skill files, model-facing analysis/save tools |
| DeepSeek model calls | Flash and vision routes passed through the real Harness adapter against a local mock; real provider verification needs the user's key |
| LinkedIn / Instagram / jobs / mail | Browser tools and workflow packs implemented; live account qualification pending |
| Files, terminal, session streaming, plugins | Reused from the pinned Harness runtime |
| Signing, notarization, portable installer, update feed | Not released; upstream auto-update/policy enforcement disabled for this fork |
| Native Mac control, voice, generated video, multiple account profiles | Further implementation/qualification required |
| Full vault locking, encrypted backups, retention management | Further implementation required |
| Cloud runners, shared teams, hosted links | Separate service track; not included |

The desktop test imported footage, exported a captioned 1080×1080 MP4, played it in the sidebar, uploaded it to an actual local form, checked its submission confirmation, recorded redacted steps, and verified organization after reload. It made no external post. A separate runtime test exercised both requested model routes, screenshot input, browser actions, and queued-message edit/remove/Steer through the real Harness session using a local mock API. The original desktop suite contains 44 passing tests; the browser update adds 27 address, crawling, and worker-lifecycle checks. The crawler integration test uses the real Harness tool loop and native Rust worker with a local mock API. It verifies Brave query routing, readable crawl results, DNS-error recovery, and cancellation. Search-page content is a local fixture; real Brave Search and social-account behavior still depend on their live services. Test artifacts are kept under `.artifacts/agent-os/` when copied from the local QA run.

## Build and test

Use Node 22.19+ (tested with 22.22.3), pnpm 11.7.0, Xcode Command Line Tools, and FFmpeg. The pinned dependency runtime downloads its own Node/Python/office helpers on first setup.

```sh
pnpm install
pnpm run strugend:build
pnpm run agent-os:start
# After the first desktop preparation:
pnpm run agent-os:launcher
```

Focused checks:

```sh
pnpm exec vitest run \
  apps/desktop/tests/agentos-store.spec.ts \
  apps/desktop/tests/agentos-browser.spec.ts \
  apps/desktop/tests/agentos-address.spec.ts \
  apps/desktop/tests/agentos-crawl.spec.ts \
  apps/desktop/tests/agentos-crawler.spec.ts \
  apps/desktop/tests/agentos-media.spec.ts \
  packages/client/ui-conversation/tests/queue-dock.client.spec.tsx \
  packages/client/ui-workspace/tests/apply.client.spec.ts \
  packages/client/ui-settings-models/tests/welcome-notice.client.spec.tsx
```

Do not use upstream publishing scripts for Strugend Harness. A distribution needs its own application identity, signing/notarization configuration, FFmpeg packaging and license review, independent update feed, install/upgrade testing, and supported-account matrix.

## Implementation map

- `apps/desktop/src/agentos*.ts`: main-process browser, media, storage, and IPC boundary.
- `apps/desktop/src/preload-browser.ts`: isolated, opt-in browser demonstration capture.
- `apps/desktop-host/src/agentos*.ts`: Harness tools, encrypted credential provider,
  vision request logging, and cancellable private parent-process transport.
- `packages/util/agentos-protocol`: shared command, event, and data contracts.
- `packages/client/ui-workspace`: organization and personal tools.
- `packages/client/ui-sidebar-browser`: native browser carrier and Video studio.
- `apps/desktop/resources/agent-os-skills`: bundled workflow instructions.

Browser website renderers receive no Agent OS API or Node access. The owned application renderer gets a narrow preload API. The model gets registered Harness tools, with the session/workspace owner supplied by the runtime. Screenshots, page content, and tool results used for tasks may be sent to DeepSeek and retained in local conversation logs. This developer build has not undergone an independent security audit.
