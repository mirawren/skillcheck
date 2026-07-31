# GitHub repository settings

Most of skillcheck's public operating contract is committed: workflows, issue forms, ownership,
security, support, releases, and the Pages source all live in the repository. The settings below
are owner-only GitHub state. Apply them once and revisit this list when the project changes hands.

## About panel

- **Description:** `CI preflight for agent skills and instructions that fail silently — 16 checks,
  trigger regression tests, 24 languages, offline.`
- **Website:** `https://mirawren.github.io/skillcheck/`
- **Topics:** `agent-skills`, `ai-agents`, `claude-code`, `codex`, `github-actions`, `linter`,
  `prompt-engineering`, `context-engineering`, `continuous-integration`, `typescript`,
  `developer-tools`, `open-source`
- Keep **Issues** enabled. Disable the wiki so the checked-in references remain canonical.
- Enable Discussions only when a maintainer is ready to own a Q&A category; an unanswered support
  channel is worse than the issue forms linked from [SUPPORT.md](../SUPPORT.md).

## Pages and social preview

1. In **Settings → Pages → Build and deployment**, set the source to **GitHub Actions**. The
   [Pages workflow](../.github/workflows/pages.yml) publishes the contents of `site/` on each
   relevant push to `main`.
2. Confirm the deployment environment is named `github-pages` and the public URL is
   `https://mirawren.github.io/skillcheck/`.
3. In **Settings → General → Social preview**, upload
   [`site/assets/social-preview.jpg`](../site/assets/social-preview.jpg). It is the GitHub-recommended
   1280 × 640 shape and stays below the 1 MB upload limit.

## Pull requests and the default branch

- Allow squash merging and automatically delete head branches after merge. Keep merge commits off
  so the release history remains linear; allow rebase merging only if maintainers intend to use it.
- Protect `main`: require a pull request, require conversation resolution, block force pushes and
  deletion, and require the CI and CodeQL checks after their first successful runs establish the
  exact check names.
- Require branches to be current before merge only if the resulting rerun cost stays acceptable;
  the test matrix deliberately covers three Node versions and three operating systems.
- Turn on automatic merge only after the branch protection rules are active.

## Actions and security

- Set the default `GITHUB_TOKEN` permission to **read repository contents** and keep permission for
  Actions to create or approve pull requests disabled. Each workflow grants its narrow write
  permissions at the job that needs them.
- Keep Dependabot alerts and security updates, the dependency graph, secret scanning, push
  protection, and private vulnerability reporting enabled.
- Restrict Actions to GitHub-authored actions and this repository's local Action if policy permits.
  Every external Action in the committed workflows is pinned to a full commit SHA, and Dependabot
  keeps those pins current.

## Releases and Marketplace

- Keep the `NPM_TOKEN` secret only until npm trusted publishing is verified, then remove it as
  described in [RELEASING.md](../RELEASING.md).
- Protect release environments if the maintainer team grows. The release workflow already
  serializes releases and stops at a Marketplace-ready GitHub draft.
- Publish the Action to Marketplace only after the owner reviews the generated draft and accepts
  GitHub's Marketplace terms.

## Final audit

The repository's **Insights → Community Standards** view should recognize the README, license,
code of conduct, contributing guide, pull request template, security policy, and issue forms. A
missing check there means GitHub is not discovering a file contributors depend on, even when the
file looks correct in the tree.
