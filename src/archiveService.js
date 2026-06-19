import { ChannelFlagsBitField, ChannelType, SnowflakeUtil } from "discord.js";
import { updateGuildConfig } from "./configStore.js";
import { sendArchiveLog } from "./logging.js";

const FORUM_CHANNEL_TYPES = new Set([
  ChannelType.GuildForum,
  ChannelType.GuildMedia
]);

const AUTO_ARCHIVE_BATCH_LIMIT = 100;

function daysAgo(date) {
  return (Date.now() - date.getTime()) / (24 * 60 * 60 * 1000);
}

function getThreadLastActivityAt(thread) {
  if (thread.lastMessage?.createdAt) {
    return thread.lastMessage.createdAt;
  }

  if (thread.lastMessageId) {
    return new Date(Number(SnowflakeUtil.timestampFrom(thread.lastMessageId)));
  }

  return thread.createdAt ?? new Date(Number(SnowflakeUtil.timestampFrom(thread.id)));
}

function isPinnedThread(thread) {
  return thread.flags?.has(ChannelFlagsBitField.Flags.Pinned) ?? false;
}

function canArchiveThread(thread, config, days) {
  return !thread.archived &&
    !thread.locked &&
    !isPinnedThread(thread) &&
    !config.whitelistedThreadIds.includes(thread.id) &&
    daysAgo(getThreadLastActivityAt(thread)) >= days;
}

function makeJobId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${suffix}`;
}

function isForumChannel(channel) {
  return channel && FORUM_CHANNEL_TYPES.has(channel.type);
}

export async function getManagedForumChannels(guild, config) {
  const channels = await guild.channels.fetch();
  return [...channels.values()]
    .filter(isForumChannel)
    .filter((channel) => !config.excludedChannelIds.includes(channel.id))
    .sort((a, b) => a.position - b.position);
}

export async function getActiveThreadsForForums(forumChannels) {
  const activeThreads = [];

  for (const channel of forumChannels) {
    const fetched = await channel.threads.fetchActive().catch(() => null);
    if (!fetched) {
      continue;
    }

    for (const thread of fetched.threads.values()) {
      activeThreads.push(thread);
    }
  }

  return activeThreads;
}

export function filterArchivableThreads(threads, config, days = config.archiveDays) {
  return threads
    .filter((thread) => canArchiveThread(thread, config, days))
    .map((thread) => ({
      thread,
      lastActivityAt: getThreadLastActivityAt(thread)
    }))
    .sort((a, b) => a.lastActivityAt - b.lastActivityAt);
}

export async function createArchivePreview(guild, config, options = {}) {
  const forumChannels = await getManagedForumChannels(guild, config);
  const activeThreads = await getActiveThreadsForForums(forumChannels);
  const days = options.days ?? config.archiveDays;
  const limit = options.limit ?? AUTO_ARCHIVE_BATCH_LIMIT;
  const channelId = options.channelId ?? null;
  const targetThreads = channelId
    ? activeThreads.filter((thread) => thread.parentId === channelId)
    : activeThreads;
  const archivable = filterArchivableThreads(targetThreads, config, days).slice(0, limit);
  const jobId = makeJobId();

  const job = {
    id: jobId,
    type: "manual",
    days,
    channelId,
    threadIds: archivable.map((item) => item.thread.id),
    createdAt: new Date().toISOString(),
    status: "preview"
  };

  await updateGuildConfig(guild.id, (current) => ({
    ...current,
    jobs: {
      ...current.jobs,
      [jobId]: job
    }
  }));

  return {
    job,
    forumCount: forumChannels.length,
    activeCount: targetThreads.length,
    archivable
  };
}

export async function executeArchiveJob(guild, config, jobId, actorName = "系统") {
  const job = config.jobs[jobId];
  if (!job || job.status !== "preview") {
    return { ok: false, reason: "找不到可执行的预览任务，或任务已经执行过。" };
  }

  const results = [];
  for (const threadId of job.threadIds) {
    const thread = await guild.channels.fetch(threadId).catch(() => null);
    if (!thread) {
      results.push({ threadId, ok: false, reason: "帖子不存在或无法读取" });
      continue;
    }

    if (!canArchiveThread(thread, config, job.days)) {
      results.push({ threadId, ok: false, reason: "帖子已不符合归档条件，已跳过" });
      continue;
    }

    await thread.setArchived(true, `由${actorName}通过归档Bot执行`);
    results.push({ threadId, ok: true, reason: "已归档", name: thread.name });
  }

  const successCount = results.filter((result) => result.ok).length;
  const failedCount = results.length - successCount;

  await updateGuildConfig(guild.id, (current) => ({
    ...current,
    jobs: {
      ...current.jobs,
      [jobId]: {
        ...job,
        status: "done",
        executedAt: new Date().toISOString(),
        results
      }
    }
  }));

  await sendArchiveLog(guild, config, [
    "**归档任务已执行**",
    `任务编号：\`${jobId}\``,
    `执行人：${actorName}`,
    `成功：${successCount} 个，跳过/失败：${failedCount} 个`
  ].join("\n")).catch(() => null);

  return { ok: true, successCount, failedCount, results };
}

export async function runAutoArchiveCheck(guild, config) {
  if (!config.autoArchiveEnabled) {
    return {
      archived: false,
      reason: "自动归档未启用",
      activeCount: 0
    };
  }

  const forumChannels = await getManagedForumChannels(guild, config);
  const activeThreads = await getActiveThreadsForForums(forumChannels);

  await updateGuildConfig(guild.id, (current) => ({
    ...current,
    lastAutoCheckAt: new Date().toISOString(),
    lastActiveThreadCount: activeThreads.length,
    lastActiveThreadCountAt: new Date().toISOString()
  }));

  const archivable = filterArchivableThreads(activeThreads, config, config.archiveDays)
    .slice(0, AUTO_ARCHIVE_BATCH_LIMIT);

  if (archivable.length === 0) {
    return {
      archived: false,
      reason: "没有符合时间条件的可归档帖子",
      activeCount: activeThreads.length
    };
  }

  const results = [];
  for (const item of archivable) {
    await item.thread.setArchived(true, `自动归档：超过 ${config.archiveDays} 天未活跃`);
    results.push(item.thread);
  }

  await updateGuildConfig(guild.id, (current) => ({
    ...current,
    lastAutoArchiveAt: new Date().toISOString()
  }));

  await sendArchiveLog(guild, config, [
    "**自动归档完成**",
    `规则：超过 ${config.archiveDays} 天未活跃`,
    `检查间隔：${config.checkIntervalMinutes ?? 120} 分钟`,
    `已归档：${results.length} 个帖子`
  ].join("\n")).catch(() => null);

  return {
    archived: true,
    activeCount: activeThreads.length,
    count: results.length
  };
}
