import "dotenv/config";
import { REST, Routes } from "discord.js";

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;

const missing = [];
if (!DISCORD_TOKEN) missing.push("DISCORD_TOKEN");
if (!DISCORD_CLIENT_ID) missing.push("DISCORD_CLIENT_ID");
if (!DISCORD_GUILD_ID) missing.push("DISCORD_GUILD_ID");

if (missing.length > 0) {
  console.error(`.env 缺少配置：${missing.join(", ")}`);
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

const application = await rest.get(Routes.oauth2CurrentApplication());
console.log(`应用名称：${application.name}`);
console.log(`Client ID：${application.id}`);

if (application.id !== DISCORD_CLIENT_ID) {
  console.error("DISCORD_CLIENT_ID 与当前 Token 对应的应用不一致。");
  process.exit(1);
}

const commands = await rest.get(
  Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID)
);

console.log(`当前服务器已注册指令数量：${commands.length}`);
for (const command of commands) {
  console.log(`- /${command.name}`);
}

if (!commands.some((command) => command.name === "归档")) {
  console.error("没有找到 /归档。请先运行 .\\scripts\\register-commands.ps1。");
  process.exit(1);
}

console.log("检查通过：/归档 已注册到这个服务器。");
