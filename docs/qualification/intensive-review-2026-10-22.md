# Intensive review checkpoint — 22 October 2026

**Status: corrections and local verification are recorded below; a replacement deployment candidate is not yet qualified by this record.** The previously successful hosted baseline remains historical evidence for its exact bytes. The `a52fd56` application has a local production build, scoped browser checks and measured performance comparisons. The subsequently confirmed light-theme contrast defect is corrected in `26f6cc54c104fd902270df38c13e069e50171a07`, native manifest `e28b3f85ecac741c25927f7da2423635646ad805017d28fa982c5797eba90dc7`; full local lint/build/compression and its focused production browser regression passed. Full frozen-source verification, both native architecture image qualifications and exact-image OS verification remain required.

This review deliberately treated existing passing tests as supporting evidence, not proof that implementation, interaction or security behavior was correct. It examined the controlled Homepage fork, one-container runtime, independent dashboard routing/storage/context, configuration transactions, native transport, gestures/playback, responsive arrangement, deployment and release gates. Reproductions used synthetic configurations and services; no live owner integration or private deployment was exercised.

## Source and verification bindings

| Subject | Exact binding and scope |
| --- | --- |
| Reviewed baseline source | `03e48b8bcd214a5de47aaea1d64fbad083c20edb`, tree `10fc033725483df4de6bf680b61a0412a64309e4` |
| Controlled upstream provenance | Homepage commit `51cc1684f9f34a7877ed462b8f94c9cc687b4dde` |
| Broad integrated native proof | Source `29d2c0be88e05eef4b22e2e23eab82441184ad34`; native source manifest SHA-256 `0374b2418ad5f43a6c19a0050c935d3adfcd65a0d4e303b110c0fe630fdbaa32` |
| Packaging/source-guard correction | `a5b75df0c85ee7aba2b54c998de5125f6ac554d4`; native source manifest unchanged |
| Later accepted-no-op correction | `82c5bc19bce153ad4eb865c8ef56405fa7498a43`; newer native source than the broad proof above |
| Mixed-width responsive-order correction | Integrated as `a52fd567b163208fefa241c46d7a15a14e0a5202`, from reviewed commit `87abf5af01ce3fed3db2b0d3a68c9ba0e8ec541d`; focused tests and independent parity checks below |
| Later production lint/build | Source `a52fd567b163208fefa241c46d7a15a14e0a5202`; native source manifest SHA-256 `6130e453ba86f8e726e551963b8763f63f1a0beb70bf517a0324cfc9ca7a6bc0` |
| Browser precondition correction | Test-only `4299a3103bc690a57a5147db7548362060050953`; the application under test remained the built `a52fd56` source |
| Light-theme description contrast correction | Reviewed source patch `83339ea90c76ea8186989cecee67002efd2cd4ed`, integrated as `26f6cc54c104fd902270df38c13e069e50171a07`; native manifest `e28b3f85ecac741c25927f7da2423635646ad805017d28fa982c5797eba90dc7`; full lint/build/compression and focused production regression passed |
| Final reviewed commit/tree/native manifest | **Pending**; final source and its complete qualification must be frozen and identified |
| Replacement workflow/image/artifact identity | **Pending**; no new hosted result or image digest is inferred from local passes |

The production application extracted from the exact published amd64 baseline was used for live baseline probes. Local native-process execution of that application is not a fresh Docker deployment. Later focused helper/controller measurements and the integrated local build are identified separately below.

## Historical successful baseline

