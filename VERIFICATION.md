# Verification status

**Unreleased; the browser-cleanup repair is locally verified, with hosted candidate qualification pending at this source-publication checkpoint.** Previous complete native qualification passed on AMD64 and ARM64. The preceding candidate run completed with an ARM64 browser-profile teardown failure after its browser assertions passed; AMD64 completed all required qualification and retained its native images. The failed matrix did not assemble a complete candidate. Cleanup remains a required gate. No complete retained candidate or deployment handoff is claimed. Historical failed runs remain below; a green test result is neither an official release nor a guarantee of defect absence.

## Candidate browser cleanup failure and bounded repair — 21 October 2026

[Run 39535169718](https://github.com/TheUncleBen/Homepage-Studio/actions/runs/39535169718), push event, attempt 1, completed with failure for published source `f7141edb2a54a13275b3c386e9442f1803aafbb9`, tree `57d9af70af8a02489718477599e30809ba315f9c`. Its ARM64 [job 119010039285](https://github.com/TheUncleBen/Homepage-Studio/actions/runs/39535169718/job/119010039285) failed at 02:57:04 UTC while deleting the temporary Chromium profile's `Default` directory: `ENOTEMPTY`. The subprocess correctly returned a failure despite its preceding browser assertions passing. AMD64 subsequently completed all required browser, Compose/Swarm and actual Portainer checks, then retained its exact native writer/renderer pair. The run finished at 03:09:34 UTC with assembly skipped because ARM64 failed. Its AMD64-only receipt artifact12318246301 was downloaded: 679-byte ZIP, SHA-256 `e96254622b70041ea69ef86cda2c5034a0f6b4d0dd3e203adcdc5fa77a0cb866`, matching the Actions digest and the source/tree/run identity. No complete multiarchitecture candidate bundle was produced.

The ARM64 job passed 584 native test files / 1,930 tests, 134 writer tests, 69 tooling tests, 13 Python checks, 2 actual Docker-parser checks, 4 native security tests and both image builds. The 17 Chromium scenarios passed in 42.4 seconds and four Firefox/WebKit cases passed in 34.7 seconds. Real headed hidden-document assertions passed in 18.337 seconds with no browser failures, then teardown failed. ARM64 retention, the remaining direct lifecycle acceptance, actual Portainer qualification and image retention were not reached. Those browser assertions do not establish a passing complete job or candidate.

The complete ARM64 log is preserved: 314,960 bytes, SHA-256 `e7c056f3ad00b5d4ef4e0b1fee0f234681b9699155ffeb6d95de90e3a944a114`. The earlier HTTP 400 metadata preflight remains a separate historical failure below; this run passed the new workflow's source checks and reached real browser execution.

The bounded test-harness repair observes process closure from spawn, permits graceful browser shutdown before sending signals, waits for inherited pipes and owned descendants, awaits bounded TERM/KILL fallback, and retries transient profile-removal failures with a finite limit. It preserves assertion failures and emits success evidence only after cleanup completes. All original dashboard assertions are unchanged. Ten focused real subprocess/filesystem regression tests pass with zero failures or skips, including late descendant writes, signal exits, forced termination, a terminal cleanup timeout, actual ENOTEMPTY recovery/exhaustion and nontransient errors. Root independently repeated those ten tests and reviewed the three affected code files; syntax and whitespace checks passed. This local subset is not a Docker, ARM64 or actual Chromium result; repaired-source hosted qualification remains pending. The repair parent is the published `f7141edb2a54a13275b3c386e9442f1803aafbb9`; the future repair commit and candidate run are unassigned until publication. The failed run is preserved, and this reviewed repair batch requests one exact-source candidate qualification. No owner workflow dispatch or candidate approval is required. Official dated publication remains after human acceptance.

## Completed native qualification and delivery revision — 21 October 2026

[Run 39525550327](https://github.com/TheUncleBen/Homepage-Studio/actions/runs/39525550327) completed successfully on both native architectures. It qualified source `dabebdba9e784d796b74a4d9207c5c549fc53016` through tested merge `a03601f0182806550b13ac87119b244988069d1b`, with the same Git tree `b374c7aca73562598fd867e56d68f233c00ddcb7`. This completed the Portainer Swarm gate left open by the historical sixth run.

The workflows were then activated on the default branch at `e80f83f610d572d6c41df548cd0779be52a1de34`. [Run 39531172438](https://github.com/TheUncleBen/Homepage-Studio/actions/runs/39531172438) completed successfully for that exact source/build revision and tree `1473c67b389c740614f03a7ed6c0223bcc2b898c`. Both jobs passed all 17 steps, with no failed cleanup or Actions error annotation.

Each architecture passed:

| Gate | Executed result per architecture |
| --- | --- |
| Native source tests | 584 files / 1,930 tests |
| Writer and packaging/release/Portainer checks | 134 + 54 tests |
| Python / actual Docker parser / native redirect-security checks | 13 / 2 / 4 tests |
| Production browsers | 17 Chromium scenarios and four total Firefox/WebKit desktop scenarios |
| Real hidden-document timing | Actual headed Chromium tab hiding and timer resumption passed |
| Docker-volume retention | After 26 committed saves, exactly the newest 25 pre-save revisions remained; API and on-volume identities agreed |
| Direct Compose and Swarm | Fresh startup, identity, edits, snapshots, replacement, persistence and restore passed |
| Actual Portainer CE 2.45.2 | Both unchanged templates passed API deployment, stored template/environment checks, exact image identities, replacement, persistence, restore and cleanup |

The successful activation run retained the known upstream Vitest hoisting and Next Edge Runtime `process.cwd` warnings. They did not fail a required gate; the complete logs are not warning-free. These runs built disposable images in hosted runners and a temporary loopback registry. They did not retain an installable GHCR candidate.

[Candidate run 39533793508](https://github.com/TheUncleBen/Homepage-Studio/actions/runs/39533793508), attempt 1, used the same activated source and failed in `authorize` with `Cannot verify package metadata (400)`. The two native builds, assembly and publication were skipped. GHCR login and push were never attempted, so this failure establishes no registry-write or container-runtime defect. The logged status does not establish why the metadata endpoint rejected the request.

The published f7141edb delivery revision removed the separate candidate approval environment, owner-only initiation, supplemental metadata token, private staging repositories and package-metadata preflight. The candidate workflow retains the full native qualification. It handles trusted default-branch pushes once; image retention occurs only for an explicit `[deliver-candidate]` request or manual candidate dispatch. Ordinary default pushes validate without publication, and pull requests use the separate nonpublishing workflow. The tested image pair is pushed directly to the declared project packages and assembled into exact multiarchitecture indexes. Source/run identity checks, image checks, complete source/evidence packaging and official release approval remain in place.

At this source-publication checkpoint, the outstanding engineering work is repaired-source hosted qualification, retained registry/image verification and exact bundle validation. The successful run and its candidate bundle provide the subsequent exact-source execution evidence. Anonymous access is reported separately; if first-use GHCR visibility prevents access, the images are preserved while that account setting is completed. No image rebuild or candidate workflow approval is required for a visibility change. Official date publication remains pending human acceptance. See [candidate delivery](docs/CANDIDATES.md) for the resulting handoff.

## Historical qualification checkpoints

The following records retain their original source, results and limitations. Pending statements within those records describe their historical checkpoint; the completed qualification and current delivery status above take precedence.

## Sixth hosted checkpoint and Portainer Swarm harness correction — 21 October 2026

[Run 39523019327](https://github.com/TheUncleBen/Homepage-Studio/actions/runs/39523019327) completed with **failure on both AMD64 and ARM64**. It tested source head `1a567184e0f3595f40beb37b315e2f8592a4f3b0` through merge commit `bcc8cea7be55179dd08a2b5e428f2ef7cef7ea52`; both have tree `d00faec1fa569136355ca3f3903b84f5dbec2acc`. The only observed failing stage was the Portainer Swarm qualification harness: it called the unsupported command `docker swarm inspect` after initializing the disposable Swarm and before creating its Portainer stack. Actual Portainer Swarm deployment was therefore not exercised.

| Completed gate | AMD64 | ARM64 |
| --- | --- | --- |
| Native suite | 584 files / 1,930 tests passed | 584 files / 1,930 tests passed |
| Writer and packaging/release/Portainer checks | 134 + 53 passed | 134 + 53 passed |
| Python / actual Docker parser / native redirect-security checks | 13 / 2 / 4 passed | 13 / 2 / 4 passed |
| Chromium production scenarios | 17 passed in 42.2 seconds | 17 passed in 40.8 seconds |
| Firefox/WebKit desktop cases | 4 passed in 26.2 seconds | 4 passed in 33.2 seconds |
| Real headed hidden-document timing | Passed in 18.435 seconds | Passed in 18.188 seconds |
| Docker-volume retention | Exact newest 25 pre-save revisions after 26 saves; API and on-volume filenames agree | Same exact checks passed |
| Direct Compose and Swarm lifecycle | Passed, including production 180-second Swarm update monitors | Same lifecycle passed |
| Portainer CE 2.45.2 standalone API lifecycle | Passed | Passed |

The actual Portainer standalone check verified deployment through its API, the stored unchanged template and explicit environment, immutable image identities, editing, snapshots, replacement persistence and restoration. No cleanup failure was emitted. The original harness failure remained the run's result, and the final all-qualified success message was absent.

The independent Docker-volume retention and strict browser no-playback-write checks now pass on both architectures. This closes that specific engineering gate raised by the earlier scratch history observations. It does **not** establish why older files appeared to reappear in the scratch workspace. Those observations and failed intermediate runs remain recorded; no writer retention code or assertion was weakened.

The reviewed correction changes three qualification files only. Its helper reads `docker info --format '{{json .Swarm}}'`, requires an active manager with a nonempty `Cluster.ID`, and returns that cluster identity rather than `NodeID`. The pinned Docker 28.0.4 executable was exercised against synthetic loopback Engine API responses in six cases: the original unsupported command was reproduced, the supported lookup returned the cluster ID, and inactive nodes, workers, absent clusters and empty IDs were rejected. This checks the actual CLI interface without claiming a local Docker daemon or Swarm deployment.

The corrected Portainer-client subset passes **14 tests**, with zero failures or skips, and the three changed files pass syntax checks. Root repeated that focused subset after integration, and an independent review verified that only those three files changed across the 149-file source. The earlier combined **187** result remains historical; **188** is the expected combined count after adding the new case, not a completed full-suite result for the correction. No production component, deployment template, update monitor or acceptance assertion changed.

Actual Portainer Swarm deployment/update/cleanup on both architectures and a complete hosted result for the corrected source remain pending. The successful browser, direct lifecycle, retention and Portainer standalone stages above retain their exact-source scope. Candidate delivery and official promotion definitions remain dormant; actual candidate registry/review/artifact-transfer/anonymous-pull operations and an installable image are not established by these checks.

## Earlier hosted checkpoint and local expanded acceptance — 21 October 2026

The following section preserves the preceding checkpoint and local follow-up. Its pending statements describe that earlier stage; the sixth hosted result above records the subsequent execution.

[Run 39517328982](https://github.com/TheUncleBen/Homepage-Studio/actions/runs/39517328982) completed successfully on native AMD64 and ARM64. It qualified source head `e571da0b82409beff3e293d9bd8853fe79e8fd61` through merge commit `689fc6d03cc1cc43d98608449c5e42a3435c5092`; both have tree `004be3e70dc9e9a37946e155a11e2a07ce1ddb7a`. Each architecture passed 584 native test files / 1,930 tests, 150 writer/packaging checks, 10 Python checks, two real Docker-parser checks, four redirect-security regressions, production dependency audits, seven actual Chromium scenarios, and the complete Compose/Swarm lifecycle. Fixture cleanup completed without the earlier swallowed-error warning. The revised trigger produced one pull-request run and no duplicate push run.

Independent acceptance work continued after that checkpoint. It found two additional application defects: focused content inside an embedded iframe did not suspend its stack's timer, and holding the unused area inside the empty-board container did not enter editing. The fixes track the active iframe at the parent-document boundary without reading a cross-origin document, and recognize noninteractive empty-board descendants. Existing native input, timing and layout behavior remains covered. Both actual production-browser regressions pass after the repairs; the targeted native component checks pass nine tests with no lint warnings.

The repaired local production build identifies itself as `e571da0b82409beff3e293d9bd8853fe79e8fd61+local-43fd543257ebaed7`. Its expanded browser results are:

| Gate | Executed result and scope |
| --- | --- |
| Main Chromium suite | 17 passed in 37.8 seconds, no retries; includes the original seven scenarios plus settings/file transactions, conflict handling, snapshot identity restoration, embedded-document state, dense native content, mixed-size stack editing, real focus/offscreen/dialog suspension and reduced motion |
| Firefox and WebKit desktop | Four passed in 20.0 seconds: the same two pointer/native-search acceptance scenarios run in each engine, including persistence and Escape cancellation |
| Real hidden browser document | Passed in 18.066 seconds using unmanaged headed Chromium and actual tab activation; nine seconds hidden, approximately 2.986 seconds of remaining budget resumed, then the normal four-second cadence, with no catch-up or playback snapshots |
| Production visual inspection | Reviewed actual native calendar, chart and process-list panels at desktop and 320-pixel mobile width, plus populated native service/search/stack views; no outer-page horizontal overflow observed |
| Portainer qualification harness | 13 local client, identity, asynchronous-state, cleanup and guard tests passed; exact generated payloads checked against the pinned API schema and real Docker parser; actual Portainer containers still require hosted execution |

The hidden-document check does not override `document.hidden`, use a fake clock, or rely on Playwright's focus-emulated page behavior. The Firefox/WebKit checks do not establish physical Samsung or Safari hardware behavior. The local process build is not a Docker or ARM64 result.

Two intermediate browser runs are retained as evidence. A coordinate-based iframe slider assertion first ran before its CSS transition had finished; the harness now waits for the real transition to settle and retains the exact value and mounted-state assertions. A subsequent run observed older backup entries reappearing in the scratch-backed fixture's history. The unchanged full suite then passed, and an exact oldest-file identity probe confirmed normal committed-save pruning from 26 to 25 with the removed file remaining absent. The cause of the earlier directory observations is not established. No writer code or no-snapshot assertion was weakened. At that local checkpoint, independent Docker-volume retention and no-playback-write checks remained required. The sixth hosted run above subsequently passed those exact checks on both architectures; the scratch cause remains unestablished.

The extended source adds all three browser engines, real document visibility, and actual pinned Portainer CE standalone/Swarm deployment to the nonpublishing workflow on both architectures. Its combined hosted result must be inspected for this exact source. Preparing these gates is not an executed result. An installable candidate additionally requires preserved image identities, complete source and evidence, and the authorized delivery path described in [RELEASES.md](docs/RELEASES.md).

Before the later three-file Portainer Swarm harness correction, the combined local follow-up passed 187 writer, packaging, Portainer-client and release-tool tests, with zero failures or skips, plus 13 Python source-preparation/archive checks. These totals include the 24 release-readiness tests and three new source-archive checks; they are not additional counts. The actual Docker 28.0.4 parser again passes both named checks, including rejection of all eight missing/empty required values. All three workflow definitions pass actionlint, and all 18 JavaScript tooling files pass syntax checks. Test discovery confirms the expected 17 Chromium and four Firefox/WebKit scenarios without claiming another browser execution.

Independent release-tool review found and closed two concrete issues before integration: official promotion now binds the original candidate bundle to its exact successful workflow run, and anonymous image identity checks use commands supported by the qualified Docker 28 client. Eight focused independent checks pass. The candidate and official definitions remain dormant in `release/workflows/`; these local results do not establish actual GitHub environment setup, GHCR delivery, or an installable image. The [candidate procedure](docs/CANDIDATES.md) records those remaining actual-account gates.

## Local results — 20 October 2026

| Check | Actual result |
| --- | --- |
| Integrated writer, board, discovery, shared playback, catalog and packaging tests | 150 passed after the startup health correction; zero failures or skips |
| Full native Homepage Vitest suite before the cold SSR correction | 581 test files; 1,924 tests passed; zero failures or skips; also passed inside both initial CI image builds |
| Targeted native overlay tests after the cold SSR correction | 12 files; 44 passed; includes the previous 42 plus two real native SSR regressions |
| Targeted native editor/stack tests after exposing the manual-delay control | 2 files; 5 passed; includes a new apply/reopen regression that fails before the control exists |
| Snapshot custom-JavaScript reload handoff | 3 regressions fail before the correction and pass afterward; changed, removed and unchanged scripts |
| Actual local production Chromium | 7 scenarios passed in 19.0 seconds with zero retries, uncaught main-page errors or local HTTP 5xx; includes the focused touch/restore pair |
| Integrated packaging checks after CI trigger/cleanup corrections | 16 passed; zero failures or skips; overlaps the integrated writer/packaging total |
| Cleanup control-flow regressions | 3 failed before / 3 passed after; simulated task-removal race, with actual Docker confirmation required in CI |
| Actual production visual inspection | Desktop 1440 × 1080 and mobile 390-pixel screenshots reviewed; synthetic content, separate from owner/device acceptance |
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

The full native suite was not repeated locally after the two-test correction. Both architectures subsequently passed 582 test files and 1,926 tests in hosted run 39510878167. Targeted counts are not added to that full-suite total.

## First actual CI result and correction

[Initial PR run 39509222831](https://github.com/TheUncleBen/Homepage-Studio/actions/runs/39509222831) successfully installed Chromium, built both images and ran the full native suite on AMD64 and ARM64. Both Compose deployments became healthy, but their first dashboard request returned HTTP 500. Browser and Swarm acceptance were not reached. The actual tested build revision was synthetic merge commit `dc03701c11fd712c34ff77365fab0bf91822aa5c`, whose tree equals implementation head `6069e2eda645483ce8041174d980617c6d732ba6`.

The page had omitted Homepage's native SWR fallback provider. Quick Launch reads `/api/widgets` during server rendering, so it received undefined data even though the Studio data bridge had its own fallback. The correction restores the native provider around all page hooks and children. Two regressions use the real native file readers, App, page, SWR and Quick Launch rather than mocking that boundary. Both fail before the correction and pass afterward. The actual standalone production server likewise returns HTTP 200 for empty and populated fixtures after returning HTTP 500 for both before the fix. Fictional provider/service secrets remain absent from the HTML and native render-data responses, and no configuration file changes or samples are introduced.

The browser acceptance sequence also waits for a completed arrangement save before reloading. Merely seeing a stack in the unsaved draft did not establish persistence. This correction changes the harness's completion condition without weakening the reload/persistence assertion.

## Second actual CI result and Swarm correction

[Run 39510878167](https://github.com/TheUncleBen/Homepage-Studio/actions/runs/39510878167) built both images and passed all 1,926 native tests on both AMD64 and ARM64. Both actual Chromium runs passed the full editor/stack/playback/input sequence. Fresh standalone Compose checks passed empty startup, native protocol/build identity, nonroot execution, read-only renderer configuration, editing, snapshots, restart/replacement persistence and restoration. The tested revision was synthetic merge `aea4ff62657f054cf981541951bdfd416abc4b4f`, whose tree equals source head `df1d2b40f6dd92e766075a3d916ca12078ea4d96`.

Both jobs then failed at Swarm deployment because Docker's legacy interpolation parser misread a hyphen in the required-variable help text as a default operator. The actual Docker 28.0.4 client reproduced this without a daemon: `docker stack config` returned success but replaced the intended renderer image with `renderer image digest`. Removing the hyphens from the two image-variable help messages preserves the required-variable guards and both exact image values. Two real-parser regressions now check all resolved deployment values and rejection of eight missing/empty required-value cases before either image is built. The focused packaging suite also passed all 15 checks after the correction.

This second run's overall result remains **failed**; its passing stages do not qualify Swarm. The corrected template's complete deployment result is established by the subsequent [validation workflow run for its exact source](https://github.com/TheUncleBen/Homepage-Studio/actions/workflows/validate.yml). No image is published by that workflow.

## Third actual CI result and startup correction

[Run 39512418935](https://github.com/TheUncleBen/Homepage-Studio/actions/runs/39512418935) again passed all 1,926 native tests, actual Chromium and the complete standalone lifecycle on both architectures. The corrected Swarm template parsed and deployed, but initial aggregate readiness stayed unavailable for 180 seconds. Neither Swarm service replacement nor restoration was reached. The tested merge was `44429544cf01f86112479166dbce9661e989262f`, with the same tree as source head `db1f8e96a35de6a15e5c0840d0730cded370ef33`. The run remains **failed**.

The writer's container health depended on aggregate renderer readiness, while the renderer waited for the writer's configuration endpoint through Swarm's service address. Docker 28.0.4 [activates that service binding only after container health succeeds](https://github.com/moby/moby/blob/v28.0.4/daemon/cluster/executor/container/controller.go), creating a startup cycle. Writer container health now uses the existing local configuration-readiness protocol. The external `/__studio/ready` endpoint still requires the native protocol, upstream source and matching build identity; it is unchanged.

A real HTTP/CLI regression runs the exact Dockerfile health command with native readiness unavailable. The old command fails, changing only the Dockerfile without the CLI endpoint mapping also fails, and the complete correction passes. Invalid configuration still fails container health, while aggregate readiness remains HTTP 503 until the renderer is ready. The integrated suite now passes 150 tests. Container acceptance additionally starts the writer alone and checks the same boundary before starting the renderer. Bounded failure diagnostics expose task health and selected endpoints without dumping configuration or environment values. Production update and stability timings remain unchanged.

These local checks established the corrected health boundary. The fourth hosted run below then exercised actual Swarm startup and replacement with that correction.

## Fourth actual CI result and independent coverage review

[Run 39514570752](https://github.com/TheUncleBen/Homepage-Studio/actions/runs/39514570752) reported success on both architectures. Each job passed 583 native test files / 1,927 tests, the writer-alone health boundary, Chromium, the full standalone lifecycle, and Swarm startup, stop-first replacement, persistence and restoration. The tested merge was `a82e3bbd555cd4ab12115927dcbdba130e676d22`, whose tree equals source head `b7c9c3c9feac1af62e5189cd9f059e0c951a36f1`.

That result did not close the candidate gate. Log review found that cleanup ignored stopped task containers and printed a volume-in-use error without failing the run. Cleanup now waits for all fixture containers, attempts remaining cleanup after an error, and reports a cleanup-only failure without replacing an earlier qualification error. Three focused control-flow regressions fail against the previous cleanup and pass against the correction; real-container confirmation belongs to the next exact-source run.

A separate requirement-to-test review found that the single browser scenario used keyboard/numeric layout controls and selection-based stacking. It did not directly test pointer placement/resize, same-finger hold-and-drag, native search state, the native service-widget proxy path, or snapshot reload instructions. The 1,927-test total contains inherited Homepage coverage; the reviewed Studio-specific native subset contained 45 cases across 13 files. These counts are not interchangeable measures of feature acceptance.

The review also found a missing reload handoff when a snapshot changes custom JavaScript. Restoration now compares the current and restored script and offers the same explicit reload action as file editing. Three regressions cover changed, removed and unchanged scripts. The actual browser verifies the prompt, preservation of the currently loaded script until reload, and execution of the restored script afterward.

The first targeted local browser run reproduced a separate functional failure: a hold entered editing, but continuing with the same finger vertically did not move the panel. A canvas touch listener now preserves motion during an active single-touch board manipulation while allowing ordinary pre-hold scrolling. The repaired browser scenario verifies scrolling, same-finger movement, cancellation, deliberate drag-to-stack and saved membership. An unrelated initial recovery assertion was corrected to address the status container containing both notice text and a button; the notice itself was already present after the restore fix.

All seven production-browser scenarios then passed locally in 19.0 seconds without retries. They add actual pointer move/resize and Escape cancellation, native search node/query preservation through stacking and moving out, native bookmark persistence, a saved 45-second manual delay with exact automatic-advance timing, and a native Custom API/private-proxy round trip using a synthetic internal endpoint. Each scenario resets the disposable configuration and checks its main page for uncaught errors and local HTTP 5xx. The additional mobile screenshot context verifies native content and horizontal fit. The two focused scenarios are a subset of seven, not nine unique tests. These local results apply to the repaired x86_64 production-process build; the next exact-source CI run qualifies the combined images on both architectures.

## CI execution policy

The initial workflow responded to both a branch push and its pull-request update. Four push duplicates were cancelled by the shared concurrency group while four PR qualification rounds continued. The duplicate triggers were avoidable. The revised routing gives default-branch pushes one complete native matrix through the candidate workflow; pull requests retain the separate complete validation matrix. An explicit candidate request enables retention only after all qualification steps pass. Candidate delivery is serialized without cancellation of a partial publication. Manual validation remains available. No acceptance assertion was weakened. Browser installation follows the image build so a build failure does not first incur browser setup work.

Follow-up corrections are reviewed and checked locally where possible, then submitted together. A passing run records the checks completed for its exact source; it is neither owner acceptance nor a claim of complete defect absence.

## What was exercised

The integrated tests cover the nine native files, literal native secret references, comments/unknown fields, single and multiple native service widgets, raw YAML type changes, independent information widgets and bookmarks, stable identities, stack membership, geometry, stale revisions, bounded input, interrupted-save recovery, restore/export, default snapshot retention and host/origin checks.

Discovery tests use actual temporary loopback HTTP servers and a schema-checked native manifest. They verify read-only refresh, fixed renderer origin/path, no credential forwarding, body/time bounds, malformed response rejection, availability changes, retained layout during outages, hidden-source restoration, and recovery without discovery dependencies.

The shared playback controller uses a deterministic clock. It verifies Play/Pause, manual switching while paused, a 30-second effective hold while playing, renewed holds on repeated interaction, independent stacks, no catch-up bursts and suspension of remaining time during blockers. Native component tests additionally cover StrictMode, focus/visibility behavior, pointer cancellation, typed editor drafts and stable mounted input/iframe hosts through movement, resizing, stacking, navigation and unstacking. A jsdom iframe identity test is not a real-browser iframe acceptance test.

The original main-page tests that asserted the replaced stock grouped/header layout were replaced with tests of the new page contract, sanitized SSR data, provider privacy, host/locale handling, Quick Launch, error fallback and stable refresh behavior. Existing native widget, auth and proxy suites remain enabled, including the native qBittorrent/Flood loopback fixtures.

Dependency review corrected `yaml` to 2.8.3 and the native `follow-redirects` dependency to exact 1.16.1. The latter has an explicit original-to-patched lockfile transform and regression tests. These audits report known findings at the recorded check time; they are not a guarantee against future advisories.

## Local environment limits and remaining gates

There is no Docker engine in the local implementation environment. Chrome for Testing 156.0.8078.4 and the pinned Playwright Firefox/WebKit builds were obtained from their official distributions and successfully ran the checks recorded above. Browser installation is complete. Container builds, Compose, Swarm, actual Portainer and architecture-qualified container execution require the hosted environment. A local production-process check is not Docker acceptance.

Both workflow paths run the actual two-image application, browser acceptance, Compose/Swarm lifecycle and pinned Portainer checks on AMD64 and ARM64 hosted runners. The successful hosted runs above establish those results for their exact sources. The revised candidate path must pass the same qualification before retaining the image pair through the repository's normal GHCR token. The separate pull-request validation path remains nonpublishing. Neither path creates an official date tag or release; the temporary Portainer registry is removed after qualification.

Owner testing in the intended private environment and on the physical phone remains a separate acceptance gate after all feasible engineering checks and image delivery are complete. Real external integrations were not contacted. Configuration support does not imply successful live testing of every native service. Native hidden widgets retain their own polling behavior. Representative calendar/chart/list/embed behavior has been checked in production browsers; aesthetic preference and physical gesture feel still require the owner.

Successful local native checks retain two existing upstream Vitest hoisting warnings and a native middleware-convention deprecation warning. They did not fail the pinned build, and the overlay-specific lint check has no warnings.
