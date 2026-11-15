# autofuzz harness: starter

The smallest harness plugin the autofuzz engine accepts, written so you can delete it into your own. It discovers executable files, reads each one's `# afz-param:` header lines as its signature, invokes each entry point with generated argv, and answers with fault outcomes and reproducer scripts over the plugin protocol (`afz/1`). It conforms to the same suite the production harnesses pass, with three of the twelve template properties declared not-applicable for reasons stated in the manifest.

Host runtime: a POSIX `sh` (the plugin runs under dash), coreutils (`find`, `timeout`, `sha256sum`, `sort`, `cut`, `sed`, `head`, `tr`), `iconv` (the only UTF-8 validator the plugin will trust, used to decide whether a target's stdout can be a string value at all), and any POSIX `awk`. JSON parsing is the vendored `vendor/JSON.sh`, which needs `bash`; the attribution file beside it says why a vendored parser beats a dependency you cannot assume. The plugin installs nothing and has no dependencies, so there is nothing to build and nothing to audit.

The target model is one executable file per target, named by the file's base name. The outcome convention is the exit code: `0` is a return value (stdout is the value, empty stdout is `undefined`, and stdout that is not text is a value the wire cannot carry, so the answer is ok with no value), `3` is the project's own guard refusal, `124` is the deadline cut by `timeout(1)`, `2` with dash's `file: line: token: message` line is a thrown shell error with a frame, and anything else is a thrown `Exit N` or `Signal N`.

## Install

```sh
afz install-harness https://github.com/DustinEwan/autofuzz-harness-starter.git
```

Install drives the conformance suite against `plugin/server.sh` before it records anything; a plugin that violates any rule is not recorded. `afz harnesses` lists what the registry holds.

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

Run the plugin tests and the wire-vocabulary contract tests:

```sh
AFZ_DOCS=/path/to/autofuzz/docs sh test/run-tests.sh
```

`AFZ_DOCS` points at an engine checkout; `test/run-tests.sh` reads `docs/schema/`, `docs/architecture.md`, and `docs/harness-authoring.md` from it. The default is the sibling checkout `../autofuzz/docs`; CI sets the variable explicitly. The assertions parse response frames with the same vendored `JSON.sh` the plugin uses, so the suite adds no host requirement.

## afz-harness.json

| key | meaning |
|---|---|
| `command` | the plugin argv; an element that names an existing file is resolved against this root |
| `conformance.emitter` | a program run as `<argv…> --out <dir>` that renders the whole conformance scan project — source tree, `autofuzz.json`, and `afz-conformance-manifest.json` — into the directory it is given; that rendered project is the only project validation ever drives |
| `conformance.deadlineMs` | the per-invocation deadline the suite passes, default 1000 |

This manifest carries no `install` and no `build`, because the scaffold has no dependencies and the shell runs its source as written; a compiled harness adds both keys and nothing else changes. The emitter is a standalone script: `conformance/emit.sh` copies files and writes the manifest with `cat`.

## The conformance project

`conformance/emit.sh` copies the demo tree from `test-targets/demo` — one deliberate defect per template property, each one named in a comment — and writes the manifest that pairs each property with its target. The project `test/run-tests.sh` drives and the project the suite validates are the same files, so the two judges cannot drift from each other by drifting from the fixture.

`conformance/validate.sh` is the project's own fixture validator: it reads the rendered files and coreutils only — never the plugin, never the emitter — and the suite requires its verdicts to agree with the plugin's.

Three properties are declared not-applicable, and CI asserts these are the only such lines: an executable file has no receiver concept (every target runs as its own process), the scaffold declares no coverage capability (so two inputs have no live digest that could differ), and it has no build or load step of its own that could fail for one discovered symbol while its siblings build.

## The contract

`docs/harness-authoring.md` in the engine repository, <https://github.com/DustinEwan/autofuzz>, states the plugin contract this harness implements. The two rules that decide the shape of `plugin/server.sh` are in that document and restated at the top of the file: stdout is the protocol channel, and a call that outlives its deadline must answer before the engine cuts the process.
