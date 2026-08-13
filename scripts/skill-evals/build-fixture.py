#!/usr/bin/env python3
"""
Build a synthetic git fixture that exercises the vendored skills.

## Why this exists

Two jobs, one artefact.

**Evals.** The vendored skills are third-party code that DevHub syncs to every
machine and runs with the agent's full permissions. `skills:verify-vendor`
proves they can't reach the network; it says nothing about whether they still
*work*. A re-vendor that quietly breaks rename-following in the archaeologist
passes every check we have. Asserting behaviour needs a repository whose history
we control, because "does it find the revert" is only answerable if we planted
one.

**Demos.** `docs/contributing/recording-demos.md` requires disposable fixtures
and reviewing every frame for names, tokens and private content. Recording these
skills against real repositories means real commit subjects, real author emails
and a list of the user's abandoned projects. This fixture has none of that, so a
recording made against it is publishable without redaction.

Building it once for both is not a coincidence: a demo is an eval you can watch.

## Determinism

Every commit pins `GIT_AUTHOR_DATE`, `GIT_COMMITTER_DATE`, name and email, so
the same inputs produce the same commit hashes on every machine. That matters
more than it sounds:

- Evals can assert on ordering and counts without tolerating drift.
- A re-recorded demo differs only where behaviour actually changed, so the diff
  in a GIF is signal rather than noise.

Dates are computed backwards from a fixed epoch rather than from `now()`, for
the same reason. `project-graveyard` decides death by age, so a fixture built
from `now()` would change category as it aged on the shelf — the classic
fixture that passes in January and fails in March.

## Usage

    python3 scripts/skill-evals/build-fixture.py /tmp/devhub-skill-fixture

Writes three repositories under the target directory and prints a JSON summary
of what was planted, so an eval can assert against intent rather than against
hardcoded strings duplicated in two places.
"""

import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone

# Fixed reference point. Not "now" — see the Determinism note above.
EPOCH = datetime(2026, 1, 15, 9, 0, 0, tzinfo=timezone.utc)

AUTHOR_NAME = "Fixture Author"
AUTHOR_EMAIL = "fixture@example.invalid"
OTHER_NAME = "Second Author"
OTHER_EMAIL = "second@example.invalid"


def run(args, cwd, env_extra=None):
    env = os.environ.copy()
    env.update({
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_SYSTEM": os.devnull,
        "GIT_TERMINAL_PROMPT": "0",
    })
    if env_extra:
        env.update(env_extra)
    result = subprocess.run(
        args, cwd=cwd, env=env, capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "git %s failed in %s: %s" % (" ".join(args[1:]), cwd, result.stderr.strip())
        )
    return result.stdout


def init_repo(path):
    os.makedirs(path, exist_ok=True)
    run(["git", "init", "--initial-branch=main", "-q"], cwd=path)
    run(["git", "config", "user.name", AUTHOR_NAME], cwd=path)
    run(["git", "config", "user.email", AUTHOR_EMAIL], cwd=path)
    run(["git", "config", "commit.gpgsign", "false"], cwd=path)


def write(path, relative, content):
    full = os.path.join(path, relative)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as handle:
        handle.write(content)


def commit(path, message, days_before, author=None):
    """Commit staged-everything at a fixed point relative to EPOCH."""
    when = (EPOCH - timedelta(days=days_before)).isoformat()
    name, email = author or (AUTHOR_NAME, AUTHOR_EMAIL)
    run(["git", "add", "-A"], cwd=path)
    run(
        ["git", "commit", "-q", "-m", message],
        cwd=path,
        env_extra={
            "GIT_AUTHOR_DATE": when,
            "GIT_COMMITTER_DATE": when,
            "GIT_AUTHOR_NAME": name,
            "GIT_AUTHOR_EMAIL": email,
            "GIT_COMMITTER_NAME": name,
            "GIT_COMMITTER_EMAIL": email,
        },
    )
    return run(["git", "rev-parse", "HEAD"], cwd=path).strip()


# --------------------------------------------------------------------------
# Repo 1: history-rich, for commit-archaeologist
# --------------------------------------------------------------------------

