"use strict";

const vscode = require("vscode");
const {
  DECISION_CLEAR_DOCUMENT,
  DECISION_CLEAR_STALE,
  DECISION_MARK_STALE,
  DECISION_READ_CONTENT,
  DECISION_REFRESH_BASELINE,
  decideStaleState,
  textMatchesText,
} = require("./stale-state");

const baselines = new Map();
const staleUris = new Set();
const staleStates = new Map();
const dismissedEditorWarnings = new Map();

const ACTION_RELOAD_BUFFER = "Discard Buffer and Reload";
const ACTION_KEEP_BUFFER = "Keep Buffer";
const ACTION_HIDE_WARNING = "Hide Warning";

let statusBar;
let pollTimer;
let pollDisposable;
let staleBackgroundDecoration;

function activate(context) {
  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    1000,
  );
  statusBar.name = "Stale Buffer Guard";
  statusBar.text = "$(warning) STALE EDITOR BUFFER";
  statusBar.tooltip =
    "The active editor buffer is based on an older disk baseline. Click for actions.";
  statusBar.command = "staleBufferGuard.showActions";
  statusBar.backgroundColor = new vscode.ThemeColor(
    "statusBarItem.warningBackground",
  );

  staleBackgroundDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    overviewRulerColor: new vscode.ThemeColor(
      "editorOverviewRuler.warningForeground",
    ),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    light: {
      backgroundColor: "rgba(255, 193, 7, 0.18)",
    },
    dark: {
      backgroundColor: "rgba(255, 193, 7, 0.18)",
    },
  });

  context.subscriptions.push(
    statusBar,
    staleBackgroundDecoration,
    vscode.commands.registerCommand(
      "staleBufferGuard.checkActiveEditor",
      checkActiveEditor,
    ),
    vscode.commands.registerCommand(
      "staleBufferGuard.refreshBaseline",
      refreshActiveBaseline,
    ),
    vscode.commands.registerCommand(
      "staleBufferGuard.reloadFromDisk",
      reloadActiveFromDisk,
    ),
    vscode.commands.registerCommand(
      "staleBufferGuard.dismissEditorWarning",
      dismissActiveEditorWarning,
    ),
    vscode.commands.registerCommand("staleBufferGuard.showActions", showActions),
    vscode.commands.registerCommand("staleBufferGuard.showStatus", showStatus),
    vscode.workspace.onDidOpenTextDocument((document) => {
      void refreshBaseline(document, { force: false });
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      void refreshBaseline(document, { force: true });
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      clearDocument(document.uri);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (isFileDocument(event.document) && !event.document.isDirty) {
        void refreshBaseline(event.document);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      void checkActiveEditor();
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => {
      renderVisibleEditors();
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      renderEditor(event.textEditor);
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      renderEditor(event.textEditor);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("staleBufferGuard")) {
        restartPolling(context);
        void checkOpenDocuments();
      }
    }),
  );

  const watcher = vscode.workspace.createFileSystemWatcher("**/*");
  context.subscriptions.push(
    watcher,
    watcher.onDidChange((uri) => {
      void checkUri(uri);
    }),
    watcher.onDidCreate((uri) => {
      void checkUri(uri);
    }),
    watcher.onDidDelete((uri) => {
      clearDocument(uri);
      void checkOpenDocuments();
    }),
  );

  for (const document of vscode.workspace.textDocuments) {
    void refreshBaseline(document, { force: false });
  }
  restartPolling(context);
  void checkOpenDocuments();
}

function deactivate() {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
  }
  if (pollDisposable !== undefined) {
    pollDisposable.dispose();
  }
}

function restartPolling(context) {
  if (pollDisposable !== undefined) {
    pollDisposable.dispose();
    pollDisposable = undefined;
  }
  const interval = Math.max(250, getConfig().get("pollIntervalMs", 2000));
  pollTimer = setInterval(() => {
    void checkOpenDocuments();
  }, interval);
  pollDisposable = {
    dispose: () => {
      if (pollTimer !== undefined) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    },
  };
  context.subscriptions.push(pollDisposable);
}

