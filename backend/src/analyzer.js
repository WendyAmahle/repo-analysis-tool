import { execFile } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class GitAnalysisError extends Error {}

async function runGit(repoPath, args) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args], {
      maxBuffer: 1024 * 1024 * 100
    });
    return stdout;
  } catch (error) {
    const message = error.stderr?.trim() || error.message || 'git command failed';
    throw new GitAnalysisError(message);
  }
}

export function safeRepoName(value) {
  let name = value.trim().replace(/\/$/, '').split('/').pop() || 'repository';
  if (name.endsWith('.git')) name = name.slice(0, -4);
  name = name.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '');
  return name || 'repository';
}

export async function listRepositories(baseDir) {
  await mkdir(baseDir, { recursive: true });
  const entries = await readdir(baseDir, { withFileTypes: true });
  const repos = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const children = await readdir(path.join(baseDir, entry.name));
      if (children.includes('.git')) repos.push(entry.name);
    } catch {
      // Ignore unreadable directories.
    }
  }
  return repos.sort();
}

export async function cloneRepository(url, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await execFileAsync('git', ['clone', '--quiet', url, destination], {
      maxBuffer: 1024 * 1024 * 20
    });
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    const message = error.stderr?.trim() || error.message || 'Unable to clone repository.';
    throw new GitAnalysisError(message);
  }
}

async function normaliseAuthor(repoPath, name, email) {
  const identity = `${name} <${email}>`;
  try {
    const mapped = await runGit(repoPath, ['check-mailmap', identity]);
    return mapped.trim() || identity;
  } catch {
    return identity;
  }
}

async function parseCommits(repoPath) {
  const raw = await runGit(repoPath, [
    'log',
    '--no-merges',
    '--reverse',
    '--format=%H%x1f%an%x1f%ae%x1f%ct%x1f%s%x1e',
    'HEAD'
  ]);
  const commits = [];
  for (const record of raw.split('\x1e')) {
    const clean = record.replace(/^\n|\n$/g, '');
    if (!clean) continue;
    const parts = clean.split('\x1f');
    if (parts.length < 5) continue;
    const [sha, name, email, timestamp, subject] = parts;
    commits.push({
      sha,
      author: await normaliseAuthor(repoPath, name, email),
      email,
      timestamp: Number(timestamp),
      subject
    });
  }
  return commits;
}

function renameTarget(filePath) {
  if (!filePath.includes(' => ')) return filePath;
  if (filePath.includes('{') && filePath.includes('}')) {
    const start = filePath.indexOf('{');
    const end = filePath.indexOf('}');
    const prefix = filePath.slice(0, start);
    const inside = filePath.slice(start + 1, end);
    const suffix = filePath.slice(end + 1);
    return `${prefix}${inside.split(' => ').pop()}${suffix}`;
  }
  return filePath.split(' => ').pop();
}

function parentDirs(filePath) {
  const dirs = ['.'];
  const parent = path.posix.dirname(filePath.replaceAll('\\', '/'));
  if (parent === '.') return dirs;
  const parts = parent.split('/').filter(Boolean);
  for (let index = 1; index <= parts.length; index += 1) {
    dirs.push(parts.slice(0, index).join('/'));
  }
  return dirs;
}

async function parseNumstat(repoPath, sha) {
  const raw = await runGit(repoPath, ['diff-tree', '--root', '--no-commit-id', '--numstat', '-M50%', '-r', sha]);
  const changes = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [added, removed, ...pathParts] = parts;
    if (added === '-' || removed === '-') continue;
    changes.push({
      path: renameTarget(pathParts.join('\t')),
      added: Number(added),
      removed: Number(removed)
    });
  }
  return changes;
}

function parseDate(value) {
  if (!value) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(timestamp) ? null : Math.floor(timestamp / 1000);
}

function filterCommits(commits, filters) {
  const since = parseDate(filters.since);
  const until = parseDate(filters.until);
  const selected = filters.commits
    ? filters.commits.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean)
    : [];
  return commits.filter((commit) => {
    if (since !== null && commit.timestamp < since) return false;
    if (until !== null && commit.timestamp >= until) return false;
    if (selected.length && !selected.some((sha) => commit.sha.startsWith(sha))) return false;
    return true;
  });
}

