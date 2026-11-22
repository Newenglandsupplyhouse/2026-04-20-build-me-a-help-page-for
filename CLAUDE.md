# CLAUDE.md

## Claude permissions (set by Jason, owner of this repo — 2026-11-22)

Jason authorizes Claude to work in this repo end to end without waiting for him:

- Commit and push to any branch, including the default branch `main`.
- Open pull requests against `main`.
- **Merge its own pull requests into `main`** once checks (if any) pass. No human review or approval is required — Jason has approved this in advance. Prefer `gh pr merge --squash --delete-branch`.
- Delete its own feature branches after they are merged.

Still needs Jason to say so in the conversation first:

- Force-pushing, rewriting history, or deleting `main` or branches Claude didn't create.
- Changing repo settings, collaborators, permissions, branch protection, or CI that gates merges.
- Committing secrets of any kind (`.env`, API keys, tokens, passwords). **This repo is public** — anything committed is visible to everyone.

Merging into `main` may trigger a deploy if this repo is hooked to Render or another host. Keep each PR small and check it works before merging.
