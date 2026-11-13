// The wire vocabulary of the starter harness.
//
// Every literal in this file is pinned by the engine: the JSON Schema generated from the
// Rust types lives under `docs/schema/` in the engine repository, and the prose contract
// lives in `docs/architecture.md` and `docs/harness-authoring.md`.
// `test/contract.test.mjs` compares each constant below with those documents, so a plugin
// that drifts from the engine fails a test in this repository rather than confusing the
// engine at run time.

export const PROTOCOL_VERSION = "afz/1";
export const JSONRPC_VERSION = "2.0";

// The seven methods the design declares. The scaffold answers five of them; `minimize`
// and `coverageMap` reach the method-not-found path because the handshake does not
// declare those capabilities.
export const METHOD_NAMES = ["handshake", "discover", "prepare", "invoke", "minimize", "reproducer", "coverageMap"];

// Error codes and the phrases the guide attaches to them (docs/harness-authoring.md).
export const ERROR_CODES = {
  parse: -32700,
  invalid_request: -32600,
  method_not_found: -32601,
  plugin: -32000,
};
export const ERROR_PHRASES = {
  [-32700]: "parse error",
  [-32600]: "invalid request",
  [-32601]: "method not found",
  [-32000]: "plugin error",
};

export const CAPABILITIES = ["coverage", "minimize", "reproducer", "sideEffects", "stateful", "concurrent"];
export const TARGET_CLASSES = ["design-time", "runtime"];
export const SKIP_REASONS = [
  "unconstructible-parameter",
  "discovery-error",
  "not-public",
  "excluded",
  "unsupported-signature",
  "target-disabled",
];
export const MATERIALIZATIONS = ["constructible", "fixture-required", "opaque"];

export const TYPE_NODE_KINDS = [
  "scalar",
  "stringFormat",
  "literal",
  "collection",
  "object",
  "tuple",
  "composite",
  "buffer",
  "promise",
  "function",
  "stream",
  "opaque",
  "ref",
];
export const VALUE_NODE_TAGS = [
  "null",
  "undefined",
  "boolean",
  "number",
  "bigInt",
  "string",
  "literal",
  "array",
  "set",
  "map",
  "object",
  "tuple",
  "buffer",
  "function",
  "stream",
  "opaque",
];
export const SCALAR_KINDS = ["null", "undefined", "boolean", "number", "bigInt", "string"];
export const COLLECTION_KINDS = ["array", "set", "map"];
export const COMPOSITE_KINDS = ["union", "intersection"];
export const FUNCTION_BEHAVIORS = ["returnFirst", "throw", "captureArguments"];
export const OUTCOME_KINDS = ["ok", "rejected", "failed"];

// JSON has no token for NaN or the infinities, so the wire carries these names and the
// plugin re-materializes the values. The spellings are serde's, camelCase except `naN`.
export const SPECIAL_NUMBERS = ["naN", "infinity", "negativeInfinity"];

// The key sets this plugin writes into each shape. The contract test asserts each set is
// a subset of the properties the committed schema defines, and that TargetDescriptor's
// required fields are all present.
export const TARGET_DESCRIPTOR_KEYS = new Set(["id", "targetClass", "origin", "name", "parameters", "returns", "effects", "materialization"]);
export const SKIPPED_TARGET_KEYS = new Set(["targetId", "name", "reason", "detail", "materialization", "blockedBy", "unlocksTargets"]);
export const FAULT_SIGNATURE_KEYS = new Set(["class", "message", "frames"]);
export const FAULT_FRAME_KEYS = new Set(["file", "line", "column", "fnName"]);
export const EFFECTS_KEYS = new Set(["async", "throws", "streams", "callbacks", "mutatesState"]);
export const ORIGIN_KEYS = new Set(["file", "module", "line"]);
export const PARAMETER_KEYS = new Set(["name", "type", "required"]);

export function success(id, result) {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

export function failure(id, code, message) {
  return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } };
}
