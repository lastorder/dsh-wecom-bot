# DSH × 企业微信智能机器人

基于 [`@wecom/aibot-node-sdk` 1.0.7](https://cdn.jsdelivr.net/npm/@wecom/aibot-node-sdk@1.0.7/README.md) WebSocket 长连接的 DeepSeek Harness 本地插件，无需公网回调地址：

- DSH 会话**本轮完成**、**需要你回答**或**请求权限**时，主动推送到企业微信；
- 在企业微信里 `/sessions` 选会话，直接回复就能继续对话，还可 `/answer`、`/cancel`；
- 每条企微消息的原始请求、回复和元数据写入 DSH home 下的 JSONL 日志。

> 企业微信**智能机器人（API 模式 · 长连接）**使用 Bot ID + **Bot Secret**，不是群机器人 webhook key，也不是回调 Token/EncodingAESKey。请勿把 Secret 发进聊天或提交到仓库。

## 构建与安装

```sh
pnpm install          # esbuild 的安装脚本不需要运行（见 pnpm-workspace.yaml）
pnpm test             # 清理 → 构建 Host 与浏览器包 → 运行全部测试
```

DSH 加载 `dist/` 中的构建产物：Host 入口 `dist/host/index.js`，浏览器入口 `dist/client.js`。在 DSH「插件」中以本目录绝对路径安装 bundle `@local/dsh-wecom-bot`（bundle patch 会插入 `wecom-bot` 条目）。

**修改代码并重新构建后，需要重启 DSH 应用**：桌面版 profile 未开启 Host 源码热重载，禁用/启用插件不会替换已缓存的 Host 模块。接口已在 DSH `0.2.0-rc.2` 上核对。

## 在插件主页配置

打开 **设置 → 插件 → `@local/dsh-wecom-bot`** 的 bundle 主页。页面自上而下：

1. **状态栏**：连接状态（在线 / 连接中 / 认证失败 / 被其他连接替换…）与本次启动以来的消息、拒绝、提交、推送计数。
2. **访问范围提示**：任一白名单留空都会醒目提示其含义。
3. **① 连接机器人（仅有的两项必填）**
   - **Bot ID**
   - **Bot Secret**：保存到 DSH 凭据库（引用名 `WECOM_BOT_SECRET`），插件 Config 只记录引用名；保存后不回显，留空表示保持不变。
4. **② DSH 会话范围**：通过 DSH Session API 读取，与 DSH 侧边栏一致地**按 Workspace 分组**；每行先显示**会话名称**，再显示 Session ID；**已归档、子代理、空白会话不显示**。支持搜索（名称 / ID / 工作区）、按工作区一键全选、仅看已选。已勾选但后来被归档或删除的会话单独列出，可一键移除。
5. **③ 企业微信来源**：列出最近 24 小时**真正给机器人发过消息**的 userid 与会话 ID（单聊为对方 userid，群聊为 chatid），**包括被白名单拒绝的**，并标注“上次被拒绝 / 已接受”、最近时间与消息数；勾选即加入白名单，也可手动添加。
6. **④ 高级设置**（默认折叠）：远程审批、等待企微回复的秒数、私有化部署的 `wss://` 地址、JSONL 日志开关与保留天数、日志目录。

底部操作栏显示是否有未保存更改，提供「放弃更改」「保存配置」。

### 访问控制：留空 = 全部允许

| 白名单 | 勾选后 | 留空时 |
| --- | --- | --- |
| DSH 会话 | 只能操作勾选的会话 | 可操作所有未归档会话（子代理/空白会话始终不可操作） |
| 企微会话 | 只接受这些单聊/群聊的消息，通知也只发到这里 | 接受任何会话；通知只发给**曾经通过授权**的会话 |
| 企微用户 | 只接受这些 userid 的消息 | 任何人 |

**三项都留空时，任何能给机器人发消息的人都能读取回复并向你的 DSH 会话下指令（可能触发命令执行与文件修改）。** 建议：只勾选自己的 userid 与自己和机器人的单聊，再只勾选需要远程操作的会话。群聊中的通知对全体群成员可见。

被拒绝的消息**不会收到任何回复**（不暴露机器人存在），但会出现在「企业微信来源」列表供你审核。ID 列表只保存 ID、计数和最近一次判定，不保存消息正文；驻留内存，每类最多 200 条，DSH 重启后清空。状态接口注册在 DSH Connection Fetch 通道（`/api/wecom-bot/state`），只有已登录的 DSH 页面可访问。

## 企业微信指令

| 指令 | 作用 |
| --- | --- |
| `/help` | 查看命令 |
| `/sessions` | 按工作区列出可操作的会话，带序号、名称、运行状态和 ID 前缀（最多 30 条） |
| `/use <序号 \| 会话ID前缀>` | 选择会话；序号来自你最近一次 `/sessions`，ID 前缀至少 6 位且需唯一。白名单只有一个会话时自动选中 |
| 引用（回复）DSH 发来的某条通知 | 把之后的消息（含斜杠命令）直接定位到那条通知所属的会话，覆盖此前的 `/use` 选择——每条通知末尾都带着可点的提示行 |
| 直接发送文字 | 提交到选中的会话（`mode: queue`）；未选择时会直接回复带序号的会话列表 |
| `/status` | 当前选择与待处理请求 |
| `/cancel` | 停止选中会话正在运行的回合 |
| `/answer <验证码> [题目ID] <选项序号或文字>` | 回答 DSH 的提问；只有一道题时可省略题目 ID；多选用 `1,3` |
| `/approve <验证码>`、`/deny <验证码>` | 远程审批（需在高级设置中开启，且只能在已授权用户的单聊中使用） |
| `/whoami` | 查看自己的 userid 与当前会话 ID |

- 完成通知只包含该回合**最后一条助手文字**，不外发推理、工具参数或附件；子代理会话的回合不推送。非“正常完成”的回合（取消、出错）只在有企微消息在等它时推送。
- 提问在企微等待（默认 60 秒）期间 DSH 页面不显示该提问，超时后回到 DSH 页面；**计划审阅与带详细内容的提问只能在 DSH 页面处理**。
- 验证码为 6 位一次性随机码，绑定到具体的那次提问/审批，过期或旧码无法重放。
- **引用定位的原理**：企业微信的引用回调只回传被引用消息的内容，不回传它的 ID，所以每条通知末尾都带一行 `/use <会话ID片段>` 的提示；插件在收到引用时从这段被回传的文字里把 ID 片段抠出来，按 `/use` 同样的规则解析成会话。无法解析（比如引用了一条无关消息，或该会话已不再允许操作）时什么都不会改变，继续按你当前的选择处理。

## JSONL 对话日志

位置：`<DSH home>/wecom-bot/logs/YYYY-MM-DD.jsonl`（DSH home 为 `$DSH_HOME`，默认 `~/.dsh`），目录权限 `0700`、文件 `0600`，按保留天数（默认 14 天）自动清理。每行一个 JSON 对象，公共字段 `ts`、`seq`、`level`、`event`。

**每条企微消息对应一行 `round.complete`**，汇总一轮对话：

```json
{"ts":"…","seq":42,"level":"info","event":"round.complete","roundId":"…","outcome":"turn-ended",
 "chatId":"zhangsan","userId":"zhangsan","chatType":"single","msgId":"…",
 "sessionId":"…","sessionTitle":"修复登录 Bug","workspace":"my-app","requestId":"…",
 "request":{"msgtype":"text","text":"帮我修复登录"},
 "response":{"replies":["已提交到《修复登录 Bug》…"],"reason":"completed","assistant":"已修复……","notifiedChats":["zhangsan"]},
 "metadata":{"turn":3,"model":{"provider":"…","model":"…"},"steps":4,"toolCalls":{"bash":2},"turnDurationMs":51234},
 "timing":{"receivedAt":"…","submittedAt":"…","completedAt":"…","totalMs":53012}}
```

`outcome` 取值：`turn-ended`（DSH 回合结束）、`command`、`rejected`、`unsupported`、`blocked`、`prompt-failed`、`interrupted`、`expired`。

明细行（用 `roundId` / `requestId` / `sessionId` 关联）：

| event | 内容 |
| --- | --- |
| `wecom.message` | 收到的原始回调帧（含被拒绝的消息）与访问判定 |
| `wecom.quote` | 引用定位的解析结果：抠出的 ID 片段（`hint`）、命中的 `sessionId`，或未解析时的原因（`outcome`） |
| `wecom.reply` | 被动回复的原始请求（streamId、内容）与服务器回执 |
| `dsh.prompt` | 提交给 DSH 的原始请求与返回值 / 错误 |
| `dsh.turn.end` | 回合结束原因、助手文字、模型、步数、工具调用统计 |
| `wecom.send` | 主动推送的原始请求体与回执 |
| `wecom.notify.skipped`（`warn`） | 该 Session 本可以推送通知，但目前没有任何已知的合格接收人——多数情况是插件刚重载或 DSH 刚重启，清空了"谁最近发过消息"的名单，而此后还没人发过新消息；`reason` 标注是哪类通知（`turn-complete`/`question`/`approval`） |
| `dsh.question*` / `dsh.approval*` | 提问、审批及其答复 |
| `connection.phase`、`config.applied`、`wecom.sdk` | 连接状态变化、生效配置（不含 Secret）、SDK 日志 |

Secret 值、`secret`/`token`/`authorization` 等字段、`response_url`、媒体 `url` 与 `aeskey` 一律脱敏。日志包含对话原文，请按敏感数据管理；不需要时可在高级设置中关闭。

## 代码结构

```text
src/
  shared/protocol.ts      Host 与页面共享的常量和状态接口类型
  host/                   DSH Host 插件（Node ESM，tsc → dist/host）
    index.ts              入口：Config、inject、apply
    config.ts             Config schema 与规范化
    runtime.ts            宿主生命周期编排：配置/凭据变化时重建连接；唯一的 session/event 监听
    bridge/               一条企微连接：
      index.ts              组装、入站处理、通知/提问/审批
      inbound.ts            回调帧校验与防重放
      policy.ts             三组白名单
      directory.ts          可操作会话（目录 ∩ 白名单）与 /use 解析
      commands.ts           斜杠命令
      interactions.ts       提问/审批等待与验证码
      notices.ts            消息模板
      outbox.ts             主动推送队列
      selection.ts          每人的会话选择
      format.ts             文本工具
    catalog.ts            按 Workspace 分组的 Session 目录（与侧边栏一致）
    observation.ts        见过的企微用户/会话（含被拒绝）
    rounds.ts             每条消息的一轮记录 → round.complete
    turns.ts              从 Session 日志汇总一个回合
    journal.ts            JSONL 日志、DSH home 解析、脱敏
    status.ts             连接状态与计数
    routes.ts             已认证的状态接口
  client/                 插件主页（React TSX，esbuild → dist/client.js）
    index.tsx             注册到 plugins.bundle.config
    components/           状态栏、风险提示、凭据、会话选择、来源选择、高级设置
    hooks.ts / api.ts     Config 表单、凭据、状态接口
    model.ts              纯函数：草稿、差异、校验、筛选
    styles.ts             基于 DSH 主题变量的样式
scripts/build-client.mjs  打包为 DSH 浏览器模块格式（React 与 DSH UI 组件由宿主提供）
test/                     node:test：Host 单元测试、页面渲染测试（react-test-renderer）
```

真实企业微信端到端送达需要本人在插件主页输入 Bot ID/Secret 后，用真实账号收发消息验证；平台限制以真实回执为准。
