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

The package should be small. For `0.1.0`, the expected shape was:

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
