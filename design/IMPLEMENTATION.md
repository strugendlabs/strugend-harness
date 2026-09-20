# Agent OS design implementation

Reference: the user's supplied Codex screenshot and `agent-os-concept.png`.
The concept was inspected alongside screenshots of the running Electron build.
The actual product contains live application state; the concept's example conversation
and LinkedIn page are design references only.

| Reference anchor | Implemented treatment |
|---|---|
| Dark macOS workspace | Graphite first-run theme, distinct sidebar, subdued borders, own Agent OS mark |
| Three working columns | Existing resizable Harness sidebar, conversation, and docked tool panes |
| Nested navigation | Persistent groups and subgroups, indentation, disclosure controls, selected chat row, pin/manage actions |
| Queue above composer | Expanded desktop queue with visible Steer, edit, and remove controls; authoritative Harness delivery |
| Visible browser actions | A native Chromium view occupies the right pane; the agent controls that same view |
| Personal tools | Skills, Vault, Memory, and the requested Video studio live in the left navigation |
| Browser/files/terminal access | Preserved Harness tab/docking system rather than hard-coded static tabs |
| Video workflow | Actual preview, clip sequence, trims, captions, format, export progress, and social-site handoff |

Intentional differences: the existing Harness docking and workspace selectors remain;
Video studio adds a media surface beyond the supplied screenshot; the blank-chat hero
is centered until a conversation begins. The social preview used in QA is a local
fixture and is never presented as a real LinkedIn or Instagram post.

Evidence is in the ignored `.artifacts/agent-os/` directory. Screenshots and temporary
Playwright scripts are not shipped as application source.
