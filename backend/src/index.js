import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';

import {
  GitAnalysisError,
  analyzeRepository,
  cloneRepository,
  listRepositories,
  safeRepoName
} from './analyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');
const repoDir = path.join(rootDir, 'data', 'repos');
const frontendDistDir = path.join(rootDir, 'frontend', 'dist');
const port = Number(process.env.PORT || 3001);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

function repoPath(repo) {
  return path.join(repoDir, safeRepoName(repo));
}

async function ensureRepository(repo) {
  const target = repoPath(repo);
  await access(path.join(target, '.git'));
  return target;
}

app.get('/api/repos', async (_request, response) => {
  try {
    response.json({ repos: await listRepositories(repoDir) });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post('/api/repos/clone', async (request, response) => {
  const url = String(request.body?.url || '').trim();
  const requestedName = String(request.body?.name || '').trim();
  if (!url) {
    response.status(400).json({ error: 'Repository URL is required.' });
    return;
  }

  const name = safeRepoName(requestedName || url);
  try {
    await cloneRepository(url, path.join(repoDir, name));
    response.status(201).json({ repo: name });
  } catch (error) {
    const status = error instanceof GitAnalysisError ? 400 : 500;
    response.status(status).json({ error: error.message });
  }
});

app.get('/api/repos/:repo/analysis', async (request, response) => {
  try {
    const target = await ensureRepository(request.params.repo);
    const analysis = await analyzeRepository(target, {
      author: String(request.query.author || ''),
      path: String(request.query.path || ''),
      since: String(request.query.since || ''),
      until: String(request.query.until || ''),
      commits: String(request.query.commits || '')
    });
    response.json(analysis);
  } catch (error) {
    const status = error instanceof GitAnalysisError ? 400 : 404;
    response.status(status).json({ error: error.message });
  }
});

app.use(express.static(frontendDistDir));
app.get('*', (_request, response) => {
  response.sendFile(path.join(frontendDistDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Repo Analysis Tool API running on http://127.0.0.1:${port}`);
});
