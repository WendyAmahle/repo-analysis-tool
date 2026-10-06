import { FormEvent, useEffect, useMemo, useState } from 'react';

type RepoMetrics = {
  added: number;
  removed: number;
  growth: number;
  churn: number;
  modifications: number;
  modificationFrequency: number;
  churnRate: number;
};

type AuthorMetric = {
  author: string;
  churn: number;
  modifications: number;
  ownership: number;
};

type ObjectMetric = RepoMetrics & {
  path: string;
  type: 'file' | 'directory';
  authors: AuthorMetric[];
};

type CommitRow = {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  subject: string;
  added: number;
  removed: number;
  churn: number;
};

type FileMetricRow = {
  commit: string;
  shortCommit: string;
  date: string;
  author: string;
  path: string;
  added: number;
  removed: number;
  growth: number;
  churn: number;
};

type DirectoryMetricRow = FileMetricRow;

type Analysis = {
  reference: string;
  authors: string[];
  commitCount: number;
  allCommitCount: number;
  repoMetrics: RepoMetrics;
  objects: ObjectMetric[];
  commits: CommitRow[];
  fileMetrics: FileMetricRow[];
  directoryMetrics: DirectoryMetricRow[];
};

type Filters = {
  author: string;
  path: string;
  since: string;
  until: string;
  commits: string;
  reference: string;
  authorMerges: string;
};

const emptyFilters: Filters = {
  author: '',
  path: '',
  since: '',
  until: '',
  commits: '',
  reference: '',
  authorMerges: ''
};

function formatDecimal(value: number): string {
  return value.toFixed(2);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }
  return data as T;
}

