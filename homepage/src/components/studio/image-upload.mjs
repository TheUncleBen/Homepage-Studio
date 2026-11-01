// Prepares an uploaded image in the browser before it is sent: pictures are
// shrunk to a sensible size and saved as WebP, so no server-side image
// library is needed. SVG is sent as it is; the server checks it.
export const UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
export const LONGEST_SIDE = { background: 2560, logo: 512 };

const readAsDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(blob);
  });

export async function prepareImage(file, kind) {
  if (!file || !UPLOAD_TYPES.includes(file.type)) throw new Error("Use a PNG, JPEG, WebP or SVG image.");
  if (file.type === "image/svg+xml") return { image: await readAsDataUrl(file), before: file.size, after: file.size };
  const bitmap = await createImageBitmap(file);
  const longest = LONGEST_SIDE[kind] || LONGEST_SIDE.background;
  const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.84));
  // Keep the original when re-encoding would not make it smaller.
  const chosen = blob && (blob.size < file.size || scale < 1) ? blob : file;
  return { image: await readAsDataUrl(chosen), before: file.size, after: chosen.size };
}

export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
