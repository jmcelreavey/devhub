import { z } from "zod";

export const runtimeRelativePathSchema = z.string().max(240).regex(/^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/)
  .refine(value => value.split("/").every(part => part !== "." && part !== ".." && part !== ""), "Use a confined relative path");
export const runtimeDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const runtimeAssetSchema = z.object({ path: runtimeRelativePathSchema, sha256: runtimeDigestSchema }).strict();
