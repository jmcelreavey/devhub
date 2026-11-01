import type { PluginPreview } from "../../../../../packages/shared/ui-lib/plugins/model";
import { PluginApiError, type PluginContext } from "./context";
import { cancelOperation, confirmOperation, getOperation, prepareLocal } from "./operations";

export async function reviewLocalRuntime(
  ctx: PluginContext,
  localPath: string,
  fingerprint?: string,
  onReview?: (preview: PluginPreview) => void,
): Promise<{ preview: PluginPreview; message: string | null }> {
  const review = await prepareLocal(ctx, localPath, { reviewRuntimeReplacement: true });
  try {
    const preview = review.preview;
    if (!preview) throw new PluginApiError(422, "INVALID_RUNTIME", review.message || "Couldn’t review this runtime. Nothing was enabled.");
    if (!preview.runtime) throw new PluginApiError(422, "INVALID_RUNTIME", "This folder needs a valid prebuilt runtime manifest. Ask the publisher for a bundle and matching dependency lockfile; DevHub won’t compile source code. Nothing was enabled.");
    if (!preview.canApply || review.state !== "ready") throw new PluginApiError(422, "INVALID_RUNTIME", preview.heading || review.message || preview.blockers[0]?.message || "This runtime cannot be enabled.");
    onReview?.(preview);
    if (!fingerprint) return { preview, message: null };
    if (fingerprint !== preview.planDigest) throw new PluginApiError(409, "PREVIEW_STALE", "Runtime inputs or registry settings changed. Review them again.");
    const result = await confirmOperation(ctx, review.id, {
      accepted: true, revision: preview.revision, planDigest: fingerprint, selectedTargets: [],
    });
    if (result.state !== "succeeded") throw new PluginApiError(422, "INSTALL_FAILED", result.error?.message || result.message || "Runtime installation failed.");
    return { preview, message: result.message };
  } finally {
    if (getOperation(ctx, review.id).cancellable) await cancelOperation(ctx, review.id);
  }
}
