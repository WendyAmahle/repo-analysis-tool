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
- Analyze non-merge commits reachable from `HEAD`.
- Normalize authors through Git `.mailmap` using `git check-mailmap`.
- Ignore binary files by skipping Git `numstat` entries reported as `-`.
- Use Git rename detection with `-M50%`.
- Calculate file, directory, repository, commit-set, and author metrics.
- Filter by author, file/directory path, date range, and manually entered commit hashes.

Not yet implemented:

- ZIP upload.
- Manual author merge UI.
- Persistent database/cache for large repositories.
- Charts and export views.

The full assignment feature list is in [docs/requirements.md](docs/requirements.md).

## Run locally

Install dependencies:

```bash
npm install
npm run install:all
```

Start both the backend API and frontend dashboard:

```bash
npm run dev
```

Then open:

```text
http://127.0.0.1:5173
```

The backend API runs on:

```text
http://127.0.0.1:3001
```

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
