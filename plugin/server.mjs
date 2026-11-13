#!/usr/bin/env node
// The starter plugin: one JSON-RPC 2.0 object per line on stdin, one per line on stdout.
//
// Two rules shape every line of this file, and they are the two an author meets first:
//
//   1. stdout is the protocol channel. The plugin redirects `process.stdout.write` to
//      stderr around every handler, so a target that logs cannot corrupt a frame or
//      deadlock the engine's reader. All frames go out on `realWrite`, captured before
//      any redirect exists.
//   2. A target call that outlives its deadline must answer before the engine's own
//      timeout fires. The plugin races the call against `deadlineMs` and answers
//      `failed` via `deadline-cut` itself; waiting to be killed loses the outcome.
//
// Requests are handled one at a time, in order. The engine sends a request and reads its
// response before the next one, and a single-threaded loop makes that ordering a fact of
// the code rather than a promise in a comment.

import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { ERROR_CODES, JSONRPC_VERSION, PROTOCOL_VERSION, failure, success } from "./protocol.mjs";
import { discover } from "./discover.mjs";
import { DeadlineCut, classifyThrown, deadlineCut, materializationBlocked, moduleLoadFailed, unknownTarget } from "./classify.mjs";
import { materialize, toValueTree } from "./materialize.mjs";
import { renderReproducer } from "./repro.mjs";

const OUT = process.stdout;
const realWrite = OUT.write.bind(OUT);
const writeLine = (frame) => realWrite(`${JSON.stringify(frame)}\n`);

// What a scan project opts into by default: a `RangeError` is the ordinary JavaScript
// "you passed me a bad number", and `harness.options.rejectClasses` replaces the list.
const DEFAULT_REJECT_CLASSES = ["RangeError"];

class InvalidRequest extends Error {}
class MethodNotFound extends Error {
  constructor(method) {
    super(`method not found: ${method}`);
  }
}

// Per connection: the discovery this process answered and the root it was relative to.
// The suite's worker connection discovers again on its own process, so each connection
// carries its own registry and an invoke never needs a handshake or a discover it missed.
let root = "";
let rejectClasses = DEFAULT_REJECT_CLASSES;
const registry = new Map();
const modules = new Map();

const HANDLERS = {
  handshake: () => ({
    protocolVersion: PROTOCOL_VERSION,
    name: "starter",
    version: "0.1.0",
    targetClass: "design-time",
    capabilities: ["reproducer"],
    languages: ["javascript"],
    discoverRequiresExecution: false,
  }),

  discover(params) {
    root = params.root ?? "";
    if (root !== "" && !isAbsolute(root)) root = resolve(root);
    rejectClasses = readRejectClasses(params.configPath);
    const found = discover({ root, include: params.include, exclude: params.exclude });
    registry.clear();
    for (const target of found.targets) {
      registry.set(target.id, { name: target.name, file: resolve(root, target.origin.file), origin: target.origin });
    }
    return found;
  },

  prepare(params) {
    const target = registry.get(params.targetId);
    if (target === undefined) return { ok: false, reason: "discovery-error" };
    return { ok: true, materialized: { handle: params.targetId, summary: `call ${target.name}(...)` } };
  },

  async invoke(params) {
    const started = performance.now();
    const elapsed = () => performance.now() - started;

    const target = registry.get(params.targetId);
    if (target === undefined) return { ...unknownTarget(params.targetId), durationMs: elapsed() };

    let args;
    try {
      args = params.values.map(materialize);
    } catch (cause) {
      return { ...materializationBlocked(cause), durationMs: elapsed() };
    }

    let callable;
    try {
      const loaded = await loadModule(target.file);
      callable = loaded[target.name];
      if (typeof callable !== "function") throw new Error(`${target.name} is not an exported function of ${target.file}`);
    } catch (cause) {
      return { ...moduleLoadFailed(cause), durationMs: elapsed() };
    }

    try {
      const result = await raceDeadline((async () => await callable(...args))(), params.deadlineMs);
      return { kind: "ok", durationMs: elapsed(), value: toValueTree(result) };
    } catch (cause) {
      if (cause instanceof DeadlineCut) return { ...deadlineCut(params.deadlineMs), durationMs: elapsed() };
      return { ...classifyThrown(cause, root, rejectClasses), durationMs: elapsed() };
    }
  },

  reproducer(params) {
    const target = registry.get(params.targetId);
    if (target === undefined) throw new InvalidRequest(`no target ${params.targetId} in this connection's discovery`);
    return { extension: "mjs", script: renderReproducer({ target, values: params.values }) };
  },
};

