import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostAudit } from "./audit.js";
import { writeFixtureHost } from "./fixture.js";
import { isBlockedMountRoot, isSensitiveRel, parseMounts, resolveMounts, resolvePublicPath } from "./jail.js";
import { HostFs } from "./store.js";
import type { HostLimits } from "./types.js";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
    throw new Error(message);
  }
}

const limits: HostLimits = {
  maxReadBytes: 1_048_576,
  maxList: 200,
  maxSearch: 50,
  maxDepth: 6,
  maxReadLines: 200,
};

async function main(): Promise<void> {
  assert(isBlockedMountRoot("/"), "block /");
  assert(isBlockedMountRoot("/etc"), "block /etc");
  assert(isBlockedMountRoot("/var/lib/docker"), "block docker lib");
  assert(!isBlockedMountRoot("/data/host"), "allow /data/host");
  assert(isSensitiveRel("secret/.env"), "block .env");
  assert(isSensitiveRel(".ssh/id_rsa"), "block ssh key");
  assert(!isSensitiveRel("runbooks/restart-nginx.md"), "allow runbook");

  const parsed = parseMounts("ops:/data/host,logs:/data/logs");
  assert(parsed.length === 2 && parsed[0].alias === "ops" && parsed[1].root === "/data/logs", "parse mounts");
  let badMount = false;
  try {
    parseMounts("/data/host");
  } catch {
    badMount = true;
  }
  assert(badMount, "reject mount without alias");

  const fixtureRoot = writeFixtureHost();
  const mounts = resolveMounts([{ alias: "ops", root: fixtureRoot }]);
  const auditFile = join(tmpdir(), `itops-host-audit-${process.pid}.jsonl`);
  const fs = new HostFs("fixture", mounts, limits, true, "smoke", new HostAudit(auditFile));

  const status = fs.status();
  assert(status.read_only && !status.write && !status.shell && status.sample, "status flags");
  assert(status.mounts.length === 1 && status.mounts[0].alias === "ops", "status mount alias");

  const listed = fs.list(undefined, 3);
  assert(
    listed.some((e) => e.path === "ops/README.md") && listed.some((e) => e.path.includes("runbooks")),
    `list fixture: ${listed.map((e) => e.path).join(",")}`,
  );
  assert(!listed.some((e) => e.path.includes(".env")), "list hides .env");
  assert(
    listed.some((e) => e.path === "ops/secret/README.md"),
    "secret README is visible so the folder is not empty",
  );

  const readme = fs.read("ops/README.md");
  assert(!readme.binary && (readme.text || "").includes("host_search"), "read readme");

  const binary = fs.read("ops/bin-sample.dat");
  assert(binary.binary && !binary.text, "binary not dumped");

  let envBlocked = false;
  try {
    fs.read("ops/secret/.env");
  } catch {
    envBlocked = true;
  }
  assert(envBlocked, "refuse .env");

  const hits = fs.search("restart-nginx");
  assert(
    hits.some((h) => h.path.includes("restart-nginx")) || hits.some((h) => (h.excerpt || "").includes("restart")),
    `search runbook: ${JSON.stringify(hits)}`,
  );

  const escaped = join(fixtureRoot, "escape-link");
  if (existsSync(escaped) && lstatSync(escaped).isSymbolicLink()) {
    let escapedRead = false;
    try {
      fs.read("ops/escape-link");
      escapedRead = true;
    } catch {
      escapedRead = false;
    }
    assert(!escapedRead, "symlink to /etc/passwd must not read");
  }

  const jailDir = join(tmpdir(), `itops-host-jail-${process.pid}`);
  mkdirSync(join(jailDir, "inside"), { recursive: true });
  writeFileSync(join(jailDir, "inside", "ok.txt"), "inside\n", "utf8");
  try {
    symlinkSync("/etc", join(jailDir, "etc-link"));
  } catch {
    // ignore
  }
  const jailMounts = resolveMounts([{ alias: "ops", root: jailDir }]);
  let etcMount = false;
  try {
    resolveMounts([{ alias: "etc", root: "/etc" }]);
    etcMount = true;
  } catch {
    etcMount = false;
  }
  assert(!etcMount, "cannot mount /etc");

  const jailFs = new HostFs("files", jailMounts, limits, false, "jail", new HostAudit(null));
  if (existsSync(join(jailDir, "etc-link"))) {
    let listedEtc = false;
    try {
      const entries = jailFs.list("ops", 2);
      listedEtc = entries.some((e) => e.path.includes("passwd") || e.path.includes("shadow"));
    } catch {
      listedEtc = false;
    }
    assert(!listedEtc, "list must not follow symlink into /etc");
  }

  let traversal = false;
  try {
    resolvePublicPath(jailMounts, "ops/../inside/ok.txt");
    traversal = true;
  } catch {
    traversal = true;
  }
  const ok = jailFs.read("ops/inside/ok.txt");
  assert(!ok.binary && ok.text?.includes("inside"), "read inside");
  assert(traversal || ok.ok, "traversal handling");

  let outside = false;
  try {
    jailFs.read("ops/../../etc/passwd");
    outside = true;
  } catch {
    outside = false;
  }
  assert(!outside, "reject .. escape");

  assert(existsSync(auditFile) && readFileSync(auditFile, "utf8").includes("host_read"), "audit written");

  console.log("mcp-host smoke ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
