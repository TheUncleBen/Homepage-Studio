#!/usr/bin/env node
// Authorization comes from GitHub's authenticated run/review records, never JSON alone.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactFingerprint, validateReleaseManifest } from './release-manifest.mjs';
import { matchCandidateToRelease, validateQualificationReport, isCommit } from './candidate-manifest.mjs';

export const RELEASE_REPOSITORY = 'TheUncleBen/Homepage-Studio';
export const RELEASE_OWNER = 'TheUncleBen';
export const RELEASE_ENVIRONMENT = 'official-release';
export const RELEASE_WORKFLOW = '.github/workflows/promote-approved.yml';
export const CANDIDATE_WORKFLOW = '.github/workflows/candidate-approved.yml';
const matchingWorkflowPath = (actual, expected, branch) => actual === expected || actual === `${expected}@${branch}`;

export function approvalStatement(candidate, release) {
  matchCandidateToRelease(candidate, release);
  return `Approve Homepage Studio ${release.version}; candidate ${candidate.artifactSetSha256}; release ${artifactFingerprint(release)}`;
}

export async function boundedResponse(response, maximum = 4 * 1024 * 1024) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maximum) throw new Error('Remote metadata exceeds its size limit.');
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maximum) throw new Error('Remote metadata exceeds its size limit.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function githubApi(token, fetcher = fetch) {
  if (!token || typeof token !== 'string') throw new Error('A GitHub Actions token is required for trusted release verification.');
  return async (suffix, { method = 'GET', body, absent = false } = {}) => {
    if ((suffix !== '' && !/^\/[A-Za-z0-9_./%?=&-]+$/.test(suffix)) || suffix.includes('..') || suffix.includes('//')) throw new Error('Invalid repository API path.');
    const response = await fetcher(`https://api.github.com/repos/${RELEASE_REPOSITORY}${suffix}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2026-03-10', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (absent && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub repository API failed (${response.status}); no unverified authorization is accepted.`);
    return JSON.parse((await boundedResponse(response)).toString('utf8'));
  };
}

export function chicagoDate(now) {
  const fields = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
  return `${fields.year}.${fields.month}.${fields.day}`;
}

export async function verifyOwnerRun(workflowPath, { environment = process.env, request } = {}) {
  const context = environment;
  if (context.GITHUB_ACTIONS !== 'true' || context.GITHUB_REPOSITORY !== RELEASE_REPOSITORY || context.GITHUB_EVENT_NAME !== 'workflow_dispatch' || context.GITHUB_ACTOR !== RELEASE_OWNER || context.GITHUB_TRIGGERING_ACTOR !== RELEASE_OWNER || context.GITHUB_RUN_ATTEMPT !== '1' || !/^[1-9][0-9]*$/.test(context.GITHUB_RUN_ID || '') || !isCommit(context.GITHUB_SHA)) throw new Error('Controlled delivery requires a fresh, owner-initiated manual run in the intended repository.');
  const api = request || githubApi(context.GITHUB_TOKEN);
  const repository = await api('');
  const ref = `refs/heads/${repository.default_branch}`;
  if (repository.full_name !== RELEASE_REPOSITORY || repository.private !== false || !repository.default_branch || context.GITHUB_REF !== ref || context.GITHUB_WORKFLOW_REF !== `${RELEASE_REPOSITORY}/${workflowPath}@${ref}`) throw new Error('Run the reviewed promotion workflow from this public repository’s default branch.');
  const run = await api(`/actions/runs/${context.GITHUB_RUN_ID}`);
  if (String(run.id) !== context.GITHUB_RUN_ID || run.run_attempt !== 1 || run.event !== 'workflow_dispatch' || run.status !== 'in_progress' || run.head_branch !== repository.default_branch || run.head_sha !== context.GITHUB_SHA || run.actor?.login !== RELEASE_OWNER || run.triggering_actor?.login !== RELEASE_OWNER || run.repository?.full_name !== RELEASE_REPOSITORY || !matchingWorkflowPath(run.path, workflowPath, repository.default_branch)) throw new Error('The authenticated GitHub run does not match this owner-initiated promotion.');
  return { schemaVersion: 1, repository: RELEASE_REPOSITORY, runId: context.GITHUB_RUN_ID, workflowCommit: context.GITHUB_SHA, actor: RELEASE_OWNER };
}

