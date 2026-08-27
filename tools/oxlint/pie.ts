import { definePlugin } from "@oxlint/plugins";

import { noVoidExpression } from "./no-void-expression";
import { nodeImportStyleRule } from "./node-import-style";

export default definePlugin({
  meta: { name: "pie" },
  rules: {
    "node-import-style": nodeImportStyleRule,
    "no-void-expression": noVoidExpression,
  },
});
