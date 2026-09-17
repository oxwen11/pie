const fs = require("node:fs");
const path = require("node:path");

/**
 * Sibling island next to unpacked pie-pi-process. electron-builder FileSet
 * (files / extraResources) treats nested node_modules as the app's production
 * deps, so listing dist/fff there copies nothing — copy it in afterPack.
 */
const FFF_ENTRY = ["node_modules", "@ff-labs", "pi-fff", "src", "index.ts"];
const UNPACKED_SERVER_DIST = ["app.asar.unpacked", "node_modules", "@getpie", "server", "dist"];

function builtFffIsland() {
  return path.join(__dirname, "..", "..", "..", "packages", "server", "dist", "fff");
}

function fffEntry(root) {
  return path.join(root, ...FFF_ENTRY);
}

function assertFffIsland(root, label) {
  const entry = fffEntry(root);
  if (!fs.existsSync(entry)) {
    throw new Error(`${label} missing bundled fff island: ${entry}`);
  }
}

function packResourcesDir(context) {
  if (context.electronPlatformName === "darwin") {
    return path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      "Contents",
      "Resources",
    );
  }
  return path.join(context.appOutDir, "resources");
}

function packedFffIsland(context) {
  return path.join(packResourcesDir(context), ...UNPACKED_SERVER_DIST, "fff");
}

function assertBuiltFffIsland() {
  assertFffIsland(builtFffIsland(), "packages/server/dist/fff");
}

function copyFffIslandIntoApp(context, source = builtFffIsland()) {
  assertFffIsland(source, "packages/server/dist/fff");
  const dest = packedFffIsland(context);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(source, dest, { recursive: true });
  assertFffIsland(dest, "packed @getpie/server/dist/fff");
}

module.exports = { assertBuiltFffIsland, copyFffIslandIntoApp };