function App() {
  const [repos, setRepos] = useState<string[]>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function loadRepos(nextRepo?: string) {
    const data = await fetchJson<{ repos: string[] }>('/api/repos');
    setRepos(data.repos);
    if (nextRepo) {
      setSelectedRepo(nextRepo);
    } else if (!selectedRepo && data.repos.length > 0) {
      setSelectedRepo(data.repos[0]);
    }
  }

  async function loadAnalysis() {
    if (!selectedRepo) {
      setAnalysis(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      (Object.entries(filters) as [keyof Filters, string][]).forEach(([key, value]) => {
        if (value.trim()) params.set(key, value.trim());
      });
      const query = params.toString() ? `?${params.toString()}` : '';
      const data = await fetchJson<Analysis>(`/api/repos/${encodeURIComponent(selectedRepo)}/analysis${query}`);
      setAnalysis(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to analyze repository.');
      setAnalysis(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRepos().catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load repositories.'));
  }, []);

  useEffect(() => {
    loadAnalysis();
  }, [selectedRepo]);

  const visibleCommits = useMemo(() => analysis?.commits.slice(0, 100) ?? [], [analysis]);
  const visibleFileMetrics = useMemo(() => analysis?.fileMetrics.slice(0, 200) ?? [], [analysis]);
  const visibleDirectoryMetrics = useMemo(() => analysis?.directoryMetrics.slice(0, 200) ?? [], [analysis]);

  async function handleClone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const data = await fetchJson<{ repo: string }>('/api/repos/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cloneUrl, name: cloneName })
      });
      setCloneUrl('');
      setCloneName('');
      setMessage(`Cloned ${data.repo}.`);
      await loadRepos(data.repo);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to clone repository.');
    } finally {
      setLoading(false);
    }
  }

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loadAnalysis();
  }

  return (
    <>
      <header>
        <h1>Repo Analysis Tool</h1>
      </header>
      <main>
        {error && <p className="alert error">{error}</p>}
        {message && <p className="alert success">{message}</p>}

        <section className="card">
          <h2>Add repository</h2>
          <form onSubmit={handleClone} className="grid form-grid">
            <label>
              Repository URL
              <input value={cloneUrl} onChange={(event) => setCloneUrl(event.target.value)} placeholder="https://github.com/DaveGamble/cJSON.git" required />
            </label>
            <label>
              Local name, optional
              <input value={cloneName} onChange={(event) => setCloneName(event.target.value)} placeholder="cJSON" />
            </label>
            <button type="submit" disabled={loading}>{loading ? 'Working...' : 'Clone and analyze'}</button>
          </form>
        </section>

        <section className="card">
          <h2>Repository</h2>
          {repos.length ? (
            <label>
              Select repository
              <select value={selectedRepo} onChange={(event) => setSelectedRepo(event.target.value)}>
                {repos.map((repo) => <option key={repo} value={repo}>{repo}</option>)}
              </select>
            </label>
          ) : (
            <p className="muted">No cloned repositories yet. Clone a public repository URL to begin.</p>
          )}
        </section>

        {selectedRepo && (
          <section className="card">
            <h2>Filters</h2>
            <form onSubmit={handleFilterSubmit}>
              <div className="grid form-grid">
                <label>
                  Author
                  <select value={filters.author} onChange={(event) => setFilters({ ...filters, author: event.target.value })}>
                    <option value="">All authors</option>
                    {analysis?.authors.map((author) => <option key={author} value={author}>{author}</option>)}
                  </select>
                </label>
                <label>
                  File or directory
                  <input value={filters.path} onChange={(event) => setFilters({ ...filters, path: event.target.value })} placeholder="src or README.md" />
                </label>
                <label>
                  From date
                  <input type="date" value={filters.since} onChange={(event) => setFilters({ ...filters, since: event.target.value })} />
                </label>
                <label>
                  Until date
                  <input type="date" value={filters.until} onChange={(event) => setFilters({ ...filters, until: event.target.value })} />
                </label>
                <label>
                  Reference commit
                  <input value={filters.reference} onChange={(event) => setFilters({ ...filters, reference: event.target.value })} placeholder="HEAD or commit hash" />
                </label>
              </div>
              <label>
                Selected commits, optional
                <textarea value={filters.commits} onChange={(event) => setFilters({ ...filters, commits: event.target.value })} rows={2} placeholder="Paste commit hashes separated by commas or spaces" />
              </label>
              <label>
                Manual author merges, optional
                <textarea value={filters.authorMerges} onChange={(event) => setFilters({ ...filters, authorMerges: event.target.value })} rows={3} placeholder="Canonical Name <email@example.com> = Alias Name <old@example.com>, Another Alias <email@example.com>" />
              </label>
              <button type="submit" disabled={loading}>{loading ? 'Analyzing...' : 'Apply filters'}</button>
            </form>
          </section>
        )}

        {analysis && (
          <>
            <section className="card">
              <h2>Repository metrics</h2>
              <p className="muted">Metrics cover {analysis.commitCount} selected non-merge commits from {analysis.allCommitCount} total non-merge commits reachable from <code>{analysis.reference.slice(0, 12)}</code>.</p>
              <div className="grid metrics">
                <MetricCard label="Added lines" value={analysis.repoMetrics.added} />
                <MetricCard label="Removed lines" value={analysis.repoMetrics.removed} />
                <MetricCard label="Growth" value={analysis.repoMetrics.growth} />
                <MetricCard label="Churn" value={analysis.repoMetrics.churn} />
                <MetricCard label="Modifications" value={analysis.repoMetrics.modifications} />
                <MetricCard label="Churn rate" value={formatDecimal(analysis.repoMetrics.churnRate)} />
              </div>
            </section>

            <section className="card table-card">
              <h2>File and directory metrics</h2>
              <table>
                <thead>
                  <tr>
                    <th>Path</th><th>Type</th><th>Added</th><th>Removed</th><th>Growth</th><th>Churn</th><th>Mods</th><th>Freq</th><th>Top authors</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.objects.map((row) => (
                    <tr key={`${row.type}-${row.path}`}>
                      <td><code>{row.path}</code></td>
                      <td>{row.type}</td>
                      <td>{row.added}</td>
                      <td>{row.removed}</td>
                      <td>{row.growth}</td>
                      <td>{row.churn}</td>
                      <td>{row.modifications}</td>
                      <td>{formatDecimal(row.modificationFrequency)}</td>
                      <td>{row.authors.slice(0, 3).map((author) => <div key={author.author}>{author.author}: {author.churn} churn, {formatPercent(author.ownership)}</div>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!analysis.objects.length && <p className="muted">No matching metrics for the current filters.</p>}
            </section>

            <section className="card table-card">
              <h2>Per-commit file metrics</h2>
              <p className="muted">For each changed file: growth = added − removed, churn = added + removed.</p>
              <table>
                <thead>
                  <tr><th>Commit</th><th>Date</th><th>Author</th><th>File</th><th>Added</th><th>Removed</th><th>Growth</th><th>Churn</th></tr>
                </thead>
                <tbody>
                  {visibleFileMetrics.map((row) => (
                    <tr key={`${row.commit}-${row.path}`}>
                      <td><code>{row.shortCommit}</code></td>
                      <td>{row.date}</td>
                      <td>{row.author}</td>
                      <td><code>{row.path}</code></td>
                      <td>{row.added}</td>
                      <td>{row.removed}</td>
                      <td>{row.growth}</td>
                      <td>{row.churn}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleFileMetrics.length && <p className="muted">No file metric rows for the current filters.</p>}
            </section>

            <section className="card table-card">
              <h2>Per-commit directory metrics</h2>
              <p className="muted">For each changed directory: growth = added − removed, churn = added + removed across immediate children and nested subdirectories.</p>
              <table>
                <thead>
                  <tr><th>Commit</th><th>Date</th><th>Author</th><th>Directory</th><th>Added</th><th>Removed</th><th>Growth</th><th>Churn</th></tr>
                </thead>
                <tbody>
                  {visibleDirectoryMetrics.map((row) => (
                    <tr key={`${row.commit}-${row.path}`}>
                      <td><code>{row.shortCommit}</code></td>
                      <td>{row.date}</td>
                      <td>{row.author}</td>
                      <td><code>{row.path}</code></td>
                      <td>{row.added}</td>
                      <td>{row.removed}</td>
                      <td>{row.growth}</td>
                      <td>{row.churn}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleDirectoryMetrics.length && <p className="muted">No directory metric rows for the current filters.</p>}
            </section>

            <section className="card table-card">
              <h2>Commits in current set</h2>
              <table>
                <thead>
                  <tr><th>Commit</th><th>Date</th><th>Author</th><th>Added</th><th>Removed</th><th>Churn</th><th>Subject</th></tr>
                </thead>
                <tbody>
                  {visibleCommits.map((commit) => (
                    <tr key={commit.sha}>
                      <td><code>{commit.shortSha}</code></td>
                      <td>{commit.date}</td>
                      <td>{commit.author}</td>
                      <td>{commit.added}</td>
                      <td>{commit.removed}</td>
                      <td>{commit.churn}</td>
                      <td>{commit.subject}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </main>
    </>
  );
}

function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric-card">
      <div className="metric-value">{value}</div>
      <div>{label}</div>
    </div>
  );
}

export default App;
