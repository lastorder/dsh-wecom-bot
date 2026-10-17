# DSH × 企业微信智能机器人

把 **DeepSeek Harness** 接到**企业微信智能机器人**（API 模式 · 长连接）：在企微里给机器人发消息，就是在对 DSH 里的会话说话。走 [`@wecom/aibot-node-sdk` 1.0.7](https://cdn.jsdelivr.net/npm/@wecom/aibot-node-sdk@1.0.7/README.md) 的 WebSocket 长连接，**不需要公网回调地址**，一台能出网的机器就够。

DSH 里的会话跑完一轮、需要你回答、或者需要审批工具调用时，机器人会主动推回企微 —— 于是"用 DSH"这件事不再被绑在电脑前。

## 使用场景

它解决的问题只有一个：**让你和你的同事，不坐在 DSH 前面也能用它**。落地下来是两种用法，可以同时存在。

### 场景一 · 用手机遥控你自己的 DSH

把自己的企微账号设成**管理员**（admin），手机上的企业微信就成了 DSH 的遥控器：**任意一个会话**都能查看、切换、推进，而不只是机器人给你开的那个。你在电脑上开的会话，手机上接着聊就行。

**怎么搭（十分钟）**

1. 装插件、填 Bot ID + Secret —— 见「[快速开始](#快速开始)」；
2. 先给机器人发一条消息，让它出现在插件主页的「③ 未授权用户」里（那里能看到你的 userid），再到「④ 管理员 → 添加」里选中你自己。管理员由配置直接信任，**不需要加入任何分组**就能用 —— 所以刚装好插件也不会把自己锁在外面；
3. 可选但推荐：展开「④ 管理员 → 可接收通知的 Workspace」勾选你关心的目录。留空（默认）＝ **全部 Workspace 的所有会话**都通知你，`/sessions` 也能列出它们；收窄范围会同时收窄这两件事。

**日常怎么用**

| 你想做的事 | 在企微里 |
| --- | --- |
| 看有哪些会话 | `/sessions`（按 Workspace 分组列出，带序号、名称、运行状态） |
| 切到某个会话继续推进 | `/use <序号>`，或直接**引用**那条通知 |
| 开一个新会话 | `/new`（建在你用 `/workspaces` 选定的默认 Workspace 里） |
| 看当前会话的状态 | `/status`（模型、effort、preset、上下文占用、第几轮） |
| 放行 / 拒绝工具调用 | `/approve <验证码>` / `/deny <验证码>`（需在「⑤ 高级设置」打开「远程审批」） |
| 回答 DSH 的提问 | `/answer <验证码> <选项序号或文字>` |
| 停止正在跑的回合 | `/cancel` |
| 腾出上下文 / 清空记忆 | `/compact`、`/delete`（先回一条警告，再 `/delete confirm`） |
| 回到自己的专属会话 | `/reset` |
| 直接发文字 | 提交到当前会话 |

**为什么够用**：DSH 里一轮跑完，通知会推到你的单聊，末尾带一行 `/use <会话ID片段>` —— **引用那条通知**，之后你发的消息（包括斜杠命令）就直接落在那个会话上。不用记 ID，翻到哪条通知就接着聊哪条。

**先说清楚的边界**：计划审阅、带详细内容的提问只能在 DSH 页面处理；完成通知只带该回合**最后一条助手文字**，不外发推理、工具参数或附件；管理员命令只能在单聊里发。

### 场景二 · 把 DSH 环境做成分享给同事的机器人

把一个「配好的 DSH 环境」变成机器人：给它一个专属 Workspace，接上必要的 **MCP**、放好 **skills**、做一个调过的 **agent preset** —— 同事私聊它，或者在群聊里 @ 它，用的就是这个环境。你把环境调教一次，团队随手就能用。

**怎么搭**

1. **先在 DSH 里把环境准备好**：选定或新建一个 Workspace，接上要用的 MCP，放好 skills，需要的话做一个专门的 agent preset。这些都归 DSH 自己管，插件不接管 —— 插件只负责"谁、在哪个环境里、跟你说话"；
2. **在插件主页建一个分组**（「② 用户分组 → 添加分组」）：指向那个 Workspace，选好模型（含思考强度 effort）与 preset。**分组＝一份策略**：一个 Workspace + 一个模型 + 一个 preset；
3. **把人或群聊放进分组**：让对方先给机器人发一条消息，再到「③ 未授权用户」里选中分组、顺手填个备注名、确认 —— 授权完成，机器人会给他发一条「管理员已授权，可以开始使用了」。群聊同理（把那个群加进分组）。

**他们看到什么**

- **私聊一人一个会话**，都建在分组指定的 Workspace 里；**群聊整个群共享一个会话**，谁说话都是同一条线（这也是"群聊里不能替大家审批、切换会话"的原因）；
- 会话标题是 `wecom-bot-<userid>`（群聊用 `wecom-bot-<群 chatid>`），在 DSH 侧边栏一眼看出这是谁的；
- 成员能用自己会话范围内的那一套命令（`/status`、`/compact`、`/delete`、`/cancel`、`/answer`、`/whoami`、`/help`）加直接发消息；**管理员命令与审批永远不属于成员** —— 工具调用审批只发给管理员，群里和成员单聊里都收不到；
- 群里必须 **@ 机器人**，企业微信才会把消息推给它：没 @ 的消息服务器那一层就不转发，插件连回调帧都收不到。这是平台限制，不是插件的开关。

**想给不同团队不同待遇**：再建一个分组就行。研发组指向代码库那个 Workspace，市场组指向另一个，互不影响。注意改某个分组的 Workspace，会让这个组的成员换到新目录**重新开会话** —— DSH 不允许一个会话静默搬家。

| | 场景一 · 遥控自己的 DSH | 场景二 · 分享给团队 |
| --- | --- | --- |
| 谁在说话 | 你自己（管理员） | 同事、群聊里的所有人 |
| 会话归属 | 你想操作哪个就 `/use` 哪个 | 一人一个私有会话；群聊共享一个 |
| 权限 | 全部命令 + 审批 | 自己会话范围内的命令，**不含**审批与管理员命令 |
| 关键配置 | 管理员名单 + 通知范围 | 分组（Workspace / 模型 / preset）+ 成员授权 |
| 典型用途 | 手机上查看进度、审批、推进长任务 | 团队随手问，把 MCP / skills 的能力给人用 |

## 快速开始

### 1. 安装插件

已发布到 npm：[`dsh-wecom-bot`](https://www.npmjs.com/package/dsh-wecom-bot)。在 DSH 的「插件」里安装时**写上版本号**，例如 `dsh-wecom-bot@0.5.0`；本地开发时改成**这个仓库的绝对路径**（bundle 的 patch 会往 profile 里插入一条 `wecom-bot` 条目）。

> **只写包名会装成旧版本。** pnpm 11 起默认 `minimumReleaseAge: 1440`，只解析**发布满 24 小时**的版本（[缓解供应链攻击](https://pnpm.io/zh/supply-chain-security)）；`pnpm add dsh-wecom-bot` 和 `dsh-wecom-bot@latest` 因此会静默选中「一天以前的最新版本」，而不是刚发布的那个。0.5.0 刚发布时这样装会得到 0.2.1 —— 一个根本不读 `settings.json` 的旧版本，装完机器人等于没有任何管理员和分组。写精确版本（`@0.5.0`）就能正常装：pnpm 会把这一条记进 profile 的 `pnpm-workspace.yaml`（`minimumReleaseAgeExclude`），这是官方允许的唯一放行方式。

安装完即时生效，不需要重启（bundle 会被直接应用到当前 profile）。但**改完插件代码重新构建之后必须重启 DSH**：桌面版 profile 未开启 Host 源码热重载，禁用/启用插件不会替换已缓存的 Host 模块。从本地路径安装换成 npm 包安装（或反过来）也属于同一种「模块换位置」，同样要重启一次。

### 2. 连接机器人

在 **设置 → 插件 → `dsh-wecom-bot`** 的 bundle 主页填「**① 连接机器人**」（仅有的两项必填）：

- **Bot ID**：写进配置；
- **Bot Secret**：保存到 DSH 凭据库（引用名 `WECOM_BOT_SECRET`），插件 Config 只记录引用名，保存后不回显。

> 企业微信**智能机器人（API 模式 · 长连接）**使用 Bot ID + **Bot Secret**，不是群机器人 webhook key，也不是回调 Token / EncodingAESKey。请勿把 Secret 发进聊天或提交到仓库。

### 3. 选一条路走

- **场景一** → 把自己加进「④ 管理员」。提示：先给机器人发一条消息，你的 userid 会出现在「③ 未授权用户」和「④ 添加」的候选列表里。
- **场景二** → 建一个「② 用户分组」，指向你配好的 Workspace，然后把同事或群聊授权进去。

### 4. 在企微里试一句

私聊机器人（或群里 @ 它）发送 `/help`。如果收到「用户未授权，请联系管理员」，说明你在等一次授权 —— 你会同时出现在插件主页的「③ 未授权用户」里，管理员在那里选中分组即可。

## 核心概念：分组、成员、会话

插件把"谁能跟机器人说话"和"他的会话建在哪里"合并成了一件事：**分组**。

| 概念 | 含义 |
| --- | --- |
| **分组** | 一份策略：一个 Workspace + 一个模型（含思考强度 effort）+ 一个 agent preset（默认的「默认分组」不可删除） |
| **成员** | 一个被授权的企微主体：私聊里的人（userid）或一个群聊（chatid） |
| **会话** | 成员在它所属分组的 Workspace 里拥有/共享的那个 DSH 会话 |
| **备注** | 给成员起的名字，设置后界面与 `/status` 都优先显示它，而不是企微 ID |
| **preset** | DSH 的 agent preset（决定这个会话能用哪些工具、带哪些提示段），只在**新建会话时**生效 |

- **授权 = 加入分组**：只有属于某个分组的成员（以及管理员）会得到回复。不在任何分组里的人发消息会收到一条固定回复「**🔒 用户未授权** · 请联系管理员把你加入分组后再试」，同时出现在插件主页的「未授权用户」卡片里，连同他最后一条消息的摘要；在那里选择分组、可选填备注并确认，就完成了授权，机器人随即给他发一条「管理员已授权，可以开始使用了」。
- **管理员始终可以发消息**：管理员名单由插件自己的设置直接信任，无需入组，会被隐式放进「默认分组」；这份名单存在 `<DSH home>/wecom-bot/settings.json`，不在 DSH 的插件 Config 里。
- **会话创建**：成员的会话为空时，收到下一条消息会在**其分组的 Workspace** 里新建一个 DSH 会话并立即提交消息；会话已归档或已删除时会自动换一个新的。想主动换一个：发 `/delete`（再 `/delete confirm`）或在插件主页点成员行尾的「归档会话」。
- **默认分组的 Workspace**：留空即插件自带目录 `<DSH home>/wecom-bot/workspace`（自动创建并注册到侧边栏，标题「企业微信」）；也可以选一个已存在的目录。
- **模型与 effort 属于分组**：分组选定模型（与思考强度 effort）后，会在创建会话时安装为会话级模型，也适用于该分组已存在的会话；留空表示跟随 DSH 当前默认模型。插件调用 DSH 的 `sessionController.selectModel` 设置会话级模型后会**把 DSH 默认模型恢复原状**，所以配置插件不会改变你在 DSH 界面新建会话时用的默认模型。
- **preset 属于分组，且是一次性的创建事实**：成员的新会话会按分组的 preset 组装（这个部署没有可选的 preset 时跟随 DSH 默认）。改分组的 preset 只影响**此后新建的会话**——DSH 不允许改写已经开始过一轮的会话，想换 preset 就归档当前会话。
- **换 Workspace 会换会话**：分组的 Workspace 一改，该分组成员记录的会话 id 会被清空，下一条消息在新目录里重新建会话（否则"分组的 Workspace"就是一句空话）。
- **删除分组会取消授权**：删掉一个分组时，组内成员一并被移出（不删 DSH 里的会话），他们会重新出现在「未授权用户」里，需要时再授权一次。这是刻意的：删除分组绝不应该悄悄把成员升级到默认分组的 Workspace。
- 新会话在**第一次提交消息之前是"空会话"**，DSH 侧边栏会暂时不显示它，提交第一条消息后就正常出现；管理员刚用 `/new` 建出的会话可以直接用，不必等它显示出来。
- **机器人建的会话会自己命名**：标题是 `wecom-bot-<userid>`（单聊）或 `wecom-bot-<群聊 chatid>`，也就是这个会话属于谁；这是显式设置的标题，DSH 不会再拿第一句话去生成标题（也省掉一次模型调用）。它和会话里的内容无关，改名只影响侧边栏显示。

## 在插件主页配置

打开 **设置 → 插件 → `dsh-wecom-bot`** 的 bundle 主页。页面只有五张卡片，默认显示的尽量少，需要什么点什么；**每张卡片各存各的**，底部的「保存配置」已经去掉了：

> **什么时候会重连机器人**：只有**连接身份**变了才会 —— Bot ID、Bot Secret、WebSocket 地址。这三项之外的一切（管理员、通知范围、等待时间、远程审批、日志开关与保留天数）都写在插件自己的**一个文件**里：`<DSH home>/wecom-bot/settings.json`（`"version": "0.5"`），它同时装着设置块、分组、成员、备注和每位管理员的默认 Workspace。保存后**立即对运行中的机器人生效，不会断开正在进行的对话**；DSH 的插件 Config 里只剩 Bot ID 与 Secret 的引用名。

![插件主页：连接、用户分组、未授权用户、管理员、高级设置五张卡片](https://raw.githubusercontent.com/lastorder/dsh-wecom-bot/main/preview/settings.png)

每个人的详情（类型、企微 ID、可编辑的备注，以及他的会话、移动分组、移出分组）都在**点小图标弹出的窗口**里；列表本身只负责看：

![点人员行左侧的小图标，弹出人员详情](https://raw.githubusercontent.com/lastorder/dsh-wecom-bot/main/preview/settings-dialog.png)

归档一个成员的会话只要一次确认；确认后下一条消息会按分组当前的配置新建会话：

![归档会话前的确认弹窗](https://raw.githubusercontent.com/lastorder/dsh-wecom-bot/main/preview/settings-archive.png)

全新安装（还没有任何成员、任何管理员）时整页只有折叠的标题行，一屏放得下：

![全新安装时的插件主页](https://raw.githubusercontent.com/lastorder/dsh-wecom-bot/main/preview/settings-empty.png)

1. **① 连接机器人**（仅有的两项必填）
   - **Bot ID**
   - **Bot Secret**：保存到 DSH 凭据库（引用名 `WECOM_BOT_SECRET`），插件 Config 只记录引用名；保存后不回显，留空表示保持不变。
   - 改了任意一项，卡片底部才出现「保存 / 放弃」；保存成功会短暂显示「已保存。」，不会留下常驻提示。
2. **② 用户分组**：每个分组是一张可折叠的卡片，标题行给出「N 位成员 · Workspace · 模型 · effort · preset」的概览，每一项都带自己的标签（例如 `模型 DeepSeek Reasoner · effort 高 · preset PTC`）；跟随 DSH 默认的模型与 preset 标成 `（DSH 默认）` 并写出实际生效的名字。**点击标题行才展开**成员列表：
   - 行尾的「**编辑**」点下去会**变成「保存」**：名称、Workspace、模型、effort、preset 一次性组成一份草稿，点「保存」才提交（旁边有「取消」放弃）。默认分组没有删除按钮。effort 下拉只在所选模型支持思考强度时可选，preset 列表来自 DSH 的 preset registry（这个部署没挂 registry 时只有「跟随 DSH 默认」）。
   - **添加分组**会立刻建一个默认名字的分组，并**直接打开它的完整编辑框**——不用先起名再编辑。
   - **每个成员一行**：左边是**彩色小图标**（蓝色=个人，琥珀色=群聊，右下角带一支铅笔表示可点）、名字（没有备注时才是企微 ID）、管理员标记，然后依次是**会话名**（含运行指示与状态）、**preset**、**当前模型**、**effort**、**上下文占用**（如 `12.3k / 128k（10%）`），行尾是「**归档会话**」。**只有那个小图标**会打开人员详情；文字上不再写"个人/群聊"。
   - 添加成员不再有单独的按钮：给机器人发消息的人在「未授权用户」里授权，就是加成员的唯一入口。
   - **这里的改动立即生效，不需要点保存**。
3. **③ 未授权用户**：给机器人发过消息、但不在任何分组里的人，按时间倒序，附带最后一条消息的摘要；点「加入分组」选择分组（可填备注）并确认，即完成授权，机器人会给他发一条授权提示。**列表只在内存中**，重启 DSH 后清空（授权本身是持久化的）。这里同样优先显示备注名。
4. **④ 管理员**：管理员列表用的是同一套人员行——点小图标弹出人员详情（类型、企微 ID、所属分组、备注），**备注即时生效**、与分组成员共用同一个名字；「移除管理员」在详情窗口底部，**加人、移除、改通知范围都不需要再点保存**：选中/移除即写入插件设置，**不会重连机器人**（决定是你当场做的，所以不用再点一次确认）。
   - 列表为空时显示一个「添加管理员」按钮；不为空时卡片右上角有一个「添加」。两者打开同一个**带搜索框的已知用户列表**：候选人是未授权用户和已授权成员，**优先显示备注名**、没有备注才显示企微 ID；找不到时也可以直接按 userid 添加。
   - 「可接收通知的 Workspace」**默认折叠**，展开后是勾选列表。配置留空（默认）时**全部勾选**、表示不收窄范围；取消勾选某个 Workspace 后，存的就是剩下勾选的那些路径，全勾回去又回到留空。只有归档会话的 Workspace 也会列出来（除非已被删除）。勾选/取消即生效。
5. **⑤ 高级设置**（默认折叠）：远程审批、等待企微回复的秒数、私有化部署的 `wss://` 地址、JSONL 日志开关与保留天数、日志目录；自带「保存 / 放弃」。这一卡里**只有 WebSocket 地址**属于连接身份，保存它会重连机器人；其余几项保存后立即生效，**日志开关与保留天数也不需要重启 DSH**。

> 截图由 `pnpm run preview` 用样例数据离屏渲染生成（`--dark` 深色版 `preview/settings-dark.png`、`--advanced` 展开通知范围的版本 `preview/settings-advanced.png`、`--dialog` 人员详情窗口、`--picker` 添加管理员窗口 `preview/settings-picker.png`、`--archive` 归档确认窗口），改页面后重新跑一次即可更新。

## 授权与权限边界

- 只有**分组里的成员**和**管理员**能让机器人干活；其它人发来的消息不会提交给 DSH，只会收到「用户未授权」并在「未授权用户」里留一行。
- 普通用户**永远只能访问自己名下的那个会话**：`/sessions`、`/use`、`/new`、`/workspaces`、引用通知跳转都会被拒绝，也不会收到别人会话的通知。自己的会话可用 `/compact` 压缩上下文、用 `/delete`（再 `/delete confirm`）归档。
- **管理员**（`adminUserIds`）可以：`/sessions` 按 Workspace 列出会话、`/use` 切换自己要操作的会话、`/workspaces` 选一个默认 Workspace、`/new` 在那个 Workspace 新建会话并切换过去、`/reset` 回到自己的专属会话、引用任意通知直接跳转到那个会话；并按 `adminWorkspaces` 接收这些 Workspace 中**所有会话**的通知（留空 = 全部 Workspace）。**工具调用审批只发给管理员**，群聊和普通用户的单聊永远收不到审批请求。
- **管理员命令只能在单聊里发送**：群聊里的会话是所有人共用的，`/new`、`/workspaces`、`/sessions`、`/use`、`/reset`、`/approve`、`/deny` 在群里一律被拒绝（回「管理员命令只能在单聊中使用」，不会被执行）；`/compact`、`/delete` 在群里只有管理员能用，群成员发会收到一条专门的说明：「群聊的会话记录只有管理员可以归档/压缩……如果你想处理的是自己的专属会话，请在与机器人的单聊里发送这条命令」。
- 管理员名单（`adminUserIds`）与通知范围（`adminWorkspaces`）在插件主页的「④ 管理员」中维护，存在插件自己的 `<DSH home>/wecom-bot/settings.json` 里：改动即时生效、**不会重连机器人**。DSH 的插件 Config 里只有 `botId` 与 Secret 的引用名。
- 撤销授权有两种方式：在成员详情窗口底部点「移出分组」，或删掉整个分组。两者都不会删除 DSH 里已有的会话，也不会忘记这个人的备注。
- **备注属于人，而不是属于某次授权**：它和分组、成员、设置一起存在 `settings.json` 的 `labels` 里，但独立于授权——移出分组、删掉分组、甚至从未进过分组的管理员，备注都还在，下次授权同一个人时自动恢复显示。

## 通知、提问与审批

- **一轮跑完推给谁**：推给"属于这个会话的人"——成员的会话推给他那个聊天；管理员按 `adminWorkspaces` 范围接收这些 Workspace 里**所有会话**的通知（留空 = 全部）。谁都不该收到时记一条 `wecom.notify.skipped`，不会静默丢消息。
- **通知内容**：只有该回合最后一条助手文字，不外发推理、工具参数或附件；**子代理会话的回合不推送**；非"正常完成"的回合（取消、出错）只在有企微消息在等它时推送。
- **提问**：DSH 提问后，等待企微回答（默认 60 秒，见高级设置）；这段时间 DSH 页面不显示该提问，超时后回到 DSH 页面。用 `/answer <验证码> <选项序号或文字>` 回答；**计划审阅与带详细内容的提问只能在 DSH 页面处理**。
- **审批**：`/approve`、`/deny` 需要先在高级设置里打开「远程审批」，且只能在**管理员**的单聊里使用。验证码是 6 位一次性随机码，绑定到具体的那次提问/审批，过期或旧码无法重放。

## 内存里保留了什么

- 「未授权用户」列表：被拒绝主体的 ID、次数、最近时间，以及**最后一条消息的摘要**（单行、最多 120 字）。这是为了让管理员能认出敲门的人是谁。
- **被接受的正常消息不保留正文**；只有被拒绝的消息会留下摘要。
- 所有这些都只驻留内存（最多 200 条、24 小时过期），DSH 重启即清空。
- **持久化的东西都在一个文件里**：`<DSH home>/wecom-bot/settings.json`（`"version": "0.5"`，权限 `0600`、原子写入）。它装着设置块（管理员、通知范围、WebSocket 地址、等待时间、远程审批、日志开关与保留天数）、分组、成员、备注，以及每位管理员自己的默认 Workspace——不再有第二个状态文件。版本号对不上（或内容读不出来）的文件不会被猜测着读或就地覆盖，而是改名成 `settings.json.v<旧版本>`（读不出来的用 `settings.json.corrupt`）放在旁边，插件从空状态开始；想留用里面的内容，照它的 userid/chatid 在页面上重新加一次即可。

状态与编辑接口注册在 DSH Connection Fetch 通道（`/api/wecom-bot/state` 读取状态、`/api/wecom-bot/store` 应用页面上的一切修改），只有已登录的 DSH 页面可访问。

## 企业微信指令

| 指令 | 作用 | 谁可以用 |
| --- | --- | --- |
| `/help` | 查看命令 | 所有人 |
| `/status` | 当前会话的完整状态：会话名、Workspace、preset、模型、effort、上下文占用、第几轮/共几步、运行状态、分组、绑定与待处理请求 | 所有人 |
| `/compact` | 压缩当前会话的上下文（把较早的历史折成一条摘要），回复合并了多少条历史、释放了多少 tokens | 所有人（群聊需管理员） |
| `/delete` | 归档当前会话：**会清空它的记忆**，下一条消息按分组当前配置新建会话。先回一条警告，再发 `/delete confirm` 才执行 | 所有人（群聊需管理员） |
| `/cancel` | 停止当前会话正在运行的回合 | 所有人 |
| `/answer <验证码> [题目ID] <选项序号或文字>` | 回答 DSH 的提问；只有一道题时可省略题目 ID；多选用 `1,3` | 所有人 |
| `/approve <验证码>`、`/deny <验证码>` | 远程审批（需在高级设置中开启，且只能在**管理员**的单聊中使用） | 仅管理员（单聊） |
| `/whoami` | 查看自己的 userid、所属分组与管理员身份 | 所有人 |
| `/new` | 在**你的默认 Workspace** 里新建一个会话并切换过去（新会话用 DSH 默认模型与 preset，不继承任何分组） | 仅管理员（单聊） |
| `/workspaces` | 列出 DSH 的 Workspace 与序号，以及你当前的默认 Workspace；`/workspaces 序号` 选定，`/workspaces 0` 取消限定 | 仅管理员（单聊） |
| `/sessions` | 按 Workspace 列出可切换的会话，带序号、名称、运行状态和 ID 前缀（最多 30 条）；选了默认 Workspace 时只列它下面的会话 | 仅管理员（单聊） |
| `/use <序号 \| 会话ID前缀>` | 切换自己要操作/接收通知的会话；序号来自你最近一次 `/sessions`，ID 前缀至少 6 位且需唯一 | 仅管理员（单聊） |
| `/reset` | 放弃切换，回到自己的专属会话 | 仅管理员（单聊） |
| 引用（回复）DSH 发来的某条通知 | 把之后的消息（含斜杠命令）直接定位到那条通知所属的会话 | 仅管理员（单聊） |
| 直接发送文字 | 提交到当前会话（`mode: queue`） | 所有人 |

- 没有权限时回复「**🔒 需要管理员权限**」；管理员命令发在群聊里回复「**🔒 管理员命令只能在单聊中使用**」；群聊里的 `/compact`、`/delete` 会说明「群聊的会话记录只有管理员可以…」并指向单聊。都不会静默失败。
- **`/delete` 是归档而不是删除文件**：DSH 没有删除会话的 API，归档会让这个会话不再被继续、历史不再进入任何请求，效果就是"记忆清零、下一条消息新开会话"；JSONL 会话文件仍留在磁盘上，需要时到 DSH 页面查看。
- `/new` 建出的会话属于"管理员自己开的会话"，不挂任何分组，所以模型与 preset 跟随 DSH 默认；想用某个分组的配置，就让那个分组的成员去用。
- **`/compact` 用的是 DSH 自己的压缩能力**，压缩的是当前会话的历史；这个服务由**会话自己的 agent preset** 提供（DSH 把 `compaction` 隔离在 preset 里，插件从 Agent 的上下文取，而不是从自己那一层），所以换了 preset 就跟着换实现；会话正忙时会拒绝并说明原因。
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
| `wecom.message` | 收到的原始回调帧（含被拒绝的消息）与访问判定（`reason: unauthorized`） |
| `wecom.quote` | 引用定位的解析结果：抠出的 ID 片段（`hint`）、命中的 `sessionId`，或未解析时的原因（`outcome`，如 `not-admin`） |
| `wecom.reply` | 被动回复的原始请求（streamId、内容）与服务器回执 |
| `dsh.prompt` | 提交给 DSH 的原始请求与返回值 / 错误 |
| `dsh.turn.end` | 回合结束原因、助手文字、模型、步数、工具调用统计 |
| `wecom.send` | 主动推送的原始请求体与回执 |
| `wecom.notify.skipped`（`warn`） | 该会话没有任何成员，也不在任何管理员的通知范围内，因此无人可通知 |
| `binding.session.created` / `binding.session.replaced`（`warn`） | 为一个成员创建了新会话（含所属分组）；或原会话已归档/不可用而换了新会话 |
| `binding.session.reset`、`session.created`、`wecom.selection` | `/delete` 或页面归档会话、首次路由、管理员切换会话 |
| `dsh.session.archive` / `dsh.session.compact` / `dsh.session.create` | 归档会话、上下文压缩（条数与 tokens）、管理员 `/new` 新建会话 |
| `dsh.session.title` | 给机器人新建的会话写标题（`wecom-bot-<userid/chatid>`）；`outcome: unavailable` 表示这个部署没挂标题服务 |
| `wecom.session.new` / `wecom.session.delete` / `wecom.workspace.select` / `wecom.authorized` | 管理员新建会话、归档自己的会话、选择默认 Workspace、页面授权某人后给她发提示 |
| `binding.store.error` / `binding.view.error`（`warn`） | 设置文件读写或读取分组视图失败（`stage: version` 表示文件版本不认识、已挪到 `settings.json.v<版本>`；无法解析的文件挪到 `settings.json.corrupt`） |
| `dsh.question*` / `dsh.approval*` | 提问、审批及其答复 |
| `connection.phase`、`config.applied`、`wecom.sdk` | 连接状态变化、生效的设置（不含 Secret；`connection: rebuilt` 表示重建了连接，`kept` 表示就地交给运行中的机器人）、SDK 日志 |

Secret 值、`secret`/`token`/`authorization` 等字段、`response_url`、媒体 `url` 与 `aeskey` 一律脱敏。日志包含对话原文，请按敏感数据管理；不需要时可在高级设置中关闭。

## 构建、本地安装与升级

```sh
pnpm install          # esbuild 的安装脚本不需要运行（见 pnpm-workspace.yaml）
pnpm run verify       # 构建 Host + 浏览器包，类型检查，跑全部测试
pnpm run preview      # 可选：重新生成 README 里的设置页截图（需要 Google Chrome）
```

DSH 加载 `dist/` 中的构建产物：Host 入口 `dist/host/index.js`，浏览器入口 `dist/client.js`。本地开发时在 DSH「插件」中以本目录绝对路径安装 bundle；改完代码重新构建后**重启 DSH**（Host 模块不热重载；只改客户端页面时，插件客户端热重载可用）。接口已在 DSH `0.2.0-rc.2` 与 `0.2.1-rc.2` 上核对。

把某个 profile 从「本地路径安装」换成「npm 包安装」（或反过来）时，插件的**解析路径变了**，而 DSH 的模块缓存仍指向旧路径：装好后条目会以 `failed to import: Cannot find package '@wecom/aibot-node-sdk' imported from …/learn/dsh-wecom-bot/dist/host/runtime.js` 这种形式失败，指向的其实是你本地仓库那个旧路径（它此时可能连 `node_modules` 都没有了）。在仓库里跑一次 `pnpm install` 修好本地依赖，然后**重启 DSH** 让条目从 profile 重新解析；同一路径上的普通版本变化（npm 0.4.2 → npm 0.5.0）不需要重启。

验证一个刚发布的版本时也请用精确版本号安装——裸包名会被 pnpm 的 24 小时窗口回落到旧版本（见「[安装插件](#1-安装插件)」）。

升级到新版本时没有手工迁移步骤：装上新的包，插件继续读同一个 `settings.json`（版本线没变就照原样用）；唯一需要动手的情况是文件版本换到了新的次版本线，那时旧文件会被改名放到旁边（见「[内存里保留了什么](#内存里保留了什么)」），照里面的 userid/chatid 在页面上重新加一次即可。

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
  shared/protocol.ts      Host 与页面共享的常量、分组/成员/模型/状态接口类型
  host/                   DSH Host 插件（Node ESM，tsc → dist/host）
    index.ts              入口：Config、inject、apply（注册两个已认证接口）
    config.ts             Config schema：只有连接身份（Bot ID + 凭据库里的 Secret 引用名）
    runtime.ts            宿主生命周期编排：连接身份变化才重建连接，其余设置就地交给运行中的机器人
    store.ts              插件自己的文档 `settings.json`：设置块 + 分组 + 成员 + 备注 + 每位管理员的默认 Workspace（原子写、私有权限、只认当前版本）
    routing.ts            成员 → 会话路由（分组的 Workspace/模型 + 成员自己的会话）
    sessions.ts           会话供给：创建会话、安装模型、描述会话状态
    session-ops.ts        需要 DSH 服务的三个操作：归档会话、压缩上下文、在指定 Workspace 新建会话
    session-title.ts      给新建的会话写 wecom-bot-<userid/chatid> 标题（DSH sessionTitle 服务）
    workspaces.ts         默认/自定义 Workspace 的解析与注册
    models.ts             DSH 模型目录与「安装会话级模型后恢复默认模型」
    presets.ts            DSH 的 agent preset 名单（分组表单的选项、写入前的校验）
    groups-view.ts        配置页的分组表格（读取 + 校验并应用编辑，含设置项的字段校验）
    bridge/               一条企微连接：
      index.ts              组装、入站处理、授权、路由、通知/提问/审批
      inbound.ts            回调帧校验与防重放
      policy.ts             授权（= 分组成员资格）+ 管理员判定
      directory.ts          管理员可操作会话（目录 ∩ Workspace 范围）与 /use 解析
      commands.ts           斜杠命令（/status、/compact、/delete、/sessions、/use、/workspaces、/new 等）
      interactions.ts       提问/审批等待与验证码
      notices.ts            消息模板
      outbox.ts             主动推送队列
      selection.ts          管理员的会话切换
      format.ts             文本工具
    catalog.ts            按 Workspace 分组的 Session 目录（与侧边栏一致）
    observation.ts        内存中的发信人：成员活跃度 + 被拒绝者及其消息摘要
    rounds.ts             每条消息的一轮记录 → round.complete
    turns.ts              从 Session 日志汇总一个回合
    journal.ts            JSONL 日志、DSH home 解析、脱敏
    status.ts             连接状态与计数
    routes.ts             已认证的两个接口：读取状态、应用页面上的设置/分组/成员修改
  client/                 插件主页（React TSX，esbuild → dist/client.js）
    index.tsx             注册到 plugins.bundle.config
    components/           状态栏、凭据、用户分组、未授权用户、管理员、高级设置（人员行为 ui.tsx 的 PersonRow/PersonDialog，分卡片保存用 SaveBar）
    hooks.ts / api.ts     Config 表单（只有①连接用）、插件设置提交、凭据与状态接口
    model.ts              纯函数：草稿、差异、校验、模型/preset/effort/上下文标签、分组/成员操作
    styles.ts             基于 DSH 主题变量的样式
scripts/build-client.mjs  打包为 DSH 浏览器模块格式（React 与 DSH UI 组件由宿主提供）
scripts/preview.mjs       用样例数据离屏渲染配置页（preview/*.png）
test/                     node:test：Host 单元测试、分组存储、页面渲染测试（react-test-renderer）
```

真实企业微信端到端送达需要本人在插件主页输入 Bot ID/Secret 后，用真实账号收发消息验证；平台限制以真实回执为准。
