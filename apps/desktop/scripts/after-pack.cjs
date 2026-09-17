const adHocSign = require("./ad-hoc-sign.cjs");
const { copyFffIslandIntoApp } = require("./fff-island.cjs");

exports.default = async function afterPack(context) {
  copyFffIslandIntoApp(context);
  await adHocSign.default(context);
};
