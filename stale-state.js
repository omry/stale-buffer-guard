"use strict";

const DECISION_CLEAR_DOCUMENT = "clearDocument";
const DECISION_CLEAR_STALE = "clearStale";
const DECISION_MARK_STALE = "markStale";
const DECISION_READ_CONTENT = "readContent";
const DECISION_REFRESH_BASELINE = "refreshBaseline";

function decideStaleState({ baseline, diskStat, diskText, documentText, isDirty }) {
  if (diskStat === undefined) {
    return { action: DECISION_CLEAR_DOCUMENT };
  }

  if (baseline === undefined) {
    return { action: DECISION_REFRESH_BASELINE };
  }

  if (!diskChangedFromBaseline(diskStat, baseline)) {
    return { action: DECISION_CLEAR_STALE };
  }

  if (!isDirty) {
    return { action: DECISION_REFRESH_BASELINE };
  }

  if (diskText === undefined || documentText === undefined) {
    return { action: DECISION_READ_CONTENT };
  }

  if (
    textMatchesText(diskText, documentText) ||
    textMatchesText(diskText, baseline.text)
  ) {
    return { action: DECISION_REFRESH_BASELINE };
  }

  return { action: DECISION_MARK_STALE };
}

function diskChangedFromBaseline(stat, baseline) {
  return stat.mtime !== baseline.mtime || stat.size !== baseline.size;
}

function textMatchesText(left, right) {
  return left === right || normalizeEol(left) === normalizeEol(right);
}

function normalizeEol(text) {
  return text.replace(/\r\n/g, "\n");
}

module.exports = {
  DECISION_CLEAR_DOCUMENT,
  DECISION_CLEAR_STALE,
  DECISION_MARK_STALE,
  DECISION_READ_CONTENT,
  DECISION_REFRESH_BASELINE,
  decideStaleState,
  diskChangedFromBaseline,
  textMatchesText,
};
