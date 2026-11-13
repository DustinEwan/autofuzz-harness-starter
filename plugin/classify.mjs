// Thrown JavaScript values to the three outcomes.
//
// The engine accepts exactly three answers per invoke, and this file decides which one a
// throw becomes:
//
//   - a throw whose class the scan project listed in `harness.options.rejectClasses` is
//     a `rejected` outcome via `reject-class`: the target examined the input and said no
//     through a channel its own author declared;
//   - a deadline the plugin cut itself is `failed` via `deadline-cut`;
//   - everything else is `failed` via `thrown`, and its stack becomes fault frames.
//
// The frames carry paths relative to the scan root, because the engine compares a frame's
// `file` with the target's `origin.file`, and both are root-relative.

// Node writes ESM stack frames as `file://` URLs; the engine compares a frame's `file`
// with the target's root-relative `origin.file`, so the URL becomes a path first.
import { fileURLToPath } from "node:url";

export const VIA_REJECT_CLASS = "reject-class";
export const VIA_THROWN = "thrown";
export const VIA_DEADLINE_CUT = "deadline-cut";
export const VIA_MATERIALIZATION_BLOCKED = "materialization-blocked";
export const VIA_MODULE_LOAD = "module-load-failed";
export const VIA_DISCOVERY_ERROR = "discovery-error";

export class DeadlineCut extends Error {
  constructor(deadlineMs) {
    super(`the target ran past its ${deadlineMs} ms deadline`);
    this.name = "TimeoutError";
  }
}

export function classifyThrown(error, root, rejectClasses) {
  const className = error instanceof Error ? error.constructor.name : typeof error;
  const message = error instanceof Error ? String(error.message) : String(error);
  if (error instanceof Error && rejectClasses.includes(className)) {
    return { kind: "rejected", via: VIA_REJECT_CLASS, detail: `${className}: ${message}` };
  }
  const frames = error instanceof Error && typeof error.stack === "string" ? parseFrames(error.stack, root) : [];
  return { kind: "failed", via: VIA_THROWN, fault: { class: className, message, frames } };
}

export function deadlineCut(deadlineMs) {
  return {
    kind: "failed",
    via: VIA_DEADLINE_CUT,
    fault: { class: "TimeoutError", message: `the target ran past its ${deadlineMs} ms deadline`, frames: [] },
  };
}

export function materializationBlocked(cause) {
  return {
    kind: "failed",
    via: VIA_MATERIALIZATION_BLOCKED,
    fault: { class: "MaterializeError", message: String(cause.message ?? cause), frames: [] },
  };
}

export function moduleLoadFailed(cause) {
  return {
    kind: "failed",
    via: VIA_MODULE_LOAD,
    fault: { class: "LoadError", message: String(cause.message ?? cause), frames: [] },
  };
}

export function unknownTarget(targetId) {
  return {
    kind: "failed",
    via: VIA_DISCOVERY_ERROR,
    fault: { class: "UnknownTarget", message: `this process never discovered a target ${targetId}`, frames: [] },
  };
}

// Node stack lines come in two shapes:
//   at lineTotal (/abs/root/src/ledger.mjs:14:18)
//   at /abs/root/src/ledger.mjs:14:18
// Both yield one frame; every other line (the message, `at async`, internals without a
// path) yields none.
export function parseFrames(stack, root) {
  const frames = [];
  for (const line of stack.split("\n")) {
    const named = line.match(/^\s*at\s+(?:async\s+)?(\S+)\s+\(([^()]+):(\d+):(\d+)\)\s*$/);
    const bare = line.match(/^\s*at\s+([^\s()]+):(\d+):(\d+)\s*$/);
    if (named !== null) {
      frames.push({ file: relativize(named[2], root), fnName: named[1], line: Number(named[3]), column: Number(named[4]) });
    } else if (bare !== null) {
      frames.push({ file: relativize(bare[1], root), line: Number(bare[2]), column: Number(bare[3]) });
    }
  }
  return frames;
}

function relativize(path, root) {
  const local = path.startsWith("file:") ? fileURLToPath(path) : path;
  const prefix = `${root}/`;
  return root !== "" && local.startsWith(prefix) ? local.slice(prefix.length) : local;
}
