# Repo Analysis Tool Requirements

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

## Basic first version scope

Implemented first:

- Clone a public remote Git repository URL.
- Store and switch between multiple cloned repositories.
- Analyze non-merge commits reachable from `HEAD` or a user-provided reference commit.
- Normalize authors through Git `.mailmap` using `git check-mailmap`.
- Merge authors manually using dashboard merge rules when `.mailmap` is not enough.
- Ignore binary files by skipping Git `numstat` entries reported as `-`.
- Use Git rename detection with `-M50%`.
- Calculate file, directory, repository, commit-set, and author metrics.
- Filter by author, path, date range, reference commit, and manually entered commit hashes.

Deferred:

- ZIP upload and extraction.
- Persistent database/cache for large repositories.
- Charts and export views.
