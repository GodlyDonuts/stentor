import { isIP } from "node:net";

const blockedHosts = new Set(["bit.ly", "tinyurl.com", "t.co", "goo.gl", "rb.gy", "localhost"]);

export type UrlValidation = { ok: true; url: string; host: string } | { ok: false; reason: string };

export function validatePublicHttpsUrl(value: string): UrlValidation {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: "The application URL is not valid." };
  }
  const host = parsed.hostname.toLocaleLowerCase("en-US").replace(/\.$/, "");
  if (parsed.protocol !== "https:")
    return { ok: false, reason: "The application URL must use HTTPS." };
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "URLs containing credentials are not accepted." };
  }
  if (parsed.port && parsed.port !== "443") {
    return { ok: false, reason: "The application URL cannot use a nonstandard port." };
  }
  if (isIP(host) !== 0 || host.endsWith(".local") || blockedHosts.has(host)) {
    return { ok: false, reason: "Use the employer's direct public application URL." };
  }
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_)/i.test(key)) parsed.searchParams.delete(key);
  }
  return { ok: true, url: parsed.toString(), host };
}
