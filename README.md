# Repo Analysis Tool

A basic web dashboard for analyzing how Git repositories change over time.

## Required features from the brief

- Repository input by remote URL clone.
- Repository input by ZIP upload containing `.git`.
- Multiple repository dashboard support.
- Author identity merging with `.mailmap`.
- Manual author merging when no `.mailmap` is provided.
- File metrics: added lines, removed lines, growth, churn.
- Directory metrics: recursive added lines, removed lines, growth, churn.
- Repository metrics: root directory totals.
- Commit-set metrics: metrics over selected commits or time ranges.
- Author metrics: modifications, churn, ownership per file or directory.
- Filters by repository, author, file/directory, time period, and selected commits.
- Binary file exclusion and rename detection with a 50% threshold.

## Basic first version implemented

This baseline intentionally focuses on the core workflow first:

- Clone a public remote Git repository URL.
- Store and switch between multiple cloned repositories.
- Analyze non-merge commits reachable from `HEAD`.
- Normalize authors through Git `.mailmap` using `git check-mailmap`.
- Ignore binary files by skipping Git `numstat` entries reported as `-`.
- Use Git rename detection with `-M50%`.
- Calculate file, directory, repository, commit-set, and author metrics.
- Filter by author, path, date range, and manually entered commit hashes.

Not yet implemented:

- ZIP upload.
- Manual author merge UI.
- Persistent database/cache for large repositories.
- Charts and export views.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Then open `http://127.0.0.1:5000`.

## Notes

The app shells out to `git`, so Git must be installed on the machine running the app. Metrics are calculated on demand from the cloned repository history.
