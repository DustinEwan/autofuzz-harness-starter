// The plugin's own suite: a real child process driven over the real pipe.
//
// Every protocol rule this scaffold claims lives in these tests as an observed response,
// not as a unit call into a function: the child is spawned the way the engine spawns it,
// requests go down stdin as lines, and every assertion reads a line back off stdout. A
// framing bug, a lost response, or a target write that corrupts the channel fails here
// exactly as it would fail in the engine.
//
// Every plugin a test starts is registered with `t.after`, so a failing assertion still
// closes the child: a leftover child with an open pipe keeps the runner's event loop
// alive, and the suite would hang instead of reporting.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION } from "../plugin/protocol.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const demo = join(packageRoot, "test-targets", "demo");

function startPlugin(t) {
  const child = spawn(process.execPath, [join(packageRoot, "plugin", "server.mjs")], {
    cwd: packageRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.on("error", () => {});
  child.stderr.resume();

  const pending = new Map();
  const strays = [];
  const strayWaiters = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    const frame = JSON.parse(line);
    const settle = pending.get(frame.id);
    if (settle !== undefined) {
      pending.delete(frame.id);
      settle(frame);
      return;
    }
    const waiter = strayWaiters.shift();
    if (waiter !== undefined) waiter(frame);
    else strays.push(frame);
  });

  const close = () => {
    child.stdin.end();
    child.kill();
  };
  t.after(close);

  let nextId = 1;
  const send = (text) => child.stdin.write(`${text}\n`);
  const call = (method, params) =>
    new Promise((settle) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, settle);
      const request = { jsonrpc: "2.0", id, method };
      if (params !== undefined) request.params = params;
      send(JSON.stringify(request));
    });
  const nextStray = () => (strays.length > 0 ? Promise.resolve(strays.shift()) : new Promise((settle) => strayWaiters.push(settle)));

  return { child, send, call, nextStray, close };
}

async function discovered(t) {
  const plugin = startPlugin(t);
  const frame = await plugin.call("discover", {
    root: demo,
    include: ["src/**/*.mjs"],
    exclude: null,
    configPath: join(demo, "autofuzz.json"),
  });
  assert.equal(frame.error, undefined, JSON.stringify(frame.error));
  const byName = new Map(frame.result.targets.map((target) => [target.name, target]));
  const skippedByName = new Map(frame.result.skipped.map((entry) => [entry.name, entry]));
  return { plugin, byName, skippedByName };
}

const invoke = (plugin, targetId, values, deadlineMs = 5000) =>
  plugin.call("invoke", { invocationId: 1, targetId, values, deadlineMs, collectCoverage: false });

test("handshake declares the scaffold", async (t) => {
  const plugin = startPlugin(t);
  const { result } = await plugin.call("handshake");
  assert.equal(result.protocolVersion, PROTOCOL_VERSION);
  assert.equal(result.name, "starter");
  assert.equal(result.targetClass, "design-time");
  assert.deepEqual(result.capabilities, ["reproducer"]);
  assert.deepEqual(result.languages, ["javascript"]);
  assert.equal(result.discoverRequiresExecution, false);
});

test("discovery lists the fuzzable exports and skips the rest with reasons", async (t) => {
  const { plugin, byName, skippedByName } = await discovered(t);
  assert.deepEqual([...byName.keys()].sort(), ["applyDiscount", "lineTotal", "noisy", "spin"]);

  const lineTotal = byName.get("lineTotal");
  assert.equal(lineTotal.origin.file, "src/ledger.mjs");
  assert.deepEqual(lineTotal.parameters, [{ name: "count", type: { kind: "scalar", scalar: "bigInt" }, required: true }]);
  assert.equal(lineTotal.materialization, "constructible");
  assert.equal(lineTotal.targetClass, "design-time");
  assert.deepEqual(lineTotal.returns, { kind: "scalar", scalar: "bigInt" });

  assert.equal(byName.get("spin").effects.async, true);
  assert.equal(byName.get("applyDiscount").effects.async, false);

  assert.deepEqual([...skippedByName.keys()].sort(), ["_cacheKey", "postToLedger", "untyped"]);
  assert.equal(skippedByName.get("_cacheKey").reason, "not-public");
  assert.equal(skippedByName.get("untyped").reason, "unsupported-signature");
  assert.match(skippedByName.get("untyped").detail, /no JSDoc @param type for value/);
  const blocked = skippedByName.get("postToLedger");
  assert.equal(blocked.reason, "unconstructible-parameter");
  assert.deepEqual(blocked.blockedBy, { type: "Ledger", path: "ledger" });
  assert.equal(blocked.materialization, "opaque");
});

