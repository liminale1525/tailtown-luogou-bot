export const CHECK_INTERVAL_MS = 60 * 1000;

export const DEFAULT_GUILD_CONFIG = {
  autoArchiveEnabled: false,
  archiveMode: "days",
  archiveDays: 15,
  checkIntervalMinutes: 120,
  logChannelId: null,
  excludedChannelIds: [],
  whitelistedThreadIds: [],
  jobs: {},
  lastAutoCheckAt: null,
  lastAutoArchiveAt: null
};

export const SUPPORTED_ARCHIVE_DAYS = [3, 7, 15, 30];
export const SUPPORTED_ARCHIVE_MODES = ["days", "full"];
export const SUPPORTED_CHECK_INTERVAL_MINUTES = [2880, 1440, 720, 360, 180, 60, 30, 3];