async function refreshActiveBaseline(uri) {
  const document = await resolveCommandDocument(uri);
  if (document === undefined) {
    return;
  }
  await refreshBaseline(document, { force: true });
  await checkActiveEditor();
}

async function showActions() {
  const document = await resolveCommandDocument();
  if (document === undefined) {
    return;
  }
  await checkDocument(document);
  const key = document.uri.toString();
  if (!staleUris.has(key)) {
    await vscode.window.showInformationMessage(
      "Stale Buffer Guard: active editor is not stale.",
    );
    renderVisibleEditors();
    return;
  }

  const choice = await vscode.window.showQuickPick(
    [
      {
        label: "$(sync) Check Again",
        description: "Re-read disk state",
        action: "check",
      },
      {
        label: `$(discard) ${ACTION_RELOAD_BUFFER}`,
        description: "Discard unsaved buffer changes and load disk contents",
        action: "reload",
      },
      {
        label: `$(check) ${ACTION_KEEP_BUFFER}`,
        description: "Keep this editor content and accept the current disk version",
        action: "keep",
      },
      {
        label: `$(eye-closed) ${ACTION_HIDE_WARNING}`,
        description: "Hide the warning for this stale snapshot only",
        action: "hide",
      },
      {
        label: "$(warning) Explain Warning",
        description: "Show why this editor buffer is considered stale",
        action: "status",
      },
    ],
    {
      placeHolder: "Stale editor buffer: choose how to handle the disk change",
    },
  );
  if (choice === undefined) {
    return;
  }

  if (choice.action === "check") {
    await checkActiveEditor(document.uri);
  } else if (choice.action === "reload") {
    await reloadActiveFromDisk(document.uri);
  } else if (choice.action === "keep") {
    await refreshActiveBaseline(document.uri);
  } else if (choice.action === "hide") {
    await dismissActiveEditorWarning(document.uri);
  } else if (choice.action === "status") {
    await showStatus();
  }
}

async function showStatus() {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined || !isFileDocument(editor.document)) {
    await vscode.window.showInformationMessage(
      "Stale Buffer Guard: no active file editor.",
    );
    return;
  }
  const document = editor.document;
  await checkDocument(document);
  const key = document.uri.toString();
  const baseline = baselines.get(document.uri.toString());
  let stat;
  try {
    stat = await vscode.workspace.fs.stat(document.uri);
  } catch (error) {
    await vscode.window.showErrorMessage(
      `Stale Buffer Guard: cannot read active file information: ${error}`,
    );
    return;
  }
  const stale = staleUris.has(key);
  const baselineText =
    baseline === undefined
      ? "none"
      : formatDateTime(baseline.mtime);
  const diskText = formatDateTime(stat.mtime);
  const disk = await readDiskContent(document);
  const diskMatchesBaseline =
    disk !== undefined &&
    baseline !== undefined &&
    textMatchesText(disk.text, baseline.text);
  const diskMatchesBuffer =
    disk !== undefined && textMatchesText(disk.text, document.getText());
  const relativePath = vscode.workspace.asRelativePath(document.uri);
  await vscode.window.showInformationMessage(
    [
      `Stale Buffer Guard: ${stale ? "stale editor buffer" : "not stale"}`,
      `File: ${relativePath}`,
      `Unsaved editor changes: ${document.isDirty ? "yes" : "no"}`,
      `File on disk changed: ${diskText}`,
      `Editor last matched disk: ${baselineText}`,
      `Disk matches editor baseline: ${diskMatchesBaseline ? "yes" : "no"}`,
      `Disk matches editor buffer: ${diskMatchesBuffer ? "yes" : "no"}`,
    ].join(" | "),
  );
}

async function reloadActiveFromDisk(uri) {
  const document = await resolveCommandDocument(uri);
  if (document === undefined) {
    return;
  }
  const detail = document.isDirty
    ? "Reloading from disk will discard unsaved editor changes."
    : "Reload this editor from the current file on disk?";
  const choice = await vscode.window.showWarningMessage(
    detail,
    { modal: true },
    ACTION_RELOAD_BUFFER,
  );
  if (choice !== ACTION_RELOAD_BUFFER) {
    return;
  }
  await showDocument(document.uri);
  await vscode.commands.executeCommand("workbench.action.files.revert");
  await refreshBaseline(document, { force: true });
  await checkActiveEditor();
}

