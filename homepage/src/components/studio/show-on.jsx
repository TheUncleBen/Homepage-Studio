import { LAYOUT_SIZES } from "./look.mjs";
import { MultiSegmented } from "./ui";

const NAMES = { desktop: "Desktop", tablet: "Tablet", phone: "Phone" };

// Show on (D2, 6 Nov 2026): which layouts show a widget. value is the stored
// "desktop+tablet+phone" form, or anything else for "mixed".
export default function ShowOn({ value, onChange, id }) {
  const list = typeof value === "string" ? value.split("+").filter((size) => LAYOUT_SIZES.includes(size)) : [];
  return (
    <MultiSegmented
      id={id}
      label="Show on"
      required
      value={list}
      options={LAYOUT_SIZES.map((size) => [size, NAMES[size]])}
      onChange={(next) => onChange(LAYOUT_SIZES.filter((size) => next.includes(size)).join("+"))}
    />
  );
}
