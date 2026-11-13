// JSDoc type strings to TypeNode.
//
// The scaffold lowers only what the engine's generator can draw values from: the six
// scalars, arrays, sets, maps, and promises. Every other JSDoc type stays `opaque`, and
// discovery then reports the symbol as unbuildable instead of guessing a shape for it.
// That honesty is the whole point of the scaffold: a wrong guess would make the engine
// generate values for a type the target cannot accept.

const SCALARS = new Map([
  ["number", "number"],
  ["string", "string"],
  ["boolean", "boolean"],
  ["bigint", "bigInt"],
  ["null", "null"],
  ["undefined", "undefined"],
]);

export function lowerType(text) {
  const t = String(text).trim();

  const suffix = t.match(/^(.+)\[\]$/);
  if (suffix) return { kind: "collection", collection: "array", type: lowerType(suffix[1]) };

  const generic = t.match(/^(Array|Set|Map)<(.+)>$/);
  if (generic) {
    const [, head, inner] = generic;
    if (head === "Array") return { kind: "collection", collection: "array", type: lowerType(inner) };
    if (head === "Set") return { kind: "collection", collection: "set", type: lowerType(inner) };
    const parts = splitTopLevel(inner);
    if (parts.length !== 2) return opaque(t);
    return { kind: "collection", collection: "map", key: lowerType(parts[0]), type: lowerType(parts[1]) };
  }

  const promise = t.match(/^Promise<(.+)>$/);
  if (promise) return { kind: "promise", type: lowerType(promise[1]) };

  const scalar = SCALARS.get(t.toLowerCase());
  if (scalar !== undefined) return { kind: "scalar", scalar };

  return opaque(t);
}

function opaque(t) {
  return { kind: "opaque", ty: t };
}

// Split on the commas that sit outside every bracket, so `Map<string, Array<number>>`
// separates into its two type arguments and `f(a = {x: 1}, b)` into its two parameters.
export function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const character of text) {
    if ("<([{".includes(character)) depth += 1;
    if (">)]}".includes(character)) depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts.map((part) => part.trim());
}
