export function isoNow(): string {
  return new Date().toISOString();
}

export function log(
  level: "debug" | "info" | "warn" | "error",
  msg: string,
  extra: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({ ts: isoNow(), level, msg, ...extra });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function optionalEnv(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}
