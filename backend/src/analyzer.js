import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import yauzl from 'yauzl';

const execFileAsync = promisify(execFile);
const analysisCache = new Map();
const MAX_ANALYSIS_CACHE_ENTRIES = 4;

export class GitAnalysisError extends Error {}

async function runGit(repoPath, args) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args], {
      maxBuffer: 1024 * 1024 * 512
    });
    return stdout;
  } catch (error) {
    const message = error.stderr?.trim() || error.message || 'git command failed';
    throw new GitAnalysisError(message);
  }
}

function runGitWithInput(repoPath, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', repoPath, ...args]);
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => reject(new GitAnalysisError(error.message)));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
      } else {
        reject(new GitAnalysisError(Buffer.concat(stderr).toString('utf8').trim() || 'git command failed'));
      }
    });
    child.stdin.end(input);
  });
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

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function safeZipEntryPath(entryName) {
  const normalized = entryName.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new GitAnalysisError('ZIP archive contains an unsafe absolute path.');
  }
  const parts = normalized.split('/').filter((part) => part && part !== '.');
  if (!parts.length || parts.includes('..')) {
    throw new GitAnalysisError('ZIP archive contains an unsafe path.');
  }
  return parts.join('/');
}

function openZip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zipFile) => {
      if (error) reject(error);
      else resolve(zipFile);
    });
  });
}

function openZipEntry(zipFile, entry) {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) reject(error);
      else resolve(stream);
    });
  });
}

async function extractZip(buffer, targetDirectory) {
  const zipFile = await openZip(buffer);
  const seenPaths = new Set();
  let entryCount = 0;
  let totalSize = 0;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      zipFile.close();
      if (error) reject(error);
      else resolve();
    };

    zipFile.on('error', finish);
    zipFile.on('end', () => finish());
    zipFile.on('entry', async (entry) => {
      try {
        entryCount += 1;
        totalSize += entry.uncompressedSize;
        if (entryCount > 10000 || totalSize > 512 * 1024 * 1024 || entry.uncompressedSize > 128 * 1024 * 1024) {
          throw new GitAnalysisError('ZIP archive exceeds the extraction safety limits.');
        }
        if (entry.generalPurposeBitFlag & 0x1) {
          throw new GitAnalysisError('Encrypted ZIP archives are not supported.');
        }

        const relativePath = safeZipEntryPath(entry.fileName);
        if (seenPaths.has(relativePath)) {
          throw new GitAnalysisError('ZIP archive contains duplicate paths.');
        }
        seenPaths.add(relativePath);

        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
        const fileType = unixMode & 0o170000;
        if (fileType === 0o120000 || (fileType && ![0o040000, 0o100000].includes(fileType))) {
          throw new GitAnalysisError('ZIP archive contains an unsupported special file.');
        }

        const destination = path.resolve(targetDirectory, relativePath);
        if (!destination.startsWith(`${path.resolve(targetDirectory)}${path.sep}`)) {
          throw new GitAnalysisError('ZIP archive contains an unsafe path.');
        }

        if (entry.fileName.endsWith('/')) {
          await mkdir(destination, { recursive: true });
        } else {
          await mkdir(path.dirname(destination), { recursive: true });
          const stream = await openZipEntry(zipFile, entry);
          await pipeline(stream, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
        }
        zipFile.readEntry();
      } catch (error) {
        finish(error);
      }
    });

    zipFile.readEntry();
  });
}

async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function findExtractedRepository(extractionDirectory) {
  const candidates = [];
  if (await isDirectory(path.join(extractionDirectory, '.git'))) {
    candidates.push(extractionDirectory);
  }
  for (const entry of await readdir(extractionDirectory, { withFileTypes: true })) {
    if (entry.isDirectory() && await isDirectory(path.join(extractionDirectory, entry.name, '.git'))) {
      candidates.push(path.join(extractionDirectory, entry.name));
    }
  }
  if (candidates.length !== 1) {
    throw new GitAnalysisError('ZIP must contain exactly one Git repository, at its root or in one top-level folder.');
  }
  return candidates[0];
}

