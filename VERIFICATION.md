# Verification status

**Unreleased development implementation.** The evidence below distinguishes the initial implementation, the cold-server-rendering correction, and actual hosted qualification. It is not an approved deployment candidate or official image. Current repository Actions results are a separate qualification record; this document does not treat a prepared workflow as an executed test.

## Local results — 20 October 2026

| Check | Actual result |
| --- | --- |
| Integrated writer, board, discovery, shared playback, catalog and packaging tests | 149 passed; zero failures or skips |
| Full native Homepage Vitest suite before the cold SSR correction | 581 test files; 1,924 tests passed; zero failures or skips; also passed inside both initial CI image builds |
| Targeted native overlay tests after the cold SSR correction | 12 files; 44 passed; includes the previous 42 plus two real native SSR regressions |
| Native ESLint for new/replaced files | Passed with zero warnings |
| Native production Next standalone build | Passed, including a rebuild after the cold SSR correction |
| Actual corrected standalone HTTP server | Empty and populated nine-file configurations both return HTTP 200; native render data, unchanged files and secret redaction verified |
| Source preparation and archive/patch safety tests | 10 passed |
| Patched native redirect regressions using actual loopback HTTP servers | 4 passed |
| Writer production dependency audit | Zero findings in the recorded dependency set |
| Native production dependency audit | Zero findings across 403 production dependencies |
| Exact upstream archive plus integrated overlay preparation | Passed; original-source guards, overlayApplied flag and dependency hashes verified |
| Interactive design-preview source/controller checks | 29 passed; separate preview evidence, not native-browser acceptance |

The native overlay is pinned to Homepage v2.6.0, commit `51cc1684f9f34a7877ed462b8f94c9cc687b4dde`. The source archive SHA-256 is `c2a66259f3e1c0f085404b5402815920ca922dab84774db3617a541692ff174a`. [Verification evidence](docs/verification-evidence.json) records the relevant source hashes and commands. [Native overlay documentation](docs/NATIVE-OVERLAY.md) records the exact source transforms and compatibility boundaries.

The full native suite was not repeated locally after the two-test correction; inspect the corrected commit's Actions run for that full-suite result instead of adding targeted counts to a historical run.

## First actual CI result and correction

[Initial PR run 39509222831](https://github.com/TheUncleBen/Homepage-Studio/actions/runs/39509222831) successfully installed Chromium, built both images and ran the full native suite on AMD64 and ARM64. Both Compose deployments became healthy, but their first dashboard request returned HTTP 500. Browser and Swarm acceptance were not reached. The actual tested build revision was synthetic merge commit `dc03701c11fd712c34ff77365fab0bf91822aa5c`, whose tree equals implementation head `6069e2eda645483ce8041174d980617c6d732ba6`.

The page had omitted Homepage's native SWR fallback provider. Quick Launch reads `/api/widgets` during server rendering, so it received undefined data even though the Studio data bridge had its own fallback. The correction restores the native provider around all page hooks and children. Two regressions use the real native file readers, App, page, SWR and Quick Launch rather than mocking that boundary. Both fail before the correction and pass afterward. The actual standalone production server likewise returns HTTP 200 for empty and populated fixtures after returning HTTP 500 for both before the fix. Fictional provider/service secrets remain absent from the HTML and native render-data responses, and no configuration file changes or samples are introduced.

The browser acceptance sequence also waits for a completed arrangement save before reloading. Merely seeing a stack in the unsaved draft did not establish persistence. This correction changes the harness's completion condition without weakening the reload/persistence assertion. Full container/browser qualification for the corrected source is established only by its subsequent Actions result.

## What was exercised

The integrated tests cover the nine native files, literal native secret references, comments/unknown fields, single and multiple native service widgets, raw YAML type changes, independent information widgets and bookmarks, stable identities, stack membership, geometry, stale revisions, bounded input, interrupted-save recovery, restore/export, default snapshot retention and host/origin checks.

Discovery tests use actual temporary loopback HTTP servers and a schema-checked native manifest. They verify read-only refresh, fixed renderer origin/path, no credential forwarding, body/time bounds, malformed response rejection, availability changes, retained layout during outages, hidden-source restoration, and recovery without discovery dependencies.

The shared playback controller uses a deterministic clock. It verifies Play/Pause, manual switching while paused, a 30-second effective hold while playing, renewed holds on repeated interaction, independent stacks, no catch-up bursts and suspension of remaining time during blockers. Native component tests additionally cover StrictMode, focus/visibility behavior, pointer cancellation, typed editor drafts and stable mounted input/iframe hosts through movement, resizing, stacking, navigation and unstacking. A jsdom iframe identity test is not a real-browser iframe acceptance test.

The original main-page tests that asserted the replaced stock grouped/header layout were replaced with tests of the new page contract, sanitized SSR data, provider privacy, host/locale handling, Quick Launch, error fallback and stable refresh behavior. Existing native widget, auth and proxy suites remain enabled, including the native qBittorrent/Flood loopback fixtures.

Dependency review corrected `yaml` to 2.8.3 and the native `follow-redirects` dependency to exact 1.16.1. The latter has an explicit original-to-patched lockfile transform and regression tests. These audits report known findings at the recorded check time; they are not a guarantee against future advisories.

## Local environment limits and remaining gates

There is no Docker engine in the local implementation environment. Official browser installation attempts using bundled Playwright 1.62.1 and the pinned test package 1.64.1 returned truncated ZIP archives and did not install a browser. Consequently local results remain **NOT_RUN** for Chromium interaction, container builds, Compose, Swarm and architecture-qualified container execution. Hosted runs are separate evidence, including the real first-run failure recorded above. The corrected production standalone HTTP regression did execute locally; it is not browser or Docker acceptance.

The nonpublishing workflow runs the actual two-image application, browser acceptance and Compose/Swarm lifecycle checks on amd64 and arm64 hosted runners. Its logs must establish results for the exact source before an engineering candidate is prepared. It has no registry login, image push, release, date-tag or installable-image artifact upload.

Owner testing in the intended Portainer/Swarm environment and phone/browser remains a separate acceptance gate. Real external integrations were not contacted. Configuration support does not imply successful live testing of every native service. Native hidden widgets retain their own polling behavior, and representative calendar/chart/list/embed sizing still requires browser review.

Successful local native checks retain two existing upstream Vitest hoisting warnings and a native middleware-convention deprecation warning. They did not fail the pinned build, and the overlay-specific lint check has no warnings.
