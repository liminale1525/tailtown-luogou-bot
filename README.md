# 尾巴镇 Discord 归档 Bot

这是一个面向中文 Discord 社区管理员的论坛帖自动归档 Bot。

启用后，Bot 会按管理员设置的检查间隔扫描论坛频道，并自动归档超过指定天数未活跃的帖子。

## 已实现功能

- 中文斜杠指令：`/归档`
- 单入口管理面板
- 自动扫描论坛频道
- 自动归档启用 / 关闭
- 归档周期：3 天、7 天、15 天、30 天
- 检查间隔：48 小时、24 小时、12 小时、6 小时、3 小时、1 小时、半小时
- 帖子白名单
- 可选 `#归档记录` 频道
- 只允许拥有“管理线程/帖子”权限的成员使用

## 归档规则

Bot 只按时间规则自动归档：

```text
自动归档已启用
并且
帖子超过 X 天未活跃
```

Bot 默认不会处理：

- 已经归档的帖子
- 已锁定的帖子
- 置顶帖子
- 加入白名单的帖子

归档不是删除。帖子被归档后会离开活跃列表，但通常仍可被重新打开。

## 准备 Discord Bot

1. 打开 Discord Developer Portal。
2. 创建 Application 和 Bot。
3. 复制 Bot Token。
4. 复制 Application / Client ID。
5. 在服务器中打开开发者模式，复制服务器 ID。
6. 邀请 Bot 时至少需要这些权限：
   - View Channels
   - Send Messages
   - Read Message History
   - Manage Threads
   - Use Slash Commands

## 配置

复制 `.env.example` 为 `.env`，然后填写：

```env
DISCORD_TOKEN=把Bot令牌填在这里
DISCORD_CLIENT_ID=把应用Client ID填在这里
DISCORD_GUILD_ID=把尾巴镇服务器ID填在这里
ARCHIVE_LOG_CHANNEL_ID=
```

`ARCHIVE_LOG_CHANNEL_ID` 可以不填。Bot 会自动寻找名为 `归档记录` 的文字频道；如果找不到，就不会发送日志。

## 安装依赖

```powershell
pnpm install
```

如果电脑没有 `pnpm`，可以先安装 Node.js，再使用：

```powershell
npm install
```

## 注册中文指令

不熟悉命令行的话，可以直接双击：

```text
scripts\register-commands.bat
```

或者使用 PowerShell：

```powershell
.\scripts\register-commands.ps1
```

注册后，在服务器里输入 `/归档` 应该能看到中文指令。

## 启动 Bot

不熟悉命令行的话，可以直接双击：

```text
scripts\start-bot.bat
```

或者使用 PowerShell：

```powershell
.\scripts\start-bot.ps1
```

Bot 内部每半小时醒来一次，判断是否达到你设置的检查间隔。比如设置为 6 小时，就每 6 小时真正执行一次扫描。

## 常用指令

```text
/归档
```

输入 `/归档` 后，会打开一个只有管理员可见的临时管理面板。

面板里可以完成：

- 启用自动归档
- 关闭自动归档
- 设置归档周期
- 设置检查间隔
- 输入帖子链接加入白名单
- 从白名单里移除帖子
- 查看白名单并跳转到帖子

## 上线部署

正式部署到尾巴镇和 VPS 前，请阅读：

```text
DEPLOYMENT.md
```