export async function importRepositoryZip(buffer, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  if (await pathExists(destination)) {
    throw new GitAnalysisError('A repository with this name already exists.');
  }

  const extractionDirectory = await mkdtemp(path.join(path.dirname(destination), '.upload-'));
  let moved = false;
  try {
    await extractZip(buffer, extractionDirectory);
    const repositoryRoot = await findExtractedRepository(extractionDirectory);
    const insideWorkTree = (await runGit(repositoryRoot, ['rev-parse', '--is-inside-work-tree'])).trim();
    if (insideWorkTree !== 'true') {
      throw new GitAnalysisError('The uploaded archive does not contain a valid Git working tree.');
    }
    await rename(repositoryRoot, destination);
    moved = true;
  } catch (error) {
    if (moved) await rm(destination, { recursive: true, force: true });
    if (error instanceof GitAnalysisError) throw error;
    throw new GitAnalysisError(error.message || 'Unable to extract ZIP repository.');
  } finally {
    await rm(extractionDirectory, { recursive: true, force: true });
  }
}

function parseManualAuthorMerges(value = '') {
  const manualMap = new Map();
  for (const rawLine of value.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.includes('=>') ? '=>' : line.includes('=') ? '=' : line.includes(':') ? ':' : null;
    if (!separator) continue;

    const [canonicalRaw, aliasesRaw] = line.split(separator, 2);
    const canonical = canonicalRaw.trim();
    if (!canonical || !aliasesRaw) continue;

    manualMap.set(canonical, canonical);
    for (const alias of aliasesRaw.split(',')) {
      const cleanedAlias = alias.trim();
      if (cleanedAlias) manualMap.set(cleanedAlias, canonical);
    }
  }
  return manualMap;
}

async function normaliseAuthors(repoPath, commits, manualAuthorMap) {
  const identities = [...new Set(commits.map((commit) => commit.identity))];
  const mailmap = new Map(identities.map((identity) => [identity, identity]));
  if (identities.length) {
    try {
      const output = await runGitWithInput(repoPath, ['check-mailmap', '--stdin'], `${identities.join('\n')}\n`);
      const mappedIdentities = output.trimEnd().split('\n');
      if (mappedIdentities.length === identities.length) {
        identities.forEach((identity, index) => mailmap.set(identity, mappedIdentities[index] || identity));
      }
    } catch {
      // Keep original identities when mailmap resolution is unavailable.
    }
  }

  return commits.map(({ identity, ...commit }) => {
    const mapped = mailmap.get(identity) || identity;
    return {
      ...commit,
      author: manualAuthorMap.get(mapped) || mapped
    };
  });
}

async function resolveReference(repoPath, reference = '') {
  const requestedReference = reference.trim() || 'HEAD';
  return (await runGit(repoPath, ['rev-parse', '--verify', `${requestedReference}^{commit}`])).trim();
}

async function parseHistory(repoPath, reference, manualAuthorMap) {
  const raw = await runGit(repoPath, [
    'log',
    '--no-merges',
    '--reverse',
    '--root',
    '-M50%',
    '--numstat',
    '--format=%x1e%H%x1f%an%x1f%ae%x1f%ct%x1f%s',
    reference
  ]);
  const commits = [];
  for (const record of raw.split('\x1e')) {
    const clean = record.replace(/^\n+|\n+$/g, '');
    if (!clean) continue;
    const [header, ...numstatLines] = clean.split('\n');
    const parts = header.split('\x1f');
    if (parts.length < 5) continue;
    const [sha, name, email, timestamp, ...subjectParts] = parts;
    const changes = [];
    for (const line of numstatLines) {
      if (!line.trim()) continue;
      const [added, removed, ...pathParts] = line.split('\t');
      if (!pathParts.length || added === '-' || removed === '-') continue;
      changes.push({
        ...changedPaths(pathParts.join('\t')),
        added: Number(added),
        removed: Number(removed)
      });
    }
    commits.push({
      sha,
      identity: `${name} <${email}>`,
      email,
      timestamp: Number(timestamp),
      subject: subjectParts.join('\x1f'),
      changes
    });
  }
  return normaliseAuthors(repoPath, commits, manualAuthorMap);
}

function changedPaths(filePath) {
  if (!filePath.includes(' => ')) return { path: filePath };
  if (filePath.includes('{') && filePath.includes('}')) {
    const start = filePath.indexOf('{');
    const end = filePath.indexOf('}');
    const prefix = filePath.slice(0, start);
    const [source, target] = filePath.slice(start + 1, end).split(' => ');
    const suffix = filePath.slice(end + 1);
    return {
      path: `${prefix}${target}${suffix}`,
      previousPath: `${prefix}${source}${suffix}`
    };
  }
  const [source, target] = filePath.split(' => ');
  return { path: target, previousPath: source };
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

async function listFilesAtReference(repoPath, reference) {
  try {
    const raw = await runGit(repoPath, ['grep', '-I', '-l', '-e', '', reference, '--']);
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(`${reference}:`, ''));
  } catch {
    return [];
  }
}

