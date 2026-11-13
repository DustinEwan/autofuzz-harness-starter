#!/usr/bin/env node
// Render the conformance fixture project for the starter harness.
//
// `afz validate-harness` and `afz-xtask check-harness` validate a plugin against the
// template (`crates/afz-conformance/template/v1.json`): ten semantic properties stated as
// wire-level expectations. This emitter writes a small JavaScript package that realizes
// every property the scaffold can express, the `autofuzz.json` that points the plugin at
// it, and `afz-conformance-manifest.json` naming the symbol behind each property. The
// suite, not this file, decides pass/fail.
//
// Usage:
//   node conformance/emit.mjs --out /tmp/conformance-starter
//
// The fixture and the scan project are copied from `test-targets/demo` rather than
// embedded, so the project `test/plugin.test.mjs` drives and the project the suite
// validates are the same files, not two transcriptions of one idea.
//
// Two properties are declared not-applicable, and the CI gate asserts that these are the
// only such lines for the scaffold: the scaffold has no receiver concept to block, and
// it declares no coverage capability, so two inputs have no live digest to differ on.
// Declaring the absence is honest; inventing a fake pass is not.

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const demo = join(packageRoot, "test-targets", "demo");

const value = (node) => ({ ...node, provenance: "user" });
const number = (n) => value({ node: "number", value: n });
const string = (s) => value({ node: "string", value: s });
const bigInt = (s) => value({ node: "bigInt", value: s });

const manifest = {
  templateVersion: 1,
  properties: {
    "crash-unguarded": { symbol: "lineTotal", input: [bigInt("5")] },
    "guard-refusal": { symbol: "applyDiscount", input: [number(-5)] },
    "private-symbol": { symbol: "_cacheKey" },
    "unrepresentable-symbol": { symbol: "untyped" },
    "unconstructible-receiver": { symbol: "postToLedger", blockedByType: "Ledger" },
    "method-receiver": {
      notApplicable:
        "the scaffold has no receiver concept: every target is a free function, so there is no receiver whose construction could be blocked",
    },
    "coverage-digest-live": {
      notApplicable:
        "the scaffold declares no coverage capability: the runtime gives it no per-call edge signal, so two inputs have no live digest that could differ",
    },
    "stdout-purity": { symbol: "noisy", input: [string("conformance noise")] },
    // The same crash as `crash-unguarded`: the script the plugin renders must replay it,
    // and the script must name the file that held the fault.
    "reproducer-script": { symbol: "lineTotal", input: [bigInt("5")] },
    // 30 000 ms against the harness's 1500 ms deadline: only a real cut answers inside it.
    "deadline-sleep": { symbol: "spin", input: [number(30000)] },
  },
  // The project judges its own fixture: Node runs .mjs files directly, so the validator
  // imports `src/ledger.mjs` with no plugin and no emitter in the path.
  validator: ["node", "conformance/validate.mjs"],
};

function emit(out) {
  mkdirSync(join(out, "src"), { recursive: true });
  mkdirSync(join(out, "conformance"), { recursive: true });
  copyFileSync(join(demo, "src", "ledger.mjs"), join(out, "src", "ledger.mjs"));
  copyFileSync(join(demo, "autofuzz.json"), join(out, "autofuzz.json"));
  copyFileSync(join(packageRoot, "conformance", "validate.mjs"), join(out, "conformance", "validate.mjs"));
  writeFileSync(join(out, "afz-conformance-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

const flag = process.argv.indexOf("--out");
if (flag === -1 || process.argv[flag + 1] === undefined) {
  console.error("usage: emit.mjs --out DIR");
  process.exit(2);
}
emit(process.argv[flag + 1]);
console.log(process.argv[flag + 1]);