export async function verifyOwnerGate({ workflowPath, environmentName, approvalComment }, { environment = process.env, request } = {}) {
  const api = request || githubApi(environment.GITHUB_TOKEN);
  const authorization = await verifyOwnerRun(workflowPath, { environment, request: api });
  const deployment = await api(`/environments/${environmentName}`);
  const reviewers = deployment.protection_rules?.filter(rule => rule.type === 'required_reviewers');
  if (deployment.name !== environmentName || !Number.isSafeInteger(deployment.id) || !Array.isArray(reviewers) || reviewers.length !== 1 || reviewers[0].prevent_self_review !== false || !reviewers[0].reviewers?.some(item => item.type === 'User' && item.reviewer?.login === RELEASE_OWNER)) throw new Error(`Configure the actual ${environmentName} environment with the owner as a required reviewer and self-approval permitted.`);
  const history = await api(`/actions/runs/${environment.GITHUB_RUN_ID}/approvals`);
  if (!Array.isArray(history)) throw new Error('GitHub did not return authenticated environment review history.');
  const reviews = history.filter(item => item.environments?.some(value => value.id === deployment.id && value.name === environmentName));
  if (reviews.length !== 1 || reviews[0].state !== 'approved' || reviews[0].user?.login !== RELEASE_OWNER || reviews[0].comment?.trim() !== approvalComment) throw new Error('The owner must approve this exact candidate and release fingerprint in this run; bypasses, stale approvals and different artifact sets are rejected.');
  return { ...authorization, environmentId: deployment.id };
}

export async function verifyTrustedApproval(candidate, release, { environment = process.env, request, now = new Date() } = {}) {
  matchCandidateToRelease(candidate, release);
  validateReleaseManifest(release);
  if (chicagoDate(now) !== release.version || new Date(release.approval.approvedAt).getTime() > now.getTime()) throw new Error('The official publication date must be today in America/Chicago with an already-recorded approval.');
  const authorization = await verifyOwnerGate({ workflowPath: RELEASE_WORKFLOW, environmentName: RELEASE_ENVIRONMENT, approvalComment: approvalStatement(candidate, release) }, { environment, request });
  return {
    ...authorization,
    candidateArtifactSetSha256: candidate.artifactSetSha256,
    releaseArtifactSetSha256: artifactFingerprint(release), version: release.version,
  };
}

export async function verifyQualifiedCandidateRun(report, candidate, { environment = process.env, request } = {}) {
  validateQualificationReport(report, candidate);
  const api = request || githubApi(environment.GITHUB_TOKEN);
  const repository = await api('');
  const run = await api(`/actions/runs/${report.workflowRun.runId}`);
  if (repository.full_name !== RELEASE_REPOSITORY || repository.private !== false || !repository.default_branch || String(run.id) !== report.workflowRun.runId || run.run_attempt !== 1 || run.event !== 'workflow_dispatch' || run.status !== 'completed' || run.conclusion !== 'success' || run.head_branch !== repository.default_branch || run.head_sha !== candidate.sourceCommit || run.actor?.login !== RELEASE_OWNER || run.triggering_actor?.login !== RELEASE_OWNER || run.repository?.full_name !== RELEASE_REPOSITORY || !matchingWorkflowPath(run.path, CANDIDATE_WORKFLOW, repository.default_branch)) throw new Error('The exact candidate workflow must have completed successfully for this source, owner dispatch and first attempt before official promotion.');
  return { runId: report.workflowRun.runId, sourceCommit: candidate.sourceCommit };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [candidateFile, releaseFile, ...extra] = process.argv.slice(2);
    if (!releaseFile || extra.length) throw new Error('Usage: node scripts/release-guard.mjs <candidate-manifest.json> <release-manifest.json>');
    const candidate = JSON.parse(await fs.readFile(candidateFile, 'utf8'));
    const release = JSON.parse(await fs.readFile(releaseFile, 'utf8'));
    console.log(JSON.stringify(await verifyTrustedApproval(candidate, release)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
