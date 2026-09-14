import { optionalEnv } from "@itops/mcp-common";
import { FixtureStore } from "./fixture.js";
import { MdbStore } from "./mdb-store.js";
import { MysqlStore } from "./mysql-store.js";
import type { AllinoneBackendKind, AllinoneStore } from "./types.js";

export function createAllinoneStore(): AllinoneStore {
  const backend = (optionalEnv("ALLINONE_BACKEND", "fixture") || "fixture").toLowerCase() as AllinoneBackendKind;
  const company = optionalEnv("ALLINONE_COMPANY_NAME");
  if (backend === "mdb") {
    return new MdbStore(
      optionalEnv("ALLINONE_DATA_DIR", "/data/allinone"),
      optionalEnv("ALLINONE_MDB_FILE"),
      company,
    );
  }
  if (backend === "mysql") {
    return new MysqlStore({
      host: optionalEnv("ALLINONE_MYSQL_HOST", "127.0.0.1"),
      port: Number(optionalEnv("ALLINONE_MYSQL_PORT", "3306")) || 3306,
      user: optionalEnv("ALLINONE_MYSQL_USER", "allinone"),
      password: optionalEnv("ALLINONE_MYSQL_PASSWORD"),
      database: optionalEnv("ALLINONE_MYSQL_DATABASE", "allinone"),
      companyName: company,
    });
  }
  return new FixtureStore();
}
