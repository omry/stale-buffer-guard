# Maintainer Notes

## Publishing

The Marketplace publisher is `omry`, so the extension ID is:

```text
omry.stale-buffer-guard
```

Before packaging, update `version` in `package.json`.

Run the local checks:

```bash
npm run check
```

Package with dependency detection disabled. This extension has no npm
dependencies, and `vsce` will derive the output filename from `name` and
`version` in `package.json`:

```bash
vsce package --no-dependencies
```

The package should be small. For `0.2.0`, the expected shape is:

```text
6 files, about 26 KB
```

If the package looks unexpectedly large, inspect it before uploading:

```bash
vsce ls --tree
```

Upload the generated `.vsix` from the Marketplace publisher page:

```text
https://marketplace.visualstudio.com/manage/publishers/
```

Select publisher `omry`, then upload the extension package. The Marketplace may
show `Verifying <version>` for a while before the extension is installable.

`vsce publish` should also work once a Personal Access Token has Marketplace
publish permission for publisher `omry`, but manual upload is the reliable
fallback.

## Dependency maintenance

Use Node 24 and npm 11.9.0, matching the project declarations. Install the
pinned npm version with `npm install --global npm@11.9.0`, then use `npm ci`.

The [Node maintenance workflows](https://github.com/hydra-ecosystem/github-actions/blob/main/docs/node-maintenance.md)
check security every Monday at 02:00 UTC and propose routine upgrades quarterly,
on January 1, April 1, July 1, and October 1 at 02:00 UTC. New releases have a
ten-day cooldown. The local `.github/node-maintenance.json` points to the shared
policy; edit its overrides to change project policy, and keep caller cron entries
in `.github/workflows/dependency-audit.yml` consistent with the resolved schedule.

To run an audit sooner, open **Actions → Node dependency maintenance → Run workflow**
on `main` and select `security` or `upgrades`. The action validates dependency
changes before opening or updating one maintenance PR. A toolchain or schedule
mismatch fails preflight and opens or updates a configuration issue. The action
does not rewrite toolchain declarations.

Publication uses the built-in token and requires **Allow GitHub Actions to create
and approve pull requests** in **Settings → Actions → General → Workflow
permissions**. Default token permissions remain read-only. The workflow does
not approve or merge its own PRs.

The project currently has no npm dependencies. Its empty lockfile supports
repeatable validation and future dependency additions.
