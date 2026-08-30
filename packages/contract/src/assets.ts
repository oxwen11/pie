import { Schema } from "effect";

import { SessionRefSchema } from "./domain";
import { oc, toStandardSchema } from "./orpc";

export const AssetCreateUrlInputSchema = Schema.Struct({
  ref: SessionRefSchema,
  destination: Schema.NonEmptyString,
});
export type AssetCreateUrlInput = typeof AssetCreateUrlInputSchema.Type;

export const AssetCreateUrlResultSchema = Schema.Struct({
  relativeUrl: Schema.String,
  expiresAt: Schema.Number,
});
export type AssetCreateUrlResult = typeof AssetCreateUrlResultSchema.Type;

const assetErrorData = toStandardSchema(Schema.Struct({ message: Schema.String }));

export const assetsContract = {
  createUrl: oc
    .input(AssetCreateUrlInputSchema)
    .errors({
      SESSION_NOT_FOUND: { data: assetErrorData },
      NOT_REFERENCED: { data: assetErrorData },
      NOT_FOUND: { data: assetErrorData },
      PATH_NOT_ALLOWED: { data: assetErrorData },
      NOT_IMAGE: { data: assetErrorData },
      FILE_TOO_LARGE: { data: assetErrorData },
      READ_FAILED: { data: assetErrorData },
    })
    .output(AssetCreateUrlResultSchema),
};
