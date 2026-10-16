window.__ModuleLoader__.load({
	id: "@local/dsh-wecom-bot",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		"use strict";
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __export = (target, all) => {
		  for (var name in all)
		    __defProp(target, name, { get: all[name], enumerable: true });
		};
		var __copyProps = (to, from, except, desc) => {
		  if (from && typeof from === "object" || typeof from === "function") {
		    for (let key of __getOwnPropNames(from))
		      if (!__hasOwnProp.call(to, key) && key !== except)
		        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
		  }
		  return to;
		};
		var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

		// src/client/index.tsx
		var index_exports = {};
		__export(index_exports, {
		  apply: () => apply,
		  inject: () => inject
		});
		module.exports = __toCommonJS(index_exports);

		// src/shared/protocol.ts
		var PACKAGE_NAME = "@local/dsh-wecom-bot";
		var CONFIG_NAMESPACE = "wecom-bot";
		var DEFAULT_SECRET_REF = "WECOM_BOT_SECRET";
		var STATE_ROUTE = "/api/wecom-bot/state";

		// src/client/components/SettingsPage.tsx
		var import_react6 = require("react");
		var import_dsh_client_ui_primitives8 = require("@deepseek-ai/dsh-client-ui-primitives");

		// src/client/api.ts
		var STATE_URL = STATE_ROUTE.replace(/^\//, "");
		async function fetchState(refresh, signal) {
		  const response = await fetch(`${STATE_URL}${refresh ? "?refresh=1" : ""}`, {
		    credentials: "same-origin",
		    cache: "no-store",
		    ...signal ? { signal } : {}
		  });
		  if (response.status === 401 || response.status === 403) throw new Error("DSH 登录已失效，请刷新页面。");
		  if (response.status === 404) throw new Error("插件后台尚未加载新版本，请重启 DSH 后再试。");
		  if (!response.ok) throw new Error(`插件状态读取失败（HTTP ${response.status}）。`);
		  return await response.json();
		}
		function unwrap(result) {
		  if (result && typeof result === "object" && "ok" in result && typeof result.ok === "boolean") {
		    const envelope = result;
		    if (!envelope.ok) throw new Error(envelope.error?.message ?? "DSH 拒绝了请求");
		    return envelope.value;
		  }
		  return result;
		}
		async function describeCredential(remote, ref) {
		  if (!remote) return void 0;
		  return unwrap(await remote.describe([ref]))?.[ref];
		}
		async function storeCredential(remote, ref, value) {
		  if (!remote) throw new Error("DSH 凭据服务未连接。");
		  const result = await remote.set(ref, value);
		  if (result !== void 0) unwrap(result);
		}

		// src/client/hooks.ts
		var import_react = require("react");
		function useFormSnapshot(scope) {
		  return (0, import_react.useSyncExternalStore)((listener) => scope.subscribe(listener), () => scope.getSnapshot());
		}
		function useBridgeState(intervalMs = 5e3) {
		  const [data, setData] = (0, import_react.useState)();
		  const [error, setError] = (0, import_react.useState)();
		  const [loading, setLoading] = (0, import_react.useState)(true);
		  const [refreshing, setRefreshing] = (0, import_react.useState)(false);
		  const tick = (0, import_react.useRef)(() => {
		  });
		  (0, import_react.useEffect)(() => {
		    let active = true;
		    const controller = new AbortController();
		    let inflight = false;
		    async function load(force) {
		      if (inflight || !force && typeof document !== "undefined" && document.visibilityState === "hidden") return;
		      inflight = true;
		      if (force) setRefreshing(true);
		      try {
		        const next = await fetchState(force, controller.signal);
		        if (!active) return;
		        setData(next);
		        setError(void 0);
		      } catch (cause) {
		        if (active && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
		      } finally {
		        inflight = false;
		        if (active) {
		          setLoading(false);
		          setRefreshing(false);
		        }
		      }
		    }
		    tick.current = (force) => {
		      void load(force);
		    };
		    void load(true);
		    const timer = setInterval(() => {
		      void load(false);
		    }, intervalMs);
		    return () => {
		      active = false;
		      controller.abort();
		      clearInterval(timer);
		    };
		  }, [intervalMs]);
		  const refresh = (0, import_react.useCallback)((force = true) => tick.current(force), []);
		  return { data, error, loading, refreshing, refresh };
		}
		function useSecretStatus(remote, ref) {
		  const [configured, setConfigured] = (0, import_react.useState)(false);
		  const [known, setKnown] = (0, import_react.useState)(false);
		  const [version, setVersion] = (0, import_react.useState)(0);
		  const refresh = (0, import_react.useCallback)(() => setVersion((v) => v + 1), []);
		  (0, import_react.useEffect)(() => {
		    let active = true;
		    describeCredential(remote?.credentials, ref).then((info) => {
		      if (active) {
		        setConfigured(Boolean(info?.configured));
		        setKnown(info !== void 0);
		      }
		    }).catch(() => {
		      if (active) {
		        setConfigured(false);
		        setKnown(false);
		      }
		    });
		    return () => {
		      active = false;
		    };
		  }, [remote, ref, version]);
		  (0, import_react.useEffect)(() => remote?.$on?.("credentials/reference-updated", (updated) => {
		    if (updated === ref) refresh();
		  }), [remote, ref, refresh]);
		  return { configured, known, refresh };
		}

		// src/client/model.ts
		var DEFAULTS = {
		  botId: "",
		  secretEnv: DEFAULT_SECRET_REF,
		  chatIds: [],
		  sessionIds: [],
		  allowedUserIds: [],
		  wsUrl: "",
		  questionTimeoutMs: 6e4,
		  remoteApprovals: false,
		  logEnabled: true,
		  logRetentionDays: 14
		};
		var LIST_KEYS = ["chatIds", "sessionIds", "allowedUserIds"];
		var SCALAR_KEYS = ["botId", "wsUrl", "questionTimeoutMs", "remoteApprovals", "logEnabled", "logRetentionDays"];
		function list(value) {
		  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
		}
		function storedFrom(value) {
		  const v = value ?? {};
		  return {
		    botId: typeof v.botId === "string" ? v.botId : DEFAULTS.botId,
		    secretEnv: typeof v.secretEnv === "string" && v.secretEnv.trim() ? v.secretEnv : DEFAULTS.secretEnv,
		    chatIds: list(v.chatIds),
		    sessionIds: list(v.sessionIds),
		    allowedUserIds: list(v.allowedUserIds),
		    wsUrl: typeof v.wsUrl === "string" ? v.wsUrl : DEFAULTS.wsUrl,
		    questionTimeoutMs: typeof v.questionTimeoutMs === "number" ? v.questionTimeoutMs : DEFAULTS.questionTimeoutMs,
		    remoteApprovals: v.remoteApprovals === true,
		    logEnabled: v.logEnabled !== false,
		    logRetentionDays: typeof v.logRetentionDays === "number" ? v.logRetentionDays : DEFAULTS.logRetentionDays
		  };
		}
		function draftFrom(stored) {
		  return { ...stored, chatIds: [...stored.chatIds], sessionIds: [...stored.sessionIds], allowedUserIds: [...stored.allowedUserIds], secret: "" };
		}
		function normalizedList(values) {
		  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
		}
		function sameList(a, b) {
		  const left = normalizedList(a);
		  const right = normalizedList(b);
		  return left.length === right.length && left.every((item) => right.includes(item));
		}
		function normalizedScalar(key, draft) {
		  const value = draft[key];
		  return typeof value === "string" ? value.trim() : value;
		}
		function changedOperations(draft, base) {
		  const ops = [];
		  for (const key of SCALAR_KEYS) {
		    const next = normalizedScalar(key, draft);
		    if (next !== normalizedScalar(key, base)) ops.push({ op: "set", path: [key], value: next });
		  }
		  for (const key of LIST_KEYS) {
		    if (!sameList(draft[key], base[key])) ops.push({ op: "set", path: [key], value: normalizedList(draft[key]) });
		  }
		  return ops;
		}
		function isDirty(draft, base) {
		  return Boolean(draft.secret.trim()) || changedOperations(draft, base).length > 0;
		}
		function validate(draft, secretConfigured) {
		  const errors = {};
		  if (!draft.botId.trim()) errors.botId = "请填写企业微信 Bot ID。";
		  if (!draft.secret.trim() && !secretConfigured) errors.secret = "首次配置需要填写 Bot Secret。";
		  const wsUrl = draft.wsUrl.trim();
		  if (wsUrl) {
		    try {
		      const url = new URL(wsUrl);
		      if (url.protocol !== "wss:" || url.username || url.password) errors.wsUrl = "只接受不含账号密码的 wss:// 地址。";
		    } catch {
		      errors.wsUrl = "不是有效的 URL。";
		    }
		  }
		  if (!Number.isFinite(draft.questionTimeoutMs) || draft.questionTimeoutMs < 1e3 || draft.questionTimeoutMs > 3e5) {
		    errors.questionTimeoutMs = "请输入 1–300 秒。";
		  }
		  if (!Number.isInteger(draft.logRetentionDays) || draft.logRetentionDays < 1 || draft.logRetentionDays > 365) {
		    errors.logRetentionDays = "请输入 1–365 的整数天数。";
		  }
		  return errors;
		}
		function accessSummary(draft) {
		  const unrestricted = [];
		  if (!normalizedList(draft.sessionIds).length) unrestricted.push("sessions");
		  if (!normalizedList(draft.chatIds).length) unrestricted.push("chats");
		  if (!normalizedList(draft.allowedUserIds).length) unrestricted.push("users");
		  return { level: unrestricted.length === 3 ? "open" : unrestricted.length ? "partial" : "restricted", unrestricted };
		}
		function toggle(values, id, on) {
		  const has = values.includes(id);
		  const want = on ?? !has;
		  if (want === has) return [...values];
		  return want ? [...values, id] : values.filter((value) => value !== id);
		}
		function setAll(values, ids, on) {
		  if (on) return [.../* @__PURE__ */ new Set([...values, ...ids])];
		  const remove = new Set(ids);
		  return values.filter((value) => !remove.has(value));
		}
		function matches(session, group, needle) {
		  return [session.title ?? "", session.sessionId, group.title, group.path ?? ""].some((text) => text.toLowerCase().includes(needle));
		}
		function filterGroups(groups, query, selected) {
		  const needle = query.trim().toLowerCase();
		  return groups.map((group) => ({
		    ...group,
		    sessions: group.sessions.filter((session) => (!needle || matches(session, group, needle)) && (!selected || selected.has(session.sessionId)))
		  })).filter((group) => group.sessions.length > 0);
		}
		function identityRows(observed, configured) {
		  const rows = observed.map((entry) => ({ id: entry.id, observed: entry }));
		  const known = new Set(observed.map((entry) => entry.id));
		  for (const id of configured) if (!known.has(id)) rows.push({ id });
		  return rows;
		}
		function displayPath(path) {
		  return (path ?? "").replace(/^(\/Users|\/home)\/[^/]+(?=\/|$)/, "~").replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/, "~");
		}
		function relativeTime(at, now = Date.now()) {
		  if (!at) return "";
		  const diff = Math.max(0, now - at);
		  if (diff < 6e4) return "刚刚";
		  if (diff < 36e5) return `${Math.floor(diff / 6e4)} 分钟前`;
		  if (diff < 864e5) return `${Math.floor(diff / 36e5)} 小时前`;
		  if (diff < 30 * 864e5) return `${Math.floor(diff / 864e5)} 天前`;
		  return new Date(at).toLocaleDateString();
		}

		// src/client/components/AccessBanner.tsx
		var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		var import_jsx_runtime = require("react/jsx-runtime");
		var DIMENSION_LABEL = {
		  sessions: "DSH 会话：全部未归档会话",
		  chats: "企微会话：所有单聊与群聊",
		  users: "企微用户：任何人"
		};
		function AccessBanner({ summary }) {
		  if (summary.level === "restricted") {
		    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wcb-banner", "data-tone": "success", role: "status", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wcb-banner-icon", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconCheckCircleOutlineRegular, { size: 18 }) }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wcb-banner-title", children: "已启用三重白名单" }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wcb-banner-body", children: "只有勾选的企微用户、在勾选的会话里，才能操作勾选的 DSH 会话。被拒绝的消息不会得到任何回复，但会出现在下方列表中供你审核。" })
		      ] })
		    ] });
		  }
		  const open = summary.level === "open";
		  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wcb-banner", "data-tone": open ? "danger" : "warning", role: "alert", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "wcb-banner-icon", children: open ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconWarningTriangleOutlineRegular, { size: 18 }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconShieldOutlineRegular, { size: 18 }) }),
		    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
		      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wcb-banner-title", children: open ? "安全风险：尚未设置任何白名单" : "部分范围未限制" }),
		      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "wcb-banner-body", children: [
		        open ? "只要能给机器人发消息，任何企业微信用户都可以读取本轮回复、向你的 DSH 会话发送指令（可能触发命令执行和文件修改）。" : "以下范围留空，表示对该范围全部允许：",
		        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "wcb-chips", children: summary.unrestricted.map((dimension) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: open ? "danger" : "warning", children: DIMENSION_LABEL[dimension] }, dimension)) }),
		        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ol", { children: [
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "在下方「企业微信来源」中只勾选你自己的 userid，以及你与机器人的单聊。" }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "在「DSH 会话」中只勾选需要远程操作的会话。" }),
		          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "群聊里的通知对所有群成员可见，请谨慎授权群聊。" })
		        ] })
		      ] })
		    ] })
		  ] });
		}

		// src/client/components/AdvancedCard.tsx
		var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");
		var import_react2 = require("react");

		// src/client/components/ui.tsx
		var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
		var import_jsx_runtime2 = require("react/jsx-runtime");
		function Card(props) {
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "wcb-card", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(CardHead, { ...props }),
		    props.children
		  ] });
		}
		function CardHead({ step, title, description, aside }) {
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "wcb-card-head", children: [
		    step !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "wcb-step", children: step }),
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "wcb-card-titles", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "wcb-card-title", children: title }),
		      description && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "wcb-card-desc", children: description })
		    ] }),
		    aside && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "wcb-card-aside", children: aside })
		  ] });
		}
		function Field({ label, required, hint, error, children }) {
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "wcb-field", "data-invalid": error ? "" : void 0, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "wcb-field-label", children: [
		      label,
		      required && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "wcb-required", "aria-label": "必填", children: "*" })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "wcb-field-control", children: [
		      children,
		      error ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "wcb-field-error", role: "alert", children: error }) : hint && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "wcb-hint", children: hint })
		    ] })
		  ] });
		}
		function ScopeTag({ count }) {
		  return count ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_dsh_client_ui_primitives2.Tag, { tone: "info", children: [
		    "已选 ",
		    count
		  ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Tag, { tone: "warning", children: "未限制 · 全部允许" });
		}
		function CheckRow({ checked, onToggle, label, children, meta, disabled }) {
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "wcb-row", "data-selected": checked ? "" : void 0, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
		      "input",
		      {
		        type: "checkbox",
		        className: "wcb-check",
		        checked,
		        disabled,
		        "aria-label": label,
		        onChange: (event) => onToggle(event.target.checked)
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "wcb-row-main", children }),
		    meta && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "wcb-row-meta", children: meta })
		  ] });
		}
		function Empty({ children }) {
		  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "wcb-empty", children });
		}

		// src/client/components/AdvancedCard.tsx
		var import_jsx_runtime3 = require("react/jsx-runtime");
		function AdvancedCard({ draft, errors, journal, disabled, onChange }) {
		  const [copied, setCopied] = (0, import_react2.useState)(false);
		  const copy = async () => {
		    if (!journal?.directory) return;
		    setCopied(await (0, import_dsh_client_ui_primitives3.writeClipboard)(journal.directory));
		    setTimeout(() => setCopied(false), 1500);
		  };
		  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: "wcb-card wcb-details", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
		      CardHead,
		      {
		        step: 4,
		        title: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
		          "高级设置 ",
		          draft.remoteApprovals && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Tag, { tone: "warning", children: "远程审批已开启" })
		        ] }),
		        description: "远程审批、等待时间、自定义连接地址与对话日志。均可保持默认。",
		        aside: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "wcb-chevron", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.IconChevronRightOutlineRegular, { size: 16 }) })
		      }
		    ) }),
		    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
		      Field,
		      {
		        label: "远程审批工具调用",
		        hint: "开启后，DSH 请求执行工具时会向已允许用户的单聊发送带验证码的审批消息，回复 /approve 或 /deny 即生效；群聊永远不能审批。不需要时请保持关闭。",
		        children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
		          import_dsh_client_ui_primitives3.Switch,
		          {
		            checked: draft.remoteApprovals,
		            disabled,
		            label: "远程审批工具调用",
		            onChange: (next) => onChange({ remoteApprovals: next })
		          }
		        )
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
		      Field,
		      {
		        label: "等待企微回复（秒）",
		        error: errors.questionTimeoutMs,
		        hint: "DSH 提问或审批时，先等待企业微信回复的时间；超时后回到 DSH 页面处理。",
		        children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
		          import_dsh_client_ui_primitives3.Input,
		          {
		            className: "wcb-number",
		            type: "number",
		            min: 1,
		            max: 300,
		            step: 1,
		            value: Math.round(draft.questionTimeoutMs / 1e3),
		            disabled,
		            "aria-label": "等待企微回复的秒数",
		            onChange: (event) => onChange({ questionTimeoutMs: Number(event.target.value) * 1e3 })
		          }
		        )
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Field, { label: "WebSocket 地址", error: errors.wsUrl, hint: "留空使用 SDK 默认地址。仅在企业私有化部署时需要，只接受 wss://。", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
		      import_dsh_client_ui_primitives3.Input,
		      {
		        className: "wcb-grow",
		        value: draft.wsUrl,
		        placeholder: "wss://openws.work.weixin.qq.com",
		        spellCheck: false,
		        disabled,
		        "aria-label": "WebSocket 地址",
		        onChange: (event) => onChange({ wsUrl: event.target.value })
		      }
		    ) }),
		    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
		      Field,
		      {
		        label: "对话日志（JSONL）",
		        hint: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
		          "每条企微消息一行 ",
		          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "wcb-code", children: "round.complete" }),
		          "，含原始请求、回复与元数据；另有 ",
		          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "wcb-code", children: "wecom.message" }),
		          "、",
		          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "wcb-code", children: "dsh.prompt" }),
		          "、",
		          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "wcb-code", children: "dsh.turn.end" }),
		          "、",
		          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "wcb-code", children: "wecom.send" }),
		          " 等明细行。Secret、回调 URL 与媒体密钥会被脱敏；文件权限仅当前用户可读。"
		        ] }),
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "wcb-field-row", children: [
		            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
		              import_dsh_client_ui_primitives3.Switch,
		              {
		                checked: draft.logEnabled,
		                disabled,
		                label: "记录对话日志",
		                onChange: (next) => onChange({ logEnabled: next })
		              }
		            ),
		            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { color: "var(--wcb-text-2)", fontSize: 13 }, children: "保留" }),
		            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
		              import_dsh_client_ui_primitives3.Input,
		              {
		                className: "wcb-number",
		                type: "number",
		                min: 1,
		                max: 365,
		                step: 1,
		                value: draft.logRetentionDays,
		                disabled: disabled || !draft.logEnabled,
		                "aria-label": "日志保留天数",
		                onChange: (event) => onChange({ logRetentionDays: Number(event.target.value) })
		              }
		            ),
		            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { color: "var(--wcb-text-2)", fontSize: 13 }, children: "天" })
		          ] }),
		          errors.logRetentionDays && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "wcb-field-error", children: errors.logRetentionDays }),
		          journal?.directory && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "wcb-field-row", style: { marginTop: 10 }, children: [
		            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "wcb-path wcb-grow", title: journal.file, children: journal.directory }),
		            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", size: "sm", icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.IconCopyOutlineRegular, {}), onClick: () => {
		              void copy();
		            }, children: copied ? "已复制" : "复制路径" })
		          ] })
		        ]
		      }
		    )
		  ] });
		}

		// src/client/components/CredentialsCard.tsx
		var import_react3 = require("react");
		var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");
		var import_jsx_runtime4 = require("react/jsx-runtime");
		function CredentialsCard({ draft, errors, secretConfigured, disabled, onChange }) {
		  const [reveal, setReveal] = (0, import_react3.useState)(false);
		  const ready = Boolean(draft.botId.trim()) && (secretConfigured || Boolean(draft.secret.trim()));
		  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
		    Card,
		    {
		      step: 1,
		      title: "连接机器人",
		      description: "在企业微信管理后台 → 智能机器人 → API 模式（长连接）中获取。这是仅有的两项必填配置。",
		      aside: ready ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Tag, { tone: "success", children: "已填写" }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Tag, { tone: "danger", children: "必填" }),
		      children: [
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Field, { label: "Bot ID", required: true, error: errors.botId, hint: "机器人的唯一标识，可公开显示。", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
		          import_dsh_client_ui_primitives4.Input,
		          {
		            className: "wcb-grow",
		            value: draft.botId,
		            placeholder: "例如 aib0xxxxxxxxxxxx",
		            spellCheck: false,
		            autoComplete: "off",
		            disabled,
		            "aria-label": "Bot ID",
		            onChange: (event) => onChange({ botId: event.target.value })
		          }
		        ) }),
		        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
		          Field,
		          {
		            label: "Bot Secret",
		            required: !secretConfigured,
		            error: errors.secret,
		            hint: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
		              "保存到 DSH 凭据库（引用名 ",
		              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "wcb-code", children: draft.secretEnv }),
		              "），不会写入插件配置，也不会回显。",
		              secretConfigured ? "留空表示保持当前 Secret。" : ""
		            ] }),
		            children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "wcb-field-row", children: [
		              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
		                import_dsh_client_ui_primitives4.Input,
		                {
		                  className: "wcb-grow",
		                  type: reveal ? "text" : "password",
		                  value: draft.secret,
		                  placeholder: secretConfigured ? "已保存 · 输入新值以替换" : "粘贴 Bot Secret",
		                  autoComplete: "new-password",
		                  spellCheck: false,
		                  disabled,
		                  "aria-label": "Bot Secret",
		                  onChange: (event) => onChange({ secret: event.target.value })
		                }
		              ),
		              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "ghost", size: "sm", type: "button", onClick: () => setReveal((value) => !value), disabled: !draft.secret, children: reveal ? "隐藏" : "显示" }),
		              secretConfigured ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Tag, { tone: "success", children: "已保存" }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Tag, { tone: "warning", children: "未设置" })
		            ] })
		          }
		        )
		      ]
		    }
		  );
		}

		// src/client/components/IdentityPicker.tsx
		var import_react4 = require("react");
		var import_dsh_client_ui_primitives5 = require("@deepseek-ai/dsh-client-ui-primitives");
		var import_jsx_runtime5 = require("react/jsx-runtime");
		var REASON = {
		  user: "用户不在白名单",
		  chat: "会话不在白名单",
		  "user+chat": "用户和会话都不在白名单"
		};
		function IdentityPicker({ observed, chatIds, userIds, disabled, connected, onChange }) {
		  const rejected = (observed?.users ?? []).filter((user) => user.decision === "rejected").length;
		  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
		    Card,
		    {
		      step: 3,
		      title: "企业微信来源",
		      description: "这里只列出最近 24 小时内真正给机器人发过消息的 ID，包括被白名单拒绝的。勾选即加入白名单；某一列不勾选表示该项不限制。",
		      aside: rejected ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_dsh_client_ui_primitives5.Tag, { tone: "danger", children: [
		        rejected,
		        " 个用户被拒绝"
		      ] }) : void 0,
		      children: [
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "wcb-columns", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
		            IdentityPanel,
		            {
		              kind: "users",
		              title: "允许的用户",
		              hint: "企业微信 userid",
		              icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.IconUserOutlineRegular, { size: 16 }),
		              observed: observed?.users ?? [],
		              selected: userIds,
		              disabled,
		              connected,
		              onChange: (next) => onChange({ allowedUserIds: next })
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
		            IdentityPanel,
		            {
		              kind: "chats",
		              title: "允许的会话",
		              hint: "单聊 = 对方 userid；群聊 = chatid",
		              icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.IconUsersOutlineRegular, { size: 16 }),
		              observed: observed?.chats ?? [],
		              selected: chatIds,
		              disabled,
		              connected,
		              onChange: (next) => onChange({ chatIds: next })
		            }
		          )
		        ] }),
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "wcb-list-foot", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: "ID 列表保存在内存中，DSH 重启后需要重新收到消息才会出现。" }),
		          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { children: [
		            "在企业微信里发送 ",
		            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "wcb-code", children: "/whoami" }),
		            " 也可查看自己的 ID（仅限已允许的用户）。"
		          ] })
		        ] })
		      ]
		    }
		  );
		}
		function IdentityPanel({ kind, title, hint, icon, observed, selected, disabled, connected, onChange }) {
		  const [manual, setManual] = (0, import_react4.useState)("");
		  const rows = identityRows(observed, selected);
		  const add = () => {
		    const id = manual.trim();
		    if (!id) return;
		    onChange(toggle(selected, id, true));
		    setManual("");
		  };
		  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
		    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "wcb-subhead", children: [
		      icon,
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "wcb-subhead-title", children: title }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "wcb-subhead-hint", children: hint }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "wcb-card-aside", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ScopeTag, { count: selected.length }) })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "wcb-panel", children: [
		      rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { padding: 10 }, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(Empty, { children: [
		        connected ? "还没有收到消息。" : "机器人尚未在线。",
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("ol", { children: [
		          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("li", { children: "填写 Bot ID 与 Secret 并保存；" }),
		          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("li", { children: "在企业微信里给机器人发一条消息（群聊里请 @机器人）；" }),
		          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("li", { children: "几秒后 ID 会自动出现在这里。" })
		        ] })
		      ] }) }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "wcb-panel-scroll", children: rows.map(({ id, observed: entry }) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
		        CheckRow,
		        {
		          checked: selected.includes(id),
		          label: `允许${kind === "users" ? "用户" : "会话"} ${id}`,
		          disabled,
		          onToggle: (on) => onChange(toggle(selected, id, on)),
		          meta: entry ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(DecisionTag, { entry }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Tag, { tone: "quiet", children: "手动添加" }),
		          children: [
		            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "wcb-row-title wcb-mono", style: { fontSize: 13 }, title: id, children: id }),
		            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "wcb-row-sub", children: entry ? describe(kind, entry) : "24 小时内未收到消息" })
		          ]
		        },
		        id
		      )) }),
		      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "wcb-add", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
		          import_dsh_client_ui_primitives5.Input,
		          {
		            className: "wcb-grow",
		            value: manual,
		            placeholder: kind === "users" ? "手动添加 userid" : "手动添加 chatid / userid",
		            "aria-label": kind === "users" ? "手动添加 userid" : "手动添加会话 ID",
		            disabled,
		            onChange: (event) => setManual(event.target.value),
		            onKeyDown: (event) => {
		              if (event.key === "Enter") {
		                event.preventDefault();
		                add();
		              }
		            }
		          }
		        ),
		        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Button, { variant: "outline", size: "sm", icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.IconPlusOutlineRegular, {}), disabled: disabled || !manual.trim(), onClick: add, children: "添加" })
		      ] })
		    ] })
		  ] });
		}
		function describe(kind, entry) {
		  const parts = [`${relativeTime(entry.lastSeenAt)}`, `${entry.messages} 条消息`];
		  if (kind === "chats") parts.unshift(entry.chatType === "group" ? "群聊" : "单聊");
		  if (kind === "chats" && entry.chatType === "group" && entry.via) parts.push(`最近发言 ${entry.via}`);
		  if (kind === "users" && entry.via && entry.via !== entry.id) parts.push(`来自群 ${entry.via}`);
		  return parts.join(" · ");
		}
		function DecisionTag({ entry }) {
		  return entry.decision === "rejected" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { title: entry.reason ? REASON[entry.reason] : void 0, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Tag, { tone: "danger", children: "上次被拒绝" }) }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives5.Tag, { tone: "success", children: "上次已接受" });
		}

		// src/client/components/SessionPicker.tsx
		var import_react5 = require("react");
		var import_dsh_client_ui_primitives6 = require("@deepseek-ai/dsh-client-ui-primitives");
		var import_jsx_runtime6 = require("react/jsx-runtime");
		var HIDDEN_REASON = {
		  archived: "已归档",
		  subagent: "子代理会话",
		  blank: "空会话",
		  missing: "已删除或不可见"
		};
		var UNTITLED = "未命名会话";
		function SessionPicker({ catalog, error, loading, refreshing, selected, disabled, onChange, onRefresh }) {
		  const [query, setQuery] = (0, import_react5.useState)("");
		  const [onlySelected, setOnlySelected] = (0, import_react5.useState)(false);
		  const [open, setOpen] = (0, import_react5.useState)({});
		  const selectedSet = (0, import_react5.useMemo)(() => new Set(selected), [selected]);
		  const groups = (0, import_react5.useMemo)(
		    () => filterGroups(catalog?.groups ?? [], query, onlySelected ? selectedSet : void 0),
		    [catalog, query, onlySelected, selectedSet]
		  );
		  const shown = groups.reduce((sum, group) => sum + group.sessions.length, 0);
		  const searching = Boolean(query.trim()) || onlySelected;
		  const isOpen = (group, index) => searching || (open[group.key] ?? (index < 2 || group.sessions.some((session) => selectedSet.has(session.sessionId))));
		  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
		    Card,
		    {
		      step: 2,
		      title: "DSH 会话范围",
		      description: "勾选允许从企业微信查看与操作的会话；不勾选表示所有未归档会话都可操作。已归档、子代理和空会话不会显示。",
		      aside: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(ScopeTag, { count: selected.length }),
		      children: [
		        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "wcb-toolbar", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
		            import_dsh_client_ui_primitives6.Input,
		            {
		              className: "wcb-search",
		              icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.IconSearchOutlineRegular, {}),
		              value: query,
		              placeholder: "搜索会话名称、ID 或工作区",
		              "aria-label": "搜索会话",
		              onChange: (event) => setQuery(event.target.value)
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Button, { variant: onlySelected ? "toolbar" : "ghost", size: "sm", "aria-pressed": onlySelected, onClick: () => setOnlySelected((value) => !value), children: "仅看已选" }),
		          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Button, { variant: "ghost", size: "sm", disabled: disabled || !selected.length, onClick: () => onChange([]), children: "清空选择" }),
		          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Button, { variant: "ghost", size: "sm", icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.IconRefreshOutlineRegular, {}), disabled: refreshing, onClick: onRefresh, "aria-label": "刷新会话列表", children: refreshing ? "刷新中" : "刷新" })
		        ] }),
		        !catalog ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Empty, { children: error ?? (loading ? "正在读取 DSH 会话列表…" : "会话列表不可用。") }) : groups.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Empty, { children: searching ? "没有匹配的会话。" : "还没有可选择的会话。在 DSH 中开始一个对话后，它会出现在这里。" }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "wcb-scroll", children: groups.map((group, index) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
		          SessionGroup,
		          {
		            group,
		            open: isOpen(group, index),
		            selected: selectedSet,
		            disabled,
		            onToggleOpen: () => setOpen((state) => ({ ...state, [group.key]: !isOpen(group, index) })),
		            onSelectGroup: (on) => onChange(setAll(selected, group.sessions.map((session) => session.sessionId), on)),
		            onSelect: (id, on) => onChange(toggle(selected, id, on))
		          },
		          group.key
		        )) }),
		        catalog && catalog.hiddenSelections.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "wcb-hidden-list", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "wcb-hidden-head", children: [
		            "已勾选但当前不可操作（",
		            catalog.hiddenSelections.length,
		            "）",
		            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { flex: 1 } }),
		            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
		              import_dsh_client_ui_primitives6.Button,
		              {
		                variant: "ghost",
		                size: "sm",
		                disabled,
		                onClick: () => onChange(setAll(selected, catalog.hiddenSelections.map((item) => item.sessionId), false)),
		                children: "全部移除"
		              }
		            )
		          ] }),
		          catalog.hiddenSelections.map((item) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
		            CheckRow,
		            {
		              checked: selectedSet.has(item.sessionId),
		              label: `取消勾选 ${item.title ?? item.sessionId}`,
		              disabled,
		              onToggle: (on) => onChange(toggle(selected, item.sessionId, on)),
		              meta: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.Tag, { tone: "warning", children: HIDDEN_REASON[item.reason] }),
		              children: [
		                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "wcb-row-title", "data-muted": item.title ? void 0 : "", children: item.title ?? UNTITLED }),
		                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "wcb-row-sub wcb-mono", children: item.sessionId })
		              ]
		            },
		            item.sessionId
		          ))
		        ] }),
		        catalog && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "wcb-list-foot", children: [
		          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
		            "显示 ",
		            shown,
		            " / ",
		            catalog.total,
		            " 个会话"
		          ] }),
		          catalog.archived > 0 && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
		            "已隐藏 ",
		            catalog.archived,
		            " 个已归档会话"
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
		            "更新于 ",
		            relativeTime(catalog.generatedAt)
		          ] })
		        ] })
		      ]
		    }
		  );
		}
		function SessionGroup({ group, open, selected, disabled, onToggleOpen, onSelectGroup, onSelect }) {
		  const count = group.sessions.filter((session) => selected.has(session.sessionId)).length;
		  const all = count === group.sessions.length;
		  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "wcb-group", "data-open": open ? "" : void 0, children: [
		    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
		      "div",
		      {
		        className: "wcb-group-head",
		        role: "button",
		        tabIndex: 0,
		        "aria-expanded": open,
		        onClick: onToggleOpen,
		        onKeyDown: (event) => {
		          if (event.target !== event.currentTarget || event.key !== "Enter" && event.key !== " ") return;
		          event.preventDefault();
		          onToggleOpen();
		        },
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "wcb-chevron", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.IconChevronRightOutlineRegular, { size: 14 }) }),
		          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
		            "input",
		            {
		              type: "checkbox",
		              className: "wcb-check",
		              checked: all,
		              disabled,
		              "aria-label": `选择工作区 ${group.title} 的全部会话`,
		              ref: (element) => {
		                if (element) element.indeterminate = count > 0 && !all;
		              },
		              onClick: (event) => event.stopPropagation(),
		              onChange: (event) => onSelectGroup(event.target.checked)
		            }
		          ),
		          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "wcb-group-icon", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.IconFolderCloseRegular, { size: 16 }) }),
		          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "wcb-group-title", title: group.title, children: group.title }),
		          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "wcb-group-path", title: group.path, children: displayPath(group.path) }),
		          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { className: "wcb-group-count", children: [
		            count ? `${count}/` : "",
		            group.sessions.length
		          ] })
		        ]
		      }
		    ),
		    open && group.sessions.map((session) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
		      CheckRow,
		      {
		        checked: selected.has(session.sessionId),
		        label: `选择会话 ${session.title ?? session.sessionId}`,
		        disabled,
		        onToggle: (on) => onSelect(session.sessionId, on),
		        meta: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
		          session.pinned && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "wcb-pin", title: "已置顶", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.IconPinFillRegular, { size: 12 }) }),
		          session.running && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { className: "wcb-running", children: [
		            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives6.StateDot, { state: "ongoing", size: 12 }),
		            "运行中"
		          ] }),
		          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: relativeTime(session.updatedAt) })
		        ] }),
		        children: [
		          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "wcb-row-title", "data-muted": session.title ? void 0 : "", title: session.title ?? UNTITLED, children: session.title ?? UNTITLED }),
		          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "wcb-row-sub wcb-mono wcb-ellipsis", title: session.sessionId, children: session.sessionId })
		        ]
		      },
		      session.sessionId
		    ))
		  ] });
		}

		// src/client/components/StatusHeader.tsx
		var import_dsh_client_ui_primitives7 = require("@deepseek-ai/dsh-client-ui-primitives");
		var import_jsx_runtime7 = require("react/jsx-runtime");
		var PHASES = {
		  unconfigured: { label: "未配置", tone: "idle", dot: "idle" },
		  invalid: { label: "配置无效", tone: "err", dot: "error" },
		  connecting: { label: "连接中", tone: "warn", dot: "ongoing" },
		  online: { label: "在线", tone: "ok", dot: "done" },
		  reconnecting: { label: "重连中", tone: "warn", dot: "ongoing" },
		  offline: { label: "已断开", tone: "warn", dot: "warning" },
		  displaced: { label: "被其他连接替换", tone: "err", dot: "error" },
		  error: { label: "连接错误", tone: "err", dot: "error" }
		};
		function StatusHeader({ state, error }) {
		  const phase = state ? PHASES[state.connection.phase] ?? PHASES.error : void 0;
		  const traffic = state?.traffic;
		  const detail = error ?? state?.connection.detail;
		  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("header", { className: "wcb-hero", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "wcb-hero-mark", "aria-hidden": "true", children: "企" }),
		    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "wcb-hero-text", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "wcb-hero-title", children: "企业微信机器人" }),
		      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "wcb-hero-sub", children: "在企业微信里接收 DSH 的完成通知与提问，直接回复即可继续对应会话。" })
		    ] }),
		    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "wcb-hero-status", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "wcb-pill", "data-tone": error ? "err" : phase?.tone ?? "idle", role: "status", children: [
		        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives7.StateDot, { state: error ? "error" : phase?.dot ?? "ongoing" }),
		        error ? "状态不可用" : phase ? phase.label : "读取状态…",
		        state && !error && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: { fontWeight: 400, opacity: 0.75 }, children: [
		          "· ",
		          relativeTime(state.connection.since)
		        ] })
		      ] }),
		      detail && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "wcb-status-detail", children: detail })
		    ] }),
		    traffic && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "wcb-stats", "aria-label": "本次 DSH 启动以来的统计", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Stat, { value: traffic.received, label: `收到消息${traffic.lastMessageAt ? ` · ${relativeTime(traffic.lastMessageAt)}` : ""}` }),
		      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Stat, { value: traffic.rejected, label: "已拒绝" }),
		      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Stat, { value: traffic.prompts, label: "提交到 DSH" }),
		      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Stat, { value: traffic.notifications, label: "推送通知" })
		    ] })
		  ] });
		}
		function Stat({ value, label }) {
		  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "wcb-stat", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "wcb-stat-value", children: value }),
		    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "wcb-stat-label", children: label })
		  ] });
		}

		// src/client/components/SettingsPage.tsx
		var import_jsx_runtime8 = require("react/jsx-runtime");
		function SettingsPage({ scope, remote }) {
		  const snapshot = useFormSnapshot(scope);
		  if (snapshot.status !== "ready") {
		    return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "wcb-page", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "wcb-card", children: snapshot.status === "loading" ? "正在加载插件配置…" : "插件配置暂不可用：请确认插件已启用。" }) });
		  }
		  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(SettingsEditor, { snapshot, scope, remote });
		}
		function SettingsEditor({ snapshot, scope, remote }) {
		  const base = (0, import_react6.useMemo)(() => storedFrom(snapshot.value), [snapshot.revision]);
		  const [draft, setDraft] = (0, import_react6.useState)(() => draftFrom(base));
		  const [save, setSave] = (0, import_react6.useState)({ phase: "idle" });
		  const [showErrors, setShowErrors] = (0, import_react6.useState)(false);
		  const baseRef = (0, import_react6.useRef)(base);
		  const bridge = useBridgeState();
		  const secret = useSecretStatus(remote, base.secretEnv);
		  const writable = snapshot.writable !== false;
		  const busy = save.phase === "saving";
		  (0, import_react6.useEffect)(() => {
		    const previous = baseRef.current;
		    baseRef.current = base;
		    setDraft((current) => isDirty({ ...current, secret: "" }, previous) ? current : { ...draftFrom(base), secret: current.secret });
		  }, [base]);
		  const errors = validate(draft, secret.configured);
		  const invalid = Object.keys(errors).length > 0;
		  const dirty = isDirty(draft, base);
		  const summary = accessSummary(draft);
		  const update = (patch) => {
		    setDraft((current) => ({ ...current, ...patch }));
		    if (save.phase !== "saving") setSave({ phase: "idle" });
		  };
		  async function onSave() {
		    if (invalid) {
		      setShowErrors(true);
		      return;
		    }
		    setSave({ phase: "saving" });
		    try {
		      const ops = changedOperations(draft, base);
		      if (ops.length && !await scope.mutate(ops, snapshot.revision)) {
		        throw new Error("配置已在别处被修改，请刷新页面后重试。");
		      }
		      if (draft.secret.trim()) {
		        try {
		          await storeCredential(remote?.credentials, base.secretEnv, draft.secret.trim());
		        } catch (error) {
		          throw new Error(`其他配置已保存，但 Secret 保存失败：${error instanceof Error ? error.message : String(error)}`);
		        }
		        setDraft((current) => ({ ...current, secret: "" }));
		        secret.refresh();
		      }
		      setShowErrors(false);
		      setSave({ phase: "saved" });
		      setTimeout(() => bridge.refresh(true), 800);
		    } catch (error) {
		      setSave({ phase: "error", message: error instanceof Error ? error.message : String(error) });
		    }
		  }
		  const visibleErrors = showErrors ? errors : {};
		  const footer = !writable ? { tone: "error", text: "此部署的设置为只读。" } : save.phase === "error" ? { tone: "error", text: save.message } : showErrors && invalid ? { tone: "error", text: "请先修正标红的字段。" } : busy ? { tone: "", text: "正在保存…" } : dirty ? { tone: "dirty", text: "有未保存的更改" } : save.phase === "saved" ? { tone: "success", text: "已保存，机器人会按新配置重新连接。" } : { tone: "", text: "所有更改均已保存。" };
		  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "wcb-page", children: [
		    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(StatusHeader, { state: bridge.data, error: bridge.error }),
		    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(AccessBanner, { summary }),
		    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
		      CredentialsCard,
		      {
		        draft,
		        errors: visibleErrors,
		        secretConfigured: secret.configured,
		        disabled: !writable || busy,
		        onChange: update
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
		      SessionPicker,
		      {
		        catalog: bridge.data?.sessions,
		        error: bridge.data?.sessionsError ?? bridge.error,
		        loading: bridge.loading,
		        refreshing: bridge.refreshing,
		        selected: draft.sessionIds,
		        disabled: !writable || busy,
		        onChange: (sessionIds) => update({ sessionIds }),
		        onRefresh: () => bridge.refresh(true)
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
		      IdentityPicker,
		      {
		        observed: bridge.data?.observed,
		        chatIds: draft.chatIds,
		        userIds: draft.allowedUserIds,
		        disabled: !writable || busy,
		        connected: bridge.data?.connection.phase === "online",
		        onChange: (patch) => update(patch)
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
		      AdvancedCard,
		      {
		        draft,
		        errors: visibleErrors,
		        journal: bridge.data?.journal,
		        disabled: !writable || busy,
		        onChange: update
		      }
		    ),
		    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "wcb-footer", children: [
		      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "wcb-footer-msg", "data-tone": footer.tone || void 0, role: "status", children: footer.text }),
		      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Button, { variant: "outline", size: "sm", disabled: !dirty || busy, onClick: () => {
		        setDraft(draftFrom(base));
		        setShowErrors(false);
		        setSave({ phase: "idle" });
		      }, children: "放弃更改" }),
		      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives8.Button, { variant: "primary", size: "sm", disabled: !writable || busy || !dirty, onClick: () => {
		        void onSave();
		      }, children: busy ? "保存中…" : "保存配置" })
		    ] })
		  ] });
		}

		// src/client/styles.ts
		var STYLES = (
		  /* css */
		  `
		.wcb-page {
		  /* DSH is monochrome; the business blue is its accent for focus and info. */
		  --wcb-brand: var(--dsw-alias-state-business-primary, #4176e6);
		  --wcb-text: var(--dsw-alias-label-primary, #0f1115);
		  --wcb-text-2: var(--dsw-alias-label-secondary, #61666b);
		  --wcb-text-3: var(--dsw-alias-label-tertiary, #81858c);
		  --wcb-surface: var(--dsw-alias-bg-layer-1, #fff);
		  --wcb-surface-2: var(--dsw-alias-bg-module-platform, #f5f6f7);
		  --wcb-line: var(--dsw-alias-border-l2, rgba(0,0,0,.1));
		  --wcb-line-2: var(--dsw-alias-border-l3, rgba(0,0,0,.12));
		  --wcb-ok: var(--dsw-alias-state-success-primary, #1a7f37);
		  --wcb-warn: var(--dsw-alias-state-warn-primary, #bf8700);
		  --wcb-err: var(--dsw-alias-state-error-primary, #cf222e);
		  --wcb-hover: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.08));
		  --wcb-mono: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
		  box-sizing: border-box;
		  display: flex;
		  flex-direction: column;
		  gap: 16px;
		  max-width: 960px;
		  margin: 0 auto;
		  padding: 4px 0 24px;
		  color: var(--wcb-text);
		  font-size: 14px;
		  line-height: 1.5;
		}
		.wcb-page *, .wcb-page *::before, .wcb-page *::after { box-sizing: border-box; }

		/* Hero */
		.wcb-hero {
		  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
		  padding: 20px 22px; border-radius: 16px;
		  border: .5px solid var(--wcb-line);
		  background:
		    radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--wcb-brand) 14%, transparent), transparent 60%),
		    var(--wcb-surface);
		}
		.wcb-hero-mark {
		  flex: none; width: 46px; height: 46px; border-radius: 14px;
		  display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 18px;
		  background: linear-gradient(135deg, #2f9bff, #2a6df4);
		  box-shadow: 0 6px 18px color-mix(in srgb, #2a6df4 35%, transparent);
		}
		.wcb-hero-text { flex: 1; min-width: 220px; }
		.wcb-hero-title { font-size: 18px; font-weight: 650; letter-spacing: .2px; }
		.wcb-hero-sub { color: var(--wcb-text-2); font-size: 13px; margin-top: 2px; }
		.wcb-hero-status { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
		.wcb-pill {
		  display: inline-flex; align-items: center; gap: 8px;
		  padding: 4px 12px; border-radius: 999px; font-size: 13px; font-weight: 550;
		  background: var(--wcb-surface-2); border: .5px solid var(--wcb-line);
		}
		.wcb-pill[data-tone="ok"] { color: var(--wcb-ok); background: color-mix(in srgb, var(--wcb-ok) 10%, transparent); }
		.wcb-pill[data-tone="warn"] { color: var(--wcb-warn); background: color-mix(in srgb, var(--wcb-warn) 12%, transparent); }
		.wcb-pill[data-tone="err"] { color: var(--wcb-err); background: color-mix(in srgb, var(--wcb-err) 10%, transparent); }
		.wcb-status-detail { color: var(--wcb-text-3); font-size: 12px; max-width: 320px; text-align: right; }
		.wcb-stats {
		  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px;
		  width: 100%; margin-top: 4px; border-radius: 12px; overflow: hidden;
		  background: var(--wcb-line); border: .5px solid var(--wcb-line);
		}
		.wcb-stat { background: var(--wcb-surface); padding: 10px 14px; }
		.wcb-stat-value { font-size: 18px; font-weight: 650; font-variant-numeric: tabular-nums; }
		.wcb-stat-label { color: var(--wcb-text-3); font-size: 12px; }

		/* Banner */
		.wcb-banner {
		  display: flex; gap: 12px; align-items: flex-start;
		  padding: 14px 16px; border-radius: 14px; border: .5px solid var(--wcb-line);
		}
		.wcb-banner[data-tone="danger"] { border-color: color-mix(in srgb, var(--wcb-err) 40%, transparent); background: color-mix(in srgb, var(--wcb-err) 7%, var(--wcb-surface)); }
		.wcb-banner[data-tone="warning"] { border-color: color-mix(in srgb, var(--wcb-warn) 40%, transparent); background: color-mix(in srgb, var(--wcb-warn) 8%, var(--wcb-surface)); }
		.wcb-banner[data-tone="success"] { border-color: color-mix(in srgb, var(--wcb-ok) 35%, transparent); background: color-mix(in srgb, var(--wcb-ok) 6%, var(--wcb-surface)); }
		.wcb-banner-icon { flex: none; margin-top: 2px; }
		.wcb-banner[data-tone="danger"] .wcb-banner-icon { color: var(--wcb-err); }
		.wcb-banner[data-tone="warning"] .wcb-banner-icon { color: var(--wcb-warn); }
		.wcb-banner[data-tone="success"] .wcb-banner-icon { color: var(--wcb-ok); }
		.wcb-banner-title { font-weight: 650; }
		.wcb-banner-body { color: var(--wcb-text-2); font-size: 13px; margin-top: 4px; }
		.wcb-banner-body ol, .wcb-banner-body ul { margin: 6px 0 0; padding-left: 20px; }
		.wcb-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }

		/* Cards */
		.wcb-card {
		  background: var(--wcb-surface); border: .5px solid var(--wcb-line);
		  border-radius: 16px; padding: 18px 20px;
		}
		.wcb-card-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
		.wcb-step {
		  flex: none; width: 26px; height: 26px; border-radius: 50%;
		  display: grid; place-items: center; font-size: 12px; font-weight: 700;
		  color: var(--wcb-brand); background: color-mix(in srgb, var(--wcb-brand) 13%, transparent);
		}
		.wcb-card-titles { flex: 1; min-width: 0; }
		.wcb-card-title { font-size: 15px; font-weight: 650; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
		.wcb-card-desc { color: var(--wcb-text-2); font-size: 12.5px; margin-top: 2px; }
		.wcb-card-aside { flex: none; display: flex; gap: 6px; align-items: center; }

		/* Fields */
		.wcb-field {
		  display: grid; grid-template-columns: 168px minmax(0, 1fr); gap: 4px 18px;
		  padding: 12px 0; border-top: .5px solid var(--wcb-line);
		}
		.wcb-field:first-child { border-top: none; padding-top: 2px; }
		.wcb-field-label { font-weight: 550; padding-top: 6px; }
		.wcb-required { color: var(--wcb-err); margin-left: 2px; }
		.wcb-field-control { min-width: 0; }
		.wcb-field-row { display: flex; gap: 8px; align-items: center; }
		.wcb-grow { flex: 1; min-width: 0; width: 100%; }
		.wcb-hint { color: var(--wcb-text-3); font-size: 12px; margin-top: 6px; }
		.wcb-field-error { color: var(--wcb-err); font-size: 12px; margin-top: 6px; }
		.wcb-field[data-invalid] .wcb-grow { border-color: var(--wcb-err); }
		.wcb-number { width: 120px; }
		@media (max-width: 720px) {
		  .wcb-field { grid-template-columns: 1fr; }
		  .wcb-field-label { padding-top: 0; }
		  .wcb-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		}

		/* Lists */
		.wcb-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
		.wcb-toolbar .wcb-search { flex: 1; min-width: 220px; }
		.wcb-scroll { max-height: 460px; overflow: auto; display: flex; flex-direction: column; gap: 8px; padding: 1px; }
		.wcb-group { border: .5px solid var(--wcb-line); border-radius: 12px; overflow: hidden; background: var(--wcb-surface); }
		.wcb-group-head {
		  display: flex; align-items: center; gap: 8px; width: 100%;
		  padding: 9px 12px; background: var(--wcb-surface-2);
		  border: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
		}
		.wcb-group-head:hover { box-shadow: inset 0 0 0 999px var(--wcb-hover); }
		.wcb-chevron { flex: none; color: var(--wcb-text-3); transition: transform .15s ease; }
		.wcb-group[data-open] .wcb-chevron { transform: rotate(90deg); }
		.wcb-group-icon { flex: none; color: var(--wcb-text-2); }
		.wcb-group-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40%; }
		.wcb-group-path { flex: 1; min-width: 0; color: var(--wcb-text-3); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.wcb-group-count { flex: none; color: var(--wcb-text-2); font-size: 12px; font-variant-numeric: tabular-nums; }
		.wcb-row {
		  display: flex; align-items: center; gap: 12px;
		  padding: 9px 12px; border-top: .5px solid var(--wcb-line); cursor: pointer;
		}
		.wcb-row:hover { background: var(--wcb-hover); }
		.wcb-row[data-selected] { background: color-mix(in srgb, var(--wcb-brand) 7%, transparent); }
		.wcb-check { flex: none; width: 16px; height: 16px; margin: 0; accent-color: var(--wcb-brand); cursor: pointer; }
		.wcb-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
		.wcb-row-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
		.wcb-row-title[data-muted] { color: var(--wcb-text-3); font-weight: 400; font-style: italic; }
		.wcb-row-sub { display: flex; gap: 8px; align-items: center; color: var(--wcb-text-3); font-size: 12px; min-width: 0; }
		.wcb-mono { font-family: var(--wcb-mono); font-size: 11.5px; }
		.wcb-ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
		.wcb-row-meta { flex: none; display: flex; gap: 6px; align-items: center; color: var(--wcb-text-3); font-size: 12px; }
		.wcb-running { display: inline-flex; align-items: center; gap: 4px; color: var(--wcb-text-2); }
		.wcb-pin { color: var(--wcb-brand); display: inline-flex; }
		.wcb-list-foot { color: var(--wcb-text-3); font-size: 12px; margin-top: 10px; display: flex; gap: 12px; flex-wrap: wrap; }
		.wcb-empty {
		  padding: 22px 18px; border-radius: 12px; text-align: center;
		  border: 1px dashed var(--wcb-line-2); color: var(--wcb-text-2); font-size: 13px;
		}
		.wcb-empty ol { display: inline-block; text-align: left; margin: 8px 0 0; padding-left: 20px; color: var(--wcb-text-3); }
		.wcb-hidden-list { margin-top: 12px; border: .5px dashed color-mix(in srgb, var(--wcb-warn) 50%, transparent); border-radius: 12px; padding: 4px 0; }
		.wcb-hidden-head { padding: 6px 12px; font-size: 12.5px; color: var(--wcb-warn); font-weight: 600; display: flex; align-items: center; gap: 8px; }

		/* Identities */
		.wcb-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
		@media (max-width: 820px) { .wcb-columns { grid-template-columns: 1fr; } }
		.wcb-subhead { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
		.wcb-subhead-title { font-weight: 600; }
		.wcb-subhead-hint { color: var(--wcb-text-3); font-size: 12px; }
		.wcb-subhead .wcb-card-aside { margin-left: auto; }
		.wcb-panel { border: .5px solid var(--wcb-line); border-radius: 12px; overflow: hidden; }
		.wcb-panel .wcb-row:first-child { border-top: none; }
		.wcb-panel-scroll { max-height: 320px; overflow: auto; }
		.wcb-add { display: flex; gap: 8px; padding: 10px 12px; border-top: .5px solid var(--wcb-line); background: var(--wcb-surface-2); }

		/* Advanced */
		.wcb-details > summary { list-style: none; cursor: pointer; }
		.wcb-details > summary::-webkit-details-marker { display: none; }
		.wcb-details > summary .wcb-card-head { margin-bottom: 0; }
		.wcb-details[open] > summary .wcb-card-head { margin-bottom: 14px; }
		.wcb-details[open] > summary .wcb-chevron { transform: rotate(90deg); }
		.wcb-path {
		  font-family: var(--wcb-mono); font-size: 12px; padding: 7px 10px; border-radius: 8px;
		  background: var(--wcb-surface-2); border: .5px solid var(--wcb-line); word-break: break-all;
		}
		.wcb-code { font-family: var(--wcb-mono); font-size: 12px; background: var(--wcb-surface-2); padding: 1px 5px; border-radius: 5px; }

		/* Footer */
		.wcb-footer {
		  position: sticky; bottom: 12px; z-index: 2;
		  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
		  padding: 12px 14px 12px 18px; border-radius: 16px;
		  background: color-mix(in srgb, var(--wcb-surface) 88%, transparent);
		  border: .5px solid var(--wcb-line-2);
		  box-shadow: 0 10px 30px rgba(0, 0, 0, .12);
		  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
		}
		.wcb-footer-msg { flex: 1; min-width: 200px; display: flex; align-items: center; gap: 8px; color: var(--wcb-text-2); font-size: 13px; }
		.wcb-footer-msg[data-tone="error"] { color: var(--wcb-err); }
		.wcb-footer-msg[data-tone="success"] { color: var(--wcb-ok); }
		.wcb-footer-msg[data-tone="dirty"] { color: var(--wcb-warn); }
		`
		);
		function insertStyles(doc = document) {
		  const element = doc.createElement("style");
		  element.setAttribute("data-dsh-plugin", "wecom-bot");
		  element.textContent = STYLES;
		  doc.head.appendChild(element);
		  return () => element.remove();
		}

		// src/client/index.tsx
		var import_jsx_runtime9 = require("react/jsx-runtime");
		var inject = ["slots", "configForms", "remote", "remote.credentials"];
		function apply(ctx) {
		  const slots = ctx.get("slots");
		  const forms = ctx.get("configForms");
		  const remote = ctx.get("remote");
		  if (!slots || !forms) return;
		  ctx.effect(() => insertStyles(), "wecom-bot: styles");
		  ctx.effect(() => forms.whileServed([CONFIG_NAMESPACE], () => slots.inject("plugins.bundle.config", () => slots.register(
		    { name: "plugins.bundle.config", key: PACKAGE_NAME },
		    ({ view }) => view === "page" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(SettingsPage, { scope: forms.get(CONFIG_NAMESPACE), remote }) : null
		  ))), "wecom-bot: plugin homepage");
		}

		return module.exports;
	}
});
