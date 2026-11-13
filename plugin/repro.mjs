// Reproducer rendering: a standalone .mjs script that replays one call.
//
// The script is the artifact a human runs when the engine files a finding, so it must
// carry the information they look for first: which file held the fault, which symbol ran,
// and with what arguments. Values become JavaScript literals here, which is the same
// decode `materialize.mjs` performs but written out as source text.
//
// An `opaque` node cannot appear: those calls never reach an invoke that could produce a
// finding, and the scaffold says so rather than rendering a script that cannot run.

import { pathToFileURL } from "node:url";

export function renderReproducer({ target, values }) {
  const args = values.map(literal).join(", ");
  const spec = pathToFileURL(target.file).href;
  return [
    `// Reproducer rendered by the starter harness.`,
    `// Target: ${target.name} in ${target.origin.file}`,
    `// Replay: node this-file.mjs`,
    `import { ${target.name} } from ${JSON.stringify(spec)};`,
    `${target.name}(${args});`,
    "",
  ].join("\n");
}

function literal(node) {
  switch (node.node) {
    case "null":
      return "null";
    case "undefined":
      return "undefined";
    case "boolean":
    case "string":
    case "literal":
      return JSON.stringify(node.value);
    case "number":
      if (node.value === "naN") return "Number.NaN";
      if (node.value === "infinity") return "Infinity";
      if (node.value === "negativeInfinity") return "-Infinity";
      return Object.is(node.value, -0) ? "-0" : String(node.value);
    case "bigInt":
      return `${BigInt(node.value).toString()}n`;
    case "array":
    case "tuple":
    case "stream":
      return `[${node.items.map(literal).join(", ")}]`;
    case "set":
      return `new Set([${node.items.map(literal).join(", ")}])`;
    case "map":
      return `new Map([${node.entries.map(([key, value]) => `[${literal(key)}, ${literal(value)}]`).join(", ")}])`;
    case "object":
      return `{ ${node.fields.map(([name, value]) => `${JSON.stringify(name)}: ${literal(value)}`).join(", ")} }`;
    case "buffer":
      return `Uint8Array.from(${JSON.stringify(node.bytes)})`;
    case "function":
      return stubSource(node.behavior);
    case "opaque":
      throw new Error(`an opaque value of type ${node.ty} has no literal to render`);
    default:
      throw new Error(`unknown value node ${node.node}`);
  }
}

function stubSource(behavior) {
  if (behavior === "throw") return "() => { throw new Error('the stub callable's behavior is throw'); }";
  if (behavior === "captureArguments") return "(...args) => args";
  return "(first) => first";
}
