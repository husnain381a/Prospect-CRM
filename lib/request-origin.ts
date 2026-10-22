function webOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function requestOriginAllowed(request: Request) {
  const origin = request.headers.get("origin");
  // Non-browser callers still go through the route's authentication checks.
  if (origin === null) return true;
  if (webOrigin(origin) !== origin) return false;

  const requestUrl = new URL(request.url);
  const allowed = new Set([requestUrl.origin, webOrigin(process.env.APP_URL)]);
  const host = request.headers.get("host");
  // Next may build request.url with its internal listen address (0.0.0.0).
  // Match the actual request Host, retaining its port, instead of allowing
  // arbitrary origins or treating every localhost port as the same origin.
  if (host && !/[\s,\/\\?#@]/.test(host)) {
    const forwardedProtocol = request.headers.get("x-forwarded-proto");
    const protocol =
      forwardedProtocol === "https" || forwardedProtocol === "http"
        ? forwardedProtocol + ":"
        : requestUrl.protocol;
    allowed.add(webOrigin(`${protocol}//${host}`));
  }
  return allowed.has(origin);
}
