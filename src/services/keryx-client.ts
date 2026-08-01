import { keryxPayloadSchema, type KeryxPayload } from "../domain/keryx.js";

export type KeryxFetchResult =
  | { changed: false; etag: string | null }
  | { changed: true; etag: string | null; payload: KeryxPayload };

const MAX_PAYLOAD_BYTES = 50 * 1024 * 1024;

export class KeryxClient {
  public constructor(private readonly url: string) {}

  async fetch(etag?: string | null): Promise<KeryxFetchResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    timeout.unref();
    try {
      const response = await fetch(this.url, {
        headers: {
          accept: "application/json",
          "user-agent": "Stentor/0.1 (+https://github.com/GodlyDonuts/stentor)",
          ...(etag ? { "if-none-match": etag } : {}),
        },
        redirect: "error",
        signal: controller.signal,
      });
      const responseEtag = response.headers.get("etag");
      if (response.status === 304) return { changed: false, etag: responseEtag ?? etag ?? null };
      if (!response.ok) throw new Error(`Keryx returned HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (declaredLength > MAX_PAYLOAD_BYTES) throw new Error("Keryx payload exceeded 50 MiB");
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_PAYLOAD_BYTES) throw new Error("Keryx payload exceeded 50 MiB");
      let json: unknown;
      try {
        json = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new Error("Keryx returned malformed JSON");
      }
      const parsed = keryxPayloadSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error(
          `Keryx schema mismatch: ${parsed.error.issues[0]?.message ?? "unknown error"}`,
        );
      }
      return { changed: true, etag: responseEtag, payload: parsed.data };
    } finally {
      clearTimeout(timeout);
    }
  }
}
