// The wire-vocabulary pin, the Node twin of `test/contract_test.py` in
// `autofuzz-harness-python`.
//
// The two sides of the plugin boundary are written in different languages and built
// separately. This file is where they are checked against each other: every literal
// `plugin/protocol.mjs` sends or reads is compared with the JSON Schema committed under
// `docs/schema/`, and the method vocabulary, the protocol version, and the error codes
// are compared with the prose in `docs/architecture.md` and `docs/harness-authoring.md`.
//
// Run with:
//
//     node --test test/
//
// The engine checkout supplies the documents: `AFZ_DOCS` names its docs directory (CI
// sets it), and the default is the sibling checkout local work shares.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as wire from "../plugin/protocol.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = process.env.AFZ_DOCS ?? resolve(packageRoot, "..", "autofuzz", "docs");
const schemaDir = join(docsDir, "schema");
const design = readFileSync(join(docsDir, "architecture.md"), "utf8");
const guide = readFileSync(join(docsDir, "harness-authoring.md"), "utf8");

const schema = (name) => JSON.parse(readFileSync(join(schemaDir, name), "utf8"));
const sorted = (values) => [...values].sort();

/** The literal members of a union, sorted: schemars emits `enum` or `oneOf` of bare consts. */
function literals(spec, what) {
  if (Array.isArray(spec.enum)) return sorted(spec.enum);
  if (!Array.isArray(spec.oneOf)) throw new Error(`${what} is neither an enum nor a oneOf`);
  return sorted(
    spec.oneOf.map((variant) => {
      assert.equal(typeof variant.const, "string", `${what} member carries no const string`);
      return variant.const;
    }),
  );
}

/** The tag values of a tagged union, sorted, read from the discriminator property. */
function tags(document, field, what) {
  return sorted(
    document.oneOf.map((variant) => {
      const value = variant.properties?.[field]?.const;
      assert.equal(typeof value, "string", `${what} variant has no "${field}" const`);
      return value;
    }),
  );
}

test("the protocol version matches the guide", () => {
  // docs/schema/handshake.json types protocolVersion as a plain string and carries no
  // value, so the guide is the only document that pins the literal.
  const text = guide.replace(/\s+/g, " ");
  const stated = text.match(/`PROTOCOL_VERSION` is `"([^"]+)"/);
  assert.ok(stated !== null, "the guide no longer states the PROTOCOL_VERSION literal");
  assert.equal(wire.PROTOCOL_VERSION, stated[1]);
});

test("the error codes match the guide", () => {
  const phrases = {
    parse: "parse error",
    invalid_request: "invalid request",
    method_not_found: "method not found",
    plugin: "plugin error",
  };
  const text = guide.replace(/\s+/g, " ");
  assert.deepEqual(sorted(Object.keys(wire.ERROR_CODES)), sorted(Object.keys(phrases)));
  for (const [key, code] of Object.entries(wire.ERROR_CODES)) {
    assert.ok(text.includes(`\`${code}\` ${phrases[key]}`), `the guide no longer names error code ${code}`);
    assert.equal(wire.ERROR_PHRASES[code], phrases[key]);
  }
});

