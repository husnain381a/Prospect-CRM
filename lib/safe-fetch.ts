import { lookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import ipaddr from "ipaddr.js";
export function isPublicAddress(address: string) {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress())
      ip = (ip as ipaddr.IPv6).toIPv4Address();
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export async function safeFetch(raw: string, maxBytes = 1_000_000) {
  const url = new URL(raw);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !["", "80", "443"].includes(url.port)
  )
    throw Error("Unsafe website URL");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw Error("Private or reserved network blocked");
  // Pin the validated DNS answer in the connection agent: prevents DNS rebinding.
  const answer = addresses[0];
  const dispatcher = new Agent({
    connect: {
      lookup: ((_host: any, _options: any, callback: any) => {
        if (_options?.all) callback(null, [answer]);
        else callback(null, answer.address, answer.family);
      }) as any,
    },
  });
  try {
    const response = await undiciFetch(url, {
      dispatcher,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
      headers: {
        "User-Agent": "ProspectBusinessAudit/1.0 (permission-required)",
        Accept: "text/html",
      },
    });
    if (response.status >= 300 && response.status < 400)
      throw Error("Redirect requires a separate permitted fetch");
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html"))
      throw Error("Only HTML websites are supported");
    if (Number(response.headers.get("content-length")) > maxBytes)
      throw Error("Response too large");
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > maxBytes) {
          await reader.cancel();
          throw Error("Response too large");
        }
        chunks.push(value);
      }
    return {
      status: response.status,
      html: Buffer.concat(chunks).toString("utf8"),
      https: url.protocol === "https:",
    };
  } finally {
    await dispatcher.close();
  }
}
