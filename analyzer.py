import os
import re
import shutil
import subprocess
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


@dataclass
class CommitInfo:
    sha: str
    author: str
    email: str
    timestamp: int
    subject: str


class GitAnalysisError(RuntimeError):
    pass


def run_git(repo_path: Path, args: List[str]) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo_path), *args],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        raise GitAnalysisError(result.stderr.strip() or "git command failed")
    return result.stdout


def clone_repository(url: str, destination: Path) -> None:
    if destination.exists():
        raise GitAnalysisError("A repository with this name already exists.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["git", "clone", "--quiet", url, str(destination)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        if destination.exists():
            shutil.rmtree(destination)
        raise GitAnalysisError(result.stderr.strip() or "Unable to clone repository.")


def list_repositories(base_dir: Path) -> List[str]:
    base_dir.mkdir(parents=True, exist_ok=True)
    return sorted(p.name for p in base_dir.iterdir() if (p / ".git").exists())


def safe_repo_name(url: str) -> str:
    name = url.rstrip("/").split("/")[-1]
    if name.endswith(".git"):
        name = name[:-4]
    name = re.sub(r"[^A-Za-z0-9_.-]+", "-", name).strip(".-")
    return name or "repository"


def normalise_author(repo_path: Path, name: str, email: str) -> str:
    identity = f"{name} <{email}>"
    try:
        mapped = run_git(repo_path, ["check-mailmap", identity]).strip()
        return mapped or identity
    except GitAnalysisError:
        return identity


def parse_commits(repo_path: Path) -> List[CommitInfo]:
    raw = run_git(
        repo_path,
        [
            "log",
            "--no-merges",
            "--reverse",
            "--format=%H%x1f%an%x1f%ae%x1f%ct%x1f%s%x1e",
            "HEAD",
        ],
    )
    commits: List[CommitInfo] = []
    for record in raw.split("\x1e"):
        record = record.strip("\n")
        if not record:
            continue
        parts = record.split("\x1f")
        if len(parts) < 5:
            continue
        sha, name, email, timestamp, subject = parts[:5]
        commits.append(
            CommitInfo(
                sha=sha,
                author=normalise_author(repo_path, name, email),
                email=email,
                timestamp=int(timestamp),
                subject=subject,
            )
        )
    return commits


def rename_target(path: str) -> str:
    if " => " not in path:
        return path
    if "{" in path and "}" in path:
        prefix = path[: path.find("{")]
        inside = path[path.find("{") + 1 : path.find("}")]
        suffix = path[path.find("}") + 1 :]
        target = inside.split(" => ")[-1]
        return f"{prefix}{target}{suffix}"
    return path.split(" => ")[-1]


def parent_dirs(file_path: str) -> Iterable[str]:
    yield "."
    current = Path(file_path).parent
    parts = [] if str(current) == "." else current.parts
    for i in range(1, len(parts) + 1):
        yield "/".join(parts[:i])


def parse_numstat(repo_path: Path, sha: str) -> List[Tuple[str, int, int]]:
    raw = run_git(repo_path, ["diff-tree", "--root", "--no-commit-id", "--numstat", "-M50%", "-r", sha])
    changes: List[Tuple[str, int, int]] = []
    for line in raw.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        added, removed = parts[0], parts[1]
        if added == "-" or removed == "-":
            continue
        path = rename_target("\t".join(parts[2:]))
        changes.append((path, int(added), int(removed)))
    return changes


def parse_date(value: str) -> Optional[int]:
    if not value:
        return None
    dt = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def filter_commits(
    commits: List[CommitInfo],
    since: Optional[int] = None,
    until: Optional[int] = None,
    selected: Optional[List[str]] = None,
) -> List[CommitInfo]:
    selected_set = {s.strip() for s in selected or [] if s.strip()}
    filtered = []
    for commit in commits:
        if since is not None and commit.timestamp < since:
            continue
        if until is not None and commit.timestamp >= until:
            continue
        if selected_set and not any(commit.sha.startswith(s) for s in selected_set):
            continue
        filtered.append(commit)
    return filtered


def empty_metrics() -> Dict[str, float]:
    return {
        "added": 0,
        "removed": 0,
        "growth": 0,
        "churn": 0,
        "modifications": 0,
        "modification_frequency": 0,
        "churn_rate": 0,
    }


def analyze_repository(
    repo_path: Path,
    author_filter: str = "",
    path_filter: str = "",
    since_date: str = "",
    until_date: str = "",
    selected_commits: str = "",
) -> Dict:
    all_commits = parse_commits(repo_path)
    selected = re.split(r"[\s,]+", selected_commits.strip()) if selected_commits.strip() else []
    commits = filter_commits(all_commits, parse_date(since_date), parse_date(until_date), selected)

    object_metrics: Dict[str, Dict[str, float]] = defaultdict(empty_metrics)
    object_authors: Dict[str, Dict[str, Dict[str, float]]] = defaultdict(lambda: defaultdict(lambda: {"churn": 0, "modifications": 0}))
    authors = sorted({c.author for c in all_commits})
    commit_rows = []

    for commit in commits:
        changes = parse_numstat(repo_path, commit.sha)
        touched_objects = set()
        commit_added = 0
        commit_removed = 0
        for file_path, added, removed in changes:
            affected = [(file_path, "file"), *[(d, "directory") for d in parent_dirs(file_path)]]
            for object_path, kind in affected:
                metric = object_metrics[object_path]
                metric["type"] = kind
                metric["added"] += added
                metric["removed"] += removed
                metric["growth"] += added - removed
                metric["churn"] += added + removed
                touched_objects.add(object_path)

                author_metric = object_authors[object_path][commit.author]
                author_metric["churn"] += added + removed
            commit_added += added
            commit_removed += removed

        for object_path in touched_objects:
            object_metrics[object_path]["modifications"] += 1
            object_authors[object_path][commit.author]["modifications"] += 1

        commit_rows.append(
            {
                "sha": commit.sha,
                "short_sha": commit.sha[:8],
                "author": commit.author,
                "date": datetime.fromtimestamp(commit.timestamp, tz=timezone.utc).strftime("%Y-%m-%d"),
                "subject": commit.subject,
                "added": commit_added,
                "removed": commit_removed,
                "churn": commit_added + commit_removed,
            }
        )

    commit_count = len(commits)
    rows = []
    for path, metric in object_metrics.items():
        if path_filter and path_filter.lower() not in path.lower():
            continue
        if metric.get("type") not in {"file", "directory"}:
            continue
        metric["modification_frequency"] = metric["modifications"] / commit_count if commit_count else 0
        metric["churn_rate"] = metric["churn"] / commit_count if commit_count else 0

        author_rows = []
        for author, values in object_authors[path].items():
            if author_filter and author_filter != author:
                continue
            ownership = values["churn"] / metric["churn"] if metric["churn"] else 0
            author_rows.append({"author": author, **values, "ownership": ownership})
        if author_filter and not author_rows:
            continue
        rows.append({"path": path, **metric, "authors": sorted(author_rows, key=lambda r: r["churn"], reverse=True)})

    rows.sort(key=lambda r: (r["type"] != "directory", -r["churn"], r["path"]))
    repo_metric = object_metrics.get(".", empty_metrics())
    repo_metric["modification_frequency"] = repo_metric["modifications"] / commit_count if commit_count else 0
    repo_metric["churn_rate"] = repo_metric["churn"] / commit_count if commit_count else 0

    return {
        "authors": authors,
        "commit_count": commit_count,
        "all_commit_count": len(all_commits),
        "repo_metrics": repo_metric,
        "objects": rows,
        "commits": list(reversed(commit_rows)),
    }
