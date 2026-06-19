import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_GUILD_CONFIG } from "./defaultConfig.js";

const DATA_DIR = path.resolve("data");
const CONFIG_PATH = path.join(DATA_DIR, "guild-config.json");

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

function mergeGuildConfig(config) {
  return {
    ...DEFAULT_GUILD_CONFIG,
    ...config,
    excludedChannelIds: config?.excludedChannelIds ?? [],
    whitelistedThreadIds: config?.whitelistedThreadIds ?? [],
    jobs: config?.jobs ?? {}
  };
}

export async function loadAllConfigs() {
  await ensureDataDir();

  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function saveAllConfigs(configs) {
  await ensureDataDir();
  await writeFile(CONFIG_PATH, `${JSON.stringify(configs, null, 2)}\n`, "utf8");
}

export async function getGuildConfig(guildId) {
  const configs = await loadAllConfigs();
  return mergeGuildConfig(configs[guildId]);
}

export async function updateGuildConfig(guildId, updater) {
  const configs = await loadAllConfigs();
  const current = mergeGuildConfig(configs[guildId]);
  const next = mergeGuildConfig(await updater(current));
  configs[guildId] = next;
  await saveAllConfigs(configs);
  return next;
}