def build_archaeology_repo(root):
    """
    A file whose history answers "why does this exist".

    Plants one of each signal the archaeologist claims to detect, so a missing
    finding is a regression rather than a gap in the fixture:

      - an issue reference (#101)
      - a revert
      - a workaround, described as temporary
      - a companion file that co-changes on most commits (tests/test_cache.py)
      - a second author, so blame and timeline authorship can disagree
    """
    path = os.path.join(root, "archaeology-repo")
    init_repo(path)
    planted = {}

    write(path, "README.md", "# archaeology-repo\n\nFixture for commit-archaeologist.\n")
    write(path, "src/cache.py", "def get(key):\n    return STORE.get(key)\n\n\nSTORE = {}\n")
    write(path, "tests/test_cache.py", "def test_get():\n    assert True\n")
    planted["introduced"] = commit(path, "feat(cache): add in-memory store for #101", 120)

    write(path, "src/cache.py",
          "def get(key):\n    return STORE.get(key)\n\n\ndef purge(key):\n"
          "    STORE.pop(key, None)\n\n\nSTORE = {}\n")
    write(path, "tests/test_cache.py", "def test_get():\n    assert True\n\n\ndef test_purge():\n    assert True\n")
    commit(path, "feat(cache): add purge", 100)

    # Workaround + temporary: the two strongest intent words the skill looks for.
    write(path, "src/cache.py",
          "def get(key):\n    # workaround: upstream returns stale keys, drop them here.\n"
          "    # temporary until the upstream fix lands.\n    value = STORE.get(key)\n"
          "    return None if value == STALE else value\n\n\ndef purge(key):\n"
          "    STORE.pop(key, None)\n\n\nSTALE = object()\nSTORE = {}\n")
    write(path, "tests/test_cache.py",
          "def test_get():\n    assert True\n\n\ndef test_purge():\n    assert True\n\n\n"
          "def test_stale():\n    assert True\n")
    planted["workaround"] = commit(
        path, "fix(cache): workaround for stale upstream keys (temporary)", 80,
        author=(OTHER_NAME, OTHER_EMAIL),
    )

    write(path, "src/cache.py",
          "def get(key):\n    return STORE.get(key)\n\n\ndef purge(key):\n"
          "    STORE.pop(key, None)\n\n\nSTORE = {}\n")
    write(path, "tests/test_cache.py", "def test_get():\n    assert True\n\n\ndef test_purge():\n    assert True\n")
    planted["revert"] = commit(path, "Revert \"fix(cache): workaround for stale upstream keys\"", 60)

    # An unrelated file, so co-change ranking has something to *not* pick.
    write(path, "docs/notes.md", "Unrelated documentation.\n")
    commit(path, "docs: add notes", 40)

    return {
        "path": path,
        "target_file": "src/cache.py",
        "companion_file": "tests/test_cache.py",
        "unrelated_file": "docs/notes.md",
        "commits": planted,
        "expected_signals": ["issue_reference", "workaround", "temporary", "revert"],
        "authors": [AUTHOR_EMAIL, OTHER_EMAIL],
    }


# --------------------------------------------------------------------------
# Repo 2: a branch that visibly overran its intent, for scope-creep-detector
# --------------------------------------------------------------------------

def build_scope_repo(root):
    """
    A branch whose stated intent is "fix cache expiry" and which also:

      - adds a dependency (requirements.txt)
      - renames a public function (api/handlers.py)
      - edits CI (.github/workflows/ci.yml)
      - touches an unrelated subsystem (billing/invoice.py)

    Each is a different signal, so a report that collapses them into one bucket
    is visibly wrong.
    """
    path = os.path.join(root, "scope-repo")
    init_repo(path)

    write(path, "README.md", "# scope-repo\n\nFixture for scope-creep-detector.\n")
    write(path, "src/cache.py", "EXPIRY = 60\n\n\ndef expired(age):\n    return age > EXPIRY\n")
    write(path, "api/handlers.py", "def handle_request(req):\n    return req\n")
    write(path, "billing/invoice.py", "def total(items):\n    return sum(items)\n")
    write(path, "requirements.txt", "click\n")
    write(path, ".github/workflows/ci.yml", "name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n")
    commit(path, "chore: initial project", 30)
    base = run(["git", "rev-parse", "HEAD"], cwd=path).strip()

    run(["git", "checkout", "-q", "-b", "fix-cache-expiry"], cwd=path)

    # In scope: the thing the intent names.
    write(path, "src/cache.py",
          "EXPIRY = 60\n\n\ndef expired(age):\n    if age is None:\n        return False\n    return age > EXPIRY\n")
    # Creep: new dependency.
    write(path, "requirements.txt", "click\nrequests\n")
    # Creep: public API rename.
    write(path, "api/handlers.py", "def process_request(req):\n    return req\n")
    # Creep: unrelated subsystem.
    write(path, "billing/invoice.py", "def total(items):\n    return sum(items) * 1.2\n")
    # Creep: CI edit.
    write(path, ".github/workflows/ci.yml",
          "name: ci\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n")
    commit(path, "fix cache expiry and some other bits", 20)

    return {
        "path": path,
        "base": base,
        "branch": "fix-cache-expiry",
        "intent": "fix cache expiry",
        "in_scope": ["src/cache.py"],
        "expect_creep": [
            "requirements.txt", "api/handlers.py",
            "billing/invoice.py", ".github/workflows/ci.yml",
        ],
        "expect_new_dep": "requests",
        "expect_rename": {"from": "handle_request", "to": "process_request"},
    }


