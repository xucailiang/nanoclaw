---
name: add-feishu
description: Add Feishu (飞书) as a channel. Uses WebSocket long connection for receiving messages - no public URL or domain required.
---

# Add Feishu Channel

This skill adds Feishu support to NanoClaw using WebSocket long connection for message reception.

## Phase 1: Pre-flight

### Check if already applied

Check if `src/channels/feishu.ts` exists. If it does, skip to Phase 3 (Setup). The code changes are already in place.

## Phase 2: Apply Code Changes (if needed)

If the channel is not installed yet:

### Install SDK

```bash
npm install @larksuiteoapi/node-sdk
```

### Create channel file

Create `src/channels/feishu.ts` with the FeishuChannel implementation.

### Update barrel import

Add to `src/channels/index.ts`:
```typescript
import './feishu.js';
```

### Validate code changes

```bash
npm run build
npx vitest run src/channels/feishu.test.ts
```

All tests must pass before proceeding.

## Phase 3: Setup

### Create Feishu App (if needed)

If the user doesn't have a Feishu app, tell them:

> I need you to create a Feishu app:
>
> 1. Go to [Feishu Open Platform](https://open.feishu.cn/app)
> 2. Click "Create Enterprise Self-Built App" (创建企业自建应用)
> 3. Fill in:
>    - App name: Something friendly (e.g., "NanoClaw Assistant")
>    - App description: Brief description
> 4. After creation, go to "Credentials & Basic Info" (凭证与基础信息)
> 5. Copy the **App ID** and **App Secret**

Wait for the user to provide the credentials.

### Enable Robot Capability

Tell the user:

> Enable robot capability for your app:
>
> 1. In the app settings, go to "App Features" (应用功能)
> 2. Enable "Robot" (机器人) capability
> 3. Configure robot name and description

### Configure Event Subscription

Tell the user:

> Configure event subscription with long connection:
>
> 1. Go to "Events & Callbacks" (事件与回调) → "Event Configuration" (事件配置)
> 2. For "Subscription Mode", select "Receive events through persistent connection" (使用长连接接收事件) - **Recommended**
> 3. Add the event: `im.message.receive_v1` (Receive message)
> 4. Save the configuration

Note: Long connection mode doesn't require a public URL or domain.

### Add Permissions

Tell the user:

> Add required permissions:
>
> 1. Go to "Permission Management" (权限管理)
> 2. Search and add these permissions:
>    - `im:message` - Get and read messages
>    - `im:message:send_as_bot` - Send messages as bot
> 3. Some permissions may require admin approval

### Configure environment

Add to `.env`:

```bash
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxx
```

Sync to container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

The container reads environment from `data/env/env`, not `.env` directly.

### Build and restart

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
# Linux: systemctl --user restart nanoclaw
```

## Phase 4: Registration

### Get Chat ID

Tell the user:

> To get the Chat ID:
>
> 1. Open Feishu and create or open a group chat
> 2. Add your bot to the group (group settings → Add bots → select your app)
> 3. Send any message in the group
> 4. The bot should log the chat ID - check the logs:
>
>    ```bash
>    tail -f logs/nanoclaw.log
>    ```
>
> 5. Or use the Feishu admin panel to find the chat ID
>
> The JID format for NanoClaw is: `feishu:<chat_id>`
>
> For private chat with the bot, the chat ID will be shown when you message the bot directly.

Wait for the user to provide the chat ID.

### Register the chat

Use `npx tsx setup/index.ts --step register` with the appropriate flags.

For a main chat (responds to all messages):

```bash
npx tsx setup/index.ts --step register -- --jid "feishu:<chat-id>" --name "<chat-name>" --folder "feishu_main" --trigger "@${ASSISTANT_NAME}" --channel feishu --no-trigger-required --is-main
```

For additional chats (trigger-only):

```bash
npx tsx setup/index.ts --step register -- --jid "feishu:<chat-id>" --name "<chat-name>" --folder "feishu_<group-name>" --trigger "@${ASSISTANT_NAME}" --channel feishu
```

## Phase 5: Verify

### Test the connection

Tell the user:

> Send a message to your registered Feishu chat:
> - For main chat: Any message works
> - For non-main: `@Andy hello` or use your configured trigger
>
> The bot should respond within a few seconds.

### Check logs if needed

```bash
tail -f logs/nanoclaw.log
```

## Troubleshooting

### Bot not responding

Check:
1. `FEISHU_APP_ID` and `FEISHU_APP_SECRET` are set in `.env` AND synced to `data/env/env`
2. Chat is registered in SQLite: `sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'feishu:%'"`
3. For non-main chats: message includes trigger pattern
4. Service is running: `launchctl list | grep nanoclaw` (macOS) or `systemctl --user status nanoclaw` (Linux)
5. WebSocket connection is established (check logs for "Feishu WebSocket connected")

### WebSocket not connecting

1. Verify App ID and App Secret are correct
2. Check that "Receive events through persistent connection" is enabled in Feishu developer console
3. Ensure the event `im.message.receive_v1` is subscribed
4. Check that robot capability is enabled

### Bot not seeing messages

1. Verify bot is added to the group/chat
2. Check permissions include `im:message`
3. For private chats, user needs to start a conversation with the bot first

### Getting chat ID

If the chat ID is hard to find:
- Send a message to the bot/group and check the NanoClaw logs
- The chat_id format is typically `oc_xxxxxx` for groups or `ou_xxxxxx` for users

## After Setup

The Feishu channel supports:
- **Group chats** — Bot must be added to the group
- **Private chats** — Users can DM the bot directly
- **Multi-channel** — Can run alongside WhatsApp, Telegram, Slack, etc.

## Known Limitations

- **Text messages only** — Images, files, and rich content are not forwarded initially
- **No typing indicator** — Feishu API doesn't expose typing indicator
- **Thread support** — Threads are flattened (replies appear as regular messages)
- **Sender name** — May show user ID instead of display name

## Removal

To remove Feishu integration:

1. Delete `src/channels/feishu.ts` and `src/channels/feishu.test.ts`
2. Remove `import './feishu.js'` from `src/channels/index.ts`
3. Remove `FEISHU_APP_ID` and `FEISHU_APP_SECRET` from `.env`
4. Remove Feishu registrations from SQLite: `sqlite3 store/messages.db "DELETE FROM registered_groups WHERE jid LIKE 'feishu:%'"`
5. Uninstall: `npm uninstall @larksuiteoapi/node-sdk`
6. Rebuild: `npm run build && launchctl kickstart -k gui/$(id -u)/com.nanoclaw` (macOS) or `npm run build && systemctl --user restart nanoclaw` (Linux)
