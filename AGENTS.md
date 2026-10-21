# Working on Homepage Studio

## Product contract

Maintain a native Homepage-derived React dashboard, not a separate integration engine or injected DOM rearranger. All four panel kinds—service, serviceWidget, informationWidget, and bookmark—must be independently placeable and stackable. A fresh configuration is empty. Preserve the restrained gray/white and eggplant theme.

Use one visible Play/Pause control per stack, passive progress indicators, touch swipes, horizontal desktop drag/trackpad input, and focused Left/Right keys. A successful manual navigation while playing resets that stack's hold to max(normal interval, manual hold), default 30 seconds. The first automatic advance occurs when the hold ends, then normal timing resumes. Paused stacks stay paused. Playback and temporary drag offsets never persist or create snapshots. Respect interactive native content, reduced motion, document visibility, and offscreen/editing timer suspension.

Keep native panel hosts stably keyed across geometry changes, stacking, navigation, and unstacking. Do not replace native widgets with mock implementations. External Docker/Kubernetes definitions stay with their native labels/annotations; only layout and visibility are Studio-owned.

## Data and compatibility

The single writer owns all nine managed native files and state.json. Preserve unknown native fields, comments where the YAML AST permits, literal environment/file references, stable panel identities, revision checks, recoverable transactions, and 25-snapshot default retention. Validate before creating snapshots. Do not create new integration adapters or an authentication system without a concrete product decision.

The Homepage commit and build inputs are pinned in upstream.lock.json. Apply changes through overlay/ and scripts/apply-homepage-overlay.mjs. A source mismatch must fail explicitly. Keep server/native protocol, upstream revision, and build identity consistent across the image pair.

Never commit runtime configuration, credentials, private project documentation, state, snapshots, downloaded dependency trees, generated build trees, or test data from real infrastructure. Synthetic examples must use reserved example domains.

## Verification and releases

Document changes, tests actually executed, remaining limitations, and the next concrete step. Do not carry historical prototype test results forward as evidence for this renderer. A passing controller test is not browser/device testing, and parsing deployment YAML is not container acceptance.

Follow docs/RELEASES.md. The engineering workflow may build and deliver a requested candidate without an owner-only dispatch or candidate environment approval. A trusted default-branch push containing [deliver-candidate], or a deliberate manual candidate dispatch, requests retention of the fully qualified images. Other pushes validate without publication. Keep source/run tags unique, verify the complete image pair and bundle, and report anonymous availability separately from build success. Official versions remain YYYY.MM.DD, immutable, and owner-approved for the exact artifact set after human testing. Never move an existing official tag, introduce a moving preview image channel, or rebuild approved image bytes during promotion.

Before completing work, update VERIFICATION.md and relevant architecture/deployment documents. The project owner maintains a separate private canonical project record; reconcile the current status and handoff there when that destination is available. Keep private links and owner infrastructure out of this public repository.
