import {
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";

export const archiveCommand = new SlashCommandBuilder()
  .setName("归档")
  .setDescription("打开自动归档管理")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads)
  .setDMPermission(false);

export const commands = [archiveCommand.toJSON()];
