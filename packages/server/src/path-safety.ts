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
  BINARY_MAGIC_PREFIXES.some(
    (prefix) =>
      bytes.byteLength >= prefix.length && prefix.every((byte, index) => bytes[index] === byte),
  );
