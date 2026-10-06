# Repo Analysis Tool

A web dashboard that analyzes Git history and shows who changed each file or directory, how often it changed, and how many lines were added or removed.

## What the app does

Repo Analysis Tool (RAT) accepts a complete Git repository from a remote clone URL or a ZIP archive containing its `.git` directory. It reads non-merge commits reachable from a selected reference commit, calculates change metrics with the Git command-line tools, and displays repository, directory, file, commit-set, per-commit, and author results in one dashboard.

A typical workflow is:

1. Clone a repository URL or upload a repository ZIP.
2. Select one of the stored repositories.
3. Choose a reference commit and optionally filter by author, path, dates, or commit hashes.
4. Review overall totals, object-level metrics, per-commit file/directory changes, and author ownership.

## Technology stack

| Layer | Technologies |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, HTML, CSS |
| Backend | Node.js, Express, JavaScript |
| Upload processing | Multer and yauzl |
| Repository analysis | Git CLI through Node.js `child_process` |
| Development tooling | npm and concurrently |

## Project structure

```text
backend/   Node/Express API and Git metric analyzer
frontend/  React + TypeScript dashboard
docs/      Assignment requirements and project documentation
data/      Locally cloned or uploaded repositories, ignored by Git
```

## Features implemented

### Repository ingestion and management

- Clone a complete public Git repository from a remote URL.
- Upload a ZIP of up to 50 MB containing one repository and its `.git` directory.
- Accept `.git` at the ZIP root or inside one top-level folder.
- Store, list, select, and analyze multiple repositories.
- Reject unsafe archive paths, encrypted archives, special files, duplicate paths, and excessive extraction sizes.

### Git history and filtering

- Analyze non-merge commits reachable from `HEAD` or a selected reference commit.
- Use Git commit timestamps for date-range filtering.
- Filter by repository, normalized author, file/directory path, date range, and explicit commit hashes.
- Include unchanged text files and directories in the selected commit set with zero-valued metrics.
- Normalize identities with `.mailmap` and support manual author merge rules from the dashboard.

### Metrics and dashboard

- File metrics: added lines, removed lines, growth, and churn.
- Directory metrics: recursive totals from all descendant files.
- Repository metrics: root-directory totals for the selected commit set.
- Commit-set metrics: modifications, modification frequency, and churn rate.
- Author metrics: modifications, churn, and ownership for each file or directory.
- Per-commit tables for file and directory changes, plus a commit summary table.
- Binary-file exclusion using Git `numstat` and rename detection at a 50% similarity threshold (`-M50%`).

The formulas used are:

- `growth = added lines - removed lines`
- `churn = added lines + removed lines`
- `modification frequency = modifications / selected commits`
- `churn rate = churn / selected commits`
- `ownership = author churn / object churn`

The complete assignment checklist is in [docs/requirements.md](docs/requirements.md).

## Setup and run locally

### Prerequisites

Install these tools before starting:

- Node.js 18 or newer
- npm
- Git

This is a public repository. Clone it over HTTPS without an SSH key, GitHub account, password, or personal access token:

```bash
git clone https://github.com/WendyAmahle/repo-analysis-tool.git
cd repo-analysis-tool
```

### Recommended setup

The executable start script checks for Git, Node.js, and npm, installs project dependencies when needed, and starts both development servers:

```bash
./start.sh
```

Then open the dashboard in a browser:

```text
http://127.0.0.1:5173
```

Press `Ctrl+C` in the terminal to stop the app.

### Manual setup

If the start script cannot be used, run the equivalent npm commands:

```bash
npm install
npm run install:all
npm run dev
```

The frontend runs at `http://127.0.0.1:5173`. The backend API runs at `http://127.0.0.1:3001`.

## Build

```bash
npm run build
```

After building, run the backend server:

```bash
npm start
```

Then open:

```text
http://127.0.0.1:3001
```

## Usage notes

- A ZIP upload must contain the repository's `.git` directory; a source-code-only GitHub ZIP does not contain history and cannot be analyzed.
- Repository data is stored locally under `data/repos/` and is not committed to this project.
- Metrics are calculated on demand, so repositories with long histories can take more time to process.
- The backend shells out to the installed `git` command, keeping rename, mailmap, binary, and history behavior aligned with Git itself.
