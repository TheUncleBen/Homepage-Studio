// Number styles for values inside a Studio card.

const NUMBER = /^([-+]?\d[\d,.\s  ]*)(.*)$/;

// Splits "21.4%" into "21.4" and "%" so the number can be large and the unit small.
export function splitValue(text) {
  const match = NUMBER.exec(String(text).trim());
  if (!match) return { number: String(text), unit: "" };
  return { number: match[1].trim(), unit: match[2].trim() };
}

// Short: at most one decimal and k/M from ten thousand. Compact: whole
// numbers and k/M from a thousand. Text that isn't a plain number is left alone.
export function formatValue(text, style = "full") {
  if (style === "full" || text === undefined || text === null) return text;
  const { number, unit } = splitValue(text);
  const plain = number.replace(/[\s  ,]/g, "");
  if (!/^[-+]?\d+(\.\d+)?$/.test(plain)) return text;
  const value = Number(plain);
  const floor = style === "compact" ? 1000 : 10000;
  const digits = style === "compact" ? 0 : 1;
  const scaled = (amount, suffix) => `${Number((value / amount).toFixed(digits))}${suffix}`;
  let out;
  if (Math.abs(value) >= 1e9 && Math.abs(value) >= floor) out = scaled(1e9, "B");
  else if (Math.abs(value) >= 1e6 && Math.abs(value) >= floor) out = scaled(1e6, "M");
  else if (Math.abs(value) >= floor) out = scaled(1e3, "k");
  else {
    // Below the threshold only extra decimals go; grouping stays as given.
    const decimals = plain.split(".")[1]?.length ?? 0;
    if (decimals <= digits) return text;
    out = `${Number(value.toFixed(digits))}`;
  }
  return unit ? `${out}${/^[%°]/.test(unit) ? "" : " "}${unit}` : out;
}
