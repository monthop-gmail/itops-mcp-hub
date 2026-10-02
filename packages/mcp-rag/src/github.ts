export interface GithubFile {
  path: string;
  text: string;
}

export interface GithubSnapshot {
  repo: string;
  commit: string;
  files: GithubFile[];
  skipped: number;
}

const MAX_FILES = 40;
const MAX_FILE_BYTES = 128_000;
const MAX_TOTAL_BYTES = 2_000_000;
const TEXT_EXT = /\.(?:md|markdown|txt|ts|tsx|js|jsx|mjs|cjs|json|yaml|yml|toml|xml|html|css|scss|py|sh|sql|go|rs|java|kt|rb|php|c|h|cpp|hpp|cs|vue|svelte)$/i;
const SKIP_DIR = /^(?:\.git|\.github|node_modules|vendor|dist|build|target|coverage|\.next|\.nuxt|\.venv|venv|__pycache__|generated|gen|out)$/i;
const SKIP_NAME = /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|id_(?:rsa|ed25519|ecdsa).*|credentials(?:\..*)?|secrets?(?:\..*)?|.*\.(?:pem|key|p12|pfx|crt|cer|der|sqlite|db|lock|map|min\.js))$/i;
const SECRET_CONTENT = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|AKIA)[A-Za-z0-9_]{12,}|\b(?:password|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"'\s]{8,}["']/i;

export function safeGithubPath(path: string): boolean {
  const parts = path.split("/");
  return parts.length > 0 && parts.every((part) => part && part !== "." && part !== ".." && !part.startsWith("."))
    && !parts.some((part) => SKIP_DIR.test(part) || SKIP_NAME.test(part))
    && TEXT_EXT.test(path);
}

function assertRepo(repo: string): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.includes("..")) {
    throw new Error("GitHub repo must be owner/name");
  }
}

function assertRef(ref: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(ref) || ref.includes("..") || ref.includes("//")) {
    throw new Error("Invalid GitHub ref");
  }
}

async function githubJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "itops-mcp-rag-poc" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} (${url.split("/").slice(3, 6).join("/")})`);
  }
  return response.json();
}

/** Public-repository, bounded POC. Fetch only allowlisted text from a resolved commit. */
export async function fetchGithubSnapshot(repo: string, ref: string, fetcher: typeof fetch = fetch): Promise<GithubSnapshot> {
  assertRepo(repo);
  assertRef(ref);
  const base = `https://api.github.com/repos/${repo}`;
  const commitResponse = await githubJson(`${base}/commits/${encodeURIComponent(ref)}`, fetcher) as { sha?: string };
  const commit = commitResponse.sha ?? "";
  if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error("GitHub did not return a commit SHA");
  const tree = await githubJson(`${base}/git/trees/${commit}?recursive=1`, fetcher) as {
    truncated?: boolean;
    tree?: Array<{ path?: string; type?: string; mode?: string; sha?: string; size?: number }>;
  };
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error("GitHub tree truncated or missing");
  const candidates = tree.tree.filter((item) => item.type === "blob" && (item.mode === "100644" || item.mode === "100755") && item.path && safeGithubPath(item.path) &&
    Number.isFinite(item.size) && item.size! > 0 && item.size! <= MAX_FILE_BYTES && /^[a-f0-9]{40}$/i.test(item.sha ?? ""));
  if (candidates.length > MAX_FILES) throw new Error(`Too many eligible files (${candidates.length}); POC limit ${MAX_FILES}`);
  if (candidates.reduce((sum, item) => sum + (item.size ?? 0), 0) > MAX_TOTAL_BYTES) throw new Error("GitHub text exceeds POC byte limit");
  const files: GithubFile[] = [];
  for (const item of candidates) {
    const blob = await githubJson(`${base}/git/blobs/${item.sha}`, fetcher) as { encoding?: string; content?: string; size?: number };
    if (blob.encoding !== "base64" || !blob.content || blob.size !== item.size) throw new Error(`Invalid GitHub blob: ${item.path}`);
    const bytes = Buffer.from(blob.content.replace(/\s/g, ""), "base64");
    if (bytes.length !== item.size || bytes.includes(0)) throw new Error(`Binary or invalid blob: ${item.path}`);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!SECRET_CONTENT.test(text)) files.push({ path: item.path!, text });
  }
  return { repo, commit, files, skipped: tree.tree.length - files.length };
}
