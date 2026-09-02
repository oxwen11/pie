import type { CnFunction } from "cn";
import { createCn } from "cn/engine";

import tables from "./cn-tables.js";

export const cn: CnFunction = createCn(tables);
