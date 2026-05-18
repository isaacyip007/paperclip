# PROJECT — LifeSimple fork of Paperclip

LifeSimple operates a fork of [paperclipai/paperclip](https://github.com/paperclipai/paperclip). The fork lives at [LifeSimple-Tech-Enterprise/paperclip](https://github.com/LifeSimple-Tech-Enterprise/paperclip).

## Architectural philosophy

1. **Upstream Paperclip is the platform.** We track it on `master`, unmodified, as a pristine mirror.
2. **LifeSimple-specific core changes** live on a single long-lived downstream branch `lifesimple-main`.
3. **Plugins** are the preferred extension point for new LifeSimple functionality. Only add to core when the change cannot be expressed as a plugin (e.g., `local_trusted`-gated test seeders, debug endpoints, ops tooling that must run inside `server/`).

## Branch policy (set by LIF-386, 2026-05-18)

See `CLAUDE.md` for the branch table and PR routing.

Summary:

- `master` = `origin/master` (always).
- `lifesimple-main` = `master` rebased + LifeSimple core delta.
- Downstream-only work PRs into `lifesimple-main`.
- Upstream contributions PR into upstream `paperclipai/paperclip`.

## Routines / automation

- **LIF-383** — upstream sync monitor. Watches `origin/master` and surfaces new commits. Operates on `master` only; does not touch `lifesimple-main`.
- **Pending follow-up (filed from LIF-386)** — merge-automation routine. Rebases `lifesimple-main` onto `master` after each successful LIF-383 sync, files a child issue on conflict.

## Sunset items

- `fork/master` is being sunset. It originally carried the LifeSimple downstream history; that history now lives on `lifesimple-main`. `fork/master` will be deleted after the merge-automation routine (LIF-386 follow-up) runs cleanly for the first time. Do not target `fork/master` for new work.