async function previousCommit(repoPath, sha) {
  try {
    return (await runGit(repoPath, ['rev-parse', '--verify', `${sha}^`])).trim();
  } catch {
    return '';
  }
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
    if (until !== null && commit.timestamp >= until + 24 * 60 * 60) return false;
    if (selected.length && !selected.some((sha) => commit.sha.startsWith(sha))) return false;
    if (filters.author && commit.author !== filters.author) return false;
    return true;
  });
}

function filterChangesByPath(commits, pathFilter = '') {
  const query = pathFilter.trim().replaceAll('\\', '/').toLowerCase();
  if (!query) return commits;
  return commits
    .map((commit) => ({
      ...commit,
      changes: commit.changes.filter((change) => {
        const currentPath = change.path.toLowerCase();
        const previousPath = change.previousPath?.toLowerCase() || '';
        return currentPath.includes(query) || previousPath.includes(query);
      })
    }))
    .filter((commit) => commit.changes.length > 0);
}

function emptyMetrics(type) {
  return {
    type,
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

function ensureMetric(objectMetrics, objectPath, type) {
  if (!objectMetrics.has(objectPath)) objectMetrics.set(objectPath, emptyMetrics(type));
  const metric = objectMetrics.get(objectPath);
  metric.type = metric.type || type;
  return metric;
}

function ensureAuthorMetric(objectAuthors, objectPath, author) {
  if (!objectAuthors.has(objectPath)) objectAuthors.set(objectPath, new Map());
  const authorMap = objectAuthors.get(objectPath);
  if (!authorMap.has(author)) authorMap.set(author, authorBucket());
  return authorMap.get(author);
}

function addObjectPath(objectMetrics, filePath) {
  ensureMetric(objectMetrics, filePath, 'file');
  for (const directory of parentDirs(filePath)) {
    ensureMetric(objectMetrics, directory, 'directory');
  }
}

function buildInsights(commitRows, rows, objectAuthors, repoMetrics) {
  const monthly = new Map();
  for (const commit of commitRows) {
    const month = commit.date.slice(0, 7);
    if (!monthly.has(month)) monthly.set(month, { date: month, added: 0, removed: 0, churn: 0, commits: 0 });
    const point = monthly.get(month);
    point.added += commit.added;
    point.removed += commit.removed;
    point.churn += commit.churn;
    point.commits += 1;
  }

  const rootAuthors = objectAuthors.get('.') || new Map();
  const authors = [...rootAuthors.entries()]
    .map(([author, values]) => ({
      author,
      ...values,
      ownership: repoMetrics.churn ? values.churn / repoMetrics.churn : 0
    }))
    .sort((left, right) => right.churn - left.churn)
    .slice(0, 8);

  const hotspots = rows
    .filter((row) => row.type === 'file' && row.churn > 0)
    .sort((left, right) => right.churn - left.churn)
    .slice(0, 8)
    .map((row) => ({ path: row.path, churn: row.churn, modifications: row.modifications }));

  return { timeline: [...monthly.values()], authors, hotspots };
}

async function addCommitSetObjects(repoPath, commits, objectMetrics, pathFilter = '') {
  if (commits.length) {
    const firstCommit = commits[0];
    const lastCommit = commits[commits.length - 1];
    const firstParent = await previousCommit(repoPath, firstCommit.sha);
    const references = [...new Set([firstParent, firstCommit.sha, lastCommit.sha].filter(Boolean))];
    const snapshots = await Promise.all(references.map((reference) => listFilesAtReference(repoPath, reference)));
    const query = pathFilter.trim().replaceAll('\\', '/').toLowerCase();
    for (const files of snapshots) {
      for (const filePath of files) {
        if (!query || filePath.toLowerCase().includes(query)) addObjectPath(objectMetrics, filePath);
      }
    }
  }
  ensureMetric(objectMetrics, '.', 'directory');
}

export async function analyzeRepository(repoPath, filters = {}) {
  const reference = await resolveReference(repoPath, filters.reference || 'HEAD');
  const cacheKey = JSON.stringify([
    repoPath,
    reference,
    filters.author || '',
    filters.path || '',
    filters.since || '',
    filters.until || '',
    filters.commits || '',
    filters.authorMerges || ''
  ]);
  if (analysisCache.has(cacheKey)) {
    const cached = analysisCache.get(cacheKey);
    analysisCache.delete(cacheKey);
    analysisCache.set(cacheKey, cached);
    return cached;
  }

  const manualAuthorMap = parseManualAuthorMerges(filters.authorMerges || '');
  const allCommits = await parseHistory(repoPath, reference, manualAuthorMap);
  const commits = filterChangesByPath(filterCommits(allCommits, filters), filters.path);
  const objectMetrics = new Map();
  const objectAuthors = new Map();
  const authors = [...new Set(allCommits.map((commit) => commit.author))].sort();
  const commitRows = [];
  const fileMetricRows = [];
  const directoryMetricRows = [];

  await addCommitSetObjects(repoPath, commits, objectMetrics, filters.path);

  for (const commit of commits) {
    const changes = commit.changes;
    const touchedObjects = new Set();
    const commitDirectoryMetrics = new Map();
    let commitAdded = 0;
    let commitRemoved = 0;

    function directoryMetricFor(directory) {
      if (!commitDirectoryMetrics.has(directory)) {
        commitDirectoryMetrics.set(directory, { added: 0, removed: 0, growth: 0, churn: 0 });
      }
      return commitDirectoryMetrics.get(directory);
    }

    for (const change of changes) {
      if (change.previousPath) addObjectPath(objectMetrics, change.previousPath);
      const changeChurn = change.added + change.removed;
      const directories = parentDirs(change.path);
      const affected = [
        { path: change.path, type: 'file' },
        ...directories.map((dir) => ({ path: dir, type: 'directory' }))
      ];
      for (const object of affected) {
        const metric = ensureMetric(objectMetrics, object.path, object.type);
        metric.added += change.added;
        metric.removed += change.removed;
        metric.growth += change.added - change.removed;
        metric.churn += changeChurn;

        const authorMetric = ensureAuthorMetric(objectAuthors, object.path, commit.author);
        authorMetric.churn += changeChurn;
        if (changeChurn > 0) touchedObjects.add(object.path);
      }
      fileMetricRows.push({
        commit: commit.sha,
        shortCommit: commit.sha.slice(0, 8),
        date: new Date(commit.timestamp * 1000).toISOString().slice(0, 10),
        author: commit.author,
        path: change.path,
        added: change.added,
        removed: change.removed,
        growth: change.added - change.removed,
        churn: changeChurn
      });
      for (const directory of directories) {
        const directoryMetric = directoryMetricFor(directory);
        directoryMetric.added += change.added;
        directoryMetric.removed += change.removed;
        directoryMetric.growth += change.added - change.removed;
        directoryMetric.churn += changeChurn;
      }
      commitAdded += change.added;
      commitRemoved += change.removed;
    }

    for (const objectPath of touchedObjects) {
      ensureMetric(objectMetrics, objectPath, objectMetrics.get(objectPath)?.type || 'file').modifications += 1;
      ensureAuthorMetric(objectAuthors, objectPath, commit.author).modifications += 1;
    }

    for (const [directory, metric] of commitDirectoryMetrics.entries()) {
      directoryMetricRows.push({
        commit: commit.sha,
        shortCommit: commit.sha.slice(0, 8),
        date: new Date(commit.timestamp * 1000).toISOString().slice(0, 10),
        author: commit.author,
        path: directory,
        ...metric
      });
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

  const repoMetrics = objectMetrics.get('.') || emptyMetrics('directory');
  repoMetrics.modificationFrequency = commitCount ? repoMetrics.modifications / commitCount : 0;
  repoMetrics.churnRate = commitCount ? repoMetrics.churn / commitCount : 0;
  const insights = buildInsights(commitRows, rows, objectAuthors, repoMetrics);

  const result = {
    reference,
    authors,
    commitCount,
    allCommitCount: allCommits.length,
    repoMetrics,
    insights,
    objects: rows,
    commits: commitRows.reverse(),
    fileMetrics: fileMetricRows.reverse(),
    directoryMetrics: directoryMetricRows.reverse()
  };
  analysisCache.set(cacheKey, result);
  while (analysisCache.size > MAX_ANALYSIS_CACHE_ENTRIES) {
    analysisCache.delete(analysisCache.keys().next().value);
  }
  return result;
}