[Workflow run 39781710031](https://github.com/TheUncleBen/Homepage-Studio/actions/runs/39781710031), **attempt 1**, successfully qualified the exact `03e48b8b` baseline. Its verification report records passed controller, packaging, native, dependency, Chromium, Firefox, WebKit, hidden-document, Compose, Swarm, Portainer Compose and Portainer Swarm checks on native linux/amd64 and linux/arm64 runners.

The candidate manifest records `engineering-qualified`, with human acceptance still pending. The delivery receipt records `public-ready`, authenticated pulls passed, and anonymous runtime-layer access verified by streamed SHA-256. It explicitly records `officialRelease: false`. These statements describe the retained baseline receipts; they do not qualify any correction made during this review or an official dated release.

| Baseline artifact | Binding |
| --- | --- |
| Application index | `ghcr.io/theuncleben/homepage-studio@sha256:e48d356cc240304c7522fa5d105f75038164647b11b900dd1d5001e39d9211f0` |
| amd64 child | `sha256:6db89ab1cfbb851f839b3bda359df729ea130070f19a3af7e6ef3b73ce7c5f55` |
| amd64 image config | `sha256:dcc3480fa6cf5a3488366d605783b7399899e03bc23e10162568cefac53b2276` |
| arm64 child | `sha256:273ee2cc4fa4d71f2528e50feb9e11cbfff71bcfeb9896ba759399bf99a5c177` |
| arm64 image config | `sha256:f82712ff829e13533982d214f53cade66a88b0970c1a3ea69b897852f0151fc4` |
| Corresponding-source archive SHA-256 | `789f21e0c278c2b4136861cb1a24f5f22e752eea31bd0b22f2b8a3392b1db98b` |
| Artifact-set SHA-256 | `6df05d35be49c5f26c92dfb2c4dab4acb60fe70de0dc46ede48622ed26cb2636` |

Earlier failed runs [39710951764](39710951764.md) and [39713698869](39713698869.md) retain their original failures. The later baseline success does not rewrite them, and the newly discovered defects show why that success is not a blanket correctness claim.

## Confirmed findings and corrective behavior

### Runtime and delivery

| Finding | Reproduction and correction |
| --- | --- |
| Discovery blocked unrelated local operations | A held native provider occupied the serialized configuration queue, delaying ordinary native forwarding and readiness. The store now captures context under the queue, performs one coalesced provider read outside it, and applies results only when native byte revision and private file identities still match. Replacement-and-rollback, layout-only saves and bounded retained/fresh membership are covered. |
| Complete-board freshness differed from ordinary edits | Complete-board submissions must attempt fresh membership because external sources can change without changing local file bytes. State/board/export reads and both board submission paths retain this refresh; structured/file-only edits, known-source visibility and restores use their existing revision/identity checks without a provider wait. Imports validate their archive and reset the destination cache. |
| Initial placement performed repeated all-rectangle scans | Large newly reconciled layouts blocked the controller event loop. A sparse 12-column occupancy index and per-size cursors preserve exact first-free row-major geometry. Tests compare against the original algorithm on deterministic mixed cases, stacks, stored overlaps and geometry ceilings. No panel schema, source identity or separate mobile layout was introduced. |
| Immutable assets were transferred without compression | The measured baseline asset set had no Content-Encoding. Build-time Brotli/gzip sidecars now cover eligible immutable text assets when smaller. Serving negotiates accepted encodings, validators and HEAD/304 responses and preserves filesystem confinement. Regeneration removes stale sidecars, including when a source becomes small. The production comparison below measured the corrected JS/CSS asset set at 294,119 transferred bytes versus 1,063,329 for the baseline. |

The fixes are internal corrections within the existing product contract. Nine-file ownership, journaled writes, native data/configuration revision pairing, independent dashboard identities, stable native hosts and owner-managed external authentication remain intact. The detailed behavior is maintained in [architecture](../ARCHITECTURE.md) and [feature acceptance](../FEATURE-ACCEPTANCE.md).

### Security and transport

| Finding | Severity and observed evidence | Corrective behavior |
| --- | --- | --- |
| Native actions bypassed the Studio-only origin guard | High. A browser-shaped cross-origin simple POST reached the exact baseline's configured Emby action and dispatched its authenticated downstream Pause request to a synthetic service. | Exact Origin and Fetch Metadata checks now apply to native `/api/` as well as Studio routes after dashboard selection. Root/named and encoded-path probes are covered. Same-origin native actions and direct clients without Origin remain supported. |
| Cross-origin redirects forwarded arbitrary credentials and retained bodies | High. An exact-image Syncthing redirect forwarded a synthetic API-key header; real-helper tests reproduced arbitrary credential headers, URL authentication and preserved login-body replay. | A change of scheme/host/port retains only public metadata, removes URL authentication and rejects a preserved body. A library rewrite to GET may continue after dropping its body. Same-origin behavior is preserved. |
| Cookie redirects crossed origin/path boundaries or poisoned sessions | High for cross-origin session movement; medium for parsing/expiry robustness. Source cookies were attributed to the destination, jar-owned headers could survive outside their Path, malformed cookies could throw, and deletion expiry could be extended. Peer review also reproduced two-port cookie resurrection and foreign overwrite of the source session. | Correct issuer/path/expiry handling; invalid cookies ignored; shorter/deletion expiry respected. Once a redirect chain leaves its original origin, all subsequent jar reads and writes stop, including later destination hops and intermediate/final Set-Cookie. |
| Secrets appeared in common diagnostics | Medium. Exact-image QNAP failure logged its session URL and then dereferenced absent data. Shared transport errors could expose URL-bearing causes; cache diagnostics logged arbitrary payloads, and some adapters put keys in URL paths. | Shared diagnostics retain only safe error code/message and network origin. Reviewed generic/credentialed/Jellyfin/QNAP/cache paths remove credential URLs or bodies; QNAP returns a controlled failure. This does not certify every custom adapter's payload or legacy debug log. |
| Native helper work outlived its caller without response bounds | Medium. A continuously streaming exact-image response remained open after the controller returned 502 at **61,281 ms**, and was still supplying bytes **2.5 seconds later**. | The shared helper enforces a **45-second total deadline** across its redirect chain, plus **32 MiB wire and 32 MiB decoded limits on the final response body**. Timeout, supplied abort, upstream abortion, decoding failure and overflow clear buffers and close the request/response/decoder. |

The origin reproduction used browser-shaped HTTP against the real native application; it was not a separate interactive-browser exploit or an evaluation of every browser's private-network policy. Transport regressions use real loopback helpers and synthetic credentials. A default-options real-clock proof of the corrected helper observed timeout at **45,101 ms**, the upstream socket closed, and **917,504 bytes** received before cleanup. That proof is a helper execution, not a newly built image acceptance. Timer scheduling can add delay to a configured deadline.

### Interaction and responsive editing

| Finding | Baseline observation and correction status |
| --- | --- |
| Mobile upward movement used desktop rows | At a 390×844 viewport, an upward drag of 264 px left a panel at top 264 px and created no draft when desktop columns shared y=0. The initial repair maps projected slots back to canonical geometry for pointer and keyboard movement. The later mixed-width ordering correction below preserves intended visible order when the first slot mapping produces a collision-driven inversion. |
| A short header press released outside could become a long press | A six-pixel movement beyond the header edge followed by release still entered editing and left playback waiting. Active-pointer release/cancel/blur/visibility/lost-capture tracking now disposes the pending hold and blocker. |
| Quick Launch did not freeze playback or cancel an already-held title | The baseline advanced a stack after 2.5 seconds while the modal was open; a held-title regression also entered editing behind it. Explicit overlay state now freezes remaining playback time, closes the picker and cancels pending holds/active arrangement without unmounting native content. |
| A second finger did not cancel arrangement | Real touch input at 390×844 left the drag active and its draft changed after another finger arrived. The repair cancels the active manipulation, restores the original draft and removes capture/listeners. |
| Loop wrap reversed the transition direction | Forward last-to-first movement sent the outgoing panel in the wrong direction. Explicit transient direction and previous identity now drive wrap, autoplay and rapid reversal while keeping native hosts mounted. |
| Pending clean restore/import did not protect departure | A beforeunload regression was not prevented during an in-flight restore despite locked modal controls. Pending/save refs now join dirty-state protection, while successful committed navigation uses current refs. |
| Same-cell movement created avoidable render work | Each of 120 same-cell pointer moves rebuilt unchanged panel objects and submitted the same arrangement. The repair preserves unchanged object identities and skips repeated snapped cells. Baseline frames were generally smooth; this is not evidence of universal baseline jank. |
| A later optimization rejected an accepted no-op | Returning false for an unchanged board prevented normal completion of an unchanged position edit. Commit `82c5bc1` accepts it without redundant submission. Its focused board-safety file passed **24 tests**; it postdates the broad native proof. |
| Mixed-width projected movement still changed intended order | Independent review of the initial repair found A/B/C widths 3/4/3 could move A one mobile row down but produce B/C/A; widths 3/3/4 could move C first but reorder the remaining A/B. IDs, dimensions and collision freedom were retained, but intended visible order was not. The repair integrated as `a52fd56` retains the original slot result when its projected order is already correct and resolves only actual inversions while preserving dimensions, stable identities and bounds. The combined focused files passed **38 tests**; independent review checked **3,386 moves across 80 deterministic boards** and **160 unchanged pre-move projections**. Final complete-source and image qualification remain pending. |

The geometry peer check binds source SHA-256 `09a867eb1392291d05f5103bbf73ee6502da4ba9de21f45cf3c31769a8e6c670`. Its 354 px and 700 px cases cover insertion order, input immutability, canonical/projected collision freedom, bounds, dimensions, panel/stack identity order, membership and unchanged distant units. The two focused files and changed-file lint passed; these are not a replacement for a final complete suite.

A later local Chromium run executed **15 selected production cases** against the `a52fd56` build: 12 new interaction cases and three native-content/state cases. It recorded **14 passed and one failed in 37.9 seconds**, with retries disabled. The failure required a narrow-toolbar secondary status label to be visible even though the existing responsive CSS hides it. The test-only `4299a31` correction checks that the dirty status exists and Save is enabled, preserving subsequent cancellation/rollback assertions. The one affected case then passed in **1.4 seconds**, also with retry zero, on the same application. The initial failed run remains failed; this is separate focused evidence, not a rewritten 15/15 whole-run result. Earlier `--list` output is not counted as execution.

### Later light-theme contrast finding

A settled-state review of the `a52fd56` production application confirmed a narrow readability defect in default slate light mode. Computed foreground colors and sampled rendered backgrounds produced description contrast ratios of **4.224:1** for a service normally, **3.997:1** when its card was hovered, and **4.431:1** for a hovered bookmark. These fall below the **4.5:1 normal-text threshold** described in [WCAG 2.2 SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). The measurements describe this controlled default-theme fixture, not every custom background or palette.

The first pale service-title capture was taken during an existing **150 ms color transition**. The retained trace first observed its settled dark foreground at approximately **160.9 ms**; the settled title measured **9.116:1**. That transient capture does not establish a persistent title-color defect and is not the target of this correction.

Reviewed source patch `83339ea90c76ea8186989cecee67002efd2cd4ed`, integrated as `26f6cc54c104fd902270df38c13e069e50171a07`, adds seven CSS lines. Fully zero-specificity selectors target only native service/bookmark descriptions inside the Studio board under **light mode and the default slate palette**, using **shade 600**. Other palettes, dark mode and semantic status colors fall outside the selectors; ordinary explicit custom CSS retains precedence. Native manifest `e28b3f85ecac741c25927f7da2423635646ad805017d28fa982c5797eba90dc7` passed complete lint (**36.501 s**), production build (**53.330 s**) and static compression (**0.417 s**), unchanged before/after. The focused production case passed **1/1 in 7.7 s**, with zero retries/skips/flaky cases. Description contrast increased to **6.726:1 normal / 6.365:1 hovered** for services and **7.056:1 hovered** for bookmarks. Across the seven sampled text selectors from all four panel kinds, the lowest recorded ratio was **6.365:1** in light/hover and **9.370:1** in dark. Device-following mode, reload, actual green/red status dots, explicit white/green palettes and ordinary custom CSS on both description selectors after a theme save all passed. The failing-first run and settled screenshots are retained; complete final-image qualification is still required. Existing build, browser and performance results remain evidence for their recorded earlier source; no accessibility-conformance claim for the whole application is made here.

## Measured responsiveness and work

### Discovery contention

These are actual controller/store HTTP requests against a synthetic provider held for 1.2 seconds. They compare the baseline implementation with the reviewed queue correction on the same review host.

| Operation while discovery is held | Baseline | Corrected helper/store |
| --- | ---: | ---: |
| Ordinary native GET | 1,205.48 ms | 5.61 ms |
| Configuration readiness | 1,223.17 ms | 20.90 ms |
| Explicit board read, which requires a discovery attempt | 1,229.91 ms | 1,215.88 ms |

Before correction, neither unrelated local operation finished before provider release. After correction, both did. The discovery client has a separate five-second metadata deadline after worker acquisition; these timings do not erase cold-worker startup or the intentional wait on an explicit refresh. HTTP regressions also hold a real provider while eight structured/restore operations complete, while both complete-board POST paths reject newly omitted external membership.

### Initial placement

Each count ran in a fresh Node v24.19.0 process, with independently asserted expected geometry and verified original/fixed source hashes. This measures server placement work, not browser rendering of thousands of widgets.

| New panels | Baseline initial placement | Corrected initial placement | Corrected persisted layout |
| --- | ---: | ---: | ---: |
| 100 | 12.484363 ms | 0.945681 ms | 0.306850 ms |
| 300 | 90.291190 ms | 1.799412 ms | 1.031009 ms |
| 600 | 705.200949 ms | 3.584894 ms | 1.197038 ms |
| 2,050 | Not rerun as a standalone baseline measurement | 7.026102 ms | 2.838282 ms |
| 4,096 | Not rerun as a standalone baseline measurement | 8.368998 ms | 3.639095 ms |

Parity coverage includes 250 deterministic single-placement fixtures, 100 mixed reconciliation fixtures, varied dimensions, stacks/collapse, overlapping stored positions and sparse high coordinates. The large-board regression runs in a separate process with a hard timeout. An earlier 76.55-second retained-union test included multiple reconciliations and a prior discovery implementation; it is not substituted for a comparable single-operation baseline.

### Production browser work and asset delivery

The exact baseline application and the corrected `a52fd56` production build were profiled locally on amd64 with Chromium **156.0.8078.4**, synthetic widgets and normal/relative 4× CPU slowdown. Each board size used three trials at each CPU setting, with **120 same-cell pointer moves per trial**.

| Board size | Baseline React commits / native panel memo executions per trial | Corrected commits / native executions per trial |
| --- | ---: | ---: |
| 32 panels | 121 / 3,840 in all six trials | 1 / 0 in all six trials |
| 60 panels | 121 / 7,200 in all six trials | 1 / 0 in all six trials |

The React DevTools hook recorded commit events and native-panel memo fibers marked as having performed work; these counts are instrumentation observations, not field interaction metrics or a claim to count every JavaScript function call. The corrected trials also recorded zero panel-prop changes. Baseline and corrected frame p95 remained **16.7–16.8 ms**; maximum intervals reached **33.4 ms** and **33.3 ms** respectively at 4× slowdown. Neither set recorded long tasks, and both had a largest recorded interaction duration of **56 ms**. The demonstrated improvement is removal of repeated no-op rendering work; the measurements do not establish universal baseline jank or a lower field interaction metric.

Single unthrottled readiness observations were **414.151747 / 322.780121 ms** for baseline 32/60 panels and **383.494345 / 267.044678 ms** for corrected 32/60 panels. These single observations are not a statistical load-time comparison or evidence that more widgets are faster. The separate controlled-network series below provides repeated samples under its stated conditions.

| Measured asset set | Baseline decoded / transferred bytes | Corrected decoded / transferred bytes |
| --- | ---: | ---: |
| 15 JS/CSS/build-manifest assets | 1,063,329 / 1,063,329 | 1,068,552 / 294,119 |
| Complete 16 static resources including the font | 1,117,213 / 1,117,213 | 1,122,436 / 348,003 |

These are actual delivered sizes. Eligible corrected assets returned Brotli; three small assets remained identity-encoded. The corrected asset report's **293,683-byte** sum of offline Brotli estimates is not the delivered total and is not used in the comparison. The larger decoded bundle is shown explicitly; the measured transfer reduction comes from build-time compression. Distinct asset sets are kept separate.

A controlled-network comparison used **60 native synthetic panels**, warm native workers, a fresh browser cache for each sample, **80 ms emulated latency**, **1.6 Mbps download** and **750 kbps upload**. Three samples per version alternated order. Baseline ready times were **6,379.560617 / 6,250.104733 / 6,261.860407 ms**, with median **6,261.860407 ms**. Corrected times were **2,525.891211 / 2,396.969466 / 2,419.031202 ms**, with median **2,419.031202 ms**. No browser errors were recorded. Resource snapshots at readiness contain 15 or 16 static entries because a **555-byte late chunk** had not completed in every sample; they are not substituted for the complete asset totals above.

### Dense native stack motion

A separate three-member stack used actual native **Calendar and Glances chart/process components**, with synthetic intercepted provider responses. Each version completed **18 transitions at 1× CPU and 18 at relative 4× slowdown**, including forward/reverse navigation. The chart and process content were present, native hosts retained identity, exactly one panel remained exposed, and runtime navigation preserved the dashboard revision and snapshot inventory.

| Dense motion measurement | Baseline | Corrected |
| --- | ---: | ---: |
| Frame p95 at 1× / 4× | 16.7 / 16.7 ms | 16.7 / 16.8 ms |
| Maximum frame interval at 1× / 4× | 16.8 / 33.3 ms | 16.8 / 33.4 ms |
| Largest recorded interaction at 1× / 4× | 24 / 40 ms | 24 / 40 ms |
| Long tasks over 50 ms / browser errors | 0 / 0 | 0 / 0 |

These results support smooth local stack motion and preserved runtime state under the exercised conditions. They are not field INP, physical-device acceptance, live-provider connectivity tests, cold-worker startup measurements or final-image qualification. The static-asset helper's separate HTTP regressions cover Brotli/gzip round trips, q=0/wildcard/identity negotiation, HEAD, weak/list validators, 304/406, nonregular sidecar fallback, filesystem confinement and stale-small-asset removal.

After the completed board profile, the execution service disconnected; both local application endpoints were then unreachable and their recorded sessions could not be resumed. The first network-comparison attempt then failed with connection refusal **before any sample**, retained under `interrupted-runtime-attempt`. The unchanged applications/configurations were restarted and their workers warmed. The subsequent sequential network, baseline dense-motion and corrected dense-motion checks all exited **0**, completed at **15:00:00 UTC**. The interrupted receipt remains a failed attempt and is not included in the successful sample set.

| Remaining browser acceptance | Status |
| --- | --- |
| Selected patched production Chromium interaction cases | Initial **14/15**, then the corrected test precondition passed **1/1** on the same `a52fd56` build; complete suite and final-image qualification remain pending |
| Cross-engine and hidden-document results for corrected source | **Pending** |
| Physical-device swipe/scroll feel and visual approval | Owner acceptance after engineering qualification |

## Executed local verification and retained failures

| Check | Observed result | Exact scope |
| --- | --- | --- |
| Broad integrated native tests | **599 files / 2,086 tests passed; zero failed or skipped** | Source `29d2c0b`, manifest `0374b241…`; run 14:29:59–14:34:24 UTC, source manifest unchanged before/after |
| Full native lint | **Exit 0** | Same source and native manifest |
| Production standalone build | **Exit 0** | Same source and native manifest; immutable sidecar generation also exited 0 |
| Complete controller suite after wrapper correction | **219 passed, zero failed/skipped; exit 0** | Source `29d2c0b`; the following packaging step still failed in that aggregate |
| Packaging/release tooling after assertion correction | **89 passed, zero failed/skipped; exit 0** | Source `a5b75df`; no production behavior, dependency pin or test budget was relaxed |
| Python corresponding-source tests | **4 passed; exit 0** | Source `a5b75df` |
| Actual local Swarm parser invocation | **Exit 1; 0/2 tests passed** | Docker executable absent: `spawn docker ENOENT`; no actual parser result or application defect established |
| Clean Docker/source-input guard | **Passed** | Exact source `a5b75df`; final later source still needs its own check |
| Later no-op position-edit focused file | **24 tests passed** | Correction now integrated as `82c5bc1`; does not extend the older whole-source native test result |
| Combined no-op/mixed-size geometry focused tests | **2 files / 38 tests passed**, changed-file lint passed | Reviewed source `87abf5a`, integrated as `a52fd56`; independent 3,386-move/80-board and 160-projection checks bind the exact geometry hash above |
| Later full native lint, production build and compression | **All exit 0**; 34.551 s / 48.951 s / 0.365 s respectively | Source `a52fd56`, native manifest `6130e453…`; run 14:48:31–14:49:55 UTC, source manifest unchanged before/after |
| Selected patched production Chromium cases | **14 passed / 1 failed**, 37.9 s, retries 0 | Same `a52fd56` application; failed narrow-toolbar visibility precondition retained |
| Corrected touch-cancellation precondition | **1 passed**, 1.4 s, retries 0 | Test-only correction integrated as `4299a31`; same `a52fd56` application and retained rollback assertions |

The following validation failures remain part of this review's evidence:

1. The first integrated controller invocation failed **three readiness assertions**. The review wrapper supplied the integration build revision, while those isolated HTTP fixtures deliberately identify their native peer as `unreleased`. The wrapper was corrected to reserve build variables for native build/tests. The complete controller suite then passed without changing assertions or budgets. The failed receipt and log were retained; this is not relabeled a pass.
2. The next controller/tooling aggregate passed **219 controller tests**, then packaging passed **88/89** and failed an old exact Dockerfile COPY-string assertion. The build now copies the compressor alongside the pinned installer. Commit `a5b75df` checks the required input paths and compression command without requiring the COPY instruction to contain only two files. The aggregate remains failed; the later 89-test tooling pass is separate evidence.
3. The later tooling/Python/Swarm sequence passed **89 tooling checks and four Python tests**, then failed when the actual Docker parser could not start. The missing executable also caused the negative parser assertion to fail. The sequence's receipt correctly remains failed. No mocked parser, skipped gate or adjusted timeout substitutes for the mandatory hosted Docker/Swarm check.

4. The 15-case patched production Chromium run passed 14 cases and failed the touch-case visibility precondition. The recorded responsive CSS, test-only correction and one-case retry-zero result explain the follow-up; they do not change the original run into a success. The full hosted browser gate remains mandatory.

The 2,086-test broad native suite precedes `82c5bc1` and the mixed-width correction. The later `a52fd56` lint/build, 38 focused tests and selected browser executions add scoped evidence; they do not extend the older whole-suite result to all later source. Final complete-source verification remains required. Earlier historical listener-permission, browser, workspace-interference and hosted audit failures remain preserved in [VERIFICATION.md](../../VERIFICATION.md) and their original records.

## Dependency and OS review

Fresh controller `npm audit --omit=dev` and pinned pnpm 10.34.7 native `audit --prod` completed at **13:52 UTC on 22 October 2026**, reporting zero advisories; the native audit covered 403 production dependencies. These checks used unchanged lockfiles and the verified pinned toolchain. Their advisory data and scope are distinct from OS package review.

Both exact baseline architecture children above were scanned remotely with verified official [Trivy 0.76.1](https://github.com/aquasecurity/trivy/releases/tag/v0.76.1), using the same database updated at **2026-10-22T13:15:26.425424764Z**. The binary tarball matched both its official release digest and published checksum: SHA-256 `c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0`. Reported image config digests match the baseline manifest. Scanning inspected OS packages remotely; it did not execute either architecture or scan every application component.

Each image contains **93 Debian 12.15 packages** and has **256 package/CVE matches representing 120 unique advisory IDs**. Counts below apply to each image separately; repeated source-package findings are not independent demonstrated exploits.

| Reported severity | Bookworm fixed version available | No Bookworm fixed version reported |
| --- | ---: | ---: |
| Critical | 3 | 1 |
| High | 4 | 58 |
| Medium | 6 | 95 |
| Low | 0 | 88 |
| Unknown | 0 | 1 |

All **13 fix-available findings** concern inherited `perl-base 5.36.0-7+deb12u3`, fixed by **`5.36.0-7+deb12u4`**. Official Debian security indexes independently confirmed that version for amd64 and arm64. Commit `c6794d1` explicitly includes perl-base in the existing runtime apt install. It does not migrate the base distribution or run a blanket upgrade. **The installed replacement version and disappearance of those 13 findings remain pending exact-image rescans.** [Debian's Perl record](https://security-tracker.debian.org/tracker/source-package/perl) is the vendor reference.

The remaining Critical zlib/MiniZip finding is explicitly non-applicable to the installed Bookworm binary according to [Debian's build notes](https://security-tracker.debian.org/tracker/CVE-2023-45853). One fix-available Critical Perl advisory requires a [32-bit Perl build](https://security-tracker.debian.org/tracker/CVE-2026-8376); the supported images here are amd64/arm64. The 58 remaining High matches collapse to 12 advisory IDs, including repeated util-linux source matches and privileged/local utility, account-management, Perl-module or DTLS prerequisites. No additional demonstrated reachable, Bookworm-fixable High/Critical OS issue was identified in the bounded application review. The raw findings remain recorded without blanket suppression. Medium/Low/Unknown findings were not individually reproduced or dismissed.

This is a package/advisory inventory with vendor-informed triage, not proof that every remaining advisory is harmless or that every custom integration has been audited. A future database or new image may produce different results. Replacement scans must record their exact child/config digests and database time rather than reusing baseline receipts.

## Retained trust and compatibility limits

- The shared HTTPS agent and the separate TrueNAS WebSocket path retain `rejectUnauthorized: false`. They encrypt traffic without rejecting an untrusted certificate. No exposed setting enables certificate verification for the shared helper, and `NODE_EXTRA_CA_CERTS` does not override that explicit false setting. The separate Docker client's CA/client-certificate configuration does not change widget HTTP behavior. This is a retained compatibility/security decision, not a defect silently fixed by the redirect guard.
- Each dashboard's direct-request cookie jar retains normal domain/path semantics; it is not isolated per integration or port. Only a redirect chain that crosses origins triggers the new sticky suppression of jar reads/writes. Configure a canonical endpoint for authenticated services.
- The 45-second deadline belongs to one shared-helper call across its redirects. The 32 MiB caps concern its final response body, not bytes summed across redirect responses. Concurrent calls and multi-step login/retry adapters have separate budgets; concatenation can transiently retain chunks and the final buffer. These are not aggregate endpoint or process memory limits, and separate transports do not automatically inherit them.
- Origin/Fetch Metadata checks are not authentication. Direct no-Origin clients remain supported; same-origin trusted editors can manage the deployment. Slugs are addresses, not user authorization boundaries. Reverse proxy, DNS, TLS termination and external access control remain owner-managed.
- The common diagnostic fixes do not certify every custom adapter's error payload or legacy debug log. Trusted editor/export endpoints intentionally expose inline configuration to their authorized deployment users. Live private-service interoperability and credential/network setup remain outside synthetic test coverage.

## Pending final qualification fields

| Required final evidence | Current status |
| --- | --- |
| Mixed-width visible-order repair and focused regression | Implemented as `a52fd56`; 38 focused tests and independent geometry checks passed |
| Light-theme description contrast correction | Integrated `26f6cc5`; fresh full lint/build/compression and focused 1/1 production browser regression passed. Service description normal/hover 6.726/6.365; bookmark hover 7.056. Final image gates remain required. |
| Final corrected source commit/tree and native source manifest | **Pending** |
| Full native lint/production build after later corrections | Passed for `26f6cc5` and native manifest `e28b3f85ecac741c25927f7da2423635646ad805017d28fa982c5797eba90dc7`; final publication source binding still required |
| Final complete native test suite after later corrections | **Pending**; the broad 2,086-test result belongs to the earlier native manifest |
| Final clean-input guard and corresponding-source archive/hash | **Pending** |
| Executed patched production Chromium suite and new interaction cases | Selected local cases recorded as **14/15 plus 1/1 focused**; complete suite/final-image gate **pending** |
| Firefox/WebKit and real hidden-document qualification for final source | **Pending** |
| Local comparative browser/asset measurements | Completed for the `a52fd56` production build with exact baseline comparison, retained interruption and scoped figures above; not final-image or physical-device evidence |
| New first-attempt hosted workflow on native amd64 and arm64 | **Pending** |
| Actual final-image Compose/Swarm/Portainer lifecycle and parser gates | **Pending**; the local missing-Docker attempt remains failed |
| Replacement application index, child manifests and image config digests | **Pending** |
| Exact replacement OS inventory, installed Perl version and both rescans | **Pending** |
| Final artifact-set/source hashes and anonymous runtime-layer receipt | **Pending** |
| Owner's physical-device, appearance, real integrations and host acceptance | Pending after a complete engineering handoff |

A deployment-ready recommendation requires the completed exact-artifact evidence above. A later successful result should be added with its own binding and should preserve this checkpoint's failed attempts and source limits. Official dated promotion remains a separate owner-approved operation that reuses accepted image bytes.

## Selected retained evidence fingerprints

These filenames identify retained review records. Hashes bind the evidence at this checkpoint; they do not make a mutable working filename proof for a later source revision. The full private engineering archive is not required to understand the scope and outcomes described above.

| Record | Filename | SHA-256 |
| --- | --- | --- |
| Baseline candidate manifest | `candidate-manifest.json` | `d543e885853ce873603fa5443e5f31ac2d8fdbb70980b1f694f8ec72876833e2` |
| Baseline verification report | `verification.json` | `38c5c451460b1f5f71c18366b4d80426d72f1795d255045f268d0935f525120b` |
| Baseline delivery receipt | `delivery-receipt.json` | `2a5e3f127950d76d07b6666bb984bc09472b0e302d1141358010bb1dccda9ccf` |
| Native tests receipt | `native-tests-result.json` | `65faadc7c58b6a81fe5ad511a5735836a7fae7ca2fb4848307c1bcc74b110209` |
| Native lint/build receipt | `native-build-result.json` | `cdca79240c40cff423bdd8ce00a1a65a34759755cec796c4a693dff1066e5423` |
| Controller/tooling failed aggregate receipt | `controller-tooling-result.json` | `21fbdf5eee8871a75ecfbc056bd95bceaf0b3cbe93dc0eb85e58334e6e05797c` |
| Tooling/Python/Swarm failed aggregate receipt | `tooling-only-result.json` | `84f5df11450e93ed479a0a9b698affaded9693555b9eee9f8f23ccca3edcddd1` |
| Clean source-input result | `source-check-a5b75df.log` | `2a42ba59295a8ccd2bcf404e7368887b737eb1b679e987e6fc71c09e887c37d7` |
| Placement comparison | `board-initial-placement-comparison.json` | `810e90ed0e9cc00e8ec689e90e1f68f29569db885ad7a371225def6f5eb82c27` |
| Discovery baseline | `discovery-head-of-line-evidence.json` | `757c198e9e2b0414e0224af835b7dd0d242534782b5546455f1181e95e839709` |
| Discovery correction | `discovery-head-of-line-fixed-evidence.json` | `2cebb9d2e96240d1c4f0021d35697fc012a7c00c804f15e50de201a62e4f2d14` |
| Browser performance baseline | `baseline-board-performance.json` | `3450ff29e18ffdbde87b5e1b388c08a1671f9941939ddd9dc34aa3f5c644f5e6` |
| Asset transfer baseline | `baseline-asset-transfer.json` | `1c48ca84dbe4eabbaf32f385c2e104e44b24880e0be68515cf42e8bb458d1b18` |
| Baseline amd64 OS report | `baseline-os-amd64-trivy.json` | `0bbcf3cfd7538f4e6b1cd5ee2471ac32cf9d7b1d9375f333c8cb3f0daa5f2592` |
| Baseline arm64 OS report | `baseline-os-arm64-trivy.json` | `af1a22b4feb5dfc2ec2139ff16629091ae035767b7e2cefa6c9d67f7ea386cb3` |
| Later native production lint/build receipt | `native-build-final-result.json` | `ca87aedab39147263fa02645cdb81a483094c14dba9d1e8ddc0facf8ce4c2578` |
| Geometry independent peer check | `ux-geometry-peer-check.json` | `67665829cb4134ca9d3567aaef245f867fb02c7ffaea93c84712812e63401b80` |
| Combined focused UX tests | `final-followup-tests.log` | `47617ad73c3e69c78e86290c2c69d9c394d4095554d025dfb1d7f4e854fb735f` |
| Initial selected patched browser run | `browser-results-initial.json` | `4f5b8e86fc5e2e506c23778db2cd054adc242233ab46cc29f959039f29e687e8` |
| Focused corrected touch browser run | `touch-browser-results.json` | `6a6014672c7591ca5d103bcb94757098ea2abbf80213101e01f109369d85994d` |
| Corrected browser work | `patched-board-performance.json` | `dd9c7eb243fde87cde6b4816ad55f1f2af2cbda97f94f036581dba423bd68bde` |
| Corrected actual asset transfer | `patched-asset-transfer.json` | `b55f861b28e207c97a017bcf54e0b3be515a3edd3f7849596b03be6964a3e3fb` |
| Controlled network comparison | `delivery-network-comparison.json` | `f867d85a3c32b310d422070eca2235207e2369059b6815119a01181d90e76f4d` |
| Baseline dense native motion | `baseline-dense-motion.json` | `b55fa169756f8daa6d3f167de2ad4d8ecf77c20faf690ab923abb60bc369249d` |
| Corrected dense native motion | `patched-dense-motion.json` | `7231bdd3f4dd54f35bfc9a88153eb2261053aa956928c08cbd4776783eee967e` |
| Completed performance sequence | `performance-completion.json` | `91b546b63c8e551f09113065f942ae636b02d09a29d8585c26327a0f4e28054f` |
| Interrupted performance sequence | `interrupted-runtime-attempt/performance-completion.json` | `c3b3f8afe97f579bd1090cd00e7f297421692d4c16b88003bb8b97cdac854909` |
| Interrupted no-sample network attempt | `interrupted-runtime-attempt/delivery-network-comparison.log` | `2e41d603dac8f2768a7bb6785b02739ac47417154b58f4e31a8bb5cf3a089ce4` |
| Default-theme contrast before correction | `native-palette-contrast.json` | `d0e154ba41e9ae4b8ee0656fbb91e9e4896febea18a7a689b361fbcdf658b595` |
| Light title transition trace | `light-transition-check.json` | `881d4446e01c9e43f2e44d4f1f036fc8532a043f8406b854804fcbb7c46cabc1` |
| Light-theme final local build receipt | `native-build-palette-result.json` | `e6aae5845ae813f3c8a93d431d2d906ad8a257adf01531257cc296ae1b599f0f` |
| Light-theme after-correction measurements | `native-palette-contrast-after.json` | `8faaaa544246ebbf75b5112ec2274f5f9a320f13c7ca3012f3246956a2bfad91` |
| Light-theme after-correction browser report | `palette-browser-results-after.json` | `2ab4eef4ea71b133b365d11daa79a3ba537b11f8f121470b401d0166ec6ad85e` |
