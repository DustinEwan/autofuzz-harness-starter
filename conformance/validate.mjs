#!/usr/bin/env node
// The conformance project's own fixture validator.
//
// The protocol judge only ever sees the plugin's statements about this fixture. This file
// is the second judgment: it inspects the fixture directly - it imports only the fixture
// and the Node standard library, never the plugin and never the emitter - and reports the
// same property ids. The suite requires the two verdict lists to agree, so a plugin
// cannot pass a fixture-shaped property by answering consistently instead of behaving.
//
// Contract (docs/harness-authoring.md, section 12):
//   - stdout is exactly one JSON `TemplateReport` and nothing else;
//   - exit 0 even when a property fails; non-zero only when this validator itself could
//     not run;
//   - the seven fixture-shaped ids, never the three process-shaped ones;
//   - stderr is free text for the author.
//
// Rendered verbatim from conformance/validate.mjs into the staged project; run as
//   node conformance/validate.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..");
const fixturePath = join(projectRoot, "src", "ledger.mjs");

const FIXTURE_SHAPED = [
  "crash-unguarded",
  "guard-refusal",
  "private-symbol",
  "unrepresentable-symbol",
  "unconstructible-receiver",
  "method-receiver",
  "coverage-digest-live",
];

const results = [];
const record = (id, verdict, detail) => results.push({ id, verdict, detail });

let ledger;
let source;
try {
  ledger = await import(pathToFileURL(fixturePath).href);
  source = readFileSync(fixturePath, "utf8");
} catch (cause) {
  for (const id of FIXTURE_SHAPED) record(id, "fail", `the fixture could not be loaded: ${cause}`);
  console.log(JSON.stringify({ version: 1, properties: results }));
  process.exit(0);
}

// The scan project decides which thrown classes count as refusals; read it from the
// project file the same way the plugin does, so the two judges cannot disagree by
// reading different lists.
let rejectClasses = ["RangeError"];
try {
  const project = JSON.parse(readFileSync(join(projectRoot, "autofuzz.json"), "utf8"));
  if (Array.isArray(project?.harness?.options?.rejectClasses)) rejectClasses = project.harness.options.rejectClasses;
} catch {
  // The default stands; a project file this validator cannot read is a fail the
  // protocol judge will surface as a broken fixture anyway.
}

// crash-unguarded: the crash is in the fixture's own code, not in a wrapper.
try {
  ledger.lineTotal(5n);
  record("crash-unguarded", "fail", "lineTotal(5n) returned instead of throwing");
} catch (error) {
  const own = typeof error.stack === "string" && error.stack.includes("ledger.mjs");
  record(
    "crash-unguarded",
    own ? "pass" : "fail",
    own
      ? `lineTotal(5n) threw ${error.constructor.name} with a frame inside ledger.mjs itself`
      : `lineTotal(5n) threw ${error}, but no frame names the fixture file`,
  );
}

// guard-refusal: the refusal class is one the scan project declared as a refusal channel.
try {
  ledger.applyDiscount(-5);
  record("guard-refusal", "fail", "applyDiscount(-5) returned instead of refusing");
} catch (error) {
  const listed = rejectClasses.includes(error.constructor.name);
  record(
    "guard-refusal",
    listed ? "pass" : "fail",
    listed
      ? `applyDiscount(-5) threw ${error.constructor.name}, which harness.options.rejectClasses lists`
      : `applyDiscount(-5) threw ${error.constructor.name}, which the scan project does not list as a refusal`,
  );
}

// private-symbol: the symbol is exported, so discovery sees it, and its name marks it
// module-private, so the scaffold's first skip rule reports it as not-public.
if (typeof ledger._cacheKey === "function" && "_cacheKey".startsWith("_")) {
  record("private-symbol", "pass", "_cacheKey is exported and underscore-prefixed, so discovery reports it as not-public instead of fuzzing it");
} else {
  record("private-symbol", "fail", "_cacheKey is no longer an underscore-prefixed exported function");
}

// unrepresentable-symbol: the scaffold lowers types from JSDoc only, so a parameter
// without an @param type is a signature no generator can draw values for.
if (typeof ledger.untyped === "function" && jsdocAbove("untyped") === "" && !/@param/.test(commentAbove("untyped"))) {
  record("unrepresentable-symbol", "pass", "untyped declares a parameter with no JSDoc @param type, so the scaffold cannot lower its signature");
} else {
  record("unrepresentable-symbol", "fail", "untyped is no longer an exported function whose parameters lack JSDoc types");
}

// unconstructible-receiver: postToLedger demands a Ledger, and no Ledger exists to build.
const ledgerDoc = jsdocAbove("postToLedger");
if (ledger.postToLedger?.length === 1 && /@param\s+\{Ledger\}/.test(ledgerDoc) && !("Ledger" in ledger)) {
  record("unconstructible-receiver", "pass", "postToLedger takes one parameter of type Ledger, and the fixture exports no Ledger to construct");
} else {
  record("unconstructible-receiver", "fail", "postToLedger no longer demonstrates a parameter whose type cannot be built");
}

// The two absences, stated here with the same reasons the manifest declares, so a reader
// of the report sees the judgment twice and the same sentence both times.
record("method-receiver", "not-applicable", "the scaffold has no receiver concept: every target is a free function, so there is no receiver whose construction could be blocked");
record("coverage-digest-live", "not-applicable", "the scaffold declares no coverage capability: the runtime gives it no per-call edge signal, so two inputs have no live digest that could differ");

// The comment block ending directly above the export line for `name`, or "". A `//`
// comment is not a JSDoc block, and this is the check the scaffold's own rule mirrors.
function jsdocAbove(name) {
  const block = commentAbove(name);
  return block.trimEnd().endsWith("*/") && block.includes("/**") ? block : "";
}

function commentAbove(name) {
  const lines = source.split("\n");
  const index = lines.findIndex((line) => line.includes(`function ${name}(`));
  if (index <= 0) return "";
  const previous = lines[index - 1].trimEnd();
  if (previous === "" || !previous.startsWith("*") && !previous.endsWith("*/") && !previous.startsWith("//")) return "";
  let start = index - 1;
  while (start >= 0 && (lines[start].trim().startsWith("*") || lines[start].trim().startsWith("/*") || lines[start].trim().startsWith("//"))) start -= 1;
  return lines.slice(start + 1, index).join("\n");
}

console.log(JSON.stringify({ version: 1, properties: results }));
