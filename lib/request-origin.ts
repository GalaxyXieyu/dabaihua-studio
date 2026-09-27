function isLocalHost(host: string) {
  // localhost, loopback IPv4/IPv6, wildcard bind, or any host carrying an explicit port.
  return /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(host) || /:\d+$/.test(host);
}

export function requestOrigin(headers: { get(name: string): string | null }): string {
  const host = headers.get("x-forwarded-host") || headers.get("host") || "localhost:3000";
  const forwardedProto = headers.get("x-forwarded-proto");
  const protocol = forwardedProto ? forwardedProto.split(",")[0].trim() : isLocalHost(host) ? "http" : "https";
  return `${protocol}://${host}`;
}