async function dismissActiveEditorWarning(uri) {
  const document = await resolveCommandDocument(uri);
  if (document === undefined) {
    return;
  }
  const key = document.uri.toString();
  const state = staleStates.get(key);
  if (state === undefined) {
    return;
  }
  dismissedEditorWarnings.set(key, state.stateKey);
  renderVisibleEditors();
}

async function checkActiveEditor(uri) {
  const document = await resolveCommandDocument(uri);
  if (document === undefined) {
    statusBar.hide();
    renderVisibleEditors();
    return;
  }
  await checkDocument(document);
  renderVisibleEditors();
}

async function checkOpenDocuments() {
  for (const document of vscode.workspace.textDocuments) {
    if (isFileDocument(document)) {
      await checkDocument(document);
    }
  }
  renderVisibleEditors();
}

async function checkUri(uri) {
  if (uri.scheme !== "file") {
    return;
  }
  for (const document of vscode.workspace.textDocuments) {
    if (document.uri.toString() === uri.toString()) {
      await checkDocument(document);
    }
  }
  renderVisibleEditors();
}

async function checkDocument(document) {
  if (!getConfig().get("enabled", true) || !isFileDocument(document)) {
    clearDocument(document.uri);
    return;
  }

  const baseline = baselines.get(document.uri.toString());
  let stat;
  try {
    stat = await vscode.workspace.fs.stat(document.uri);
  } catch {
    clearDocument(document.uri);
    return;
  }

  const decision = decideStaleState({
    baseline,
    diskStat: stat,
    isDirty: document.isDirty,
  });

  let disk;
  if (
    decision.action === DECISION_READ_CONTENT ||
    decision.action === DECISION_REFRESH_BASELINE ||
    decision.action === DECISION_MARK_STALE
  ) {
    disk = await readDiskContent(document);
    if (disk === undefined) {
      clearDocument(document.uri);
      return;
    }
  }

  const contentDecision =
    decision.action === DECISION_READ_CONTENT
      ? decideStaleState({
          baseline,
          diskStat: stat,
          diskText: disk.text,
          documentText: document.getText(),
          isDirty: document.isDirty,
        })
      : decision;

  if (contentDecision.action === DECISION_CLEAR_DOCUMENT) {
    clearDocument(document.uri);
  } else if (contentDecision.action === DECISION_REFRESH_BASELINE) {
    setBaseline(document, stat, disk.text);
    clearStale(document.uri);
  } else if (contentDecision.action === DECISION_MARK_STALE) {
    markStale(document, stat, baseline);
  } else if (contentDecision.action === DECISION_CLEAR_STALE) {
    clearStale(document.uri);
  }
}

async function refreshBaseline(document, options = {}) {
  if (!isFileDocument(document)) {
    return;
  }
  if (document.isDirty && !options.force) {
    return;
  }
  try {
    const stat = await vscode.workspace.fs.stat(document.uri);
    const disk = await readDiskContent(document);
    if (disk === undefined) {
      clearDocument(document.uri);
      return;
    }
    setBaseline(document, stat, disk.text);
    clearStale(document.uri);
  } catch {
    clearDocument(document.uri);
  }
}

async function readDiskContent(document) {
  try {
    const bytes = await vscode.workspace.fs.readFile(document.uri);
    return {
      text: Buffer.from(bytes).toString("utf8"),
    };
  } catch {
    return undefined;
  }
}

function setBaseline(document, stat, text) {
  baselines.set(document.uri.toString(), {
    mtime: stat.mtime,
    size: stat.size,
    text,
  });
}

