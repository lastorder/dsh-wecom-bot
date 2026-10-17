# DSH × 企业微信智能机器人

基于 [`@wecom/aibot-node-sdk` 1.0.7](https://cdn.jsdelivr.net/npm/@wecom/aibot-node-sdk@1.0.7/README.md) WebSocket 长连接的 DeepSeek Harness 本地插件，无需公网回调地址：

- **每个企业微信用户/群都有自己的专属 DSH 会话**：用户私聊时一人一个会话，群聊时整个群共享一个会话，会话创建在插件配置的 Workspace 里；
- DSH 会话**本轮完成**、**需要你回答**或**请求权限**时，主动推送回**绑定这个会话的那个聊天**（管理员还可按 Workspace 订阅）；
- 在企业微信里直接发消息就能继续对话，还可 `/status`、`/new`、`/answer`、`/cancel`、`/approve`；
- 只有管理员能切换会话；绑定关系、Workspace、模型都能在插件主页上按 Workspace 分组查看与调整；
- 每条企微消息的原始请求、回复和元数据写入 DSH home 下的 JSONL 日志。

> 企业微信**智能机器人（API 模式 · 长连接）**使用 Bot ID + **Bot Secret**，不是群机器人 webhook key，也不是回调 Token/EncodingAESKey。请勿把 Secret 发进聊天或提交到仓库。

## 构建与安装

```sh
pnpm install          # esbuild 的安装脚本不需要运行（见 pnpm-workspace.yaml）
pnpm test             # 清理 → 构建 Host 与浏览器包 → 运行全部测试
```

DSH 加载 `dist/` 中的构建产物：Host 入口 `dist/host/index.js`，浏览器入口 `dist/client.js`。已发布到 npm 后可直接安装 [`dsh-wecom-bot`](https://www.npmjs.com/package/dsh-wecom-bot)；本地开发时在 DSH「插件」中以本目录绝对路径安装 bundle（bundle patch 会插入 `wecom-bot` 条目）。

**修改代码并重新构建后，需要重启 DSH 应用**：桌面版 profile 未开启 Host 源码热重载，禁用/启用插件不会替换已缓存的 Host 模块。接口已在 DSH `0.2.0-rc.2` 上核对。

## 会话、Workspace 与绑定

| 来源 | 会话 | 通知去向 |
| --- | --- | --- |
| 私聊（某个 userid） | 该用户**专属**的一个 DSH 会话 | 该用户的单聊 |
| 群聊（某个 chatid） | 该群**共享**的一个 DSH 会话 | 该群（对所有成员可见） |
| 管理员订阅的 Workspace | 不改变会话归属 | 管理员的单聊 |

- **绑定**：某个聊天第一次给机器人发消息时，插件创建一个绑定（`user:<userid>` 或 `group:<chatid>`），记录它使用的 Workspace、DSH 会话与模型，写入 `<DSH home>/wecom-bot/bindings.json`；重启后依然有效。通知接收人就是绑定这个会话的聊天，不再依赖"谁最近发过消息"。
- **会话创建**：绑定的会话为空时，收到下一条消息会在该绑定的 Workspace 里新建一个 DSH 会话并立即提交消息；会话已归档或已删除时会自动换一个新的（旧会话仍保留在 DSH 里，可用 `/new` 主动更换）。
- **默认 Workspace**：留空则使用 `<DSH home>/wecom-bot/workspace`（自动创建并注册到侧边栏，标题「企业微信」）；也可以在配置页选一个已存在的目录。
- **模型**：默认模型在创建会话时安装到该会话，留空表示跟随 DSH 当前默认模型；每个绑定可单独覆盖，还可以选思考强度。插件调用 DSH 的 `sessionController.selectModel` 设置会话级模型后会**把 DSH 默认模型恢复原状**，所以配置插件不会改变你在 DSH 界面新建会话时用的默认模型。
- 新会话在**第一次提交消息之前是"空会话"**，DSH 侧边栏和插件的会话下拉都会暂时不显示它，提交第一条消息后就正常出现。

## 在插件主页配置

打开 **设置 → 插件 → `dsh-wecom-bot`** 的 bundle 主页。页面自上而下：

1. **状态栏**：连接状态（在线 / 连接中 / 认证失败 / 被其他连接替换…）与本次启动以来的消息、拒绝、提交、推送计数。
2. **访问风险提示**：任一白名单留空都会醒目提示其含义。
3. **① 连接机器人（仅有的两项必填）**
   - **Bot ID**
   - **Bot Secret**：保存到 DSH 凭据库（引用名 `WECOM_BOT_SECRET`），插件 Config 只记录引用名；保存后不回显，留空表示保持不变。
4. **② 默认 Workspace 与模型**：新会话建在哪个 Workspace、默认用哪个模型（下拉列表来自 DSH 的模型目录）。
5. **③ 会话绑定**：按 Workspace 分组列出每个用户/群的绑定，可以逐个调整 Workspace、DSH 会话（该 Workspace 下的会话列表，或"自动创建"）、模型与思考强度，也可以手动新增或删除绑定。**这里的改动立即生效，不需要点保存**。
6. **④ 访问范围**：列出最近 24 小时**真正给机器人发过消息**的 userid 与会话 ID（单聊为对方 userid，群聊为 chatid），**包括被白名单拒绝的**，并标注"上次被拒绝 / 已接受"、最近时间与消息数；勾选即加入白名单，也可手动添加。
7. **⑤ 管理员**：管理员 userid（可多人），以及管理员可接收通知的 Workspace 范围；留空 = 全部 Workspace。
8. **⑥ 高级设置**（默认折叠）：远程审批、等待企微回复的秒数、私有化部署的 `wss://` 地址、JSONL 日志开关与保留天数、日志目录。

底部操作栏显示是否有未保存的更改，提供「放弃更改」「保存配置」——只用于 ①④⑤⑥ 这类插件设置；③ 的绑定改动是即时生效的。

### 访问控制：留空 = 全部允许

| 白名单 | 勾选后 | 留空时 |
| --- | --- | --- |
| 企微会话 | 只接受这些单聊/群聊的消息 | 接受任何会话 |
| 企微用户 | 只接受这些 userid 的消息 | 任何人 |

**两项都留空时，任何能给机器人发消息的人都会得到一个专属 DSH 会话，可以在默认 Workspace 里执行命令与修改文件。** 建议：只勾选你自己的 userid 与自己和机器人的单聊，并给默认 Workspace 选一个可以放心被改动的目录。群聊里的通知对全体群成员可见，请谨慎授权群聊。

被拒绝的消息**不会收到任何回复**（不暴露机器人存在），但会出现在「访问范围」列表供你审核。ID 列表只保存 ID、计数和最近一次判定，不保存消息正文；驻留内存，每类最多 200 条，DSH 重启后清空（**绑定关系不受影响**）。状态与绑定接口注册在 DSH Connection Fetch 通道（`/api/wecom-bot/state`、`/api/wecom-bot/bindings`），只有已登录的 DSH 页面可访问。

### 管理员与权限边界

- 普通用户**永远只能访问自己绑定的那个会话**：`/sessions`、`/use`、引用通知跳转都会被拒绝，也不会收到别人会话的通知。
- **管理员**（`adminUserIds`）可以：`/sessions` 按 Workspace 列出会话、`/use` 切换自己要操作的会话、`/reset` 回到自己的专属会话、引用任意通知直接跳转到那个会话；并按 `adminWorkspaces` 接收这些 Workspace 中**所有会话**的通知（留空 = 全部 Workspace，会比较吵）。
- 管理员配置在插件主页的「⑤ 管理员」中维护，也可以直接改 Config 的 `adminUserIds` / `adminWorkspaces`。

## 企业微信指令

| 指令 | 作用 | 谁可以用 |
| --- | --- | --- |
| `/help` | 查看命令 | 所有人 |
| `/status` | 查看当前会话、绑定的 Workspace/模型与待处理请求 | 所有人 |
| `/new` | 换一个新的专属会话（旧会话仍保留在 DSH 中） | 所有人 |
| `/cancel` | 停止当前会话正在运行的回合 | 所有人 |
| `/answer <验证码> [题目ID] <选项序号或文字>` | 回答 DSH 的提问；只有一道题时可省略题目 ID；多选用 `1,3` | 所有人 |
| `/approve <验证码>`、`/deny <验证码>` | 远程审批（需在高级设置中开启，且只能在已授权用户的单聊中使用） | 所有人（单聊） |
| `/whoami` | 查看自己的 userid、绑定与管理员身份 | 所有人 |
| `/sessions` | 按工作区列出可切换的会话，带序号、名称、运行状态和 ID 前缀（最多 30 条） | 仅管理员 |
| `/use <序号 \| 会话ID前缀>` | 切换自己要操作/接收通知的会话；序号来自你最近一次 `/sessions`，ID 前缀至少 6 位且需唯一 | 仅管理员 |
| `/reset` | 放弃切换，回到自己的专属会话 | 仅管理员 |
| 引用（回复）DSH 发来的某条通知 | 把之后的消息（含斜杠命令）直接定位到那条通知所属的会话 | 仅管理员 |
| 直接发送文字 | 提交到当前会话（`mode: queue`） | 所有人 |

- 完成通知只包含该回合**最后一条助手文字**，不外发推理、工具参数或附件；子代理会话的回合不推送。非"正常完成"的回合（取消、出错）只在有企微消息在等它时推送。
- 提问在企微等待（默认 60 秒）期间 DSH 页面不显示该提问，超时后回到 DSH 页面；**计划审阅与带详细内容的提问只能在 DSH 页面处理**。
- 验证码为 6 位一次性随机码，绑定到具体的那次提问/审批，过期或旧码无法重放。
- **引用定位的原理**：企业微信的引用回调只回传被引用消息的内容，不回传它的 ID，所以每条通知末尾都带一行 `/use <会话ID片段>` 的提示；插件在收到引用时从这段被回传的文字里把 ID 片段抠出来，按 `/use` 同样的规则解析成会话。无法解析（比如引用了一条无关消息，或该会话不在你的 Workspace 范围内）时什么都不会改变。

### 消息排版

命令回复与通知都由同一套模板生成（[`notices.ts`](src/host/bridge/notices.ts)），结构固定、一眼能扫：

```markdown
**🔄 已切换到《Alpha 任务》**

- **Workspace**：dsh-workpet
- **会话 ID**：`session-1ab2cd3ef4…`

现在直接发送消息即可继续该会话；发送 `/reset` 可以回到自己的专属会话。
```

- 第一行是 `**🏷 标题** · 《会话名》`——谁在说话、哪件事、属于哪个会话；命令名用 **粗体**，ID 与可以照抄的命令用 `行内代码`；
- 上下文（Workspace、用时、步数、`/cancel` 提示）放在引用块（`>`）里；
- 明细一律是扁平的 `- **字段**：值`，**不用表格、不用嵌套列表**（企业微信的 Markdown 渲染器不支持，会原样输出）；
- 每条与会话有关的通知末尾都带 `引用（回复）这条消息，或发送 /use <会话ID片段>`，引用它就能继续那个会话；
- 所有来自 DSH 的字符串（会话标题、工具名、提问文字）都会把 Markdown 元字符换成同形字符，不会被渲染成链接、@ 提及或标签。

发送 `/help` 即可在企业微信里看到全部命令。

## JSONL 对话日志

位置：`<DSH home>/wecom-bot/logs/YYYY-MM-DD.jsonl`（DSH home 为 `$DSH_HOME`，默认 `~/.dsh`），目录权限 `0700`、文件 `0600`，按保留天数（默认 14 天）自动清理。每行一个 JSON 对象，公共字段 `ts`、`seq`、`level`、`event`。

**每条企微消息对应一行 `round.complete`**，汇总一轮对话：

```json
{"ts":"…","seq":42,"level":"info","event":"round.complete","roundId":"…","outcome":"turn-ended",
 "chatId":"zhangsan","userId":"zhangsan","chatType":"single","msgId":"…",
 "sessionId":"…","sessionTitle":"修复登录 Bug","workspace":"企业微信","requestId":"…",
 "request":{"msgtype":"text","text":"帮我修复登录"},
 "response":{"replies":["**🚀 已提交给 DSH** · 《修复登录 Bug》…"],"reason":"completed","assistant":"已修复……","notifiedChats":["zhangsan"]},
 "metadata":{"turn":3,"model":{"provider":"…","model":"…"},"steps":4,"toolCalls":{"bash":2},"turnDurationMs":51234},
 "timing":{"receivedAt":"…","submittedAt":"…","completedAt":"…","totalMs":53012}}
```

`outcome` 取值：`turn-ended`（DSH 回合结束）、`command`、`rejected`、`unsupported`、`blocked`、`prompt-failed`、`interrupted`、`expired`。

明细行（用 `roundId` / `requestId` / `sessionId` 关联）：

| event | 内容 |
| --- | --- |
| `wecom.message` | 收到的原始回调帧（含被拒绝的消息）与访问判定 |
| `wecom.quote` | 引用定位的解析结果：抠出的 ID 片段（`hint`）、命中的 `sessionId`，或未解析时的原因（`outcome`，如 `not-admin`） |
| `wecom.reply` | 被动回复的原始请求（streamId、内容）与服务器回执 |
| `dsh.prompt` | 提交给 DSH 的原始请求与返回值 / 错误 |
| `dsh.turn.end` | 回合结束原因、助手文字、模型、步数、工具调用统计 |
| `wecom.send` | 主动推送的原始请求体与回执 |
| `wecom.notify.skipped`（`warn`） | 该会话没有任何绑定，也不在任何管理员的通知范围内，因此无人可通知 |
| `binding.session.created` / `binding.session.replaced`（`warn`） | 为一个绑定创建了新会话；或原会话已归档/不可用而换了新会话 |
| `binding.session.reset`、`session.created`、`wecom.selection` | `/new`、首次路由、管理员切换会话 |
| `binding.store.error` / `binding.view.error`（`warn`） | 绑定文件读写或读取绑定视图失败 |
| `dsh.question*` / `dsh.approval*` | 提问、审批及其答复 |
| `connection.phase`、`config.applied`、`wecom.sdk` | 连接状态变化、生效配置（不含 Secret）、SDK 日志 |

Secret 值、`secret`/`token`/`authorization` 等字段、`response_url`、媒体 `url` 与 `aeskey` 一律脱敏。日志包含对话原文，请按敏感数据管理；不需要时可在高级设置中关闭。

## 从 0.2.x 升级

- Config 里的 `sessionIds`（DSH 会话白名单）已被**绑定**取代：升级后该字段会被忽略，可以手动从 profile 配置里删掉。非管理员不再需要选会话——第一条消息就会自动创建专属会话。
- 原有的 `chatIds` / `allowedUserIds` 白名单保持不变，仍然决定"谁能跟机器人说话"。
- 旧的 `sessionIds` 里勾选的会话不会自动变成绑定；需要时可用管理员账号 `/use` 切过去，或在配置页里手动把某个绑定指向那个会话。
- 绑定文件是新增的 `<DSH home>/wecom-bot/bindings.json`；删除它等于清空所有路由（下一次消息会重新创建）。

## 已知限制

- **群聊必须 @ 机器人**：企业微信只会把 @ 了机器人的群消息推给它，没 @ 的消息服务器那一层就不转发——插件连回调帧都收不到，无法处理。这是平台限制，不是插件的开关。
- **@ 不会被平台摘掉，位置会影响解析**：实测确认企业微信不会把 "@显示名" 从正文里去掉，它停在发送者打字时光标所在的位置。插件会去掉**消息最开头**连续的一个或多个 `@xxx ` 提及（命令解析、提交给 DSH 的内容都基于去掉之后的文本），消息中间的 @ 则原样保留，当作用户确实想说的话。
- **群聊"话题"（thread）里 @ 机器人，目前收不到消息**：这是用户实测观察到的现象，我们没有查到官方文档确认具体原因（未联网核实），推测大概率是当前 `@wecom/aibot-node-sdk`（进而是企业微信智能机器人 API 本身）还没有把"话题"当作一种消息来源对接——SDK 的消息类型定义（`BaseMessage` 等）里完全没有 `thread_id` / `root_msgid` 这类字段，拿到的回调结构和普通群消息没有任何区别的字段可用来判断"这是不是来自某个话题"。
- **机器人发的消息不能开成一个新话题**：同样没有找到对应能力。SDK 里所有「主动发送」「被动回复」相关的类型（`SendTextParams`、`SendMarkdownParams`、`StreamReplyBody`、`SendMsgBody` 等）都只接受 `chatid`/`msgid`，没有任何话题相关的参数可以传——即使想做，目前这版 SDK 也没有暴露这个能力。

**现在的结论**：这两条先记录下来，不在本插件这一层做任何尝试性的绕过（没有可靠的字段/参数可用，勉强做容易做出"看起来支持、实际不可靠"的功能）。等以后企业微信或 `@wecom/aibot-node-sdk` 真的加上话题相关的字段或参数，可以考虑：

- **收消息**：如果回调里出现了类似话题 ID 的字段，可以比照现有的"引用定位"机制，把"同一个话题里的消息"自动路由到同一个 DSH 会话——不需要每次都 `/use` 或引用，天然用话题分组多个并行任务。
- **发消息**：如果发送 / 回复 API 支持指定话题，完成通知可以发回触发它的那个话题里，而不是群的主干道，长时间跑的任务也不会刷屏主群。

## 代码结构

```text
src/
  shared/protocol.ts      Host 与页面共享的常量、绑定/模型/状态接口类型
  host/                   DSH Host 插件（Node ESM，tsc → dist/host）
    index.ts              入口：Config、inject、apply（注册两个已认证接口）
    config.ts             Config schema 与规范化（策略：白名单、默认 Workspace/模型、管理员）
    runtime.ts            宿主生命周期编排：配置/凭据变化时重建连接；唯一的 session/event 监听
    bindings.ts           绑定存储：<DSH home>/wecom-bot/bindings.json（原子写、私有权限）
    routing.ts            绑定 → 会话路由（首次接触即创建绑定）
    sessions.ts           会话供给：创建会话、安装模型、描述会话状态
    workspaces.ts         默认/自定义 Workspace 的解析与注册
    models.ts             DSH 模型目录与「安装会话级模型后恢复默认模型」
    bindings-view.ts      配置页的绑定表格（读取 + 校验并应用编辑）
    bridge/               一条企微连接：
      index.ts              组装、入站处理、路由、通知/提问/审批
      inbound.ts            回调帧校验与防重放
      policy.ts             访问白名单 + 管理员判定
      directory.ts          管理员可操作会话（目录 ∩ Workspace 范围）与 /use 解析
      commands.ts           斜杠命令（切换会话仅管理员）
      interactions.ts       提问/审批等待与验证码
      notices.ts            消息模板
      outbox.ts             主动推送队列
      selection.ts          管理员的会话切换
      format.ts             文本工具
    catalog.ts            按 Workspace 分组的 Session 目录（与侧边栏一致）
    observation.ts        见过的企微用户/会话（含被拒绝）
    rounds.ts             每条消息的一轮记录 → round.complete
    turns.ts              从 Session 日志汇总一个回合
    journal.ts            JSONL 日志、DSH home 解析、脱敏
    status.ts             连接状态与计数
    routes.ts             已认证的状态与绑定接口
  client/                 插件主页（React TSX，esbuild → dist/client.js）
    index.tsx             注册到 plugins.bundle.config
    components/           状态栏、风险提示、凭据、Workspace/模型、绑定表格、访问范围、管理员、高级设置
    hooks.ts / api.ts     Config 表单、凭据、状态接口与绑定提交
    model.ts              纯函数：草稿、差异、校验、绑定分组、模型选项
    styles.ts             基于 DSH 主题变量的样式
scripts/build-client.mjs  打包为 DSH 浏览器模块格式（React 与 DSH UI 组件由宿主提供）
scripts/preview.mjs       用样例数据离屏渲染配置页（preview/*.png）
test/                     node:test：Host 单元测试、绑定存储、页面渲染测试（react-test-renderer）
```

真实企业微信端到端送达需要本人在插件主页输入 Bot ID/Secret 后，用真实账号收发消息验证；平台限制以真实回执为准。
