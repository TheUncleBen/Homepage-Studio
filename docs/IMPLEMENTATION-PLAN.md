# Controlled-platform completion plan

This plan tracks the source transition approved on 21 October 2026. The target is
one owned Homepage Studio application whose engineering candidate needs only
the owner's environment/device/appearance acceptance before official promotion.
The checkboxes below are a **22 October 2026, 01:23 UTC source checkpoint**;
they are not a live status feed for later candidates. Exact candidate workflow
and artifact evidence determines later completion. Test evidence belongs in
[VERIFICATION.md](../VERIFICATION.md), and the feature contract is in
[FEATURE-ACCEPTANCE.md](FEATURE-ACCEPTANCE.md).

## Source and architecture

- [x] Maintain complete controlled native source, dependencies, assets, tests and
  licenses in `homepage/`. Retire overlay preparation and companion deployment.
- [x] Keep controller registry and immutable storage identity separate from slugs.
  Preserve existing root data; isolate nine-file configuration, identities,
  layout/stacks, themes/CSS/JS, discovery and history per dashboard.
- [x] Scope native request paths, cache/cookie/browser state, revision matching and
  credentials to the selected worker/dashboard. Check aggregate robots policy
  with the same native environment and YAML semantics without requiring workers.
- [x] Implement loopback worker supervision with count/idle/startup bounds, drainage,
  crash recovery and bounded shutdown. Separate global application readiness
  from selected configuration/native readiness and shared static assets. The
  single-image UID1000 runtime still needs its exact container qualification.

## Interaction and management

- [x] Implement dashboard creation, duplication, name/slug changes, explicit archive and
  restore using registry revisions. Preserve pending/dirty drafts and provide
  actionable conflicts without resubmitting writes.
- [x] Implement the quiet stack title picker using an intentional short click/tap or
  keyboard action. Prevent accidental opening during swipe/drag/long press/context
  actions; retain existing Play/Pause-only transport and focus behavior.
- [x] Complete the authored local production browser scenarios for panel/editor,
  stack/playback, import, appearance, discovery and named-dashboard flows.
  Existing code must satisfy
  this architecture rather than survive only because it previously existed.

## Executed local engineering checks

- [x] Full backend suite: 202 passed, zero failures/skips, exit 0.
- [x] Full native suite: 594 files and 2,026 tests passed, exit 0, before the
  later focused dialog repair. Full native ESLint exited 0 at that baseline.
- [x] Full native ESLint rerun against the final frozen source after the dialog
  repair exited 0, observed at 01:12:04 UTC; retain its exact result and log.
- [x] Preserve the restricted final native invocation: exit 1, 592/594 files
  passed, 2,026 tests passed and four skipped. Both setup failures came from
  `listen EPERM 127.0.0.1`; the JSON report has zero assertion failures.
- [x] Complete the unchanged final-source native suite with local listener
  permission: 594/594 test files and 2,030/2,030 tests passed, exit 0, no skips,
  unhandled errors or retries, in 412.30 seconds. Two workers, assertions and
  budgets remained unchanged. Evidence is bound to product commit
  `438d5bc74aeb313ac12cb9ba8852c8f2a4e4d96e` and its verified native source index.
- [x] Controller and native production audits: zero vulnerabilities in each.
- [x] Native production rebuild after the dialog repair exited 0; all 1,553
  native source files match the final local build index.
- [x] Repeat the real production-process fresh/edit and all-nine-file
  multi-dashboard fixture using isolated `/tmp` volumes on loopback port 33001.
  Root plus three named dashboards passed; graceful restart preserved all four,
  and root snapshot restore left the three named dashboards unchanged.
- [x] Investigate the first Chromium result of 22 passed/3 failed. Correct the
  stale button-count and companion-port test assumptions, repair the actual
  pending-dialog Tab escape, and pass its focused 1-test regression and lint.
- [x] Isolated production Chromium desktop/mobile: 25/25 passed, zero retries,
  2.0 minutes. Preserve the original 22 passed/3 failed result as history.
- [x] Isolated Firefox/WebKit desktop matrix: 8/8 passed in each engine, zero
  retries, 2.1 minutes combined. Preserve the first 15/16 result and its external
  rsync resurrection diagnosis; product source and assertions stayed unchanged
  during the correction to `/tmp`. Both aggregate observers ended with 25
  snapshots, zero rsync events and zero deleted-snapshot resurrections.
- [x] Real hidden-document playback: no advance for 9,000 ms hidden; expected
  remaining dwell 2,974.8 ms, observed resume 2,979.1 ms, following dwell 4,001 ms.
- [x] Earlier focused delivery-tooling and corresponding-source checks passed
  (58 JavaScript and 4 Python tests); these do not qualify a final container.

The restricted invocation, earlier native baseline and failed browser runs remain
part of the evidence. Their original outcomes and source scopes are preserved.
The full browser suite keeps its 15-minute aggregate and 16-minute parent budget,
unchanged individual bounds and zero retries.

## Engineering gates still pending at this checkpoint

1. Use the committed source and final documentation checkpoint to run the complete
   exact-source hosted workflow,
   the clean Docker-input guard and corresponding-source packaging checks.
2. Build the complete image natively on AMD64 and ARM64. Run real Chromium, Firefox,
   WebKit, hidden-document, direct Compose/Swarm, worker/runtime and pinned
   Portainer acceptance with successful resource cleanup on both targets.
3. Retain only the exact tested image IDs under a unique source/run identity.
   Assemble the complete multiarchitecture index, package the single complete
   corresponding-source archive, render digest-pinned templates, verify evidence
   hashes and anonymously stream/hash every unique runtime layer.
4. Reconcile public docs and the private canonical requirements/status/history
   with the actual source/results. Deliver the public-ready bundle, precise
   completed/remaining status, rollback instructions and concise human checklist.
   Only then declare readiness for the owner's deployment testing.

Official date tagging and GitHub release publication remain a later promotion of
the exact human-accepted artifact set. No live deployment to the owner's host is
part of autonomous engineering qualification, and no prior candidate is silently
replaced with a newer build.
