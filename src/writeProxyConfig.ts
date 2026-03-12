import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { SafetyStrategy } from "./runCodexExec";
import { checkOutput } from "./checkOutput";

const MODEL_PROVIDER = "codex-action-responses-proxy";
const MANAGED_HEADER_START = "# BEGIN codex-action managed model provider";
const MANAGED_HEADER_END = "# END codex-action managed model provider";
const MANAGED_TABLE_START = "# BEGIN codex-action managed proxy";
const MANAGED_TABLE_END = "# END codex-action managed proxy";

export async function writeProxyConfig(
  codexHome: string,
  port: number,
  safetyStrategy: SafetyStrategy
): Promise<void> {
  const configPath = path.join(codexHome, "config.toml");

  let existing = "";
  try {
    existing = await fs.readFile(configPath, "utf8");
  } catch {
    existing = "";
  }

  const header = `${MANAGED_HEADER_START}
model_provider = "${MODEL_PROVIDER}"
${MANAGED_HEADER_END}`;
  const table = `${MANAGED_TABLE_START}
[model_providers.${MODEL_PROVIDER}]
name = "Codex Action Responses Proxy"
base_url = "http://127.0.0.1:${port}/v1"
wire_api = "responses"
${MANAGED_TABLE_END}`;

  const cleanedExisting = stripManagedProxyConfig(existing);
  const output = [header, cleanedExisting, table]
    .filter((part) => part.length > 0)
    .join("\n\n")
    .concat("\n");

  if (safetyStrategy === "unprivileged-user") {
    // We know we have already created the CODEX_HOME directory, but it is owned
    // by another user, so we need to use sudo to write the file.
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-config"));
    try {
      const tempConfigPath = path.join(tempDir, "config.toml");
      await fs.writeFile(tempConfigPath, output, "utf8");
      await checkOutput(["sudo", "mv", tempConfigPath, configPath]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  } else {
    await fs.mkdir(codexHome, { recursive: true });
    await fs.writeFile(configPath, output, "utf8");
  }
}

function stripManagedProxyConfig(config: string): string {
  const normalized = config.replace(/\r\n/g, "\n");

  const withoutManagedBlocks = normalized
    .replace(managedBlockPattern(MANAGED_HEADER_START, MANAGED_HEADER_END), "")
    .replace(managedBlockPattern(MANAGED_TABLE_START, MANAGED_TABLE_END), "")
    .replace(
      /(^|\n)# Added by codex-action\.\n\[model_providers\.codex-action-responses-proxy\]\nname = "Codex Action Responses Proxy"\nbase_url = "http:\/\/127\.0\.0\.1:\d+\/v1"\nwire_api = "responses"\n?/g,
      "$1"
    )
    .replace(
      /(^|\n)# Added by codex-action\.\nmodel_provider = "codex-action-responses-proxy"\n?/g,
      "$1"
    );

  return withoutManagedBlocks
    .replace(/^model_provider\s*=.*\n?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function managedBlockPattern(startMarker: string, endMarker: string): RegExp {
  const escapedStart = escapeRegExp(startMarker);
  const escapedEnd = escapeRegExp(endMarker);
  return new RegExp(`(^|\\n)${escapedStart}\\n[\\s\\S]*?\\n${escapedEnd}\\n?`, "g");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