# --------------------------------------------------------------------------
# Repo 3+: a small graveyard, for project-graveyard
# --------------------------------------------------------------------------

def build_graveyard_repos(root):
    """
    Three corpses with different shapes, under their own root so a scan can be
    pointed at them without touching anything real.

    Ages are relative to EPOCH, so whether these read as "dead" depends on the
    --days threshold and the date the eval passes in, not on when the fixture
    was built.
    """
    graveyard_root = os.path.join(root, "graveyard")
    os.makedirs(graveyard_root, exist_ok=True)
    repos = []

    # Long-lived then abandoned.
    path = os.path.join(graveyard_root, "tab-sensei")
    init_repo(path)
    for index, days in enumerate([300, 290, 280, 270, 260]):
        write(path, "README.md", "# tab-sensei\n\nA browser tab manager.\n")
        write(path, "src/main.py", "print('tab sensei %d')\n" % index)
        commit(path, "feat: iteration %d" % index, days)
    repos.append({"name": "tab-sensei", "commits": 5})

    # One-day burst, never reopened.
    path = os.path.join(graveyard_root, "recipe-scraper")
    init_repo(path)
    write(path, "README.md", "# recipe-scraper\n")
    write(path, "scrape.py", "print('scrape')\n")
    commit(path, "initial commit", 200)
    repos.append({"name": "recipe-scraper", "commits": 1})

    # Died at the payments wall: the final commits touch payment code, which is
    # the signal the cause taxonomy keys on. Without a planted cause, every
    # corpse reports "unknown" and the eval proves only that the scanner runs.
    path = os.path.join(graveyard_root, "side-hustle")
    init_repo(path)
    write(path, "README.md", "# side-hustle\n\nA thing people would pay for.\n")
    write(path, "src/app.py", "print('app')\n")
    commit(path, "feat: core app", 250)
    write(path, "src/app.py", "print('app v2')\n")
    commit(path, "feat: polish", 240)
    write(path, "src/payments.py", "STRIPE_KEY = None\n\n\ndef checkout(cart):\n    raise NotImplementedError\n")
    write(path, "src/billing.py", "def subscription(plan):\n    raise NotImplementedError\n")
    commit(path, "wip: stripe checkout and billing", 230)
    repos.append({"name": "side-hustle", "commits": 3, "expected_cause": "payments_wall"})

    # Recently active, so the dead/alive boundary is exercised rather than
    # assumed.
    #
    # Deliberately the one exception to EPOCH-relative dating: project-graveyard
    # measures silence against wall-clock `now()`, which no fixture can pin. An
    # EPOCH-relative "alive" repo is alive on the day it is written and dead
    # forever after — which is how the first draft of this fixture reported
    # `still-alive` as a corpse. Its hashes therefore vary by build date; the
    # repos the archaeology and scope evals depend on stay deterministic.
    path = os.path.join(graveyard_root, "still-alive")
    init_repo(path)
    now_days = (EPOCH - datetime.now(timezone.utc)).days  # negative: EPOCH is past
    write(path, "README.md", "# still-alive\n")
    write(path, "main.py", "print('alive')\n")
    commit(path, "initial commit", now_days + 10)
    write(path, "main.py", "print('still alive')\n")
    commit(path, "chore: keep going", now_days + 1)
    repos.append({"name": "still-alive", "commits": 2, "expected_alive": True})

    return {
        "root": graveyard_root,
        "repos": repos,
        "author_email": AUTHOR_EMAIL,
        "deterministic": False,
        "note": "still-alive is dated relative to now(), not EPOCH — see build_graveyard_repos.",
    }


def main(argv):
    if len(argv) != 2:
        print("usage: build-fixture.py TARGET_DIR", file=sys.stderr)
        return 2

    target = os.path.abspath(os.path.expanduser(argv[1]))
    # Refuse to nuke something that isn't ours. A fixture builder that takes a
    # path and calls rmtree is one typo away from being a very bad afternoon.
    if os.path.exists(target):
        if not os.path.exists(os.path.join(target, ".devhub-skill-fixture")):
            print(
                "refusing to overwrite %s: not a fixture directory "
                "(no .devhub-skill-fixture marker)" % target,
                file=sys.stderr,
            )
            return 2
        shutil.rmtree(target)
    os.makedirs(target)
    with open(os.path.join(target, ".devhub-skill-fixture"), "w") as handle:
        handle.write("Generated by scripts/skill-evals/build-fixture.py\n")

    summary = {
        "root": target,
        "epoch": EPOCH.isoformat(),
        "archaeology": build_archaeology_repo(target),
        "scope": build_scope_repo(target),
        "graveyard": build_graveyard_repos(target),
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
