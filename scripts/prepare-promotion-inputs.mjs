#!/usr/bin/env node
// Write dispatch inputs as data, without shell interpolation or executing them.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchCandidateToRelease, sha256, validateQualificationReport } from './candidate-manifest.mjs';
import { approvalStatement } from './release-guard.mjs';

export async function preparePromotionInputs(directory, environment = process.env) {
  const candidateText = environment.STUDIO_CANDIDATE_MANIFEST;
  const releaseText = environment.STUDIO_RELEASE_MANIFEST;
  const reportText = environment.STUDIO_QUALIFICATION_REPORT;
  if ([candidateText, releaseText, reportText].some(value => typeof value !== 'string' || value.length > 60000)) throw new Error('Bounded candidate, release and report inputs are required.');
  const candidate = JSON.parse(candidateText);
  const release = JSON.parse(releaseText);
  matchCandidateToRelease(candidate, release);
  if (sha256(Buffer.from(reportText)) !== candidate.files['verification.json']) throw new Error('Dispatch report bytes differ from the accepted candidate report.');
  const report = JSON.parse(reportText);
  validateQualificationReport(report, candidate);
  const output = path.resolve(directory);
  await fs.mkdir(output);
  await fs.writeFile(path.join(output, 'candidate-manifest.json'), JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });
  await fs.writeFile(path.join(output, 'release-manifest.json'), JSON.stringify(release, null, 2) + '\n', { flag: 'wx' });
  await fs.writeFile(path.join(output, 'verification.json'), reportText, { flag: 'wx' });
  return { sourceCommit: candidate.sourceCommit, candidateRunId: report.workflowRun.runId, approvalStatement: approvalStatement(candidate, release) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [directory, ...extra] = process.argv.slice(2);
    if (!directory || extra.length) throw new Error('Usage: node scripts/prepare-promotion-inputs.mjs <new-output-directory>');
    const result = await preparePromotionInputs(directory);
    if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `source_commit=${result.sourceCommit}\ncandidate_run_id=${result.candidateRunId}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `### Exact promotion awaiting owner review\n\nApproval comment:\n\n\`\`\`text\n${result.approvalStatement}\n\`\`\`\n\nThis only prepares metadata. Review the completed candidate and human acceptance before approving the protected job.\n`);
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
