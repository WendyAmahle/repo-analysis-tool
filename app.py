from pathlib import Path

from flask import Flask, redirect, render_template, request, url_for

from analyzer import GitAnalysisError, analyze_repository, clone_repository, list_repositories, safe_repo_name


BASE_DIR = Path(__file__).resolve().parent
REPO_DIR = BASE_DIR / "data" / "repos"

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024


@app.route("/", methods=["GET", "POST"])
def index():
    message = ""
    error = ""
    if request.method == "POST":
        url = request.form.get("repo_url", "").strip()
        custom_name = request.form.get("repo_name", "").strip()
        if not url:
            error = "Enter a remote Git repository URL."
        else:
            repo_name = safe_repo_name(custom_name or url)
            destination = REPO_DIR / repo_name
            try:
                clone_repository(url, destination)
                return redirect(url_for("dashboard", repo=repo_name))
            except GitAnalysisError as exc:
                error = str(exc)

    return render_template("index.html", repos=list_repositories(REPO_DIR), message=message, error=error)


@app.route("/repo/<repo>")
def dashboard(repo: str):
    repo_path = REPO_DIR / repo
    if not (repo_path / ".git").exists():
        return redirect(url_for("index"))

    filters = {
        "author": request.args.get("author", ""),
        "path": request.args.get("path", ""),
        "since": request.args.get("since", ""),
        "until": request.args.get("until", ""),
        "commits": request.args.get("commits", ""),
    }
    error = ""
    analysis = None
    try:
        analysis = analyze_repository(
            repo_path,
            author_filter=filters["author"],
            path_filter=filters["path"],
            since_date=filters["since"],
            until_date=filters["until"],
            selected_commits=filters["commits"],
        )
    except GitAnalysisError as exc:
        error = str(exc)

    return render_template(
        "dashboard.html",
        repo=repo,
        repos=list_repositories(REPO_DIR),
        analysis=analysis,
        filters=filters,
        error=error,
    )


if __name__ == "__main__":
    app.run(debug=True)
