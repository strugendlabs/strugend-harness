# Decision runtime qualification

English | [中文](README.zh.md)

## Summary

The local Decision helper runs native inference outside the Desktop Host. Lifecycle fixtures verify process exit, queue limits, deadlines, credential exclusion, memory admission, and recovery without loading weights. Component removal rejects active and queued work and blocks new inference until all owned work and processes stop. The optional native test separately evaluates the actual component with production review prompts.

## Run qualification

Run `pnpm exec vitest run apps/desktop-host/tests/strugend-laya-local.spec.ts apps/desktop-host/tests/strugend-decision-quality.spec.ts --maxWorkers=1` for deterministic lifecycle and qualification checks. Build the Desktop Host and optional Decision component before running `LAYA_MODEL_TEST=1 pnpm exec vitest run apps/desktop-host/tests/strugend-laya.built.spec.ts --maxWorkers=1`. Set `LAYA_COMPONENT_ROOT` to the unpacked component containing `model/` and `node_modules/`; `LAYA_PACKAGED_ROOT` selects the compiled helper from a prepared desktop payload. Without those variables, the test uses `apps/desktop-host/lib` and `.artifacts/components/decision`. Native inference requires 8 GiB physical RAM and 3 GiB available memory. A rejected admission writes an explicit skipped report and never loads the model.

The native report records cold and warm latency, Host RSS separately from helper RSS and peak RSS, resource observations, individual answers, failures, and per-intent precision. Its output is `.artifacts/strugend/local-laya-[payload-]<platform>-<arch>.json`. Helper exit releases its process memory; these observations do not measure total browser or build-tool memory.

`STRUGEND_COMPONENT_TEST=1 LAYA_PACKAGED_ROOT=apps/desktop/.desktop-build/targets/<target> pnpm exec vitest run apps/desktop-host/tests/optional-components.built.spec.ts --maxWorkers=1` installs the exact release archives through the download manager. It verifies hashes and extraction, resolves the installed SDK, runs Python document imports, creates DOCX and renders native PDF, then removes the document component.

## Read the results

The corpus contains 72 synthetic tasks: four calibration and twenty held-out cases for each production review intent. Qualification requires at least twelve accepted suggestions with 90% precision, at least three abstention controls with no false suggestion, and no missing or failed held-out inference. Calibration answers never count. Low confidence and abstention cannot manufacture a passing result. `LAYA_REQUIRE_QUALIFIED=1` makes the native test reject an unqualified intent; ordinary native measurement still records that failure in the report.

Synthetic review precision does not establish improved coding outcomes. Automatic activation additionally requires a reviewed paired-task comparison with equivalent Core providers, tools, inputs, and budgets, scored by executable tests and verified artifacts. The release manifest in `../src/strugend-review-qualification.json` is empty until both forms of evidence support a specific model revision. Installing the component or changing runtime settings does not qualify it.

## Remote and paired-task qualification

`LAYA_REMOTE_MODEL_TEST=1 pnpm exec vitest run apps/desktop-host/tests/strugend-laya-remote.spec.ts --maxWorkers=1` runs the same production recipes against Impossibl using `IMPOSSIBL_API_KEY` from the process environment or root `.env`. It writes `.artifacts/strugend/remote-laya-quality.json`; missing credentials produce an explicit skip. Keys never enter reports. Remote precision cannot qualify a model revision that the provider does not identify.

The paired scaffold uses the supported `dsh` ACP profile and shared subprocess test launcher. Set `STRUGEND_PAIRED_TEST=1`, `STRUGEND_PAIRED_BASELINE_PATCH`, and `STRUGEND_PAIRED_ASSIST_PATCH` to reviewed ACP overlays with identical primary providers, tools and budgets. Supply the primary provider credential identified by `STRUGEND_PAIRED_CORE_KEY_REF` (default `DEEPSEEK_API_KEY`) and `IMPOSSIBL_API_KEY`, then run `pnpm exec vitest run apps/desktop-host/tests/strugend-decision-paired.spec.ts --maxWorkers=1`. Missing inputs are recorded as skipped. Each variant gets a private workspace and profile; independent checks score signed-number addition and a saved expense summary. Reports include elapsed time, tool count and overlay digests. These two tasks exercise runner plumbing only: broader task coverage, real advice attribution, token use and process-tree memory are still required. The scaffold always reports `qualified: false` and cannot change production activation.
