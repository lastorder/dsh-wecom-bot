# AGENTS.md

dsh-wecom-bot is a single DeepSeek Harness plugin package (unlike the
dsh-workpet monorepo, there is no `packages/` split: one `package.json`, one
`src/`, one published npm package). This file covers *where a change goes*
and *how to ship it*; README.md owns what the plugin does for users.

## Layout

```
src/host/           Host half: runtime, catalog, journal, bridge/ (built to dist/host/index.js)
  config.ts         policy only: connection, administrators, advanced knobs
  routing-store.ts  durable user groups + memberships + notes + per-admin Workspace
                    (<DSH home>/wecom-bot/bindings.json, version "0.4" only)
  session-ops.ts    the three DSH-service operations: archive a Session, compact its
                    context, create a Session in a chosen Workspace
  presets.ts        the DSH agent-preset roster behind a group's `preset`
  routing.ts        member -> Session resolution; sessions.ts provisions the Session
  workspaces.ts     the Workspace new Sessions live in; models.ts the model catalog
  groups-view.ts    the groups table the page reads and edits
src/client/         Client half: the settings page, React (built to dist/client.js,
                    a __ModuleLoader__ factory — see scripts/build-client.mjs)
src/shared/         protocol.ts: constants and types both halves import
test/               *.test.js, run by `node --test` against the built dist/
scripts/            build-client.mjs, clean.mjs, preview.mjs (settings-page screenshots)
preview/            settings*.png, committed because README.md links them; the generated
                    index.html in the same directory is ignored. Deliberately *not* in
                    package.json's `files`: README links them by absolute
                    raw.githubusercontent.com URL so they render on npm too, without
                    putting 1.3 MB of screenshots into every install's tarball
icon.svg            Plugin Manager display metadata (package.json's `icon` field)
cordis.patch.yml    the bundle's insert patch; its `name` must equal package.json's `name`
.github/workflows/  ci.yml (verify on push/PR), release.yml (tag -> npm stage + GitHub Release)
```

## Commands

```sh
pnpm install
pnpm run build     # clean -> tsc (Host) -> tsc + esbuild (Client)
pnpm run typecheck
pnpm run test      # builds, then node --test against dist/
pnpm run verify    # build + typecheck + test; what CI and prepublishOnly run
pnpm run preview   # renders the settings page to preview/*.png (needs Google Chrome);
                   # the PNGs are committed, so a page change should re-run it and ship them
```

## Conventions

- `dist/` is not committed (`.gitignore`); every workflow and `prepublishOnly` rebuilds it fresh. Never hand-edit it.
- **`cordis.patch.yml`'s `name` and `src/shared/protocol.ts`'s `PACKAGE_NAME` must both equal `package.json`'s `name`.** The client keys its `plugins.bundle.config` slot registration by `PACKAGE_NAME`; a mismatch after a rename silently breaks the settings page. `test/client.test.js` checks this.
- A rename or any change to `exports`/`main` requires reinstalling the local dev bundle (`plugin_manager` remove_bundle then install_bundle with the workspace path) **and a full DeepSeek Harness restart** — the desktop profile does not hot-reload the Host module, and a bare disable/enable of the plugin re-runs `apply()` against a module Node already has cached under the old specifier's resolved path, which fails with "failed to import". A content-only edit (rebuild, same package name) reloads fine with disable/enable; renaming anything about the package identity does not.
  - **Root cause, confirmed while shipping v0.2.1's rename from `@local/dsh-wecom-bot` to `dsh-wecom-bot`:** this is a DSH/`dsh-hmr` limitation, not something in this plugin's code. `node -e "import('dsh-wecom-bot')"` run standalone against the exact same profile's `node_modules` always succeeds; the long-running DSH process still reports `fiberPhase: null` and `"failed to import"` indefinitely (toggling enable/disable repeatedly does not help). The entry's load goes through `@deepseek-ai/cordis-plugin-loader`'s `tree.import()`, which — when `ctx.loader.internal` is set — delegates to `dsh-hmr`'s own module loader/cache (`loadCache`, plus a `require.cache` shadow for CJS-in-ESM) instead of a bare `import()`. That cache is keyed by resolved file path and was built against the package's *old* identity; after the identity changes, the cache entry is wrong but `dsh-hmr` doesn't detect this itself, so every subsequent enable attempt reads the same stale state. Only a full process restart rebuilds `dsh-hmr`'s cache from scratch, which is why restarting (not reinstalling, not toggling) is what fixes it. A plain version bump (same package name/`exports`/`main`, e.g. `0.2.1` → `0.2.2`) does not re-trigger this — only an identity change does.