test("ids are stable across processes", async (t) => {
  const first = await discovered(t);
  const second = await discovered(t);
  assert.deepEqual([...first.byName.keys()].sort(), [...second.byName.keys()].sort());
  for (const name of first.byName.keys()) {
    assert.equal(first.byName.get(name).id, second.byName.get(name).id, `${name} got a different id in a second process`);
  }
});

test("prepare answers with a handle, or a bare skip reason", async (t) => {
  const { plugin, byName } = await discovered(t);
  const ok = await plugin.call("prepare", { targetId: byName.get("lineTotal").id, values: [{ node: "bigInt", value: "5" }] });
  assert.equal(ok.result.ok, true);
  assert.equal(typeof ok.result.materialized.handle, "string");
  const missing = await plugin.call("prepare", { targetId: "afz:t:nosuchtarget", values: [] });
  assert.deepEqual(missing.result, { ok: false, reason: "discovery-error" });
});

test("the fixture crash comes back failed, with a frame inside the fixture", async (t) => {
  const { plugin, byName } = await discovered(t);
  const { result } = await invoke(plugin, byName.get("lineTotal").id, [{ node: "bigInt", value: "5" }]);
  assert.equal(result.kind, "failed");
  assert.equal(result.via, "thrown");
  assert.equal(result.fault.class, "TypeError");
  assert.ok(result.fault.frames.some((frame) => frame.file === "src/ledger.mjs"), `no frame names the fixture: ${JSON.stringify(result.fault.frames)}`);
  assert.ok(result.durationMs >= 0);
});

test("a refusal class the scan project lists comes back rejected", async (t) => {
  const { plugin, byName } = await discovered(t);
  const { result } = await invoke(plugin, byName.get("applyDiscount").id, [{ node: "number", value: -5 }]);
  assert.equal(result.kind, "rejected");
  assert.equal(result.via, "reject-class");
  assert.match(result.detail, /RangeError/);
});

test("a call past its deadline cuts itself and still answers", async (t) => {
  const { plugin, byName } = await discovered(t);
  const started = Date.now();
  const { result } = await invoke(plugin, byName.get("spin").id, [{ node: "number", value: 30000 }], 250);
  const waited = Date.now() - started;
  assert.equal(result.kind, "failed");
  assert.equal(result.via, "deadline-cut");
  assert.equal(result.fault.class, "TimeoutError");
  assert.ok(waited < 5000, `the plugin waited ${waited} ms for a 250 ms deadline`);
});

test("a target that logs cannot corrupt the protocol channel", async (t) => {
  const { plugin, byName } = await discovered(t);
  const { result } = await invoke(plugin, byName.get("noisy").id, [{ node: "string", value: "conformance noise" }]);
  assert.equal(result.kind, "ok");
  assert.deepEqual(result.value, { node: "string", value: "conformance noise" });
  // If the target's console.log had reached stdout, this next frame could not parse.
  const after = await plugin.call("handshake");
  assert.equal(after.result.name, "starter");
});

test("an unknown target id is an outcome, not an error frame", async (t) => {
  const { plugin } = await discovered(t);
  const frame = await invoke(plugin, "afz:t:nosuchtarget", []);
  assert.equal(frame.error, undefined);
  assert.equal(frame.result.kind, "failed");
  assert.equal(frame.result.fault.class, "UnknownTarget");
});

test("the reproducer replays the crash as a standalone script", async (t) => {
  const { plugin, byName } = await discovered(t);
  const target = byName.get("lineTotal");
  const frame = await plugin.call("reproducer", { targetId: target.id, values: [{ node: "bigInt", value: "5" }] });
  assert.equal(frame.error, undefined, JSON.stringify(frame.error));
  assert.equal(frame.result.extension, "mjs");
  assert.match(frame.result.script, /ledger\.mjs/);
  assert.match(frame.result.script, /lineTotal\(5n\)/);

  const dir = mkdtempSync(join(tmpdir(), "afz-repro-"));
  const script = join(dir, "repro.mjs");
  writeFileSync(script, frame.result.script);
  const replay = await new Promise((settle) => {
    const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => settle({ code, stderr }));
  });
  assert.notEqual(replay.code, 0, "the rendered reproducer ran clean; it must replay the crash");
  assert.match(replay.stderr, /TypeError/);
});

test("an unknown method answers -32601 and echoes the id", async (t) => {
  const plugin = startPlugin(t);
  const frame = await plugin.call("afz/does-not-exist", {});
  assert.equal(frame.error.code, -32601);
  assert.match(frame.error.message, /method not found/);
});

test("a line that is not JSON answers -32700 without dying", async (t) => {
  const plugin = startPlugin(t);
  plugin.send("this is not JSON");
  const frame = await plugin.nextStray();
  assert.equal(frame.error.code, -32700);
  assert.equal(frame.id, null);
  const after = await plugin.call("handshake");
  assert.equal(after.result.name, "starter");
});
