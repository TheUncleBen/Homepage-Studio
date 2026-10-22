# Historical companion-container verification record

This preserves the earlier record verbatim below. Its test counts, image pairs,
overlay paths and passing workflow results belong to the earlier architecture.
They do not qualify the controlled single-container revision. See the current
[root verification status](../../VERIFICATION.md).

---

# Verification status

**Unreleased; official human acceptance remains pending.** Engineering candidates are qualified for an exact source and image pair. The completed baseline below is preserved; the comprehensive review changes in this revision require their own matching workflow results and delivery receipt. This file records source review and checks available before publication. Subsequent image results are attached to that exact source's [candidate workflow run](https://github.com/TheUncleBen/Homepage-Studio/actions/workflows/candidate-approved.yml) and bundle, so historical counts cannot be reused to qualify newer bytes. A green run is one part of the review, not a guarantee of defect absence.

## Completed candidate baseline — 21 October 2026

[Run 39540147520](https://github.com/TheUncleBen/Homepage-Studio/actions/runs/39540147520) completed successfully for source `6cb481a7853c715e788d027c2dc4b0cd682917b1`, tree `61b68eaadf5301ee74a445074fa9227514f300c2`. Both native targets and multiarchitecture assembly passed. The delivered receipt is `public-ready`: all four authenticated platform pulls and anonymous image/layer verification passed, with no package access pending. The candidate fingerprint is `69def5cfc794e35857eb06d84036bfbcfeb99cc7f9051c5375ae5678eaaa88d5`. Its original ten-file bundle is 8,930,168 bytes, SHA-256 `094b8d6433726c6cf0ff2d668235c52e0da567ced0bccc25e74abe256bdc20db`.

On each of AMD64 and ARM64, that baseline passed 584 native files / 1,930 tests; 134 writer, 80 tooling, 13 Python, two actual Docker parser and four redirect security checks; 17 Chromium and four Firefox/WebKit cases; real hidden-document timing and cleanup; exact newest-25 retention after 26 saves; direct Compose/Swarm lifecycle; and actual pinned Portainer CE 2.45.2 standalone/Swarm deployment, replacement, persistence, restoration and cleanup. An independent anonymous verifier streamed and SHA-256 checked 59 per-repository runtime-layer entries / 376,725,427 bytes. These historical results belong to that baseline only. The additional review below found defects that those checks did not cover.

## Comprehensive source review — 21 October 2026

Independent reviews covered native documentation/configuration compatibility, direct manipulation and editor failure behavior, persistent-data recovery, deployment, source/image delivery, licensing boundaries and focused appearance customization. The review fetched all 209 current official documentation pages without errors, mapped 176 dedicated widget pages against the pinned 169-service/14-information registry, and checked 178 native source hashes. No native registry entry was missing from the catalog. Complex nested configuration retains the JSON/YAML fallback; documentation coverage does not establish successful connectivity to every external service.

Confirmed corrections include changed-only native patches; nine catalog control gaps; synthetic widget-parent cleanup; snapshot ordering across equal/backward timestamps and restart; complete validated dashboard imports; dirty and pending editor guards; accurate committed-save/failed-refresh recovery; revision-paired native rendering and arrangement draft provenance; rollback-aware native file reads; and request-time native Kubernetes configuration lookups. Appearance controls retain the restrained default while adding per-instance light/dark/device mode, a chosen accent, and native CSS overrides. Packaging now verifies the actual pinned pnpm tarball, refuses untracked overlay inputs, and anonymously checks every runtime layer again before an official promotion writes anything.

Every correction retains the native Homepage integration engine. Original failing regressions were preserved in the review evidence. Physical Samsung gesture feel, the owner's visual judgment and private deployment/service connectivity remain distinct human checks. The implementation keeps the approved Play/Pause-only stack controls and does not claim full WCAG or generic carousel-pattern conformance.

### Startup interaction correction

The production Chromium pass on `ee62b9d1f2a774d95e499a57e8141a6929602db8` completed 18 of 19 scenarios successfully, with zero retries. The remaining configuration-workflow scenario clicked Dashboard settings immediately after navigation, before the board had initialized; no editor opened. The original result is retained. Source review confirmed that Settings and Quick Launch were enabled in server-rendered HTML even though Add and Edit already waited for board data.

The correction applies the existing board availability guard consistently, starts page-level search interaction blocked, and keeps the optional native floating Quick Launch mounted but inert until interaction is ready. The first enabled click opens the editor. It does not delay tests with sleeps, retry a lost click, or replace the dashboard while it initializes.

The local focused run passed **13 selected tests across three files**, including the held-first-board-response scenario, the page's shortcut/native-button guard, all existing page-composition checks, and both real native server-render regressions. Sixteen unrelated board cases were outside that focused selection. All five changed native JavaScript files pass ESLint with zero warnings; the new browser scenario passes syntax checking and the diff passes whitespace checking. The browser scenario holds the first board request explicitly, verifies unavailable controls, then makes one settings click after release. Its production execution and a rerun of the unchanged failed configuration scenario remain required on a rebuilt runtime; the local source checks do not establish that later browser result.

## Preserved delivery history

The following candidate and qualification records retain their original source, results, and checkpoint language. References to pending repairs or unassigned runs in those records describe that historical point. The completed candidate baseline and current comprehensive review status above take precedence.

## Historical candidate pull-verification failure and bounded repair — 21 October 2026

[Run 39537323749](https://github.com/TheUncleBen/Homepage-Studio/actions/runs/39537323749), push attempt 1, completed **failure** at 03:32:16 UTC on source `5509fc5d0c97b45d8784a887eaf80325975520ee`, tree `5b65083b5b8028a6f51d6608a88f3a646621fcab`. Both native jobs passed their complete qualification and retained the exact writer/renderer images. Each architecture passed 584 native files / 1,930 tests, 134 writer and 79 tooling/cleanup checks, 13 Python, 2 Docker-parser and 4 security checks, 17 Chromium scenarios, four Firefox/WebKit cases, real hidden-document timing **and cleanup**, exact newest-25 retention, direct Compose/Swarm and actual Portainer standalone/Swarm with full cleanup. Both native receipt ZIPs were downloaded and verified against their Actions digests and exact source/tree/run identities.

The separate [assembly job 119022378893](https://github.com/TheUncleBen/Homepage-Studio/actions/runs/39537323749/job/119022378893) reached authenticated delivery verification after index creation/readback and local bundle materialization. Pulling the second platform through the same writer index failed: `docker pull --platform linux/arm64` reported `cannot overwrite digest sha256:2122f70b39297997baa45d83f4816fbaa7e384a1f861e974ce88ed204a40606d`. The complete four-image pull check did not pass; anonymous metadata/layer checks were not reached, no delivery receipt was written and bundle upload was skipped. Retained native images and prior index creation do not establish a completed candidate or public availability.

The observed error matches the multi-platform digest-reference collision documented in [Moby issue 43188](https://github.com/moby/moby/issues/43188). The repair pulls each platform's already-verified **child manifest digest**, using Docker's supported [digest and platform options](https://docs.docker.com/reference/cli/docker/image/pull/). Registry index validation still binds every child manifest and configuration to the tested source/platform. Each of the four actual pulls must still match its expected configuration ID, operating system and architecture. Deployment templates retain immutable multiarchitecture index references. No image deletion, retagging, rebuild or skipped assertion is used to avoid the local reference collision.

The focused fixture reproduces `cannot overwrite digest` against the original helper; the repaired suite passes **27/27**, with zero failures or skips. Root independently repeated that suite, verified the failing baseline, reviewed the two changed code/test files, and passed two syntax checks and the whitespace check. The fixture models the Docker store contract; it is **not a live Docker pull**. Application code, workflows, Dockerfiles and deployment templates are unchanged. The repair parent is `5509fc5d0c97b45d8784a887eaf80325975520ee`; its new commit/tree and candidate run are unassigned until publication. Successful hosted delivery, exact bundle verification and anonymous availability remain required. No owner workflow approval is required; official dated publication remains after human acceptance.

## Historical candidate browser cleanup failure and bounded repair — 21 October 2026

This section preserves the preceding source-publication checkpoint. The later run above confirms that its browser-cleanup repair passed on both native targets; the separate pull-verification failure remains open.

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

The current pull-verification repair still requires exact-source hosted execution, completed registry delivery and bundle verification. Any subsequent run and bundle supply their own source-specific evidence; this immutable checkpoint does not claim their future result. Anonymous access is reported separately; if first-use GHCR visibility prevents access, completed images and the bundle are preserved while that account setting is addressed. No image rebuild or candidate workflow approval is required for a visibility change. Official date publication remains pending human acceptance. See [candidate delivery](docs/CANDIDATES.md) for the resulting handoff.

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

## Earlier environment and qualification limits

The earlier implementation environment had no Docker engine. Chrome for Testing 156.0.8078.4 and the pinned Playwright Firefox/WebKit builds were obtained from their official distributions and ran the historical checks recorded above. Those installations and results are not evidence that a later workspace has the same browsers. Container builds, Compose, Swarm, actual Portainer and architecture-qualified container execution require the hosted environment. A local production-process check is not Docker acceptance.

Both workflow paths run the actual two-image application, browser acceptance, Compose/Swarm lifecycle and pinned Portainer checks on AMD64 and ARM64 hosted runners. The successful hosted runs above establish those results for their exact sources. The revised candidate path must pass the same qualification before retaining the image pair through the repository's normal GHCR token. The separate pull-request validation path remains nonpublishing. Neither path creates an official date tag or release; the temporary Portainer registry is removed after qualification.

Owner testing in the intended private environment and on the physical phone remains a separate acceptance gate after all feasible engineering checks and image delivery are complete. Real external integrations were not contacted. Configuration support does not imply successful live testing of every native service. Native hidden widgets retain their own polling behavior. Representative calendar/chart/list/embed behavior has been checked in production browsers; aesthetic preference and physical gesture feel still require the owner.

Successful local native checks retain two existing upstream Vitest hoisting warnings and a native middleware-convention deprecation warning. They did not fail the pinned build, and the overlay-specific lint check has no warnings.

## Local UX safety review — 2026-10-21

This review starts from source `6cb481a7853c715e788d027c2dc4b0cd682917b1` and changes the frontend save/draft boundary. It does not repeat or inherit container qualification for the changed source. The isolated prepared native source uses the pinned native dependency graph and pnpm 10.34.7.

All 12 Studio component test files passed, totaling 43 tests, including seven new board-level regression scenarios and three additions to file-import/stack tests. ESLint passed for every changed Studio component and component test with no warnings. The delayed-write tests prove that arrangement controls cannot create edits which the completed request would discard, that a failed write retains its draft, and that healthy native input nodes retain identity. Editor tests cover dirty close/switch/Escape decisions, focus restoration, browser-departure guarding, retained invalid/non-serializable YAML, pending field/dismissal locks, and explicit Apply/successful-save bypasses. A native-refresh outage test verifies a committed write is not reported as an unsuccessful save or repeated on retry. The same-type deletion/reindex regression uses the native resolver, retains the matching old board/data pair hidden and inert during the outage, and verifies correct survivor content and native input identity after refresh. The existing lifecycle, gesture, adapter, geometry, routing, config-form and snapshot tests remain enabled and passed.

The browser configuration scenario now activates the native file chooser with Enter and verifies Cancel → Keep editing preserves the imported text, then Escape → Discard closes it without changing saved revision. That browser update has **not yet been executed for this source** in this isolated review; actual production-browser, merged-source and container qualification remain required. This change preserves the agreed Play/Pause-only stack controls and does not claim physical Samsung behavior or a completed accessibility certification. Independent periodic board/native polling received the follow-up verification below.

### Revision-correlated native rendering and draft provenance

The follow-up uses the additive `configurationRevision` contract to match the board's native locators to sanitized native data. The complete isolated Studio suite passed 52 tests across 12 files, including 16 board-level scenarios. Static analysis then identified a render-time ref read in the new matched-pair cache; it was replaced with guarded React render state, without disabling lint rules. The final 16 board regressions passed again, and ESLint passed for all four changed components/test files without warnings. The isolated runtime copied the combined review's current settings/appearance components read-only so the snapshot conflict test exercised the actual board-mounted `SnapshotEditor` with its new reload callback; those components remain owned and verified separately in the combined review.

The new fault scenarios cover both arrival orders of independent board/native polls; failed and successfully returned-but-mismatched native responses after a same-type widget deletion/reindex; preserved native input identity; retained arrangement and position-dialog drafts across native-file changes; invalid/missing native fingerprints; and a layout-only external change which leaves native content visible but submits the draft's original optimistic writer revision. The mounted snapshot test verifies that explicit conflict reload fetches fresh editor state even while native content is stale, does not repeat the restore, and supplies the new writer revision only on the user's next explicit restore. The existing dirty/pending/committed-save safety scenarios also remain enabled. Production browser and complete merged-image acceptance are still separate gates; these component results do not qualify container bytes or external integrations.

### Form value preservation and the modal test budget

The ConfigForm boundary now rejects cyclic values and non-finite numbers before propagating parsed YAML or object/array JSON into a configuration draft. The original text remains editable, the previous valid value is retained, and correction restores validity. Tests cover YAML `.inf`, `-.inf` and `.nan`, nested JSON numeric overflow, cyclic aliases, and recovery. Values which the pinned YAML parser returns as strings, including `1e999` and quoted `.inf`, remain strings. This prevents JSON serialization from silently turning an invalid numeric value into `null`.

The unchanged dirty-editor workflow first reproduced a 5,000 ms test timeout, with no failed behavior assertion. A temporary phase diagnostic of its valid-draft portion reached board readiness at 3.27 seconds, settings readiness at 7.58, queried controls at 8.32, and completed all assertions at 11.55; cumulative process CPU time was about 13.37 seconds. The measurements show CPU-heavy React/jsdom/query work rather than an application wait requirement. Temporary profiling was removed. The original single coherent workflow and all its assertions are preserved, with scoped/reused control queries and an explicit 15-second timeout for this test alone. Application timing, other tests and the global suite timeout are unchanged.

Final focused verification passed all 11 ConfigForm scenarios and the complete dirty-editor workflow; that workflow completed in 5.615 seconds. The other 15 board cases were outside this explicit focused selection, not counted as new passes. ESLint passed for all three changed source/test files without warnings, and whitespace validation passed. The combined full native suite remains a distinct integration gate.