- **Routing state never lives in Config — and neither does authorization.** Config (`config.ts`) holds the connection, the administrator lists and the advanced knobs; a Config write rebuilds the bridge and reconnects the socket. Groups (Workspace + model/effort + preset) and memberships (who may talk to the Bot at all, plus which Session they own) live in `<DSH home>/wecom-bot/bindings.json` (`routing-store.ts`, atomic write-then-rename, `0600`, **`version: "0.4"` only**), edited from the page through `POST /api/wecom-bot/routing` (`groups-view.ts` validates every op; a Workspace must resolve, and a model and a preset must exist in the DSH catalogs). Do not move groups or members into the Config schema: adding somebody to a group must not reconnect the socket, and the settings form must not own state the Host writes on its own. The one *preference* the Bot writes for itself lives there too: the `adminDefaults` map (userid → `{ "workspace": "<path>" }`; `store.adminWorkspace(user)`) is set by `/workspaces` and read by `/sessions` and `/new`, and belongs to the person exactly like a note. Each value is an object rather than a bare path so a future preference can join `workspace` without changing the file shape again; only that object form is read. Do not confuse it with the Config array `adminWorkspaces`, which is the *notification scope*.
- **The routing file version names a release line, not an edit counter.** `ROUTING_VERSION` in `protocol.ts` is the string `'0.4'`: it only changes when a new minor line changes the layout, so the file no longer reads `version 5` after five small edits. `BridgeStateView.version` carries the same constant. A file of any other version (including the integer `5` that 0.4.1 wrote) is reported as a `version` store error and renamed to `bindings.json.v<version>` instead of being guessed at or half-read — the version is untrusted file content, so `routing-store.ts` sanitizes it before using it in a filename. Do not reintroduce an earlier reader or an upgrader: describing the current layout is the whole job, and a silent upgrader is exactly the kind of code nobody can test after the fact.
- **The route's op guard is part of the contract.** `routes.ts`'s `isRoutingOp` rejects a whole batch for one unknown op, so a `RoutingOp` variant missing there silently disables a page feature (a 备注 edit once failed that way with no visible error). `test/routes.test.js` builds one op per variant from `model.ts` and asserts the guard accepts it — add the new case in both places when the union grows. Two ops carry intent beyond their store write: `group.add` reports the new group's id (`createdGroupId`) so the page can open its complete form instead of asking for a name first, and `member.add` reports the principals it authorized (`authorized`) so `runtime.applyRouting` can send them the one-time 「管理员已授权」 greeting.
- **Authorization is group membership, and administrators are the one exception.** `bridge/policy.ts` accepts a sender whose binding exists (the binding *is* the membership) and accepts an administrator from `adminUserIds` even without one, implicitly into `默认分组` — otherwise whoever configured the Bot could lock themselves out of it. A refused sender gets exactly one fixed reply (`unauthorizedText()`: 用户未授权，请联系管理员) and is recorded in `observation.ts`, where assigning it to a group is what authorizes it. The reply is deliberate: an operator asked to be told, and a person who wrote to the Bot needs to know why nothing happened. There is no allowlist to fall back to: an empty group set means nobody can use the Bot.
- **A 备注 belongs to the person, never to the membership.** `bindings.json` keeps them in its own `labels` map (`user:<userid>` / `group:<chatid>`), edited from the page through the `label.set` op, and every person component reads the note first and the WeCom id only as a fallback. That is why an administrator who is in no group still has a name, why removing somebody from a group (or deleting the group) keeps their note, and why re-authorizing them restores it. Do not put the note back on `BindingRecord`: it would make the note disappear exactly when the operator is trying to recognize who they are re-adding, and it would leave the administrator list with no name at all. The administrator list itself stays Config (`adminUserIds`, saved by that card's own 保存) while its notes are routing state (applied immediately) — keep that split, a note edit must not reconnect the socket.
- **A group owns the Workspace, the model/effort and the preset; a member owns only the Session.** `desiredSelection(group)` is the single source of the model (`''` = follow the DSH default), and `groups-view.ts` clears the members' Session ids when a group's Workspace changes, because a Session cannot silently keep living in the old directory. Deleting a group de-authorizes its members instead of moving them to the default group — never escalate somebody into another group's Workspace by deleting one.
- **A preset is a creation fact, not a setting of an existing Session.** `sessions.ensure` passes the group's preset as `sessionController.create({ agentPreset })`; DSH refuses to re-compose a Session that has already had a turn (`agent-preset/locked`), so changing a group's preset must only affect Sessions created afterwards. Do not try to "apply" a preset edit to bound Sessions — the page says as much and offers 归档会话 instead. The roster comes from `ctx.get('agentPresets')` (`presets.ts`); a deployment without that service has an empty roster and accepts any id, so never treat "no roster" as "reject every preset".
- **A group's collapsed header is its overview, so it names every fact the group owns.** `GroupsCard` renders one labelled fact per item — 成员数, Workspace, 模型, effort, preset — from `groupModelSummary()` and `presetSummaryLabel()`: the model and preset a group follows are marked `（DSH 默认）` with the name they actually resolve to, and an unset effort reads 默认 instead of vanishing. `presetLabel()` keeps spelling the fallback out in full for the dropdown; do not reuse that wording in the header (five facts do not fit). The facts wrap rather than truncate (`.wcb-group-summary` is a wrapping flex row), because an ellipsis there would hide exactly the effort/preset the operator opened the page to check.
- **A member is one line, and its only click target is the colored badge.** Blue = private chat, amber = group chat, with a pencil in the corner; the text never says 个人/群聊 (a badge plus the dialog's 类型 row carries it). The line then reads, left to right: the name, the admin tag, the Session name (with its state and running dot), the preset, the model (name only — `modelName()`, not the id), the effort and the context occupancy, and ends with 归档会话. The dialog (`PersonDialog`) is where the note, the group move and 移出分组 live. There is no Session picker and no "+ 添加成员" form any more: authorization happens in the 未授权用户 card, and the only Session operation is archiving it (a `ConfirmDialog`, then `member.archive`), after which the next message creates a fresh Session from the group's current defaults. Keep this "one line to read, one badge to edit" shape.
- **Reasoning effort travels with the model.** A group's effort is part of its model selection (`desiredSelection`), the session row shows both the model and the effort the last request actually used (`modelSelection.lastUsed`), and the group's effort dropdown is only selectable when the chosen model publishes efforts (`effortsFor`). Never expose effort as a standalone setting: DSH installs it through the same `selectModel` call as the model.
- **`sessionController.selectModel` also saves the deployment default model.** `models.ts` reads `agentDefaultModel.currentSelection()` first and puts it back right after selecting, so configuring a model for WeCom Sessions never changes what the DSH GUI uses for new Sessions. `saveSelection` commits in submission order, which is what makes the restore land after the selection.
- **A Session is `blank` until its first turn starts**, and the DSH Session list hides blank Sessions — so a just-created Session is invisible to the catalog for a moment. `sessions.ts` treats `blank` as usable, and so does `directory.permitted()` (otherwise an administrator's `/new` would switch to a Session the very next message would replace), `/sessions` never lists it, and `state?refresh=1` rebuilds the catalog (the page's first read and its refresh button both force).
- **The notification scope lists every Workspace, and an empty list means all of them.** `workspaces.list()` counts a Workspace's live Sessions (its `sessionIds` minus `registry.archivedSessionIds`), but the page never drops a Workspace for having only archived Sessions — the operator asked to see the whole set, and the count already says 暂无会话. `adminWorkspaces: []` is the documented default and renders **every** box checked; unchecking one stores the remaining paths, and `toggleScope` collapses a list that covers everything back to `[]` rather than pinning today's Workspace set into the Config file.
- **One conversation is handled one message at a time.** `bridge/index.ts` keeps a per-chat promise chain (`serialize`) and `handleFrame` awaits its own slot; the socket listener stays fire-and-forget. Without that queue, two messages typed in a row overlapped: both saw a member with no Session, each created one, the second message was submitted to a Session nobody was bound to, and the person's two messages ended up in two conversations in the sidebar. Keep it per chat rather than global (one conversation must not wait behind another's Session creation), keep `handleFrame` awaiting its slot, and keep that awaited by tests through `bridge.whenIdle()` — `settle()`'s tick count is not a duration, which is exactly how the race first showed up as flaky CI on a slower filesystem.
- The Session catalog is cached for 3s (`createCatalogService`); anything that must observe a Session created moments ago passes `{ force: true }` or calls `catalogs.invalidate()` — `session-ops.ts` invalidates after archiving, compacting or creating a Session.
- **DSH has no "delete Session", so `/delete` archives one.** `session-ops.archive` calls `workspaceRegistry.archiveSession(id, { stopActivity: true })` and then clears the binding; the Session stops being resumed, so its history can never reach a request, which is the honest meaning of "clear its memory". The JSONL log stays on disk and is never unlinked by the plugin — reaching into the session store by hand would corrupt DSH's own index. `/delete` asks for `/delete confirm` first; the page's 归档会话 asks through a `ConfirmDialog`.
- **Manual compaction goes through DSH's own service.** `session-ops.compact` resolves the Agent with `sessionController.resolveAgent` (a cold Session must be resumed first) and calls `ctx.get('compaction').compactNow(agent, signal)`; `ManualCompactionError` codes (`busy`, `changed`, `summary`, …) are mapped to Chinese explanations in `COMPACTION_FAILURE`. Do not reimplement summarization, and do not call it on a running Session.
- **Tool approvals go to administrators only.** `onApproval` notifies `settings.adminUserIds` — never the chat bound to the Session — and `/approve` / `/deny` require a single chat whose sender is an administrator. A member's group or private chat must never be able to authorize a tool call, and the approval notice still carries the `/use` pointer so the administrator can jump to the Session afterwards.
- **An administrator command is refused in a group chat, even for an administrator.** `commands.ts` guards `ADMIN_ONLY_COMMANDS` (the commands a non-administrator may never run: `/new`, `/workspaces`, `/sessions`, `/use`, `/reset`, `/approve`, `/deny`) and answers `adminPrivateOnlyText()` — 管理员命令只能在单聊中使用 — before any handler sees the command. The reason is not rank but the shared Session: creating, switching or re-pointing it, or approving a tool call on everybody's behalf, must not happen from a chat every member is looking at. A non-administrator asking from a group still gets `adminOnlyText()` (需要管理员权限), so the reply always names the real reason. `/compact` and `/delete` are *not* in that set: they are open to everybody in a private chat and gated by `allowed()` (an administrator) in a group, because they touch only that conversation's own Session. Adding a command that only administrators may run means adding it here too.
- **Each card saves its own Config section.** `hooks.useConfigSave(scope)` diffs one card's fields against the newest stored revision (`changedOperations`) and retries on a revision conflict; `SettingsPage` therefore holds no draft and no footer. A successful save shows 已保存 for two seconds — there is deliberately no persistent "已生效" banner, and routing edits (groups, notes, archive) show nothing on success because the refreshed table is the confirmation. Only failures stay on screen.
- **Every WeCom-facing string lives in `src/host/bridge/notices.ts`** (command replies included — `commands.ts` only composes its helpers) and is built with its `title` / `field` / `code` helpers: one `**🏷 标题** · 《会话》` header, one quoted line of context, then flat `- **字段**：值` details. The refusal, the 授权 greeting, the `/delete` warning and the `/workspaces` list are templates there too — `commands.ts` never builds user-facing prose inline. Never tables and never nested lists — WeCom renders a Markdown subset and prints everything else raw, so every line must also read correctly unstyled. Never write `/use ` followed by a word in copy that WeCom can quote back (a `/sessions` footer saying `/use 1` would hijack the quote path, because `extractSessionPointer` scans the quoted text for `/use <token>`); `test/notices.test.js` pins the shape, the reply budget and that invariant. Untrusted values go through `inline()`, which substitutes look-alike characters rather than escaping them.

## Releasing

Single package, one version, one `vX.Y.Z` tag triggers the release of that one package — no `scripts/release.mjs` helper is needed (compare dsh-workpet's monorepo one): `package.json`'s own `version` is the only thing a release bumps.

### One-time setup, before the first tag (done once, for v0.2.0)

[release.yml](.github/workflows/release.yml) authenticates only through npm's
token-free OIDC Trusted Publishing, which must be configured on a package
that already exists on the registry.

1. `pnpm run verify`.
2. `npm login`, then `npm publish` from the repository root (unscoped name, so no `--access public` needed; `prepublishOnly` reruns `pnpm run verify` first).
3. Establish the Trusted Publisher relationship — `npm trust github`, not the npmjs.com web UI, is the actual working path (confirmed when setting up v0.2.1: the web UI's documented steps did not produce a relationship `npm trust list` could see, and the first release run failed at "Stage on npm" with `E401 Unable to authenticate` until this command was run):
   ```sh
   npm trust github dsh-wecom-bot --repo lastorder/dsh-wecom-bot --file release.yml --allow-stage-publish
   ```
   `--file` takes just the workflow's filename (`release.yml`), not its path under `.github/workflows/` — passing the path fails with "GitHub Actions workflow must be just a file not a path". This needs your npm login and 2FA (one browser OTP prompt); verify first with `--dry-run` (no OTP required) if the exact repo/file values are ever in doubt, and `npm trust list dsh-wecom-bot` to confirm afterward.

### Every release after that

1. Bump `package.json`'s `version` to `X.Y.Z`.
2. `pnpm run verify`.
3. Commit as `Release vX.Y.Z: <summary>` with a prose body; this message becomes the GitHub Release notes verbatim.
4. `git tag -a vX.Y.Z -m "Release vX.Y.Z: <summary>"` and `git push && git push --tags`.
5. release.yml verifies, checks the tag against `package.json`'s version, runs `npm stage publish`, packs a tarball, and creates a GitHub Release **marked pre-release**.
6. **Approve the stage**: `https://www.npmjs.com/package/dsh-wecom-bot?activeTab=versions`, or `npm stage list dsh-wecom-bot` then `npm stage approve <stage-id>` (2FA). Then uncheck "pre-release" on the GitHub Release.

Do not run `npm publish` / `npm stage publish` by hand for an ordinary release; only to recover from a CI outage, after `pnpm run verify`. Keep the Trusted Publisher stage-only (`--allow-stage-publish`, never `--allow-publish`): the human approval on npmjs.com is the control that keeps a compromised workflow or repository from ever reaching the registry on its own.

### Troubleshooting a release run

- **`pnpm/action-setup`: "Error: No pnpm version is specified."** — `package.json` is missing `packageManager`; it must be present (this bit v0.2.0's and v0.2.1's first CI/release runs — adapting workflows from another repository without carrying over its `packageManager` field). Keep it in sync with the pnpm version used locally (`pnpm --version`).
- **"Stage on npm": `E401 Unable to authenticate, your authentication token seems to be invalid.`** — no working Trusted Publisher relationship for this exact repo + workflow filename. Run the `npm trust github` command above (needs a human with npm 2FA; cannot be fixed from inside the workflow). `npm trust list dsh-wecom-bot` shows what is currently configured.
- **Tag pushed against the wrong commit, or `package.json`'s version never bumped** — release.yml's "Check the tag matches package.json's version" step fails before anything is staged; fix the version or re-tag and re-push.

### CI/release infrastructure notes

- Third-party actions are pinned to a full commit SHA (`softprops/action-gh-release`); first-party `actions/*` and `pnpm/*` stay on major tags.
- The release job's `id-token: write` permission mints the OIDC token npm exchanges for a short-lived, workflow-scoped stage credential — no `NPM_TOKEN` repository secret exists or should ever be added while Trusted Publishing covers this.
