import { lstatSync, realpathSync } from "node:fs";
import { normalize, posix, relative, resolve, sep } from "node:path";
import type { HostMount } from "./types.js";
import { HostError } from "./types.js";

const BLOCKED_EXACT = new Set([
  "/",
  "/etc",
  "/proc",
  "/sys",
  "/dev",
  "/root",
  "/boot",
  "/run",
  "/var/run",
  "/var/lib/docker",
]);

const BLOCKED_PREFIXES = [
  "/etc/",
  "/proc/",
  "/sys/",
  "/dev/",
  "/root/",
  "/boot/",
  "/run/",
  "/var/run/",
  "/var/lib/docker/",
  "/var/lib/containerd/",
];

const SENSITIVE_BASE = new Set([
  "docker.sock",
  "shadow",
  "gshadow",
  "sudoers",
  "id_rsa",
  "id_ed25519",
  "id_dsa",
  "id_ecdsa",
]);

export function posixify(p: string): string {
  return p.replaceAll("\\", "/");
}

export function isBlockedMountRoot(abs: string): boolean {
  const p = posixify(normalize(abs)).replace(/\/+$/, "") || "/";
  if (BLOCKED_EXACT.has(p)) {
    return true;
  }
  return BLOCKED_PREFIXES.some((prefix) => p.startsWith(prefix) || `${p}/` === prefix);
}

export function isSensitiveRel(rel: string): boolean {
  const n = posixify(rel);
  const parts = n.split("/").filter(Boolean);
  if (parts.some((part) => part === ".ssh" || part === ".gnupg" || part === ".docker")) {
    return true;
  }
  const base = (parts[parts.length - 1] || "").toLowerCase();
  if (/^\.env(\.|$)/.test(base)) {
    return true;
  }
  if (SENSITIVE_BASE.has(base)) {
    return true;
  }
  if (/\.(pem|key|p12|pfx|p8)$/i.test(base)) {
    return true;
  }
  return false;
}

export function parseMounts(raw: string): Array<{ alias: string; root: string }> {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const cut = part.indexOf(":");
      if (cut <= 0) {
        throw new HostError(`HOST_MOUNTS entry must be alias:/abs/path (got '${part}')`);
      }
      const alias = part.slice(0, cut).trim();
      const root = part.slice(cut + 1).trim();
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(alias)) {
        throw new HostError(`Invalid mount alias '${alias}'`);
      }
      if (!root.startsWith("/") || root.includes("\0")) {
        throw new HostError(`Mount '${alias}' must be an absolute container path`);
      }
      return { alias, root };
    });
}

export function resolveMounts(specs: Array<{ alias: string; root: string }>): HostMount[] {
  const seen = new Set<string>();
  const out: HostMount[] = [];
  for (const spec of specs) {
    const alias = spec.alias.toLowerCase();
    if (seen.has(alias)) {
      throw new HostError(`Duplicate mount alias '${spec.alias}'`);
    }
    seen.add(alias);
    let root: string;
    try {
      root = realpathSync(spec.root);
    } catch {
      throw new HostError(`Mount '${spec.alias}' does not exist: ${spec.root}`);
    }
    if (isBlockedMountRoot(root)) {
      throw new HostError(`Mount '${spec.alias}' points at a blocked path`);
    }
    out.push({ alias: spec.alias, root });
  }
  return out;
}

export interface ResolvedHostPath {
  mount: HostMount;
  abs: string;
  rel: string;
  publicPath: string;
}

function splitPublicPath(input: string, mounts: HostMount[]): { alias: string; rel: string } {
  const trimmed = input.trim().replaceAll("\\", "/");
  if (!trimmed || trimmed === ".") {
    if (mounts.length === 1) {
      return { alias: mounts[0].alias, rel: "" };
    }
    throw new HostError("path is required when more than one mount is configured");
  }
  const colon = trimmed.indexOf(":");
  if (colon > 0 && !trimmed.startsWith("/")) {
    return { alias: trimmed.slice(0, colon), rel: trimmed.slice(colon + 1).replace(/^\/+/, "") };
  }
  const slash = trimmed.indexOf("/");
  const alias = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const rel = slash === -1 ? "" : trimmed.slice(slash + 1);
  if (mounts.some((m) => m.alias === alias)) {
    return { alias, rel };
  }
  if (mounts.length === 1) {
    return { alias: mounts[0].alias, rel: trimmed.replace(/^\/+/, "") };
  }
  throw new HostError(`Unknown mount alias in path '${input}'`);
}

function staysInside(root: string, abs: string): boolean {
  const rel = relative(root, abs);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith("../"));
}

export function resolvePublicPath(mounts: HostMount[], input: string): ResolvedHostPath {
  if (mounts.length === 0) {
    throw new HostError("No host mounts configured");
  }
  const { alias, rel } = splitPublicPath(input, mounts);
  const mount = mounts.find((m) => m.alias === alias);
  if (!mount) {
    throw new HostError(`Unknown mount '${alias}'`);
  }
  const relNorm = posix.normalize(rel || ".").replace(/^(\.\.(\/|$))+/, "");
  if (relNorm.startsWith("..")) {
    throw new HostError("Path escapes the mount");
  }
  const joined = relNorm === "." ? mount.root : resolve(mount.root, relNorm);
  let st;
  try {
    st = lstatSync(joined);
  } catch {
    throw new HostError(`Not found: ${alias}${relNorm === "." ? "" : `/${relNorm}`}`);
  }
  let abs: string;
  try {
    abs = realpathSync(joined);
  } catch {
    throw new HostError(`Cannot resolve ${alias}/${relNorm}`);
  }
  if (!staysInside(mount.root, abs)) {
    throw new HostError("Path escapes the mount (symlink or ..)");
  }
  if (isBlockedMountRoot(abs)) {
    throw new HostError("Refusing blocked path");
  }
  const publicRel = posixify(relative(mount.root, abs));
  if (isSensitiveRel(publicRel) || isSensitiveRel(relNorm)) {
    throw new HostError("Refusing sensitive path");
  }
  const relOut = publicRel === "" ? "" : publicRel;
  return {
    mount,
    abs,
    rel: relOut,
    publicPath: relOut ? `${mount.alias}/${relOut}` : mount.alias,
  };
}