async function dispatch(method, params) {
  const handler = HANDLERS[method];
  if (handler === undefined) throw new MethodNotFound(method);
  return handler(params ?? {});
}

// The engine cuts the process at its own timeout plus a grace; a plugin that answers
// first keeps the outcome. The losing timer is cleared, so a fast call leaves nothing
// behind on the event loop.
async function raceDeadline(call, deadlineMs) {
  let timer;
  try {
    return await Promise.race([call, new Promise((_, reject) => { timer = setTimeout(() => reject(new DeadlineCut(deadlineMs)), deadlineMs); })]);
  } finally {
    clearTimeout(timer);
  }
}

function loadModule(file) {
  if (!modules.has(file)) modules.set(file, import(pathToFileURL(file).href));
  return modules.get(file);
}

// Harness-specific settings live in the scan project file, which the engine hands over by
// path because it does not interpret them itself.
function readRejectClasses(configPath) {
  if (configPath === null || configPath === undefined) return DEFAULT_REJECT_CLASSES;
  try {
    const project = JSON.parse(readFileSync(configPath, "utf8"));
    const listed = project?.harness?.options?.rejectClasses;
    return Array.isArray(listed) ? listed.map(String) : DEFAULT_REJECT_CLASSES;
  } catch {
    return DEFAULT_REJECT_CLASSES;
  }
}

async function handleLine(raw) {
  const text = raw.trim();
  if (text === "") return;

  let request;
  try {
    request = JSON.parse(text);
  } catch {
    writeLine(failure(null, ERROR_CODES.parse, "parse error: the line is not one JSON object"));
    return;
  }

  const id = request?.id ?? null;
  if (typeof request !== "object" || request === null || request.jsonrpc !== JSONRPC_VERSION || typeof request.method !== "string") {
    writeLine(failure(id, ERROR_CODES.invalid_request, "invalid request: expected a JSON-RPC 2.0 call with a method"));
    return;
  }

  // The channel is the plugin's, not the target's: anything the target writes to stdout
  // during the handler lands on stderr instead.
  const channel = process.stdout.write;
  process.stdout.write = (chunk, encoding, callback) => {
    process.stderr.write(chunk);
    if (typeof encoding === "function") encoding();
    else if (typeof callback === "function") callback();
    return true;
  };
  let result;
  let error;
  try {
    result = await dispatch(request.method, request.params);
  } catch (cause) {
    error = cause;
  } finally {
    process.stdout.write = channel;
  }

  if (error instanceof MethodNotFound) writeLine(failure(id, ERROR_CODES.method_not_found, error.message));
  else if (error instanceof InvalidRequest) writeLine(failure(id, ERROR_CODES.invalid_request, `invalid request: ${error.message}`));
  else if (error !== undefined) writeLine(failure(id, ERROR_CODES.plugin, `${error.name}: ${error.message}`));
  else writeLine(success(id, result));
}

async function main() {
  // A write to a pipe whose reader is gone is an `'error'` event, and Node ends the
  // process over an unhandled one. The channel is unusable either way; say so on stderr
  // and let the engine notice the silence instead of filing a crash against a target.
  OUT.on("error", (error) => process.stderr.write(`stdout write failed: ${error.message}\n`));
  process.stderr.on("error", () => {});

  for await (const line of createInterface({ input: process.stdin })) {
    await handleLine(line);
  }
  // EOF means the engine is done with this process. Exit now: a target timer that outlived
  // its deadline (the `deadline-sleep` fixture, for one) would otherwise hold the loop.
  process.exit(0);
}

main();
