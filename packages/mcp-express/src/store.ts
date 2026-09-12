import { optionalEnv } from "@itops/mcp-common";
import { DbfStore } from "./dbf-store.js";
import { FixtureStore } from "./fixture.js";
import { HttpStore } from "./http-store.js";
import type { ExpressBackendKind, ExpressStore } from "./types.js";

export function createExpressStore(): ExpressStore {
  const backend = (optionalEnv("EXPRESS_BACKEND", "fixture") || "fixture").toLowerCase() as ExpressBackendKind;
  if (backend === "http") {
    const baseUrl = optionalEnv("EXPRESS_API_URL");
    if (!baseUrl) {
      throw new Error("EXPRESS_API_URL is required when EXPRESS_BACKEND=http");
    }
    return new HttpStore(baseUrl, optionalEnv("EXPRESS_API_TOKEN") ?? "");
  }
  if (backend === "dbf") {
    const dataDir = optionalEnv("EXPRESS_DATA_DIR");
    if (!dataDir) {
      throw new Error("EXPRESS_DATA_DIR is required when EXPRESS_BACKEND=dbf");
    }
    return new DbfStore(
      dataDir,
      optionalEnv("EXPRESS_DBF_ENCODING", "windows-874"),
      optionalEnv("EXPRESS_COMPANY_NAME", "Express Accounting"),
    );
  }
  return new FixtureStore();
}
