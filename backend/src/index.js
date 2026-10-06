import cors from 'cors';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';

import {
  GitAnalysisError,
  analyzeRepository,
  cloneRepository,
  importRepositoryZip,
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
const zipUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1,
    fields: 2,
    fieldSize: 200
  }
});
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

app.post('/api/repos/upload', zipUpload.single('archive'), async (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: 'A ZIP archive is required.' });
    return;
  }
  if (!request.file.originalname.toLowerCase().endsWith('.zip')) {
    response.status(400).json({ error: 'The uploaded file must use the .zip extension.' });
    return;
  }

  const requestedName = String(request.body?.name || '').trim();
  const archiveName = request.file.originalname.replace(/\.zip$/i, '');
  const name = safeRepoName(requestedName || archiveName);
  try {
    await importRepositoryZip(request.file.buffer, path.join(repoDir, name));
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
      commits: String(request.query.commits || ''),
      reference: String(request.query.reference || ''),
      authorMerges: String(request.query.authorMerges || '')
    });
    response.json(analysis);
  } catch (error) {
    const status = error instanceof GitAnalysisError ? 400 : 404;
    response.status(status).json({ error: error.message });
  }
});

app.use((error, _request, response, next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'ZIP archive must not exceed 50 MB.'
      : 'Invalid ZIP upload request.';
    response.status(400).json({ error: message });
    return;
  }
  next(error);
});

app.use(express.static(frontendDistDir));
app.get('*', (_request, response) => {
  response.sendFile(path.join(frontendDistDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Repo Analysis Tool API running on http://127.0.0.1:${port}`);
});
