# Repository topology — LifeSimple fork of Paperclip

This repository is the LifeSimple fork of upstream Paperclip. The branch policy was set by board decision on LIF-386 (2026-05-18).

## Remotes

- `origin` → `https://github.com/paperclipai/paperclip.git` (upstream Paperclip)
- `fork` → `https://github.com/LifeSimple-Tech-Enterprise/paperclip.git` (LifeSimple)

## Branches

- **`master`** — pristine mirror of `origin/master`. Must always satisfy `master == origin/master`. No downstream commits. Routine `LIF-383` watches this branch for upstream changes.
- **`lifesimple-main`** — long-lived downstream branch carrying every LifeSimple core modification. This is the production deploy branch. Protected: linear history required, force-push and deletion blocked. Tracks `fork/lifesimple-main`.

## Where to PR

| Change scope | Branch off | PR into |
|---|---|---|
| Downstream-only (LifeSimple specifics: LIF-* features, local-trusted test endpoints, ops tooling, LifeSimple-only config) | `lifesimple-main` | `lifesimple-main` (on `fork`) |
| Upstream contribution (Core Paperclip improvements suitable for the open-source project) | `master` | `paperclipai/paperclip` `master` (upstream) |

**Default for agent feature work is downstream.** Only target upstream when the change is genuinely useful to the broader Paperclip community AND has been pre-cleared as upstream-bound.

## Keeping `master` clean

- Never commit to `master` directly.
- Never push to `fork/master` (it is being sunset — see LIF-386).
- `git pull` on `master` must always be a clean fast-forward from `origin/master`. If it is not, stop and file an issue — do not merge or rebase to "fix" it.

## Keeping `lifesimple-main` healthy

- A merge-automation routine (filed as a follow-up to LIF-386) periodically rebases `lifesimple-main` on top of `master` after each upstream sync.
- When that rebase produces conflicts, the routine files a child issue with the failing commits.
- Manual rebase is only allowed when the routine fails — and only on a fresh checkout of `lifesimple-main` from `fork`.
