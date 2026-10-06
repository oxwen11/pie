import adHocSign from "./ad-hoc-sign.js";
import { copyFffIslandIntoApp } from "./fff-island.js";

export default async function afterPack(context) {
  copyFffIslandIntoApp(context);
  await adHocSign(context);
}
