// Discovery for the scaffold: it reads source text and never executes it.
//
// Every exported function inside the include globs is examined, and the first rule that
// fires decides what the engine hears about it:
//
//   1. a name starting with `_` is module-private: `not-public`;
//   2. no JSDoc block, or a declared parameter with no `@param`, or a rest parameter:
//      `unsupported-signature`, because the plugin cannot lower a type it cannot read;
//   3. a `@param` type the scaffold cannot lower: `unconstructible-parameter`, with the
//      blocking type named so one missing type stays one task;
//   4. a file that cannot be read: `discovery-error`.
//
// Only what survives all four becomes a target. The four rules run in this order and no
// other, because the reason the engine reports must be the reason the scaffold stopped.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { lowerType, splitTopLevel } from "./lower.mjs";

const DEFAULT_INCLUDE = ["**/*.mjs", "**/*.js"];
// Directories no scan should walk into, whatever the globs say.
const PRUNED = new Set(["node_modules", "dist", ".git", ".autofuzz"]);

const FUNCTION_EXPORT = /^export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/;
const ARROW_EXPORT = /^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(async\s+)?\(([^)]*)\)\s*=>/;

export function discover({ root, include, exclude }) {
  const includes = (include === null || include === undefined || include.length === 0 ? DEFAULT_INCLUDE : include).map(globToRegExp);
  const excludes = (exclude ?? []).map(globToRegExp);

  const targets = [];
  const skipped = [];
  for (const file of walk(root)) {
    if (!includes.some((pattern) => pattern.test(file)) || excludes.some((pattern) => pattern.test(file))) continue;

    let source;
    try {
      source = readFileSync(join(root, file), "utf8");
    } catch (cause) {
      skipped.push({
        targetId: makeId(file, file, ""),
        name: file,
        reason: "discovery-error",
        detail: `the file could not be read: ${cause.message}`,
      });
      continue;
    }
    examineFile(file, source, targets, skipped);
  }
  targets.sort((a, b) => (a.name < b.name ? -1 : 1));
  skipped.sort((a, b) => (a.name < b.name ? -1 : 1));
  return { targets, skipped };
}

function examineFile(file, source, targets, skipped) {
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const named = FUNCTION_EXPORT.exec(line) ?? ARROW_EXPORT.exec(line);
    if (named === null) continue;
    const arrow = named.source === ARROW_EXPORT.source;
    examineExport(
      {
        file,
        line: index + 1,
        name: arrow ? named[1] : named[2],
        signature: arrow ? named[4] : named[3],
        isAsync: arrow ? named[3] !== undefined : named[1] !== undefined,
        lines,
      },
      targets,
      skipped,
    );
  }
}

function examineExport({ file, line, name, signature, isAsync, lines }, targets, skipped) {
  const targetId = () => makeId(file, name, signature);
  const skip = (entry) => skipped.push({ targetId: targetId(), name, ...entry });

  if (name.startsWith("_")) {
    skip({ reason: "not-public", detail: "the scaffold treats an underscore-prefixed export as module-private" });
    return;
  }

  const parameters = parseParameters(signature);
  const rest = parameters.find((parameter) => parameter.rest);
  if (rest !== undefined) {
    skip({ reason: "unsupported-signature", detail: `rest parameter ...${rest.name} has no count the generator could draw` });
    return;
  }

  const doc = jsdocAbove(lines, line - 1);
  const declared = parseParams(doc);
  const missing = parameters.find((parameter) => !declared.has(parameter.name));
  if (missing !== undefined) {
    skip({ reason: "unsupported-signature", detail: `no JSDoc @param type for ${missing.name}` });
    return;
  }

  const lowered = parameters.map((parameter) => ({ parameter, type: lowerType(declared.get(parameter.name)) }));
  const blocked = lowered.find(({ type }) => type.kind === "opaque");
  if (blocked !== undefined) {
    skip({
      reason: "unconstructible-parameter",
      detail: `parameter ${blocked.parameter.name} has type ${blocked.type.ty}, which the scaffold cannot build`,
      materialization: "opaque",
      blockedBy: { type: blocked.type.ty, path: blocked.parameter.name },
    });
    return;
  }

  targets.push({
    id: targetId(),
    targetClass: "design-time",
    origin: { file, line },
    name,
    parameters: lowered.map(({ parameter, type }) => ({ name: parameter.name, type, required: parameter.required })),
    returns: returnsType(doc),
    effects: { async: isAsync },
    materialization: "constructible",
  });
}

// The JSDoc block ending on the line directly above the export, or the empty string.
// A block separated from its function by any other statement is not this function's doc.
function jsdocAbove(lines, exportIndex) {
  if (exportIndex === 0 || !lines[exportIndex - 1].trimEnd().endsWith("*/")) return "";
  let start = exportIndex - 1;
  while (start >= 0 && !lines[start].includes("/**")) start -= 1;
  if (start < 0) return "";
  return lines.slice(start, exportIndex).join("\n");
}

// `@param {Type} name`, `@param {Type} [name]`, with or without a description.
function parseParams(doc) {
  const types = new Map();
  for (const match of doc.matchAll(/@param\s+\{([^}]+)\}\s+(?:\[([\w$]+)\]|([\w$]+))/g)) {
    types.set(match[2] ?? match[3], match[1]);
  }
  return types;
}

function returnsType(doc) {
  const match = doc.match(/@returns?\s+\{([^}]+)\}/);
  return match === null ? null : lowerType(match[1]);
}

function parseParameters(signature) {
  if (signature.trim() === "") return [];
  return splitTopLevel(signature).map((part) => {
    const trimmed = part.trim();
    if (trimmed.startsWith("...")) return { name: trimmed.slice(3).trim(), required: false, rest: true };
    return { name: trimmed.split("=")[0].trim(), required: !trimmed.includes("="), rest: false };
  });
}

// Walk the tree and return paths relative to root, with forward slashes on every platform.
function walk(root) {
  const found = [];
  const visit = (dir, prefix) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!PRUNED.has(entry.name)) visit(join(dir, entry.name), `${prefix}${entry.name}/`);
        continue;
      }
      if (entry.isFile()) found.push(`${prefix}${entry.name}`);
    }
  };
  try {
    visit("", "");
  } catch {
    // A root that cannot be listed yields no targets and no skips. The engine knows the
    // scan project's root exists, and an empty answer beats a crashed plugin.
  }
  return found;
}

// The id is a content hash of module path, symbol, and signature, so the same symbol in
// the same file keeps the same id across processes and across runs.
function makeId(file, name, signature) {
  const digest = createHash("sha256").update(`${file}\u0000${name}\u0000${signature}`).digest("hex");
  return `afz:t:${digest.slice(0, 12)}`;
}

// The smallest glob matcher that covers the include/exclude patterns a scan project
// writes: `**/` crosses directories, `*` stays inside one name, `?` is one character.
function globToRegExp(pattern) {
  let source = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const character = pattern[i];
    if (character === "*") {
      if (pattern[i + 1] === "*") {
        i += 1;
        if (pattern[i + 1] === "/") {
          i += 1;
          source += "(?:[^/]+/)*";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}
