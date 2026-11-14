# Every afz/1 literal in one file, zero behavior.
#
# `test/run-tests.sh` compares these lists against `$AFZ_DOCS/schema/*.json` and the
# plugin interface in `$AFZ_DOCS/architecture.md`, so a protocol revision fails the
# contract test here rather than the conformance suite in the engine's CI.
#
# Sourced by `plugin/server.sh`; nothing in this file runs.

PROTOCOL_VERSION="afz/1"
JSONRPC_VERSION='"2.0"'

# The eight methods the design declares. The scaffold answers handshake, discover,
# prepare, invoke, reproducer, and ready; `minimize` and `coverageMap` reach the
# method-not-found path because the handshake does not declare those capabilities.
METHOD_NAMES="handshake discover prepare invoke minimize reproducer coverageMap ready"

# Error codes and the phrases the guide attaches to them (docs/harness-authoring.md).
PARSE_ERROR=-32700
INVALID_REQUEST=-32600
METHOD_NOT_FOUND=-32601
PLUGIN_ERROR=-32000

# `docs/schema/handshake.json` $defs.Capability. The scaffold declares `reproducer`
# and `readiness`; the other five are vocabulary only, so the contract test pins the
# whole closed set.
CAPABILITIES="coverage minimize reproducer sideEffects stateful concurrent readiness"

# `docs/schema/skipped-target.json` $defs.SkipReason.
SKIP_REASONS="unconstructible-parameter discovery-error not-public excluded unsupported-signature target-disabled"

# `docs/schema/target-descriptor.json` $defs.Materialization.
MATERIALIZATIONS="constructible fixture-required opaque"

# The scaffold's own conventions, which the README states:
#
#   EXIT_REJECT   an executable's guard says "you passed me a bad input" with this exit.
#   EXIT_SHELL_ERROR   dash reports a runtime error (unset variable, bad command name in
#                      an expansion) with exit 2 and a `<file>: <line>: <token>: …` line
#                      on stderr; that is the scaffold's crash channel, and the frame
#                      parser reads it.
EXIT_REJECT=3
EXIT_SHELL_ERROR=2
EXIT_TIMED_OUT=124
