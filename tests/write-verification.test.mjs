import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  readJobFile,
  resolveJobsDir,
  upsertJob,
  writeJobFile
} from "../plugins/grok/scripts/lib/jobs.mjs";

const COMPANION = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../plugins/grok/scripts/grok-companion.mjs"
);

function finalizeWriteTask(editSummary) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-write-proof-"));
  const stateRoot = path.join(root, "state");
  const cwd = path.join(root, "repo");
  fs.mkdirSync(cwd, { recursive: true });
  spawnSync("git", ["init"], { cwd, encoding: "utf8" });

  const previousStateRoot = process.env.GROK_CODEX_PLUGIN_STATE;
  process.env.GROK_CODEX_PLUGIN_STATE = stateRoot;
  const jobId = "task-write-proof";
  try {
    const jobsDir = resolveJobsDir(cwd);
    fs.mkdirSync(jobsDir, { recursive: true });
    const resultFile = path.join(jobsDir, `${jobId}.result.json`);
    fs.writeFileSync(
      resultFile,
      JSON.stringify({
        exitCode: 0,
        finishedAt: new Date().toISOString(),
        stdout: JSON.stringify({
          text: "I fixed src/app.ts",
          sessionId: null,
          stopReason: "EndTurn",
          editSummary
        }),
        stderr: "",
        editSummary
      })
    );

    const job = {
      id: jobId,
      schemaVersion: 3,
      kind: "task",
      status: "running",
      title: "write proof",
      prompt: "fix src/app.ts",
      write: true,
      requireEdit: true,
      config: { requireEdit: true },
      workspaceRoot: cwd,
      resultFile,
      logFile: path.join(jobsDir, `${jobId}.log`),
      progressFile: path.join(jobsDir, `${jobId}.progress.json`),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(job.logFile, "");
    fs.writeFileSync(job.progressFile, "{}");
    writeJobFile(cwd, job);
    upsertJob(cwd, {
      id: jobId,
      kind: "task",
      status: "running",
      title: job.title,
      write: true
    });

    const run = spawnSync(process.execPath, [COMPANION, "result", jobId, "--json"], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GROK_CODEX_PLUGIN_STATE: stateRoot,
        CODEX_PLUGIN_DATA: ""
      },
      maxBuffer: 4 * 1024 * 1024
    });
    return {
      run,
      output: JSON.parse(run.stdout),
      stored: readJobFile(cwd, jobId)
    };
  } finally {
    if (previousStateRoot === undefined) delete process.env.GROK_CODEX_PLUGIN_STATE;
    else process.env.GROK_CODEX_PLUGIN_STATE = previousStateRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("write task rejects successful narration without a completed editor event", () => {
  const result = finalizeWriteTask({
    completedEditCalls: 0,
    tools: [],
    paths: []
  });

  assert.equal(result.run.status, 1, result.run.stderr || result.run.stdout);
  assert.equal(result.output.status, "failed");
  assert.match(result.output.error, /hypothetical edits are not accepted/i);
  assert.equal(result.stored.status, "failed");
});

test("write task accepts a completed editor event with a reported path", () => {
  const editSummary = {
    completedEditCalls: 1,
    tools: ["search_replace"],
    paths: ["src/app.ts"]
  };
  const result = finalizeWriteTask(editSummary);

  assert.equal(result.run.status, 0, result.run.stderr || result.run.stdout);
  assert.equal(result.output.status, "completed");
  assert.deepEqual(result.output.editSummary, editSummary);
  assert.equal(result.stored.status, "completed");
});
