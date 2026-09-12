import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, jsonResult } from "@itops/mcp-common";
import { z } from "zod";
import { SEVERITY_NAMES, ZabbixClient, ZabbixClientError, severitiesFromMin } from "./zabbix-client.js";

const severityMinSchema = z
  .number()
  .int()
  .min(0)
  .max(5)
  .optional()
  .describe("Minimum problem severity. 0 Not classified … 5 Disaster. Defaults to 0 (all).");

interface ZabbixHost {
  hostid: string;
  host: string;
  name: string;
  status: string;
  groups?: Array<{ groupid: string; name: string }>;
  interfaces?: Array<{
    interfaceid: string;
    ip: string;
    dns?: string;
    type: string;
    available?: string;
    error?: string;
    main?: string;
  }>;
}

interface ZabbixProblem {
  eventid: string;
  objectid: string;
  name: string;
  severity: string;
  clock: string;
  acknowledged: string;
  hosts?: Array<{ hostid: string; host: string; name: string }>;
  tags?: Array<{ tag: string; value: string }>;
}

interface ZabbixItem {
  itemid: string;
  name: string;
  key_: string;
  lastvalue?: string;
  lastclock?: string;
  units?: string;
  state?: string;
  error?: string;
  status?: string;
}

function availabilityLabel(code: string | undefined): string {
  switch (code) {
    case "1":
      return "available";
    case "2":
      return "unavailable";
    case "0":
    default:
      return "unknown";
  }
}

function clockToIso(clock: string | undefined): string | null {
  if (!clock) {
    return null;
  }
  const seconds = Number(clock);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
}

