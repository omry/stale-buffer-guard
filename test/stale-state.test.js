"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  DECISION_CLEAR_DOCUMENT,
  DECISION_CLEAR_STALE,
  DECISION_MARK_STALE,
  DECISION_READ_CONTENT,
  DECISION_REFRESH_BASELINE,
  decideStaleState,
  diskChangedFromBaseline,
  textMatchesText,
} = require("../stale-state");

const BASELINE = {
  mtime: 1000,
  size: 6,
  text: "base\n",
};

function disk(text, overrides = {}) {
  return {
    stat: {
      mtime: overrides.mtime ?? 2000,
      size: overrides.size ?? text.length,
    },
    text,
  };
}

function decision(input) {
  return decideStaleState({
    baseline: BASELINE,
    diskStat: disk("changed\n").stat,
    diskText: "changed\n",
    documentText: "local\n",
    isDirty: true,
    ...input,
  }).action;
}

test("missing disk state clears tracked document state", () => {
  assert.equal(
    decision({
      diskStat: undefined,
      diskText: undefined,
    }),
    DECISION_CLEAR_DOCUMENT,
  );
});

test("dirty changed disk identity asks caller to read content before deciding", () => {
  assert.equal(
    decision({
      diskStat: { mtime: 2000, size: 7 },
      diskText: undefined,
      documentText: undefined,
      isDirty: true,
    }),
    DECISION_READ_CONTENT,
  );
});

test("clean document without a baseline establishes a baseline", () => {
  assert.equal(
    decision({ baseline: undefined, isDirty: false }),
    DECISION_REFRESH_BASELINE,
  );
});

test("dirty document without a baseline establishes a provisional baseline", () => {
  assert.equal(
    decision({ baseline: undefined, isDirty: true }),
    DECISION_REFRESH_BASELINE,
  );
});

test("clean document refreshes when disk stat changes", () => {
  assert.equal(
    decision({ diskStat: disk("base\n").stat, isDirty: false }),
    DECISION_REFRESH_BASELINE,
  );
});

test("clean document trusts unchanged disk identity", () => {
  assert.equal(
    decision({
      diskStat: { mtime: BASELINE.mtime, size: BASELINE.size },
      diskText: "same-size-change",
      isDirty: false,
    }),
    DECISION_CLEAR_STALE,
  );
});

test("dirty document is stale when disk differs from baseline and editor", () => {
  assert.equal(decision(), DECISION_MARK_STALE);
});

test("dirty document trusts unchanged disk identity", () => {
  assert.equal(
    decision({
      diskStat: { mtime: BASELINE.mtime, size: BASELINE.size },
      diskText: "changed-with-same-stat",
      documentText: undefined,
    }),
    DECISION_CLEAR_STALE,
  );
});

test("dirty document relaxes when disk text matches the editor buffer", () => {
  assert.equal(
    decision({
      diskStat: disk("local\n").stat,
      diskText: "local\n",
      documentText: "local\n",
    }),
    DECISION_REFRESH_BASELINE,
  );
});

test("dirty document relaxes when disk reverts to baseline text", () => {
  assert.equal(
    decision({
      diskStat: disk("base\n", { mtime: 3000, size: 99 }).stat,
      diskText: "base\n",
      documentText: "local\n",
    }),
    DECISION_REFRESH_BASELINE,
  );
});

test("stale dirty document clears when disk reverts to stored baseline", () => {
  assert.equal(
    decision({
      baseline: BASELINE,
      diskStat: disk("changed\n").stat,
      diskText: "changed\n",
      documentText: "local\n",
      isDirty: true,
    }),
    DECISION_MARK_STALE,
  );
  assert.equal(
    decision({
      baseline: BASELINE,
      diskStat: disk(BASELINE.text, {
        mtime: 4000,
        size: BASELINE.text.length,
      }).stat,
      diskText: BASELINE.text,
      documentText: "local\n",
      isDirty: true,
    }),
    DECISION_REFRESH_BASELINE,
  );
});

test("eol-normalized text is treated as matching", () => {
  assert.equal(textMatchesText("one\r\ntwo\r\n", "one\ntwo\n"), true);
});

test("disk identity changes on mtime or size differences", () => {
  assert.equal(
    diskChangedFromBaseline({ mtime: 1000, size: 6 }, BASELINE),
    false,
  );
  assert.equal(
    diskChangedFromBaseline({ mtime: 1001, size: 6 }, BASELINE),
    true,
  );
  assert.equal(
    diskChangedFromBaseline({ mtime: 1000, size: 7 }, BASELINE),
    true,
  );
});
