import path from "node:path";

type Magic = {
  readonly bytes: ReadonlyArray<number>;
  readonly image?: string;
  readonly offset?: number;
};

const MAGICS: ReadonlyArray<Magic> = [
  { bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // PDF
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], image: "image/png" },
  { bytes: [0xff, 0xd8, 0xff], image: "image/jpeg" },
  { bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], image: "image/gif" },
  { bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], image: "image/gif" },
  { bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF container; WebP checked below
  { bytes: [0x50, 0x4b, 0x03, 0x04] }, // ZIP
  { bytes: [0x50, 0x4b, 0x05, 0x06] }, // Empty ZIP
  { bytes: [0x1f, 0x8b] }, // Gzip
  { bytes: [0x7f, 0x45, 0x4c, 0x46] }, // ELF
  { bytes: [0x42, 0x4d], image: "image/bmp" },
];

const startsWith = (bytes: Uint8Array, prefix: ReadonlyArray<number>, offset = 0): boolean =>
  bytes.byteLength >= offset + prefix.length &&
  prefix.every((byte, index) => bytes[offset + index] === byte);

const matches = (bytes: Uint8Array, magic: Magic): boolean =>
  startsWith(bytes, magic.bytes, magic.offset ?? 0);

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
  MAGICS.some((magic) => matches(bytes, magic));

export const detectImageMimeType = (bytes: Uint8Array): string | undefined => {
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return MAGICS.find((magic) => magic.image !== undefined && matches(bytes, magic))?.image;
};