export function registerZabbixTools(server: McpServer, client: ZabbixClient): void {
  server.tool(
    "zabbix_get_active_problems",
    "Read currently active Zabbix problems (triggers that have not recovered), optionally filtered by minimum severity. Returns host, severity, acknowledgement, and tags.",
    { severity_min: severityMinSchema },
    async ({ severity_min }) => {
      try {
        const severities = severitiesFromMin(severity_min ?? 0);
        const problems = await client.call<ZabbixProblem[]>("problem.get", {
          output: ["eventid", "objectid", "name", "severity", "clock", "acknowledged", "suppressed"],
          selectHosts: ["hostid", "host", "name"],
          selectTags: "extend",
          recent: false,
          sortfield: ["eventid"],
          sortorder: "DESC",
          severities,
        });

        const items = (problems ?? []).map((problem) => {
          const severity = Number(problem.severity);
          return {
            eventid: problem.eventid,
            name: problem.name,
            severity,
            severity_name: SEVERITY_NAMES[severity] ?? "unknown",
            acknowledged: problem.acknowledged === "1",
            started_at: clockToIso(problem.clock),
            hosts: (problem.hosts ?? []).map((host) => ({
              hostid: host.hostid,
              host: host.host,
              name: host.name,
            })),
            tags: (problem.tags ?? []).map((tag) => ({ tag: tag.tag, value: tag.value })),
          };
        });

        return jsonResult({
          ok: true,
          count: items.length,
          severity_min: severity_min ?? 0,
          problems: items,
        });
      } catch (error) {
        return mapZabbixError("zabbix_get_active_problems", error);
      }
    },
  );

  server.tool(
    "zabbix_get_device_status",
    "Read monitored Zabbix hosts and interface availability. Optionally restrict to a host group name (exact or case-insensitive match).",
    {
      group_name: z
        .string()
        .min(1)
        .optional()
        .describe("Optional Zabbix host group name, e.g. 'ESXi', 'Switches', 'CCTV', 'Windows servers'."),
    },
    async ({ group_name }) => {
      try {
        let groupids: string[] | undefined;
        if (group_name) {
          const groups = await client.call<Array<{ groupid: string; name: string }>>("hostgroup.get", {
            output: ["groupid", "name"],
            search: { name: group_name },
            searchWildcardsEnabled: true,
          });
          const needle = group_name.toLowerCase();
          const matched = (groups ?? []).filter(
            (group) =>
              group.name.toLowerCase() === needle || group.name.toLowerCase().includes(needle),
          );
          if (matched.length === 0) {
            return errorResult(`No Zabbix host group matched '${group_name}'`);
          }
          groupids = matched.map((group) => group.groupid);
        }

        const hosts = await client.call<ZabbixHost[]>("host.get", {
          output: ["hostid", "host", "name", "status"],
          selectGroups: ["groupid", "name"],
          selectInterfaces: ["interfaceid", "ip", "dns", "type", "available", "error", "main"],
          groupids,
          monitored_hosts: true,
          sortfield: "name",
        });

        const devices = (hosts ?? []).map((host) => {
          const interfaces = (host.interfaces ?? []).map((iface) => ({
            interfaceid: iface.interfaceid,
            ip: iface.ip,
            dns: iface.dns || "",
            type: iface.type,
            available: availabilityLabel(iface.available),
            error: iface.error || "",
            main: iface.main === "1",
          }));
          const worst = interfaces.some((iface) => iface.available === "unavailable")
            ? "unavailable"
            : interfaces.some((iface) => iface.available === "available")
              ? "available"
              : "unknown";
          return {
            hostid: host.hostid,
            host: host.host,
            name: host.name,
            enabled: host.status === "0",
            availability: worst,
            groups: (host.groups ?? []).map((group) => group.name),
            interfaces,
          };
        });

        return jsonResult({
          ok: true,
          count: devices.length,
          group_name: group_name ?? null,
          devices,
        });
      } catch (error) {
        return mapZabbixError("zabbix_get_device_status", error);
      }
    },
  );

  server.tool(
    "zabbix_get_metrics",
    "Read the latest values for specific Zabbix item keys on one host (technical host name or visible name).",
    {
      host_name: z
        .string()
        .min(1)
        .describe("Zabbix technical host name or visible name, e.g. 'esxi-01' or 'SW-CORE-1'."),
      item_keys: z
        .array(z.string().min(1))
        .min(1)
        .describe("Exact Zabbix item keys, e.g. ['system.cpu.util', 'vm.memory.size[pavailable]']."),
    },
    async ({ host_name, item_keys }) => {
      try {
        const hosts = await client.call<ZabbixHost[]>("host.get", {
          output: ["hostid", "host", "name", "status"],
          search: { host: host_name, name: host_name },
          searchByAny: true,
          limit: 20,
        });
        const needle = host_name.toLowerCase();
        const host =
          (hosts ?? []).find(
            (candidate) =>
              candidate.host.toLowerCase() === needle || candidate.name.toLowerCase() === needle,
          ) ?? (hosts ?? [])[0];

        if (!host) {
          return errorResult(`No Zabbix host matched '${host_name}'`);
        }

        const items = await client.call<ZabbixItem[]>("item.get", {
          output: ["itemid", "name", "key_", "lastvalue", "lastclock", "units", "state", "error", "status"],
          hostids: [host.hostid],
          filter: { key_: item_keys },
          monitored: true,
        });

        const foundKeys = new Set((items ?? []).map((item) => item.key_));
        const missing = item_keys.filter((key) => !foundKeys.has(key));

        return jsonResult({
          ok: true,
          host: {
            hostid: host.hostid,
            host: host.host,
            name: host.name,
            enabled: host.status === "0",
          },
          metrics: (items ?? []).map((item) => ({
            itemid: item.itemid,
            name: item.name,
            key: item.key_,
            lastvalue: item.lastvalue ?? null,
            lastclock: clockToIso(item.lastclock),
            units: item.units || "",
            unsupported: item.state === "1",
            error: item.error || "",
          })),
          missing_item_keys: missing,
        });
      } catch (error) {
        return mapZabbixError("zabbix_get_metrics", error);
      }
    },
  );
}

function mapZabbixError(tool: string, error: unknown) {
  if (error instanceof ZabbixClientError) {
    return errorResult(`${tool} failed: ${error.message}`, {
      http_status: error.status ?? null,
      rpc: error.rpc ?? null,
    });
  }
  return errorResult(`${tool} failed: ${error instanceof Error ? error.message : String(error)}`);
}
