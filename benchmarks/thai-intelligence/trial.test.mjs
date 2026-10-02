import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runTrial, scoreCase, trialCases } from "./trial-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureBytes = await readFile(join(here, "fixtures.json"));
const fixtures = JSON.parse(fixtureBytes);
const replay = JSON.parse(await readFile(join(here, "replay-synthetic.json")));
const metadata = JSON.parse(await readFile(join(here, "replay-model.json")));
const cases = trialCases(fixtures);
const find = (id) => cases.find((item) => item.id === id);
const execFileAsync = promisify(execFile);

test("synthetic replay covers all nine cases without executing a tool", async () => {
  const seen = [];
  const report = await runTrial({ fixtures, fixtureBytes, model: metadata.model, metadata, invoke: async (request, { caseId }) => {
    seen.push({ caseId, request });
    return replay.responses[caseId];
  } });
  assert.equal(report.complete, true);
  assert.deepEqual(report.counts, { pass: 9 });
  assert.deepEqual(seen.map((item) => item.caseId), cases.map((item) => item.id));
  assert.ok(report.rows.every((row) => row.request_sha256 && row.response_sha256 && row.policy_violation === false));
  assert.ok(seen.every(({ request }) => request.stream === false));
});

test("no-call and approval fixtures reject unsafe tool calls", () => {
  for (const id of ["tool-02", "tool-03", "tool-04"]) {
    const score = scoreCase(find(id), { tool_calls: [{ function: { name: id === "tool-04" ? "server_stop" : "delete_all", arguments: {} } }] });
    assert.equal(score.status, "fail");
    assert.equal(score.policy_violation, true);
  }
  assert.equal(scoreCase(find("tool-03"), replay.responses["tool-03"].choices[0].message).semantic_review_required, true);
  assert.equal(scoreCase(find("tool-04"), replay.responses["tool-04"].choices[0].message).semantic_review_required, true);
});

test("tool call checks exact name and arguments", () => {
  assert.equal(scoreCase(find("tool-01"), replay.responses["tool-01"].choices[0].message).status, "pass");
  assert.equal(scoreCase(find("tool-01"), { tool_calls: [{ function: { name: "enterprise_search", arguments: { query: "อื่น" } } }] }).status, "fail");
  assert.equal(scoreCase(find("tool-01"), { tool_calls: [{ function: { name: "delete_all", arguments: {} } }] }).policy_violation, true);
});

test("dated facts reject invented, expired, conflicting and missing provenance", () => {
  assert.equal(scoreCase(find("fact-01"), { content: '{"answer":"ชื่อสมมติ","source_ids":[]}' }).status, "fail");
  assert.equal(scoreCase(find("fact-04"), { content: '{"answer":"10","source_ids":["source-fee-v1"]}' }).status, "fail");
  assert.equal(scoreCase(find("fact-05"), { content: '{"answer":"open","source_ids":["source-status-a"]}' }).status, "fail");
  assert.equal(scoreCase(find("fact-03"), { content: '{"answer":"09:00","source_ids":[]}' }).status, "fail");
  assert.equal(scoreCase(find("fact-03"), { content: "not JSON" }).reason, "invalid_answer_json");
});

test("two timeouts stop trial and explicitly mark remaining cases untested", async () => {
  const report = await runTrial({ fixtures, fixtureBytes, model: metadata.model, metadata, invoke: async () => { throw new DOMException("timeout", "AbortError"); } });
  assert.deepEqual(report.counts, { timeout: 2, not_tested: 7 });
  assert.equal(report.complete, false);
  assert.equal(report.rows.length, 9);
});

test("missing model provenance is rejected before invoking", async () => {
  await assert.rejects(() => runTrial({ fixtures, fixtureBytes, model: "x", metadata: {}, invoke: async () => { throw new Error("must not run"); } }), /required/);
});

test("missing assistant message is not mistaken for a correct no-call", () => {
  assert.equal(scoreCase(find("tool-02"), undefined).reason, "missing_assistant_message");
});

test("CLI offline replay runs all nine cases", async () => {
  const folder = await mkdtemp(join(tmpdir(), "thai-trial-replay-"));
  const output = join(folder, "report.json");
  await execFileAsync(process.execPath, [join(here, "trial.mjs"), "--metadata", join(here, "replay-model.json"), "--replay", join(here, "replay-synthetic.json"), "--output", output]);
  const report = JSON.parse(await readFile(output));
  assert.equal(report.complete, true);
  assert.deepEqual(report.counts, { pass: 9 });
  assert.equal(report.transport, "offline_replay");
});

test("CLI runs all nine cases through a loopback mock endpoint", async (t) => {
  let index = 0;
  const server = createServer(async (request, response) => {
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.method, "POST");
    const body = JSON.parse(await new Promise((resolve) => {
      let raw = "";
      request.on("data", (chunk) => { raw += chunk; });
      request.on("end", () => resolve(raw));
    }));
    assert.equal(body.model, metadata.model);
    const item = cases[index++];
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(replay.responses[item.id]));
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      t.skip("loopback bind restricted by sandbox");
      return;
    }
    throw error;
  }
  try {
    const folder = await mkdtemp(join(tmpdir(), "thai-trial-test-"));
    const output = join(folder, "report.json");
    await execFileAsync(process.execPath, [join(here, "trial.mjs"), "--metadata", join(here, "replay-model.json"), "--endpoint", `http://127.0.0.1:${server.address().port}/v1/chat/completions`, "--output", output]);
    const report = JSON.parse(await readFile(output));
    assert.equal(report.complete, true);
    assert.equal(index, 9);
    assert.deepEqual(report.counts, { pass: 9 });
    assert.equal(report.transport, "local_openai_compatible");
    assert.equal(report.cost_usd, 0);
  } finally {
    server.close();
  }
});
