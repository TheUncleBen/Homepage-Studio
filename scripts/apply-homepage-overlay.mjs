#!/usr/bin/env node
// Exact-source integration patch. Content/components/API files are copied from overlay/ first.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || "");
const hash = (text) => createHash("sha256").update(text).digest("hex");
const replacements = {
  "src/pages/index.jsx":
    "a2a194699b5abbcaa50c4316964f0a8c3bdff973ca4196167e6b789280fd314f",
  "src/__tests__/pages/index.test.jsx":
    "18c2807f52639d2cd72e5d1db78c4fe3a36049763cf625919b735359d303dd14",
};
if (!process.argv[2])
  throw new Error(
    "Usage: node scripts/apply-homepage-overlay.mjs <prepared-source-path>",
  );
if (process.argv.includes("--verify-baseline")) {
  for (const [path, expected] of Object.entries(replacements)) {
    if (hash(await readFile(resolve(root, path))) !== expected)
      throw new Error(`Pinned native replacement baseline changed: ${path}`);
  }
  process.stdout.write(
    "Homepage Studio: exact original main-page and test replacement baselines verified.\n",
  );
  process.exit(0);
}
const originalHash =
  "128c5afe51aaa7d54d74dff363fe479c3267d659cb2cebe85d77d95c017d7bf4";
const originalViewport =
  "width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no";
const accessibleViewport = "width=device-width, initial-scale=1.0";
const cssImport = 'import "styles/studio.css";\n';
const file = resolve(root, "src/pages/_app.jsx");
const input = await readFile(file, "utf8");
const normalized = input.includes(cssImport)
  ? input
      .replace(cssImport, "")
      .replace(
        `content="${accessibleViewport}"`,
        `content="${originalViewport}"`,
      )
  : input;
if (hash(normalized) !== originalHash)
  throw new Error(
    "Pinned Homepage _app.jsx source does not match the reviewed baseline. Refusing a fuzzy patch.",
  );
if (
  JSON.parse(await readFile(resolve(root, "package.json"), "utf8")).version !==
  "2.6.0"
)
  throw new Error("Unexpected Homepage package version.");
const output = normalized
  .replace(
    'import "styles/theme.css";\n',
    `import "styles/theme.css";\n${cssImport}`,
  )
  .replace(originalViewport, accessibleViewport);
if (!output.includes(cssImport) || output.includes("user-scalable=no"))
  throw new Error("Studio integration patch did not apply.");
await readFile(resolve(root, "src/components/studio/board.jsx"));
await readFile(resolve(root, "src/styles/studio.css"));
await readFile(resolve(root, "src/pages/api/studio/health.js"));
const boundaryFile = resolve(root, "src/components/errorboundry.jsx");
const boundaryHash =
  "c33fceeed7ae2bd34bb2286eae3533b0d52de165c454b63f6003cb40539120e1";
const boundaryImport =
  'import { StudioRevisionContext } from "utils/contexts/studio-revision";\n\n';
const boundaryContext = "  static contextType = StudioRevisionContext;\n\n";
const boundaryMethods = `  // Studio: retry only a failed subtree after native configuration changes.
  componentDidMount() {
    this.studioRevision = this.context;
  }

  componentDidUpdate() {
    const changed = this.studioRevision !== this.context;
    this.studioRevision = this.context;
    if (changed && this.state.errorInfo) this.setState({ error: null, errorInfo: null });
  }

`;
const boundaryInput = await readFile(boundaryFile, "utf8");
const boundaryOriginal = boundaryInput
  .replace(boundaryImport, "")
  .replace(boundaryContext, "")
  .replace(boundaryMethods, "");
if (hash(boundaryOriginal) !== boundaryHash)
  throw new Error(
    "Pinned native error boundary changed. Refusing a fuzzy lifecycle patch.",
  );
const boundaryOutput = boundaryOriginal
  .replace(
    "export default class ErrorBoundary",
    `${boundaryImport}export default class ErrorBoundary`,
  )
  .replace(
    "extends React.Component {\n",
    `extends React.Component {\n${boundaryContext}`,
  )
  .replace(
    "  componentDidCatch(error, errorInfo) {",
    `${boundaryMethods}  componentDidCatch(error, errorInfo) {`,
  );
await writeFile(file, output);
await writeFile(boundaryFile, boundaryOutput);
await writeFile(
  resolve(root, "studio-overlay.json"),
  JSON.stringify(
    {
      protocolVersion: 1,
      upstreamCommit: "51cc1684f9f34a7877ed462b8f94c9cc687b4dde",
      originalAppSha256: originalHash,
      patchedAppSha256: hash(output),
      originalBoundarySha256: boundaryHash,
      patchedBoundarySha256: hash(boundaryOutput),
      replacedNativeSources: await Promise.all(
        Object.entries(replacements).map(async ([path, originalSha256]) => ({
          path,
          originalSha256,
          replacementSha256: hash(await readFile(resolve(root, path))),
        })),
      ),
    },
    null,
    2,
  ) + "\n",
);
process.stdout.write(
  "Homepage Studio overlay: exact native source verified; stylesheet and accessible viewport applied.\n",
);
