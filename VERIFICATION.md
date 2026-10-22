# Verification evidence

## Capture correction — local browser verification passed

The reviewed owner-aware capture repair is integrated at `d68d261e03422b0daf1ce7a40dfa252270c4193a`, native manifest `65d4b442829e3933cedd8a593ada80fcb5b5ac9d39f65b8eb09c6d3a4825b8c9`. Full local lint/build/compression passed; all **38 Chromium cases passed with zero retries, skips or flaky results**, including the two unchanged swipe failures and stronger held-title arrangement case. The preceding **37/38** local invocation remains a recorded runner setup failure: it omitted the existing local widget-fixture URL override. Source, assertions and budgets did not change between those invocations. See the [detailed correction checkpoint](docs/qualification/intensive-review-2026-10-22.md#capture-correction--complete-local-production-browser-checkpoint).

This local production-process evidence does not qualify a container candidate. A new frozen publication and complete first-attempt native architecture matrix, lifecycle, exact-image/source/artifact and OS verification remain required.

## First intensive-review replacement attempt — failed

[Run 39805250061, attempt 1](docs/qualification/39805250061.md) failed for exact
source `fe8e56f782e5498c8cb4f2c987bd5fa7c4456270`, tree
`849ad0e8ddd94144ac5bf7b279c526d31178ebf9`. Each native architecture passed 219
controller, 89 tooling, four Python, two actual Swarm-parser and four native
redirect-security checks, plus all **599 native files / 2,091 tests**, lint,
production build, audits and the source-input guard. Both then recorded
**36/38 Chromium passed, two failed, zero retries** at the same mobile-swipe
advancement assertions; all 13 review-added browser cases passed within the 36.

The real local event trace confirms that the review-added cancellation watchdog
mistook an implicit child-to-shell pointer-capture transfer for actual capture
loss. This product regression affects both architectures. Its correction and complete local Chromium result are recorded above;
full container requalification remains **pending**. Firefox/WebKit, hidden-document,
the later retention/Swarm lifecycle gates, Portainer and delivery were not
reached; no qualified replacement image was retained and no replacement OS scan
was run. The mandatory gates and retry/assertion budgets remain unchanged.

The local checkpoint below predates this hosted attempt and retains its original
results and source limits. The failed run has its own full record; it does not
erase earlier failed invocations or qualify the subsequent repaired source.

## Intensive review checkpoint — 22 October 2026

The [intensive review record](docs/qualification/intensive-review-2026-10-22.md)
records newly reproduced security, runtime and interaction defects, their
corrections, measured baseline/corrected helper behavior, retained trust limits,
and the remaining qualification gates. **A corrected replacement image is not
yet qualified by this checkpoint.** Historical run 39781710031 passed for source
`03e48b8bcd214a5de47aaea1d64fbad083c20edb`; it does not qualify subsequent changes.

| Current local evidence | Observed result and binding |
| --- | --- |
| Broad native lint/tests/build | Full lint and production build exited 0; **599 files / 2,086 tests passed, zero failed/skipped**, at source `29d2c0be88e05eef4b22e2e23eab82441184ad34`, native manifest `0374b2418ad5f43a6c19a0050c935d3adfcd65a0d4e303b110c0fe630fdbaa32` |
| Controller | **219 passed, zero failed/skipped** after correcting the review wrapper's fixture build-revision override; the original three readiness failures remain recorded |
| Packaging/tooling and Python | **89 tooling checks and four Python tests passed** at `a5b75df0c85ee7aba2b54c998de5125f6ac554d4`, after the old exact COPY assertion was corrected; the original 88/89 packaging failure remains recorded |
| Actual local Swarm parser | **Failed: `spawn docker ENOENT`; 0/2 passed**. Docker was absent, so no actual parser/application failure was established. The combined sequence remains failed and hosted execution is mandatory. |
| Clean source-input guard | Passed at exact source `a5b75df`; a later final source requires its own guard |
| Newer native corrections | Accepted-no-op patch `82c5bc19bce153ad4eb865c8ef56405fa7498a43` and mixed-width order correction `a52fd567b163208fefa241c46d7a15a14e0a5202` postdate the broad native tests. Combined focused files passed **38 tests**; independent review checked **3,386 moves / 80 boards / 160 unchanged projections**. |
| Later native production lint/build | Both passed at `a52fd56`, native manifest `6130e453ba86f8e726e551963b8763f63f1a0beb70bf517a0324cfc9ca7a6bc0`; compression also passed. The complete test rerun for later source remains pending. |
| Selected patched production Chromium cases | Initial **14/15 passed**, then **1/1 focused passed** with a test-only narrow-toolbar precondition correction integrated as `4299a31`; retries 0 and the same `a52fd56` application. The initial failed run is preserved, not relabeled 15/15. |
| Measured local performance | At source `a52fd56`, for 32 and 60 panels, all six corrected same-cell trials at each size recorded **1 React commit / 0 native panel memo executions**, versus baseline **121 / 3,840** and **121 / 7,200**. JS/CSS delivered bytes fell **1,063,329 → 294,119**. Three alternating samples under the recorded emulated network gave median ready time **6,261.860407 → 2,419.031202 ms**. Actual native dense-stack motion retained hosts/revision/snapshots, with frame p95 **16.7–16.8 ms** and no observed long tasks/browser errors. These are local production traces, not field INP or physical-device proof. |
| Later light-theme finding | Settled default-slate service descriptions measured **4.224:1 normal / 3.997:1 hover**, and bookmark hover **4.431:1**. Scoped default-slate patch `83339ea` is integrated as `26f6cc54c104fd902270df38c13e069e50171a07`; native manifest `e28b3f85ecac741c25927f7da2423635646ad805017d28fa982c5797eba90dc7` passed fresh full lint/build/compression and the focused **1/1 production browser case**, retry zero. Service description contrast is now **6.726:1 normal / 6.365:1 hover**, bookmark hover **7.056:1**; dark/system/status/explicit palettes/custom CSS checks passed. The pale title screenshot was explained by the existing 150 ms transition, not a persistent title-color defect. |
| Advisory review | Fresh controller/native production audits reported zero advisories. Exact baseline OS scans found an available Perl package update; the Dockerfile correction is implemented, but the replacement package version and both exact-image rescans remain pending. |

The controller/tooling aggregate that encountered the packaging failure and the
later tooling/Python/Swarm aggregate that lacked Docker are **failed aggregates**,
even though individual earlier steps passed. Their receipts and the initial
wrapper-related failure are preserved. No gate, assertion budget or retry policy
was relaxed to reinterpret them as successful complete runs.

Complete native/browser reruns for the frozen source, both native architecture
hosted image qualifications, exact replacement OS scans and public-ready artifact
delivery are **pending**. The local performance comparisons for `a52fd56` are complete; an
interrupted attempt failed before sampling when both local application endpoints were unreachable,
and remains recorded separately from the subsequent successful measurements.
The later local build and selected browser executions have their own bindings;
earlier `--list` output is not counted as execution. The detailed review record
contains explicit fields for the final source, workflow, image/config digests,
measurements and receipts to be filled only after execution. The earlier dated
checkpoints below retain their original results.

## Hosted qualification history

Hosted results are bound to their exact source and first-attempt workflow run.
Read the matching candidate manifest, verification report and delivery receipt
before treating an image as ready for deployment evaluation.

| Run | Exact source | Recorded result |
| --- | --- | --- |
| [39710951764](docs/qualification/39710951764.md) | `308771961057db5e38985a1055b395eedd9d2c19` | Both native builds passed; container qualification exposed a command-line worker-discovery defect in the harness. No candidate was retained. |
| [39713698869](docs/qualification/39713698869.md) | `da16fd89f7091138639c352189b4fdd792caffc9` | Corrected process regressions passed on both architectures; both image builds then failed when the registry's production audit request timed out. No candidate was retained. |
| [39781710031](https://github.com/TheUncleBen/Homepage-Studio/actions/runs/39781710031) | `03e48b8bcd214a5de47aaea1d64fbad083c20edb` | Both native architecture qualifications passed; engineering-qualified/public-ready baseline receipts verified exact image/source and anonymous runtime layers. Human acceptance remained pending. This is the [historical baseline](docs/qualification/intensive-review-2026-10-22.md#historical-successful-baseline), not qualification of intensive-review corrections. |
| [39805250061](docs/qualification/39805250061.md) | `fe8e56f782e5498c8cb4f2c987bd5fa7c4456270` | Both native builds and all 2,091 native tests passed; both Chromium runs failed the same two touch-swipe cases (36/38). The review-added capture watchdog caused the product regression. Later image/lifecycle/delivery gates were not reached; no qualified replacement image was retained. |

The second result preserves the required dependency audit as a failed gate. Its
record does not change application code, dependencies, audit semantics, retry
budgets or workflow policy. Subsequent qualification requires a fresh complete
run and its own exact source/image/artifact evidence.

## Dated source checkpoint — 22 October 2026, 01:23 UTC

This record describes the local engineering evidence available at this source
checkpoint. It is not a live release-status declaration. Qualification of a later
candidate is determined by that candidate's exact source commit/tree, workflow
run and retained image/artifact evidence; a later successful run does not rewrite
the results or pending work recorded here. The machine-readable checkpoint is in
[verification-evidence.json](docs/verification-evidence.json).

The controlled source now implements one controller/native image, authoritative
`homepage/` source, independent slug-addressed dashboards, supervised loopback
workers, global versus selected health, scoped native context and intentional
stack-title selection. Build, templates, source packaging, image manifests,
release guards, runtime fixtures and documentation use that model. Final local
qualification is bound to product source commit
`438d5bc74aeb313ac12cb9ba8852c8f2a4e4d96e`, tree
`d4d8b9efde36f953956a98b0e2b42aa56926e696`, and the verified native source
manifest. Earlier records retain their original execution scopes. These local
results do not by themselves qualify a hosted workflow or deployable container
image.

### Completed local checks

| Check | Observed result | Scope and evidence |
| --- | --- | --- |
| Full backend suite | **202 passed, 0 failed, 0 skipped; exit 0** | Controller, storage, registry, worker lifecycle and delivery-tooling coverage; `evidence/backend-final.log` |
| Full native suite baseline | **594 files passed; 2,026 tests passed; exit 0** | Earlier native suite before the focused dialog repair; retained in `evidence/native-full-tests.log` |
| Full native ESLint baseline | **Exit 0** | Complete native source lint before the later focused dialog repair; `evidence/native-full-lint.log` |
| Final frozen-source full native ESLint | **Exit 0** | Complete native source lint after the dialog repair; observed at 01:12:04 UTC; `evidence/native-final-lint-result.json` and `evidence/native-final-lint.log` |
| Final native suite, restricted invocation | **592/594 files passed; 2,026 tests passed, 4 skipped; exit 1** | Historical failed aggregate: two setup hooks could not open their local listeners (`listen EPERM 127.0.0.1`); zero assertion failures; `evidence/native-final-tests-restricted-result.json` |
| Final frozen-source full native suite | **594/594 files and 2,030/2,030 tests passed; exit 0** | Zero skipped tests, unhandled errors or retries; **412.30 seconds**, two workers, unchanged assertions and budgets, with local listener permission; `evidence/native-final-tests-result.json`, `.json` report and `.log` |
| Controller production dependency audit | **0 vulnerabilities; exit 0** | `evidence/controller-audit.json` |
| Native production dependency audit | **0 vulnerabilities; exit 0** | `evidence/native-audit.json` |
| Native production build after dialog repair | **Exit 0** | Rebuilt production application; all **1,553 native source files** match the final local build index; `evidence/native-production-build-dialog-final.log` |
| Isolated local production runtime fixture | **All phases passed; runner exit 0** | Fresh/edit and independent operation of all nine managed files using live volumes under `/tmp`, on loopback port `33001`; default root plus **three named dashboards**, four total; `evidence/native-runtime-tmp-result.json` and `evidence/native-runtime-tmp-manifest.json` |
| Isolated restart and snapshot restore | **Passed** | Graceful restart preserved root and all three named dashboards; root snapshot restore left the named dashboards unchanged. Both owned controllers shut down with exit 0, and the port was closed after completion. |
| Focused dialog repair | **1 regression passed; focused lint exit 0** | Covers the pending-dialog focus escape found by the first browser run |
| Isolated production Chromium desktop/mobile | **25/25 passed; 0 retries; 2.0 minutes** | Full unchanged suite against the rebuilt production application with live data and outputs under `/tmp` |
| Isolated Firefox/WebKit desktop matrix | **Firefox 8/8 and WebKit 8/8 passed; 0 retries; 2.1 minutes combined** | Complete selected cross-engine production matrix; unchanged assertions |
| Real hidden-document playback | **Passed** | Real tab hidden for **9,000 ms** without advancing; expected remaining dwell **2,974.8 ms**, observed resume **2,979.1 ms**, following dwell **4,001 ms**; pinned headed Chromium with real tab activation |

The browser qualification summary is
`recovery/local/browser-isolated-evidence/qualification-summary.json`, with its
suite logs, filesystem observations and real-hidden evidence. Both aggregate
observers recorded **zero external rsync events, zero deleted-snapshot
resurrections and exactly 25 retained snapshots** at completion. Product source
was unchanged after the production build used by these browser runs.

The `evidence/` and `recovery/local/` names identify local delivery working
records. They are not substitutes for the exact workflow artifacts required for
a published candidate.
Audit results describe the dependency versions and advisory data at execution.

### Final native suite and local listener permission

The first final-source full native invocation exited **1**. It completed with
**592 passed and 2 failed test files**, **2,026 passed and 4 skipped tests**, and
two unhandled listener errors. The Flood and qBittorrent session-proxy suites
could not bind their test servers: both reported `listen EPERM 127.0.0.1`, then
their `beforeAll` hooks reached the unchanged 10-second limit. The JSON report
records zero assertion failures; this invocation is still a failed aggregate.

The complete unchanged suite then **passed with exit 0**, using explicit
permission for local listeners, two workers and unchanged budgets. All **594
test files and 2,030 tests passed**, with **zero skips, unhandled errors or
retries**, in **412.30 seconds**. The run started at 01:15:55.193 UTC; its
successful completion was observed at 01:23:29.900 UTC. The retained result,
full JSON report and log are `evidence/native-final-tests-result.json`,
`evidence/native-final-tests.json` and `evidence/native-final-tests.log`.

The original failed log, JSON report and result receipt remain available as
`evidence/native-final-tests-restricted.log`,
`evidence/native-final-tests-restricted.json` and
`evidence/native-final-tests-restricted-result.json`. Both native invocations and
the successful final lint share native source manifest SHA-256
`cfce590e8a07661de0db352b882720374362945c97d615ea92d5a21dc59f22e9`.

### First production Chromium run and repairs

The first aggregate Chromium run completed with **22 passed and 3 failed**. The
failures were an outdated button-count assertion, a fixture still targeting the
removed companion-container port, and a real pending-dialog Tab escape. The
assertion and fixture were corrected, and dialog focus handling was repaired.
The focused dialog regression and lint passed, followed by a successful production
rebuild and a complete **25/25 Chromium rerun with zero retries in 1.5 minutes**.
The original failed aggregate remains part of the record.

### Workspace interference and isolated rerun

The first Firefox/WebKit aggregate recorded **15/16 passed**: Firefox 8/8 and
WebKit 7/8. Its import-before-confirmation assertion observed previously pruned
snapshots reappearing while the configuration revision stayed unchanged. The
filesystem observer captured external workspace rsync temporary-file activity
recreating those exact deleted snapshot IDs. The retained diagnostic record is
`recovery/local/webkit-import-history-events.json`.

Live configuration/state, browser outputs and downloads were moved to `/tmp`.
No product source or test assertion was changed for this environment correction.
The unchanged full Chromium suite, Firefox/WebKit matrix and real hidden-document
check then passed with the results above. Completed evidence was copied back
after execution; live test volumes remained outside the synchronized workspace.
The original failing logs and filesystem proof remain part of the record.

The browser aggregate and parent time limits, individual test bounds and
zero-retry policy remain unchanged. Local pinned browser engines rendered using
their extracted dependencies; host library-cache validation alone was disabled
because the system cache could not see those extracted libraries. Application
tests and hosted CI gates were not skipped.

### Earlier focused reconstruction checks

- 58 packaging, release-integrity and Portainer client tests passed with local
  loopback listeners enabled. They include the actual application health command,
  one-service templates, exact OCI/source/release bindings, anonymous layer guards
  and documented Portainer request contracts. These tests are not real Docker or
  Portainer execution.
- Four Python corresponding-source tests passed: ignored/untracked files in every
  copied source subtree are rejected; real Docker exclusions allow generated local
  dependencies/builds; the one complete source archive is reproducible and retains
  native license/source/executable mode; exact identity and symlink checks fail
  closed. The final committed source still needs its own clean-input check.
- The three runtime acceptance scripts passed JavaScript syntax checks. The local
  production phases reported above have since executed; final-image dashboard,
  worker and lifecycle acceptance remains a separate gate.
- The Manrope license was downloaded from its actual immutable Google Fonts
  revision and matched SHA-256
  `58172e0c0fac2cda8a37b348164bb55e44b0e69051e557e92b1d3f6910141f7b`.
  Both bundled Manrope fonts were inspected for their embedded copyright and OFL
  metadata. The IBM Plex license was copied from the bundled native source.
  The runtime Dockerfile includes the complete third-party notice directory.

### Candidate gates pending at this checkpoint

The final frozen-source native suite, full lint, rebuilt production runtime and
local browser qualification have completed. The exact committed candidate still
must pass its hosted workflow, clean Docker-input guard and complete
corresponding-source packaging. Native AMD64 and ARM64 container
qualification, actual Compose/Swarm and Portainer lifecycle, immutable image and
manifest assembly, and anonymous verification of every runtime layer were still
pending. None is replaced by a local process test, a fixture or an older image.

Candidate evidence must identify the exact source/tree, image configurations and
workflow run. Public-ready handoff and the owner's device/environment/appearance
acceptance remain later gates. See the [completion plan](docs/IMPLEMENTATION-PLAN.md)
and [feature acceptance](docs/FEATURE-ACCEPTANCE.md).

## Historical evidence

The [preserved companion-container verification record](docs/history/VERIFICATION-2026-10-21-companion.md)
contains the earlier successful source/run/image evidence and detailed source
reviews. Its completed baseline is source
`6cb481a7853c715e788d027c2dc4b0cd682917b1`, tree
`61b68eaadf5301ee74a445074fa9227514f300c2`,
[workflow run 39540147520](https://github.com/TheUncleBen/Homepage-Studio/actions/runs/39540147520).
That baseline and the recovered review commits are useful history. Their pass
counts and public-ready receipt must not be relabeled as verification of the
single-container source or reused for a new image.

## Handoff boundary

A deployment-ready engineering handoff requires every feasible engineering gate,
the complete digest-pinned bundle, matching source/licenses and verified anonymous
runtime-layer access. Human testing then covers physical-device gesture feel,
visual preference, real integration credentials and the intended private host,
network and storage. A local process run is not container acceptance, a YAML parse
is not Portainer execution, and a synthetic integration is not live coverage of
every native widget. Official promotion preserves the accepted bytes without
rebuilding and requires the owner's exact approval.