function markStale(document, stat, baseline) {
  const key = document.uri.toString();
  const stateKey = staleStateKey(stat, baseline);
  const previousStateKey = staleStates.get(key)?.stateKey;
  staleUris.add(key);
  staleStates.set(key, {
    stat,
    baseline,
    stateKey,
  });
  if (dismissedEditorWarnings.get(key) !== stateKey) {
    dismissedEditorWarnings.delete(key);
  }
  if (previousStateKey !== stateKey) {
    updateActiveEditorContext();
  }
}

async function resolveCommandDocument(uri) {
  if (uri instanceof vscode.Uri) {
    const existing = vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === uri.toString(),
    );
    if (existing !== undefined) {
      return isFileDocument(existing) ? existing : undefined;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    return isFileDocument(document) ? document : undefined;
  }

  const editor = vscode.window.activeTextEditor;
  if (editor === undefined || !isFileDocument(editor.document)) {
    return undefined;
  }
  return editor.document;
}

async function showDocument(uri) {
  const visibleEditor = vscode.window.visibleTextEditors.find(
    (editor) => editor.document.uri.toString() === uri.toString(),
  );
  if (visibleEditor !== undefined) {
    await vscode.window.showTextDocument(visibleEditor.document, visibleEditor.viewColumn);
    return;
  }
  await vscode.window.showTextDocument(uri, { preview: false });
}

function renderEditor(editor) {
  applyEditorDecorations(editor);
  updateStatusBar();
}

function renderVisibleEditors() {
  for (const editor of vscode.window.visibleTextEditors) {
    applyEditorDecorations(editor);
  }
  updateStatusBar();
}

function applyEditorDecorations(editor) {
  const key = editor.document.uri.toString();
  const state = staleStates.get(key);
  const shouldShowInEditor =
    state !== undefined && dismissedEditorWarnings.get(key) !== state.stateKey;

  if (shouldShowInEditor) {
    editor.setDecorations(staleBackgroundDecoration, staleBackgroundRanges(editor));
  } else {
    editor.setDecorations(staleBackgroundDecoration, []);
  }
}

function updateStatusBar() {
  const editor = vscode.window.activeTextEditor;
  if (editor !== undefined && staleUris.has(editor.document.uri.toString())) {
    statusBar.show();
  } else {
    statusBar.hide();
  }
  updateActiveEditorContext();
}

function updateActiveEditorContext() {
  const editor = vscode.window.activeTextEditor;
  const state =
    editor === undefined
      ? undefined
      : staleStates.get(editor.document.uri.toString());
  const activeEditorWarningVisible =
    state !== undefined &&
    dismissedEditorWarnings.get(editor.document.uri.toString()) !==
      state.stateKey;
  void vscode.commands.executeCommand(
    "setContext",
    "staleBufferGuard.activeEditorWarningVisible",
    activeEditorWarningVisible,
  );
}

function staleBackgroundRanges(editor) {
  const lineNumbers = new Set();
  for (const visibleRange of editor.visibleRanges) {
    for (
      let lineNumber = visibleRange.start.line;
      lineNumber <= visibleRange.end.line;
      lineNumber += 1
    ) {
      lineNumbers.add(lineNumber);
    }
  }
  return [...lineNumbers]
    .filter((lineNumber) => lineNumber >= 0 && lineNumber < editor.document.lineCount)
    .map((lineNumber) => editor.document.lineAt(lineNumber).range);
}

function clearStale(uri) {
  const key = uri.toString();
  const hadStaleState = staleUris.has(key) || staleStates.has(key);
  staleUris.delete(key);
  staleStates.delete(key);
  dismissedEditorWarnings.delete(key);
  if (hadStaleState) {
    updateActiveEditorContext();
    renderVisibleEditors();
  }
}

function clearDocument(uri) {
  baselines.delete(uri.toString());
  clearStale(uri);
}

function isFileDocument(document) {
  return document.uri.scheme === "file" && !document.isUntitled;
}

function getConfig() {
  return vscode.workspace.getConfiguration("staleBufferGuard");
}

function formatDateTime(time) {
  return new Date(time).toLocaleString();
}

function staleStateKey(stat, baseline) {
  return `${stat.mtime}:${stat.size}:${baseline.mtime}:${baseline.size}`;
}

module.exports = {
  activate,
  deactivate,
};
