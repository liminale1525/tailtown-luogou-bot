import "dotenv/config";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { CHECK_INTERVAL_MS } from "./defaultConfig.js";
import { getGuildConfig, updateGuildConfig } from "./configStore.js";
import {
  buildArchiveBatchChannelReply,
  runAutoArchiveCheck
} from "./archiveService.js";

const { DISCORD_TOKEN, ARCHIVE_LOG_CHANNEL_ID } = process.env;
const DISPLAY_TIME_ZONE = process.env.TIME_ZONE ?? "Asia/Hong_Kong";

if (!DISCORD_TOKEN) {
  throw new Error("请先在 .env 中填写 DISCORD_TOKEN。");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

const INTERVAL_OPTIONS = [
  { label: "48小时", value: 2880 },
  { label: "24小时", value: 1440 },
  { label: "12小时", value: 720 },
  { label: "6小时", value: 360 },
  { label: "3小时", value: 180 },
  { label: "1小时", value: 60 },
  { label: "半小时", value: 30 },
  { label: "3分钟测试", value: 3 }
];

function formatDate(value) {
  if (!value) {
    return "暂无";
  }

  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
    timeZone: DISPLAY_TIME_ZONE
  });
}

function formatInterval(minutes) {
  const option = INTERVAL_OPTIONS.find((item) => item.value === minutes);
  if (option) {
    return option.label;
  }

  if (minutes % 60 === 0) {
    return `${minutes / 60}小时`;
  }

  return `${minutes}分钟`;
}

function isDueForCheck(config) {
  if (!config.autoArchiveEnabled) {
    return false;
  }

  if (!config.lastAutoCheckAt) {
    return true;
  }

  const intervalMs = (config.checkIntervalMinutes ?? 120) * 60 * 1000;
  return Date.now() - new Date(config.lastAutoCheckAt).getTime() >= intervalMs;
}

function isThreadChannel(channel) {
  return [
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread
  ].includes(channel?.type);
}

function parseThreadId(input) {
  const value = input.trim();
  const urlMatch = value.match(/discord(?:app)?\.com\/channels\/\d+\/(\d+)(?:\/\d+)?/i);
  if (urlMatch) {
    return urlMatch[1];
  }

  const idMatch = value.match(/\d{17,20}/);
  return idMatch?.[0] ?? null;
}

function truncateLabel(value) {
  return value.length > 95 ? `${value.slice(0, 94)}…` : value;
}

async function ensureEnvLogChannel(guildId, config) {
  if (!ARCHIVE_LOG_CHANNEL_ID || config.logChannelId) {
    return config;
  }

  return updateGuildConfig(guildId, (current) => ({
    ...current,
    logChannelId: ARCHIVE_LOG_CHANNEL_ID
  }));
}

async function normalizeConfig(guildId) {
  let config = await ensureEnvLogChannel(guildId, await getGuildConfig(guildId));

  if (!config.checkIntervalMinutes) {
    config = await updateGuildConfig(guildId, (current) => ({
      ...current,
      checkIntervalMinutes: 120
    }));
  }

  return config;
}

async function getWhitelistEntries(guild, threadIds) {
  const entries = [];

  for (const id of threadIds.slice(0, 25)) {
    const thread = await guild.channels.fetch(id).catch(() => null);
    entries.push({
      id,
      name: thread?.name ?? `未知帖子 ${id}`
    });
  }

  return entries;
}

async function buildWhitelistReply(guild, notice = null) {
  const config = await normalizeConfig(guild.id);
  const entries = await getWhitelistEntries(guild, config.whitelistedThreadIds);
  const content = [
    notice ? `**${notice}**` : "**🛡️ 白名单**",
    entries.length === 0
      ? "当前没有被保护的帖子。"
      : entries.map((entry, index) => `${index + 1}. <#${entry.id}>`).join("\n")
  ].join("\n");

  if (entries.length === 0) {
    return { content, components: [] };
  }

  return {
    content,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("archive:whitelist:remove")
          .setPlaceholder("移除被保护帖子")
          .addOptions(
            entries.map((entry, index) => ({
              label: `${index + 1} 移除 ❌`,
              value: entry.id,
              description: truncateLabel(entry.name)
            }))
          )
      )
    ]
  };
}

