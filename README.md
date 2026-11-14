# autofuzz harness: starter

The smallest harness plugin the autofuzz engine accepts, written so you can delete it into your own. It discovers exported JavaScript functions from JSDoc, builds arguments from generated values, invokes each entry point, and answers with fault outcomes and reproducer scripts over the plugin protocol (`afz/1`). It conforms to the same suite the production harnesses pass, with two properties declared not-applicable for reasons stated in the manifest.

Host runtime: Node 24 or newer, standard library only. The plugin installs no dependencies and has none, so there is nothing to build and nothing to audit.

## Install

```sh
afz install-harness https://github.com/DustinEwan/autofuzz-harness-starter.git
```

Install drives the conformance suite against `plugin/server.mjs` before it records anything; a plugin that violates any rule is not recorded. `afz harnesses` lists what the registry holds.

A scan project names the harness and no command:

```json
{ "harness": { "name": "starter" } }
```

The engine resolves the plugin argv from the registry record. To try the plugin on the fixture that ships here:

```sh
afz probe-plugin --path test-targets/demo
```

## Author

Edit, then validate — there are no dependencies to fetch:

```sh
afz validate-harness
```

`afz validate-harness` with no argument validates the repository it is run in: it renders the conformance project with this repository's own emitter, drives the suite, and reports rule by rule. It never touches an install or a registry.

Run the unit tests and the wire-vocabulary contract tests:

```sh
AFZ_DOCS=/path/to/autofuzz/docs node --test
```

`AFZ_DOCS` points at an engine checkout; `test/contract.test.mjs` reads `docs/schema/`, `docs/architecture.md`, and `docs/harness-authoring.md` from it. The default is the sibling checkout `../autofuzz/docs`; CI sets the variable explicitly.

## afz-harness.json

| key | meaning |
|---|---|
| `command` | the plugin argv; an element that names an existing file is resolved against this root |
| `conformance.emitter` | a program run as `<argv…> --out <dir>` that renders the whole conformance scan project — source tree, `autofuzz.json`, and `afz-conformance-manifest.json` — into the directory it is given; that rendered project is the only project validation ever drives |
| `conformance.deadlineMs` | the per-invocation deadline the suite passes, default 1000 |

This manifest carries no `install` and no `build`, because the scaffold has no dependencies and Node runs its source as written; a TypeScript harness adds both keys and nothing else changes. The emitter is a standalone program: `conformance/emit.mjs` imports `node:fs`, `node:path`, and `node:url` only.

## The conformance project

`conformance/emit.mjs` copies the demo package from `test-targets/demo` — one deliberate defect per template property, each one named in a comment — and writes the manifest that pairs each property with its symbol. The project `test/plugin.test.mjs` drives and the project the suite validates are the same files, so the two judges cannot drift from each other by drifting from the fixture.

`conformance/validate.mjs` is the project's own fixture validator: it imports the rendered fixture and the standard library only — never the plugin, never the emitter — and the suite requires its verdicts to agree with the plugin's.

Two properties are declared not-applicable, and CI asserts these are the only such lines: the scaffold has no receiver concept (every target is a free function), and it declares no coverage capability, so two inputs have no live digest that could differ.

## The contract

`docs/harness-authoring.md` in the engine repository, <https://github.com/DustinEwan/autofuzz>, states the plugin contract this harness implements. The two rules that decide the shape of `plugin/server.mjs` are in that document and restated at the top of the file: stdout is the protocol channel, and a call that outlives its deadline must answer before the engine cuts the process.