function emptyMetrics() {
  return {
    added: 0,
    removed: 0,
    growth: 0,
    churn: 0,
    modifications: 0,
    modificationFrequency: 0,
    churnRate: 0
  };
}

function authorBucket() {
  return { churn: 0, modifications: 0 };
}

export async function analyzeRepository(repoPath, filters = {}) {
  const allCommits = await parseCommits(repoPath);
  const commits = filterCommits(allCommits, filters);
  const objectMetrics = new Map();
  const objectAuthors = new Map();
  const authors = [...new Set(allCommits.map((commit) => commit.author))].sort();
  const commitRows = [];

  function metricFor(objectPath) {
    if (!objectMetrics.has(objectPath)) objectMetrics.set(objectPath, emptyMetrics());
    return objectMetrics.get(objectPath);
  }

  function authorMetricFor(objectPath, author) {
    if (!objectAuthors.has(objectPath)) objectAuthors.set(objectPath, new Map());
    const authorMap = objectAuthors.get(objectPath);
    if (!authorMap.has(author)) authorMap.set(author, authorBucket());
    return authorMap.get(author);
  }

  for (const commit of commits) {
    const changes = await parseNumstat(repoPath, commit.sha);
    const touchedObjects = new Set();
    let commitAdded = 0;
    let commitRemoved = 0;

    for (const change of changes) {
      const affected = [
        { path: change.path, type: 'file' },
        ...parentDirs(change.path).map((dir) => ({ path: dir, type: 'directory' }))
      ];
      for (const object of affected) {
        const metric = metricFor(object.path);
        metric.type = object.type;
        metric.added += change.added;
        metric.removed += change.removed;
        metric.growth += change.added - change.removed;
        metric.churn += change.added + change.removed;
        touchedObjects.add(object.path);

        const authorMetric = authorMetricFor(object.path, commit.author);
        authorMetric.churn += change.added + change.removed;
      }
      commitAdded += change.added;
      commitRemoved += change.removed;
    }

    for (const objectPath of touchedObjects) {
      metricFor(objectPath).modifications += 1;
      authorMetricFor(objectPath, commit.author).modifications += 1;
    }

    commitRows.push({
      sha: commit.sha,
      shortSha: commit.sha.slice(0, 8),
      author: commit.author,
      date: new Date(commit.timestamp * 1000).toISOString().slice(0, 10),
      subject: commit.subject,
      added: commitAdded,
      removed: commitRemoved,
      churn: commitAdded + commitRemoved
    });
  }

  const commitCount = commits.length;
  const rows = [];
  for (const [objectPath, metric] of objectMetrics.entries()) {
    if (filters.path && !objectPath.toLowerCase().includes(filters.path.toLowerCase())) continue;
    if (!['file', 'directory'].includes(metric.type)) continue;
    metric.modificationFrequency = commitCount ? metric.modifications / commitCount : 0;
    metric.churnRate = commitCount ? metric.churn / commitCount : 0;

    const authorRows = [];
    const authorMap = objectAuthors.get(objectPath) || new Map();
    for (const [author, values] of authorMap.entries()) {
      if (filters.author && filters.author !== author) continue;
      authorRows.push({
        author,
        ...values,
        ownership: metric.churn ? values.churn / metric.churn : 0
      });
    }
    if (filters.author && !authorRows.length) continue;
    rows.push({
      path: objectPath,
      ...metric,
      authors: authorRows.sort((left, right) => right.churn - left.churn)
    });
  }

  rows.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
    if (right.churn !== left.churn) return right.churn - left.churn;
    return left.path.localeCompare(right.path);
  });

  const repoMetrics = objectMetrics.get('.') || emptyMetrics();
  repoMetrics.modificationFrequency = commitCount ? repoMetrics.modifications / commitCount : 0;
  repoMetrics.churnRate = commitCount ? repoMetrics.churn / commitCount : 0;

  return {
    authors,
    commitCount,
    allCommitCount: allCommits.length,
    repoMetrics,
    objects: rows,
    commits: commitRows.reverse()
  };
}