async function buildPanel(guild, notice = null) {
  let config = await normalizeConfig(guild.id);

  const content = [
    `# 📁 自动归档处${notice ? `\n${notice}` : ""}`,
    `白名单：${config.whitelistedThreadIds.length} 个帖子`,
    `上次归档：${formatDate(config.lastAutoArchiveAt)}`
  ].join("\n");

  const statusRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("archive:status")
      .setLabel(config.autoArchiveEnabled ? "已启用" : "已关闭")
      .setStyle(config.autoArchiveEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(config.autoArchiveEnabled ? "archive:auto:disable" : "archive:auto:enable")
      .setLabel(config.autoArchiveEnabled ? "关闭" : "启用")
      .setStyle(config.autoArchiveEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("archive:refresh")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary)
  );

  const daysRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("archive:days")
      .setPlaceholder(`周期：${config.archiveDays}天`)
      .addOptions(
        [3, 7, 15, 30].map((days) => ({
          label: `${days}天`,
          value: String(days),
          default: config.archiveDays === days
        }))
      )
  );

  const intervalRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("archive:interval")
      .setPlaceholder(`间隔：${formatInterval(config.checkIntervalMinutes ?? 120)}`)
      .addOptions(
        INTERVAL_OPTIONS.map((option) => ({
          label: option.label,
          value: String(option.value),
          default: (config.checkIntervalMinutes ?? 120) === option.value
        }))
      )
  );

  const whitelistRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("archive:whitelist:open-add")
      .setLabel("保护帖子")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🛡️"),
    new ButtonBuilder()
      .setCustomId("archive:whitelist:list")
      .setLabel("查看白名单")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    content,
    components: [statusRow, daysRow, intervalRow, whitelistRow]
  };
}

async function handleArchiveCommand(interaction) {
  console.log(`[command] /归档 by ${interaction.user.tag} in ${interaction.guild?.id}`);
  await interaction.reply({
    content: "# 📁 自动归档处\n正在读取状态...",
    flags: MessageFlags.Ephemeral
  });
  const panel = await buildPanel(interaction.guild);
  await interaction.editReply(panel);
}

async function handleArchiveComponent(interaction) {
  console.log(`[component] ${interaction.customId} by ${interaction.user.tag} in ${interaction.guild?.id}`);

  const guild = interaction.guild;
  let notice = "设置已更新";

  if (interaction.customId.startsWith("archive:batch:")) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const batchId = interaction.customId.split(":").at(-1);
    const channelId = interaction.values[0];
    const config = await normalizeConfig(guild.id);
    const batch = config.archiveBatches?.[batchId];

    if (!batch) {
      await interaction.editReply("没有找到这个归档批次，可能是记录已被清理或 Bot 更换过数据文件。");
      return;
    }

    await interaction.editReply(buildArchiveBatchChannelReply(batch, channelId));
    return;
  }

  if (interaction.customId === "archive:whitelist:list") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reply = await buildWhitelistReply(guild);
    await interaction.editReply(reply);
    return;
  }

  await interaction.deferUpdate();

  if (interaction.customId === "archive:auto:enable") {
    await updateGuildConfig(guild.id, (current) => ({
      ...current,
      autoArchiveEnabled: true
    }));
    notice = "自动归档已启用";
  }

  if (interaction.customId === "archive:auto:disable") {
    await updateGuildConfig(guild.id, (current) => ({
      ...current,
      autoArchiveEnabled: false
    }));
    notice = "自动归档已关闭";
  }

  if (interaction.customId === "archive:days") {
    const archiveDays = Number(interaction.values[0]);
    await updateGuildConfig(guild.id, (current) => ({
      ...current,
      archiveDays
    }));
    notice = `归档周期已改为 ${archiveDays} 天`;
  }

  if (interaction.customId === "archive:interval") {
    const checkIntervalMinutes = Number(interaction.values[0]);
    await updateGuildConfig(guild.id, (current) => ({
      ...current,
      checkIntervalMinutes
    }));
    notice = `检查间隔已改为 ${formatInterval(checkIntervalMinutes)}`;
  }

  if (interaction.customId === "archive:whitelist:remove") {
    const threadId = interaction.values[0];
    await updateGuildConfig(guild.id, (current) => ({
      ...current,
      whitelistedThreadIds: current.whitelistedThreadIds.filter((id) => id !== threadId)
    }));
    const reply = await buildWhitelistReply(guild, "已移除被保护帖子");
    await interaction.editReply(reply);
    return;
  }

  if (interaction.customId === "archive:refresh") {
    notice = "状态已刷新";
  }

  const panel = await buildPanel(guild, notice);
  await interaction.editReply(panel);
}

