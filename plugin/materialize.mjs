// ValueTree nodes to JavaScript values, and returned values back to ValueTree.
//
// The engine sends a `ValueTree` per parameter and the target is ordinary JavaScript, so
// materialization is a one-way decode with one honest refusal: an `opaque` node has no
// JavaScript value, and inventing one (an empty object, a proxy) would let the target
// crash on the plugin's own fabrication. The decode throws, and the outcome says
// `materialization-blocked`.
//
// The reverse direction describes what the target returned. A value the ValueTree
// vocabulary cannot carry (a symbol, a class instance, a promise that never settles) is
// reported as no value at all rather than as a lossy stand-in.

export class MaterializeError extends Error {}

export function materialize(node) {
  switch (node.node) {
    case "null":
      return null;
    case "undefined":
      return undefined;
    case "boolean":
    case "string":
    case "literal":
      return node.value;
    case "number":
      return numberValue(node.value);
    case "bigInt": {
      try {
        return BigInt(node.value);
      } catch {
        throw new MaterializeError(`${node.value} is not an integer literal`);
      }
    }
    case "array":
    case "tuple":
    case "stream":
      return node.items.map(materialize);
    case "set":
      return new Set(node.items.map(materialize));
    case "map":
      return new Map(node.entries.map(([key, value]) => [materialize(key), materialize(value)]));
    case "object": {
      const built = {};
      for (const [name, value] of node.fields) built[name] = materialize(value);
      return built;
    }
    case "buffer":
      return Uint8Array.from(node.bytes);
    case "function":
      return stub(node.behavior);
    case "opaque":
      throw new MaterializeError(`an opaque value of type ${node.ty} has no JavaScript value to build`);
    default:
      throw new MaterializeError(`unknown value node ${node.node}`);
  }
}

function numberValue(value) {
  if (value === "naN") return NaN;
  if (value === "infinity") return Infinity;
  if (value === "negativeInfinity") return -Infinity;
  return value;
}

// The generator says what a callable parameter must do when the target calls it; the
// scaffold implements all three behaviors because they are three lines each.
function stub(behavior) {
  if (behavior === "throw") {
    return () => {
      throw new Error("the stub callable's behavior is throw");
    };
  }
  if (behavior === "captureArguments") {
    return (...args) => args;
  }
  return (first) => first;
}

export function toValueTree(value) {
  if (value === null) return { node: "null" };
  if (value === undefined) return { node: "undefined" };
  const type = typeof value;
  if (type === "boolean" || type === "string") return { node: type, value };
  if (type === "number") {
    if (Number.isNaN(value)) return { node: "number", value: "naN" };
    if (value === Infinity) return { node: "number", value: "infinity" };
    if (value === -Infinity) return { node: "number", value: "negativeInfinity" };
    return { node: "number", value };
  }
  if (type === "bigint") return { node: "bigInt", value: value.toString() };
  if (type === "function" || type === "symbol") return null;
  if (Array.isArray(value)) return every(value.map(toValueTree), (items) => ({ node: "array", items }));
  if (value instanceof Map) {
    return every([...value].map(([key, item]) => pair(key, item)), (entries) => ({ node: "map", entries }));
  }
  if (value instanceof Set) return every([...value].map(toValueTree), (items) => ({ node: "set", items }));
  if (value instanceof Uint8Array) return { node: "buffer", bytes: [...value] };
  if (type === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;
    return every(
      Object.entries(value).map(([name, item]) => pair(name, item)),
      (fields) => ({ node: "object", fields }),
    );
  }
  return null;
}

function pair(key, value) {
  const described = toValueTree(value);
  return described === null ? null : [typeof key === "string" ? key : String(key), described];
}

// One undescribable member makes the whole container undescribable: a partial tree would
// tell the engine the call returned something it did not return.
function every(children, build) {
  return children.some((child) => child === null) ? null : build(children);
}
