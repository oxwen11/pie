import path from "node:path";

const BINARY_MAGIC_PREFIXES: ReadonlyArray<ReadonlyArray<number>> = [
  [0x25, 0x50, 0x44, 0x46, 0x2d], // PDF
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
  [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
  [0x50, 0x4b, 0x03, 0x04], // ZIP
  [0x50, 0x4b, 0x05, 0x06], // Empty ZIP
  [0x1f, 0x8b], // Gzip
  [0x7f, 0x45, 0x4c, 0x46], // ELF
];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const GIF87A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] as const;
const GIF89A_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] as const;
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50] as const;
const BMP_SIGNATURE = [0x42, 0x4d] as const;

const startsWith = (bytes: Uint8Array, prefix: ReadonlyArray<number>, offset = 0): boolean =>
  bytes.byteLength >= offset + prefix.length &&
  prefix.every((byte, index) => bytes[offset + index] === byte);

/** Is `child` at or beneath `parent`? */
export const contains = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
};

export const toPosixPath = (value: string): string => value.split(path.sep).join("/");

export const hasBinaryMagicPrefix = (bytes: Uint8Array): boolean =>
  BINARY_MAGIC_PREFIXES.some((prefix) => startsWith(bytes, prefix));

/** Sniff a previewable image type. Checked before treating the file as opaque binary. */
export const detectImageMimeType = (bytes: Uint8Array): string | undefined => {
  if (startsWith(bytes, PNG_SIGNATURE)) return "image/png";
  if (startsWith(bytes, JPEG_SIGNATURE)) return "image/jpeg";
  if (startsWith(bytes, GIF87A_SIGNATURE) || startsWith(bytes, GIF89A_SIGNATURE)) {
    return "image/gif";
  }
  if (startsWith(bytes, RIFF_SIGNATURE) && startsWith(bytes, WEBP_SIGNATURE, 8)) {
    return "image/webp";
  }
  if (startsWith(bytes, BMP_SIGNATURE)) return "image/bmp";
  return undefined;
};
