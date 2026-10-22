# Verification evidence

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
