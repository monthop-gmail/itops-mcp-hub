import { optionalEnv } from "@itops/mcp-common";
import { FixtureStore } from "./fixture.js";
import { MdbStore } from "./mdb-store.js";
import { MssqlStore } from "./mssql-store.js";
import type { ZktimeBackendKind, ZktimeStore } from "./types.js";

export function createZktimeStore(): ZktimeStore {
  const backend = (optionalEnv("ZKTIME_BACKEND", "fixture") || "fixture").toLowerCase() as ZktimeBackendKind;
  const site = optionalEnv("ZKTIME_SITE_NAME");
  if (backend === "mdb") {
    return new MdbStore(
      optionalEnv("ZKTIME_DATA_DIR", "/data/zktime"),
      optionalEnv("ZKTIME_MDB_FILE"),
      site,
    );
  }
  if (backend === "mssql") {
    return new MssqlStore({
      host: optionalEnv("ZKTIME_MSSQL_HOST", "127.0.0.1"),
      port: Number(optionalEnv("ZKTIME_MSSQL_PORT", "1433")) || 1433,
      user: optionalEnv("ZKTIME_MSSQL_USER", "sa"),
      password: optionalEnv("ZKTIME_MSSQL_PASSWORD"),
      database: optionalEnv("ZKTIME_MSSQL_DATABASE", "att2000"),
      encrypt: optionalEnv("ZKTIME_MSSQL_ENCRYPT", "false").toLowerCase() === "true",
      siteName: site,
    });
  }
  return new FixtureStore();
}
