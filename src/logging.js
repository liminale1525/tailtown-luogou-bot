import { ChannelType } from "discord.js";

export async function findArchiveLogChannel(guild, configuredChannelId) {
  if (configuredChannelId) {
    const configured = await guild.channels.fetch(configuredChannelId).catch(() => null);
    if (configured?.isTextBased()) {
      return configured;
    }
  }

  const channels = await guild.channels.fetch();
  return channels.find((channel) => (
    channel?.type === ChannelType.GuildText &&
    channel.name === "归档记录" &&
    channel.isTextBased()
  )) ?? null;
}

export async function sendArchiveLog(guild, config, message) {
  const channel = await findArchiveLogChannel(guild, config.logChannelId);
  if (!channel) {
    return false;
  }

  await channel.send(message);
  return true;
}
