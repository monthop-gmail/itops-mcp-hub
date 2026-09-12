const TRUSTED_REDIRECT_SUFFIXES = [
  "chatgpt.com",
  "openai.com",
  "grok.com",
  "x.ai",
  "google.com",
  "googleusercontent.com",
  "claude.ai",
  "anthropic.com",
  "cursor.com",
  "cursor.sh",
];

export function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
}

function hostAllowed(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return TRUSTED_REDIRECT_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function isTrustedRedirectUri(requested: string): boolean {
  let url: URL;
  try {
    url = new URL(requested);
  } catch {
    return false;
  }
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) {
    return true;
  }
  if (url.protocol !== "https:") {
    return false;
  }
  return hostAllowed(url.hostname);
}
