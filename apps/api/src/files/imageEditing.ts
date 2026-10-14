import { config } from "../config.js";
import { createAssetFromBuffer, getAssetForUser } from "./service.js";
import { verifyGeneratedImage } from "./imageValidation.js";
import { getR2Object } from "./r2.js";

/** Original-image editing, shared by the authenticated API and the agent tool. */
export async function editStoredImage(userId: string, assetId: string, instruction: string, conversationId?: string) {
    const endpoint = process.env.MODAL_IMAGE_EDIT_URL;
    const token = config.ai.modalProxyToken;
    if (!endpoint || !token) throw new Error("Image editing is not configured.");
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid image editing endpoint.");
    const source = await getAssetForUser(userId, assetId);
    if (!source.mimeType.startsWith("image/") || source.status !== "ready") throw new Error("A ready image attachment is required.");
    const original = await getR2Object(source.r2Key);
    if (original.content.length > 12 * 1024 * 1024) throw new Error("Image exceeds editing size limit.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    let result: Buffer;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: "image-edit",
          prompt: instruction,
          image: { mime_type: source.mimeType, b64_json: original.content.toString("base64") },
          response_format: "b64_json",
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Image editing provider failed (${response.status}).`);
      const payload = await response.json() as { data?: Array<{ b64_json?: string }> };
      const encoded = payload.data?.[0]?.b64_json;
      if (!encoded || encoded.length > 24 * 1024 * 1024) throw new Error("Image editing provider returned no valid image.");
      result = Buffer.from(encoded, "base64");
    } finally { clearTimeout(timeout); }
    const verified = verifyGeneratedImage(result);
    const edited = await createAssetFromBuffer({
      userId: userId,
      filename: `edited-${assetId.slice(0, 8)}.${verified.mimeType === "image/png" ? "png" : verified.mimeType === "image/webp" ? "webp" : "jpg"}`,
      mimeType: verified.mimeType,
      content: result,
      source: "ai_image_edit",
      kind: "image",
      addToFiles: true,
    });
    return { assetId: edited.id, sourceAssetId: source.id, filename: edited.filename, mimeType: edited.mimeType, sizeBytes: Number(edited.sizeBytes), instruction: instruction, conversationId: conversationId ?? null };
}
