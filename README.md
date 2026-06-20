# Stale Buffer Guard

Stale Buffer Guard helps with open VS Code editors that can present stale
information after the file changes on disk.

It is designed for the confusing workflow where version control, formatters,
and agents can all change files while those same files are already open in the
editor. A stale editor view can cost time, lead
you to reason from old information, or turn into a save-time conflict right when
you thought you were done. The extension tracks the editor's saved disk baseline,
follows clean disk updates, and warns when unsaved edits are based on older file
contents, before VS Code's overwrite prompt interrupts you at save time.

## Behavior

- Records each file editor's disk last-modified time when the document opens,
  saves, reloads from disk, cleanly changes, or you explicitly refresh the
  baseline.
- When VS Code updates a clean document from disk, the extension refreshes its
  baseline for that document.
- Watches workspace disk changes and periodically checks all open file editors,
  including files outside the workspace.
- If the editor is dirty and the file on disk differs from the stored editor
  baseline, shows:
  - a warning background across the visible editor buffer
  - a warning status bar item: `STALE EDITOR BUFFER`
- editor-title actions in the always-visible editor header:
  - `Check Active Editor`
  - `Discard Buffer and Reload`
  - `Keep Buffer`
  - `Hide Warning`
- Clicking the status bar item opens an action picker.
- `Keep Buffer` accepts the current disk version as the new baseline and keeps
  your editor contents.
- `Hide Warning` hides the warning background and editor-title actions for the
  current stale snapshot only. The buffer remains stale until you reload, save,
  keep the buffer, or the disk file changes again.

## Commands

- `Stale Buffer Guard: Check Active Editor`
- `Stale Buffer Guard: Keep Editor Buffer`
- `Stale Buffer Guard: Discard Buffer and Reload`
- `Stale Buffer Guard: Hide Editor Warning`
- `Stale Buffer Guard: Show Actions`
- `Stale Buffer Guard: Explain Stale Warning`

## Settings

```json
{
  "staleBufferGuard.enabled": true,
  "staleBufferGuard.pollIntervalMs": 2000
}
```

## Try It Locally

Open this directory in VS Code:

```bash
code ~/dev/stalebufferguard
```

Press `F5` to launch an Extension Development Host.

In the Extension Development Host:

1. Open a file.
2. Make an unsaved edit in the editor.
3. Edit the same file from another terminal or tool.
4. Return to the editor. The buffer should show a warning background and
   editor-title actions.

## Install Locally

For quick development usage, run an Extension Development Host with this folder.

For a normal install, package it with `vsce`:

```bash
npm install -g @vscode/vsce
vsce package
code --install-extension stale-buffer-guard-0.1.0.vsix
```