test("the plugin answers exactly the methods the design declares", () => {
  const start = design.indexOf("export interface HarnessPlugin {");
  assert.notEqual(start, -1, "no plugin interface found in the design");
  const block = design.slice(start, design.indexOf("\n}", start));
  const declared = [...block.matchAll(/^  ([A-Za-z]+)\??\(/gm)].map((match) => match[1]);
  assert.ok(declared.length >= wire.METHOD_NAMES.length, "no plugin interface found in the design");
  assert.deepEqual(sorted(wire.METHOD_NAMES), sorted(declared));
});

test("skip reasons match the generated schema", () => {
  assert.deepEqual(sorted(wire.SKIP_REASONS), literals(schema("skipped-target.json").$defs.SkipReason, "SkipReason"));
});

test("materializations match the generated schema", () => {
  assert.deepEqual(sorted(wire.MATERIALIZATIONS), literals(schema("target-descriptor.json").$defs.Materialization, "Materialization"));
});

test("capabilities match the generated schema", () => {
  assert.deepEqual(sorted(wire.CAPABILITIES), literals(schema("handshake.json").$defs.Capability, "Capability"));
});

test("target classes match the generated schema", () => {
  assert.deepEqual(sorted(wire.TARGET_CLASSES), schema("handshake.json").$defs.TargetClass.enum.slice().sort());
});

test("type node kinds match the generated schema", () => {
  assert.deepEqual(sorted(wire.TYPE_NODE_KINDS), tags(schema("type-node.json"), "kind", "TypeNode"));
});

test("value node tags match the generated schema", () => {
  assert.deepEqual(sorted(wire.VALUE_NODE_TAGS), tags(schema("value-tree.json"), "node", "ValueNode"));
});

test("scalar, collection, composite, and behavior sub-kinds match the schema", () => {
  const typeNode = schema("type-node.json").$defs;
  assert.deepEqual(sorted(wire.SCALAR_KINDS), literals(typeNode.ScalarKind, "ScalarKind"));
  assert.deepEqual(sorted(wire.COLLECTION_KINDS), literals(typeNode.CollectionKind, "CollectionKind"));
  assert.deepEqual(sorted(wire.COMPOSITE_KINDS), literals(typeNode.CompositeKind, "CompositeKind"));
  assert.deepEqual(sorted(wire.FUNCTION_BEHAVIORS), literals(typeNode.FunctionBehavior, "FunctionBehavior"));
});

test("the number names the wire carries are the serde spellings", () => {
  assert.deepEqual(sorted(wire.SPECIAL_NUMBERS), ["infinity", "naN", "negativeInfinity"]);
  assert.deepEqual(literals(schema("value-tree.json").$defs.SpecialNumber, "SpecialNumber"), sorted(wire.SPECIAL_NUMBERS));
});

test("outcome kinds and required fields are what the engine reads", () => {
  const outcome = schema("outcome.json");
  assert.deepEqual(sorted(wire.OUTCOME_KINDS), tags(outcome, "kind", "Outcome"));
  assert.deepEqual(outcome.$defs.RejectedOutcome.required, ["durationMs", "via", "detail"]);
  assert.deepEqual(outcome.$defs.FailedOutcome.required, ["durationMs", "via", "fault"]);
  assert.deepEqual(outcome.$defs.FaultSignature.required, ["class", "message"]);
});

test("prepare reports ok with a handle, or a bare skip reason", () => {
  const prepare = schema("prepare-resp.json");
  const [ok, skip] = prepare.oneOf;
  assert.deepEqual(ok.required, ["ok", "materialized"]);
  assert.deepEqual(skip.required, ["ok", "reason"]);
  assert.deepEqual(sorted(Object.keys(prepare.$defs.MaterializedCall.properties)), ["handle", "summary"]);
});

// Every key the plugin writes must exist in the committed schema for that shape.
function assertSubset(emitted, documentName, path, what) {
  let node = schema(documentName);
  for (const part of path) node = node[part];
  const unknown = [...emitted].filter((key) => !(key in node.properties));
  assert.deepEqual(unknown, [], `${what} emits keys docs/schema/${documentName} does not define`);
}

test("the target descriptor emits only schema keys and all required ones", () => {
  assertSubset(wire.TARGET_DESCRIPTOR_KEYS, "target-descriptor.json", [], "TargetDescriptor");
  const missing = schema("target-descriptor.json").required.filter((key) => !wire.TARGET_DESCRIPTOR_KEYS.has(key));
  assert.deepEqual(missing, [], "TargetDescriptor would omit required fields");
});

test("the skipped entry emits only schema keys", () => {
  assertSubset(wire.SKIPPED_TARGET_KEYS, "skipped-target.json", [], "SkippedTarget");
});

test("the fault signature and frames emit only schema keys", () => {
  assertSubset(wire.FAULT_SIGNATURE_KEYS, "outcome.json", ["$defs", "FaultSignature"], "FaultSignature");
  assertSubset(wire.FAULT_FRAME_KEYS, "outcome.json", ["$defs", "FaultFrame"], "FaultFrame");
});

test("effects, origin, and parameters emit only schema keys", () => {
  assertSubset(wire.EFFECTS_KEYS, "target-descriptor.json", ["$defs", "Effects"], "Effects");
  assertSubset(wire.ORIGIN_KEYS, "target-descriptor.json", ["$defs", "Origin"], "Origin");
  assertSubset(wire.PARAMETER_KEYS, "target-descriptor.json", ["$defs", "Parameter"], "Parameter");
});
