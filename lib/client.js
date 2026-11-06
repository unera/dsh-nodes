window.__ModuleLoader__.load({
  id: "@dr-co/dsh-nodes",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
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

// src/client/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");
var BASE = "/api/dsh-nodes";
async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    ...options
  });
  const text = await response.text();
  const type = response.headers.get("content-type") ?? "";
  let parsed = null;
  if (text && type.includes("json")) {
    parsed = JSON.parse(text);
  } else if (text) {
    throw new Error(`${response.status}: ${text.replace(/\s+/g, " ").slice(0, 120)}`);
  }
  if (!response.ok) throw new Error(parsed?.message ?? `${response.status}`);
  return parsed;
}
var op = (payload) => request("/admin", { method: "POST", body: JSON.stringify(payload) });
var STYLE_ID = "dsh-nodes-styles";
var CSS = `
.dshn { display: flex; flex-direction: column; gap: 18px; font-size: 14px; }
.dshn h3 { font-size: 13px; letter-spacing: .04em; text-transform: uppercase; opacity: .6; margin: 0 0 8px; font-weight: 600; }
.dshn table { width: 100%; border-collapse: collapse; }
.dshn th, .dshn td { text-align: left; padding: 6px 8px; border-bottom: 1px solid rgba(128,128,128,.25); vertical-align: top; }
.dshn th { font-size: 12px; opacity: .6; font-weight: 600; }
.dshn code { font: 12px ui-monospace, SFMono-Regular, monospace; }
.dshn button { font: inherit; padding: 3px 9px; border-radius: 6px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; cursor: pointer; }
.dshn button:hover { border-color: currentColor; }
.dshn button.primary { border-color: #3b82f6; color: #3b82f6; }
.dshn button.danger { border-color: #ef4444; color: #ef4444; }
.dshn input { font: inherit; padding: 4px 7px; border-radius: 6px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; }
.dshn .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dshn .muted { opacity: .6; }
.dshn .pill { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid rgba(128,128,128,.4); }
.dshn .on { color: #16a34a; border-color: #16a34a88; }
.dshn .off { opacity: .6; }
.dshn .msg { min-height: 18px; font-size: 13px; }
.dshn .msg.bad { color: #ef4444; }
.dshn .msg.good { color: #16a34a; }
.dshn .secret { font: 12px ui-monospace, monospace; word-break: break-all; padding: 8px; border: 1px dashed #f59e0b; border-radius: 8px; margin-top: 8px; }
.dshn .empty { opacity: .6; padding: 8px 0; }
`;
function mountStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return () => {
  };
  const element = document.createElement("style");
  element.id = STYLE_ID;
  element.textContent = CSS;
  document.head.appendChild(element);
  return () => element.remove();
}
function ago(ms) {
  if (!ms) return "\u043D\u0438\u043A\u043E\u0433\u0434\u0430";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1e3));
  if (s < 60) return `${s}\u0441`;
  if (s < 3600) return `${Math.round(s / 60)}\u043C`;
  if (s < 86400) return `${Math.round(s / 3600)}\u0447`;
  return `${Math.round(s / 86400)}\u0434`;
}
function NodeRow({ node, busy, onAliases, onToken, onDelete }) {
  const [aliases, setAliases] = (0, import_react.useState)(node.aliases.join(", "));
  const signature = node.aliases.join(",");
  (0, import_react.useEffect)(() => {
    setAliases(node.aliases.join(", "));
  }, [signature]);
  return (0, import_react.createElement)("tr", null, [
    (0, import_react.createElement)("td", { key: "id" }, (0, import_react.createElement)("code", null, node.id)),
    (0, import_react.createElement)("td", { key: "name" }, [
      (0, import_react.createElement)("div", { key: "n" }, node.name),
      (0, import_react.createElement)("div", { key: "a", className: "row", style: { marginTop: 4 } }, [
        (0, import_react.createElement)("input", {
          key: "i",
          value: aliases,
          placeholder: "\u0430\u043B\u0438\u0430\u0441\u044B \u0447\u0435\u0440\u0435\u0437 \u0437\u0430\u043F\u044F\u0442\u0443\u044E",
          style: { width: 220 },
          onChange: (event) => setAliases(event.target.value)
        }),
        (0, import_react.createElement)("button", {
          key: "b",
          disabled: busy,
          onClick: () => onAliases(node.id, aliases.split(",").map((v) => v.trim()).filter(Boolean))
        }, "\u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C")
      ])
    ]),
    (0, import_react.createElement)("td", { key: "state" }, [
      (0, import_react.createElement)("span", { key: "p", className: `pill ${node.online ? "on" : "off"}` }, node.online ? "online" : "offline"),
      (0, import_react.createElement)("span", { key: "t", className: "muted" }, node.online ? "" : ` ${ago(node.lastSeen)}`),
      node.queued ? (0, import_react.createElement)("div", { key: "q", className: "muted", style: { fontSize: 12 } }, `\u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 ${node.queued}`) : null
    ]),
    (0, import_react.createElement)(
      "td",
      { key: "apis" },
      node.apis.length ? node.apis.map((api) => (0, import_react.createElement)("code", { key: api.id, style: { marginRight: 8 } }, `${api.name}${api.version ? " @" + api.version : ""}`)) : (0, import_react.createElement)("span", { className: "muted" }, "\u2014")
    ),
    (0, import_react.createElement)("td", { key: "access" }, [
      (0, import_react.createElement)("div", { key: "a" }, node.access),
      node.clientVersion ? (0, import_react.createElement)("div", { key: "v", className: "muted", style: { fontSize: 12 } }, node.clientVersion) : null
    ]),
    (0, import_react.createElement)("td", { key: "actions" }, (0, import_react.createElement)("div", { className: "row" }, [
      (0, import_react.createElement)("button", { key: "t", disabled: busy, onClick: () => onToken(node.id) }, "\u0442\u043E\u043A\u0435\u043D"),
      (0, import_react.createElement)("button", { key: "d", className: "danger", disabled: busy, onClick: () => onDelete(node.id) }, "\u0443\u0434\u0430\u043B\u0438\u0442\u044C")
    ]))
  ]);
}
function NodesPanel() {
  const [nodes, setNodes] = (0, import_react.useState)([]);
  const [pending, setPending] = (0, import_react.useState)([]);
  const [epoch, setEpoch] = (0, import_react.useState)(null);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [message, setMessage] = (0, import_react.useState)({ text: "", kind: "" });
  const [secret, setSecret] = (0, import_react.useState)(null);
  const [link, setLink] = (0, import_react.useState)(null);
  const [ttl, setTtl] = (0, import_react.useState)(600);
  const [newName, setNewName] = (0, import_react.useState)("");
  const say = (text, kind = "") => setMessage({ text, kind });
  async function load() {
    try {
      const [list, waiting] = await Promise.all([request("/nodes"), request("/pending")]);
      setNodes(list.nodes ?? []);
      setEpoch(list.epoch ?? null);
      setPending(waiting.pending ?? []);
    } catch (error) {
      say(error.message, "bad");
    }
  }
  (0, import_react.useEffect)(() => {
    load();
    const timer = setInterval(load, 5e3);
    return () => clearInterval(timer);
  }, []);
  async function run(payload, okText) {
    setBusy(true);
    try {
      const result = await op(payload);
      say(okText, "good");
      if (result?.token) setSecret(result.token);
      if (result?.rejected?.length) say(`\u0437\u0430\u043D\u044F\u0442\u044B \u0434\u0440\u0443\u0433\u0438\u043C\u0438 \u0443\u0437\u043B\u0430\u043C\u0438: ${result.rejected.join(", ")}`, "bad");
      await load();
    } catch (error) {
      say(error.message, "bad");
    } finally {
      setBusy(false);
    }
  }
  return (0, import_react.createElement)("div", { className: "dshn" }, [
    (0, import_react.createElement)(
      "div",
      { key: "msg", className: `msg ${message.kind}` },
      message.text || (epoch != null ? `epoch ${epoch}, \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432 ${nodes.length}` : "")
    ),
    secret ? (0, import_react.createElement)("div", { key: "secret", className: "secret" }, `\u0442\u043E\u043A\u0435\u043D (\u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u043E\u0434\u0438\u043D \u0440\u0430\u0437): ${secret}`) : null,
    (0, import_react.createElement)("section", { key: "pair" }, [
      (0, import_react.createElement)("h3", { key: "h" }, "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u0430"),
      (0, import_react.createElement)("div", { key: "r", className: "row" }, [
        (0, import_react.createElement)("input", { key: "ttl", type: "number", value: ttl, style: { width: 90 }, onChange: (e) => setTtl(Number(e.target.value) || 600) }),
        (0, import_react.createElement)("button", {
          key: "b",
          className: "primary",
          disabled: busy,
          onClick: async () => {
            try {
              const result = await op({ op: "pair", body: { ttlSeconds: ttl } });
              setLink(result.url);
              say("\u0441\u0441\u044B\u043B\u043A\u0430 \u0433\u043E\u0442\u043E\u0432\u0430", "good");
            } catch (error) {
              say(error.message, "bad");
            }
          }
        }, "\u0441\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441\u0441\u044B\u043B\u043A\u0443"),
        (0, import_react.createElement)("span", { key: "t", className: "muted" }, "\u0441\u0435\u043A\u0443\u043D\u0434\u044B \u0436\u0438\u0437\u043D\u0438 \u0441\u0441\u044B\u043B\u043A\u0438")
      ]),
      link ? (0, import_react.createElement)("div", { key: "l", className: "secret" }, link) : null,
      (0, import_react.createElement)(
        "div",
        { key: "hint", className: "muted", style: { fontSize: 12, marginTop: 6 } },
        "\u041D\u0430 \u0443\u0437\u043B\u0435: dshnc connect <\u0441\u0441\u044B\u043B\u043A\u0430>. \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u0442\u044C \u0437\u0434\u0435\u0441\u044C \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0443\u0436\u043D\u043E, \u043A\u043E\u0434 \u043E\u0434\u043D\u043E\u0440\u0430\u0437\u043E\u0432\u044B\u0439."
      )
    ]),
    (0, import_react.createElement)("section", { key: "pending" }, [
      (0, import_react.createElement)("h3", { key: "h" }, `\u0417\u0430\u044F\u0432\u043A\u0438 \u0431\u0435\u0437 \u043A\u043E\u0434\u0430 (${pending.length})`),
      pending.length === 0 ? (0, import_react.createElement)("div", { key: "e", className: "empty" }, "\u043D\u0435\u0442") : (0, import_react.createElement)("table", { key: "t" }, [
        (0, import_react.createElement)("thead", { key: "head" }, (0, import_react.createElement)("tr", null, [
          (0, import_react.createElement)("th", { key: "n" }, "\u0438\u043C\u044F"),
          (0, import_react.createElement)("th", { key: "i" }, "id"),
          (0, import_react.createElement)("th", { key: "a" }, "\u0430\u0434\u0440\u0435\u0441"),
          (0, import_react.createElement)("th", { key: "w" }, "\u0432\u0438\u0441\u0438\u0442"),
          (0, import_react.createElement)("th", { key: "x" }, "")
        ])),
        (0, import_react.createElement)("tbody", { key: "body" }, pending.map((row) => (0, import_react.createElement)("tr", { key: row.uuid }, [
          (0, import_react.createElement)("td", { key: "n" }, row.name),
          (0, import_react.createElement)("td", { key: "i" }, (0, import_react.createElement)("code", null, row.short)),
          (0, import_react.createElement)("td", { key: "a" }, row.ip ?? "\u2014"),
          (0, import_react.createElement)("td", { key: "w" }, `${row.waiting} \u0441`),
          (0, import_react.createElement)("td", { key: "x" }, (0, import_react.createElement)("div", { className: "row" }, [
            (0, import_react.createElement)("button", { key: "y", className: "primary", disabled: busy, onClick: () => run({ op: "approve", id: row.uuid }, "\u0434\u043E\u043F\u0443\u0449\u0435\u043D") }, "\u0434\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C"),
            (0, import_react.createElement)("button", { key: "r", className: "danger", disabled: busy, onClick: () => run({ op: "reject", id: row.uuid }, "\u043E\u0442\u043A\u043B\u043E\u043D\u0451\u043D") }, "\u043E\u0442\u043A\u043B\u043E\u043D\u0438\u0442\u044C")
          ]))
        ])))
      ])
    ]),
    (0, import_react.createElement)("section", { key: "nodes" }, [
      (0, import_react.createElement)("h3", { key: "h" }, `\u0423\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430 (${nodes.length})`),
      nodes.length === 0 ? (0, import_react.createElement)("div", { key: "e", className: "empty" }, "\u043D\u0435\u0442") : (0, import_react.createElement)("table", { key: "t" }, [
        (0, import_react.createElement)("thead", { key: "head" }, (0, import_react.createElement)("tr", null, [
          (0, import_react.createElement)("th", { key: "i" }, "id"),
          (0, import_react.createElement)("th", { key: "n" }, "\u0438\u043C\u044F / \u0430\u043B\u0438\u0430\u0441\u044B"),
          (0, import_react.createElement)("th", { key: "s" }, "\u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435"),
          (0, import_react.createElement)("th", { key: "a" }, "API"),
          (0, import_react.createElement)("th", { key: "d" }, "\u0434\u043E\u0441\u0442\u0443\u043F"),
          (0, import_react.createElement)("th", { key: "x" }, "")
        ])),
        (0, import_react.createElement)("tbody", { key: "body" }, nodes.map((node) => (0, import_react.createElement)(NodeRow, {
          key: node.id,
          node,
          busy,
          onAliases: (id, aliases) => run({ op: "update", id, body: { aliases } }, "\u0430\u043B\u0438\u0430\u0441\u044B \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B"),
          onToken: (id) => run({ op: "token", id }, "\u0442\u043E\u043A\u0435\u043D \u043F\u0435\u0440\u0435\u0432\u044B\u043F\u0443\u0449\u0435\u043D"),
          onDelete: (id) => {
            if (typeof window !== "undefined" && !window.confirm(`\u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0443\u0437\u0435\u043B ${id}?`)) return;
            run({ op: "delete", id }, "\u0443\u0434\u0430\u043B\u0451\u043D");
          }
        })))
      ])
    ]),
    (0, import_react.createElement)("section", { key: "create" }, [
      (0, import_react.createElement)("h3", { key: "h" }, "\u041D\u043E\u0432\u044B\u0439 \u0443\u0437\u0435\u043B \u0432\u0440\u0443\u0447\u043D\u0443\u044E"),
      (0, import_react.createElement)("div", { key: "r", className: "row" }, [
        (0, import_react.createElement)("input", { key: "i", value: newName, placeholder: "\u0438\u043C\u044F, \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 nbw", style: { width: 220 }, onChange: (e) => setNewName(e.target.value) }),
        (0, import_react.createElement)("button", {
          key: "b",
          disabled: busy || !newName.trim(),
          onClick: () => {
            run({ op: "create", body: { name: newName.trim() } }, "\u0443\u0437\u0435\u043B \u0441\u043E\u0437\u0434\u0430\u043D");
            setNewName("");
          }
        }, "\u0441\u043E\u0437\u0434\u0430\u0442\u044C \u0438 \u0432\u044B\u0434\u0430\u0442\u044C \u0442\u043E\u043A\u0435\u043D")
      ])
    ])
  ]);
}
var name = "dsh-nodes";
var inject = ["slots"];
function apply(ctx) {
  try {
    const disposeStyles = mountStyles();
    if (typeof ctx?.effect === "function") ctx.effect(() => disposeStyles);
    const slots = ctx?.slots;
    if (!slots?.register) {
      console.warn("[dsh-nodes] \u0441\u043B\u043E\u0442\u044B \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B: \u043F\u0430\u043D\u0435\u043B\u044C \u043D\u0435 \u0441\u043C\u043E\u043D\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0430");
      return;
    }
    slots.inject("settings.section", () => slots.register(
      { name: "settings.section", id: "dsh-nodes", order: 35, label: () => "\u0423\u0437\u043B\u044B" },
      NodesPanel
    ));
  } catch (error) {
    console.warn("[dsh-nodes] \u043A\u043B\u0438\u0435\u043D\u0442\u0441\u043A\u0430\u044F \u043F\u043E\u043B\u043E\u0432\u0438\u043D\u0430 \u043D\u0435 \u0441\u043C\u043E\u043D\u0442\u0438\u0440\u043E\u0432\u0430\u043B\u0430\u0441\u044C:", error);
  }
}

    return module.exports;
  }
});