async function handleArchiveModal(interaction) {
  console.log(`[modal] ${interaction.customId} by ${interaction.user.tag} in ${interaction.guild?.id}`);
  await interaction.deferUpdate();

  const input = interaction.fields.getTextInputValue("thread-link");
  const threadId = parseThreadId(input);
  if (!threadId) {
    const panel = await buildPanel(interaction.guild, "没有识别到有效的帖子链接");
    await interaction.editReply(panel);
    return;
  }

  const thread = await interaction.guild.channels.fetch(threadId).catch(() => null);
  if (!isThreadChannel(thread)) {
    const panel = await buildPanel(interaction.guild, "没有找到这个论坛帖子，请确认链接来自本服务器");
    await interaction.editReply(panel);
    return;
  }

  await updateGuildConfig(interaction.guild.id, (current) => ({
    ...current,
    whitelistedThreadIds: [...new Set([...current.whitelistedThreadIds, thread.id])]
  }));

  const panel = await buildPanel(interaction.guild, `已保护帖子：<#${thread.id}>`);
  await interaction.editReply(panel);
}

async function runAutoChecks() {
  for (const guild of client.guilds.cache.values()) {
    const config = await normalizeConfig(guild.id);
    if (!isDueForCheck(config)) {
      continue;
    }

    await runAutoArchiveCheck(guild, config).then((result) => {
      console.info(
        `[auto-check-done] guild=${guild.id} archived=${result.archived} count=${result.count ?? 0} failed=${result.failedCount ?? 0} active=${result.activeCount ?? 0} reason="${result.reason ?? "ok"}"`
      );
    }).catch((error) => {
      console.error(`[auto-check] ${guild.id}`, error);
    });
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`已登录：${client.user.tag}`);
  console.log("归档面板版本：single-panel-2026-06-19-13");
  runAutoChecks().catch((error) => console.error("[initial-auto-check]", error));
  setInterval(runAutoChecks, CHECK_INTERVAL_MS);
});

client.on(Events.InteractionCreate, async (interaction) => {
  const startedAt = Date.now();
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "归档") {
      await handleArchiveCommand(interaction);
      console.log(`[interaction-ok] /归档 ${Date.now() - startedAt}ms`);
      return;
    }

    if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith("archive:")) {
      if (interaction.isButton() && interaction.customId === "archive:whitelist:open-add") {
        const modal = new ModalBuilder()
          .setCustomId("archive:whitelist:add-modal")
          .setTitle("保护帖子");

        const input = new TextInputBuilder()
          .setCustomId("thread-link")
          .setLabel("帖子链接")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("粘贴 Discord 论坛帖子链接")
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        console.log(`[interaction-ok] ${interaction.customId} ${Date.now() - startedAt}ms`);
        return;
      }

      await handleArchiveComponent(interaction);
      console.log(`[interaction-ok] ${interaction.customId} ${Date.now() - startedAt}ms`);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === "archive:whitelist:add-modal") {
      await handleArchiveModal(interaction);
      console.log(`[interaction-ok] ${interaction.customId} ${Date.now() - startedAt}ms`);
    }
  } catch (error) {
    console.error(`[interaction-failed] ${Date.now() - startedAt}ms`, error);
    const message = "执行时遇到错误。请确认 Bot 拥有查看频道、发送消息、管理帖子/线程的权限。";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message, components: [] }).catch(() => null);
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  }
});

await client.login(DISCORD_TOKEN);
