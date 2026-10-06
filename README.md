# Repo Analysis Tool

A React + TypeScript and Node/Express web dashboard for analyzing how Git repositories change over time.

## Project structure

```text
backend/   Node/Express API and Git metric analyzer
frontend/  React + TypeScript dashboard
docs/      Assignment requirements and project documentation
data/      Local cloned repositories, ignored by Git
```

## Basic version implemented

This baseline focuses on the core assignment workflow first:

- Clone a public remote Git repository URL.
- Store and switch between multiple cloned repositories.
- Analyze non-merge commits reachable from `HEAD` or a user-provided reference commit.
- Normalize authors through Git `.mailmap` using `git check-mailmap`.
- Merge authors manually using dashboard merge rules when `.mailmap` is not enough.
- Ignore binary files by skipping Git `numstat` entries reported as `-`.
- Use Git rename detection with `-M50%`.
- Calculate file, directory, repository, commit-set, and author metrics, including unchanged text files/directories in the selected commit set.
- Filter by author, file/directory path, date range, reference commit, and manually entered commit hashes.

Not yet implemented:

- ZIP upload and extraction.
- Persistent database/cache for large repositories.
- Charts and export views.

The full assignment feature list is in [docs/requirements.md](docs/requirements.md).

## Clone and run locally

This is a public repository. Clone it over HTTPS without an SSH key, GitHub account, password, or personal access token:

```bash
git clone https://github.com/WendyAmahle/repo-analysis-tool.git
cd repo-analysis-tool
```

### Recommended: start script

The start script checks for Git, Node.js, and npm, installs missing project dependencies, and starts both servers:

```bash
./start.sh
```

Then open the dashboard in a browser:

```text
http://127.0.0.1:5173
```

Press `Ctrl+C` in the terminal to stop the app.

### Manual npm commands

The equivalent commands are:

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

## Notes

The backend shells out to the `git` command line, so Git must be installed on the machine running the app. Metrics are calculated on demand from cloned repository history.
