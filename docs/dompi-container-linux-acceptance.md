# Full Linux container acceptance

Candidate: `b8d0b02fac415ef67d774cf18121340e5d1d4657`. Railpack `0.41.0`, Python `3.13.16`, Ubuntu 24.04 x64.

The workflow checks out this exact SHA, not the workflow branch HEAD. It builds
an archive of the candidate using its own railpack.json and full requirements.
No application code, wheel, requirements, or Railway setting is modified.
The build downloads public dependencies; only runtime smoke is network-isolated.

## Execution after separate commit/push approval

Commit this workflow and document on a review branch descending from the candidate.
Push only `review/dompi-core-linux-build` in this repository. This push trigger
works without placing the workflow on the default branch. Do not push the bot
production branch `release/openai-only-3de1917` or dashboard main.

Open Actions -> Dompi full Linux container acceptance -> the branch run.
Re-run that run for retries. workflow_dispatch is also provided, but GitHub may
require the workflow to exist on the default branch before manual dispatch is
available; do not change the default branch merely to enable it.
A job-level ref guard also skips manual dispatch from any other branch or tag.

Each repository runs its own workflow and uses only its automatic, short-lived,
contents:read GitHub token for checkout, with persist-credentials disabled.
No cross-repository checkout, PAT, Railway credentials, registry login, image
push, deployment, or production service is used. A local BuildKit daemon runs
privileged only on the disposable GitHub-hosted runner. Built images are loaded
into that runner's Docker daemon and disappear with the runner.

## PASS / FAIL and limits

Require success of candidate SHA verification, official Railpack binary checksum,
wheel SHA/provenance, install-input plan assertion, full image build, installed
Core smoke, and offline health. Bot also runs its existing three package tests.
Any failing required step fails acceptance; do not turn failures into allowed skips.
The summary records build PASS independently before runtime tests.

Dashboard starts `python app.py` with a deliberately synthetic BOT_TOKEN and
checks localhost /health. Bot starts only its existing webhook HTTP component,
with ADMIN_ID=1 and a disposable SQLite file under /tmp. It does not run
start.py/poll Telegram. No provider keys or DATABASE_URL are supplied.
Runtime containers have no network, a read-only root filesystem and /tmp tmpfs.
Neither health test establishes production database, Telegram, OCR/AI, or payment
integration readiness. Both repository runs must pass before full-build acceptance.

Current status: workflow prepared locally; full container build NOT yet run.
