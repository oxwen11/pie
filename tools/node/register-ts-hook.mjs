import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import url from "node:url";

// Source imports omit extensions because tsconfig uses moduleResolution
// "Bundler". Node's loader does not read tsconfig, so launching the source
// daemon needs this hook to supply the on-disk extension.
const extensions = [".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", ".json"];

const isRelativeOrAbsolute = (specifier) => {
  if (specifier.startsWith("./")) return true;
  if (specifier.startsWith("../")) return true;
  return path.isAbsolute(specifier);
};

const hasKnownExtension = (specifier) => extensions.some((ext) => specifier.endsWith(ext));

const isNotFound = (error) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error.code === "ERR_MODULE_NOT_FOUND" || error.code === "ERR_UNSUPPORTED_DIR_IMPORT");

const tryResolve = (specifier, context, nextResolve) => {
  try {
    return nextResolve(specifier, context);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return undefined;
  }
};

module.registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = tryResolve(specifier, context, nextResolve);
    if (resolved !== undefined) return resolved;
    if (!isRelativeOrAbsolute(specifier) || hasKnownExtension(specifier)) {
      return nextResolve(specifier, context);
    }

    const parentPath =
      typeof context.parentURL === "string" && context.parentURL.startsWith("file:")
        ? path.dirname(url.fileURLToPath(context.parentURL))
        : undefined;
    const candidates = extensions.flatMap((ext) => [specifier + ext, `${specifier}/index${ext}`]);
    for (const candidate of candidates) {
      if (parentPath !== undefined) {
        const file = path.resolve(parentPath, candidate);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      }
      const hit = tryResolve(candidate, context, nextResolve);
      if (hit !== undefined) return hit;
    }
    return nextResolve(specifier, context);
  },
});
