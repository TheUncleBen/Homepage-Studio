// Shared by the controlled renderer and the deployment's robots policy reader.
// Keep replacement order and file reads identical to Homepage's native config
// loader; callers supply their own environment snapshot and file reader.
export function resolveEnvironmentVariables(text, variables, readFile, { maxBytes } = {}) {
  let result = text;
  const bounded = maxBytes !== undefined;
  if (bounded && (!Number.isSafeInteger(maxBytes) || maxBytes < 0))
    throw new RangeError("maxBytes must be a non-negative safe integer");
  let size = bounded ? Buffer.byteLength(result, "utf8") : 0;
  const checkSize = (bytes) => {
    if (bounded && bytes > maxBytes) throw new RangeError("Expanded native configuration exceeds its size limit");
  };
  checkSize(size);
  const replace = (key, value) => {
    const token = `{{${key}}}`;
    if (bounded) {
      let count = 0;
      for (let at = result.indexOf(token); at !== -1; at = result.indexOf(token, at + token.length)) count += 1;
      if (!count) return;
      const prospective = size + count * (Buffer.byteLength(String(value), "utf8") - Buffer.byteLength(token, "utf8"));
      checkSize(prospective);
      size = prospective;
    }
    result = result.replaceAll(token, () => value);
  };
  if (result.includes("{{")) {
    for (const [key, value] of variables) {
      if (key.startsWith("HOMEPAGE_VAR_")) {
        replace(key, value);
      } else if (key.startsWith("HOMEPAGE_FILE_")) {
        const contents = readFile(value, "utf8");
        replace(key, contents);
      }
    }
  }
  return result;
}
