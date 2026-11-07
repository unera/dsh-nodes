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
var op = (payload) => request("/op", { method: "POST", body: JSON.stringify(payload) });
var STYLE_ID = "dsh-nodes-styles";
var CSS = `
.dshn { display: flex; flex-direction: column; gap: 16px; font-size: 14px; }
.dshn h3 { font-size: 13px; letter-spacing: .04em; text-transform: uppercase; opacity: .6; margin: 0 0 8px; font-weight: 600; }
.dshn table { width: 100%; border-collapse: collapse; }
.dshn th, .dshn td { text-align: left; padding: 7px 8px; border-bottom: 1px solid rgba(128,128,128,.25); vertical-align: top; }
.dshn th { font-size: 12px; opacity: .6; font-weight: 600; }
.dshn code { font: 12px ui-monospace, SFMono-Regular, monospace; }
.dshn button { font: inherit; padding: 3px 9px; border-radius: 6px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; cursor: pointer; }
.dshn button:hover { border-color: currentColor; }
.dshn button.primary { border-color: #3b82f6; color: #3b82f6; }
.dshn button.danger { color: #ef4444; }
.dshn button.glyph { padding: 4px 6px; display: inline-flex; align-items: center; justify-content: center; border-color: transparent; }
.dshn button.glyph:hover { background: rgba(128,128,128,.15); border-color: rgba(128,128,128,.4); }
.dshn input, .dshn textarea { font: inherit; padding: 5px 8px; border-radius: 6px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; box-sizing: border-box; width: 100%; }
.dshn .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dshn .muted { opacity: .6; }
.dshn .badge { font-size: 11px; padding: 1px 6px; border-radius: 6px; border: 1px solid rgba(128,128,128,.35); cursor: help; }
/* \u0440\u0435\u0436\u0438\u043C\u044B \u0446\u0432\u0435\u0442\u043E\u043C: ro \u2014 \u043A\u0440\u0430\u0441\u043D\u044B\u0439, rw \u2014 \u0441\u0438\u043D\u0438\u0439, full \u2014 \u0437\u0435\u043B\u0451\u043D\u044B\u0439 */
.dshn .badge.ro { color: #ef4444; border-color: #ef444488; }
.dshn .badge.rw { color: #3b82f6; border-color: #3b82f688; }
.dshn .badge.fa { color: #16a34a; border-color: #16a34a88; }
.dshn .pill { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid rgba(128,128,128,.4); margin-left: 6px; white-space: nowrap; }
.dshn .on { color: #16a34a; border-color: #16a34a88; }
/* \u0441\u0432\u044F\u0437\u044C \u0431\u044B\u043B\u0430 \u0431\u043E\u043B\u044C\u0448\u0435 \u043C\u0438\u043D\u0443\u0442\u044B \u043D\u0430\u0437\u0430\u0434 \u2014 \u0443\u0436\u0435 \u043D\u0435 \u0437\u0435\u043B\u0451\u043D\u044B\u0439 */
.dshn .stale { color: #3b82f6; border-color: #3b82f688; }
/* \u0431\u043E\u043B\u044C\u0448\u0435 \u043F\u044F\u0442\u0438 \u043C\u0438\u043D\u0443\u0442 \u2014 \u0441\u0435\u0440\u044B\u0439 */
.dshn .cold { color: #6b7280; border-color: #6b728088; }
/* offline \u2014 \u043A\u0440\u0430\u0441\u043D\u044B\u0439 */
.dshn .off { color: #ef4444; border-color: #ef444488; }
.dshn .tabs { display: flex; gap: 6px; margin: 10px 0; border-bottom: 1px solid rgba(128,128,128,.25); }
.dshn .tab { font: inherit; font-size: 13px; padding: 6px 12px; background: transparent; border: none; border-bottom: 2px solid transparent; color: inherit; opacity: .65; cursor: pointer; }
.dshn .tab.active { opacity: 1; border-bottom-color: currentColor; }
.dshn .msg { min-height: 18px; font-size: 13px; }
.dshn .msg.bad { color: #ef4444; }
.dshn .msg.good { color: #16a34a; }
.dshn .secret { font: 12px ui-monospace, monospace; word-break: break-all; padding: 8px; border: 1px dashed #f59e0b; border-radius: 8px; margin-top: 8px; }
.dshn .empty { opacity: .6; padding: 8px 0; }
.dshn .aliases { font-size: 12px; opacity: .6; margin-top: 2px; }
.dshn .chips { display: flex; flex-wrap: wrap; gap: 4px; max-width: 240px; }
.dshn .chip { font: 12px ui-monospace, monospace; padding: 1px 6px; border-radius: 4px; background: rgba(128,128,128,.15); white-space: nowrap; }
.dshn .editor { border: 1px solid rgba(128,128,128,.35); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.dshn .editor label { font-size: 12px; opacity: .7; display: block; margin-bottom: 4px; }
.dshn .actions { display: flex; gap: 2px; justify-content: flex-end; }
.dshn .tipbox { position: fixed; z-index: 40; padding: 3px 8px; border-radius: 5px; font-size: 12px; white-space: nowrap; background: rgba(28,28,30,.97); color: #fff; border: 1px solid rgba(255,255,255,.18); pointer-events: none; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
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
function splitAliases(value) {
  return String(value ?? "").split(/[,\n;]+/).map((part) => part.trim()).filter(Boolean);
}
function uptimeText(seconds) {
  if (seconds == null) return null;
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}\u0441`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes}\u043C`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours}\u0447 ${rest}\u043C` : `${hours}\u0447`;
  return `${Math.floor(hours / 24)}\u0434 ${hours % 24}\u0447`;
}
var MODE_TEXT = {
  "read-only": "ro",
  "workspace-write": "rw",
  "danger-full-access": "FA",
  ro: "ro",
  rw: "rw",
  full: "FA"
};
var MODE_TITLE = {
  "read-only": "ro \u2014 \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u0435\u043D\u0438\u0435 (read-only)",
  "workspace-write": "rw \u2014 \u0437\u0430\u043F\u0438\u0441\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u043D\u0443\u0442\u0440\u0438 \u0440\u0430\u0437\u0440\u0435\u0448\u0451\u043D\u043D\u044B\u0445 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u043E\u0432 (workspace-write)",
  "danger-full-access": "FA \u2014 \u0431\u0435\u0437 \u043F\u0435\u0441\u043E\u0447\u043D\u0438\u0446\u044B: \u043F\u043E\u043B\u043D\u044B\u0439 \u0434\u043E\u0441\u0442\u0443\u043F (danger-full-access)",
  ro: "ro \u2014 \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u0435\u043D\u0438\u0435 (read-only)",
  rw: "rw \u2014 \u0437\u0430\u043F\u0438\u0441\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u043D\u0443\u0442\u0440\u0438 \u0440\u0430\u0437\u0440\u0435\u0448\u0451\u043D\u043D\u044B\u0445 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u043E\u0432 (workspace-write)",
  full: "FA \u2014 \u0431\u0435\u0437 \u043F\u0435\u0441\u043E\u0447\u043D\u0438\u0446\u044B: \u043F\u043E\u043B\u043D\u044B\u0439 \u0434\u043E\u0441\u0442\u0443\u043F (danger-full-access)"
};
function modeBadge(label, mode, kind) {
  if (!mode) return null;
  const text = MODE_TEXT[mode] ?? mode;
  const tone = {
    ro: "ro",
    rw: "rw",
    full: "fa",
    "read-only": "ro",
    "workspace-write": "rw",
    "danger-full-access": "fa"
  }[mode] ?? null;
  const explain = MODE_TITLE[mode] ?? String(mode);
  const hint = kind === "base" ? `base: ${explain}. \u0412 \u044D\u0442\u043E\u043C \u0440\u0435\u0436\u0438\u043C\u0435 \u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u0441\u0442\u0430\u0440\u0442\u0443\u0435\u0442.` : `upto: ${explain}. \u041F\u043E\u0442\u043E\u043B\u043E\u043A \u0443\u0437\u043B\u0430: \u0432\u044B\u0448\u0435 \u043D\u0435 \u043F\u043E\u0434\u043D\u0438\u043C\u0435\u0442\u0441\u044F \u0434\u0430\u0436\u0435 \u0441 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u0435\u043C.`;
  return (0, import_react.createElement)("span", { key: label, className: `badge ${tone ?? ""}`, title: hint }, `${label}:${text}`);
}
function approverBadge(approver) {
  const view = {
    server: { glyph: "\u{1F310}", hint: "web: \u0441\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u0435\u0442 \u0447\u0435\u043B\u043E\u0432\u0435\u043A \u0432 DSH \u2014 \u0432\u043E\u043F\u0440\u043E\u0441 \u043F\u0440\u0438\u0445\u043E\u0434\u0438\u0442 \u0432 GUI" },
    local: { glyph: "\u{1F4BB}", hint: "local: \u0441\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u0435\u0442 \u0447\u0435\u043B\u043E\u0432\u0435\u043A \u0437\u0430 \u044D\u0442\u043E\u0439 \u043C\u0430\u0448\u0438\u043D\u043E\u0439 \u2014 \u0432\u043E\u043F\u0440\u043E\u0441 \u0432\u0441\u043F\u043B\u044B\u0432\u0430\u0435\u0442 \u043D\u0430 \u0443\u0437\u043B\u0435 (zenity \u0438 \u043F\u043E\u0434\u043E\u0431\u043D\u043E\u0435)" },
    none: { glyph: "\u2205", hint: "none: \u0432\u043E\u043F\u0440\u043E\u0441\u044B \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u044B \u2014 \u043E\u0442\u043A\u0430\u0437 \u043F\u0435\u0441\u043E\u0447\u043D\u0438\u0446\u044B \u043E\u043A\u043E\u043D\u0447\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0439" }
  }[approver];
  if (!view) return null;
  return (0, import_react.createElement)("span", { key: "approver", className: "badge", title: view.hint }, view.glyph);
}
function row(what, value) {
  return (0, import_react.createElement)("tr", { key: what }, [
    (0, import_react.createElement)("td", { key: "w", className: "muted" }, what),
    (0, import_react.createElement)("td", { key: "v" }, (0, import_react.createElement)("code", null, String(value)))
  ]);
}
function pillState(node) {
  if (!pillOnline(node)) return "off";
  const age = node.lastSeen ? Date.now() - node.lastSeen : Infinity;
  if (age < 6e4) return "on";
  if (age < 3e5) return "stale";
  return "cold";
}
function pillOnline(node) {
  if (typeof node.attached === "boolean") return node.attached;
  return Boolean(node.online);
}
function ago(ms) {
  if (!ms) return "\u043D\u0438\u043A\u043E\u0433\u0434\u0430";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1e3));
  if (s < 60) return `${s}\u0441`;
  if (s < 3600) return `${Math.round(s / 60)}\u043C`;
  if (s < 86400) return `${Math.round(s / 3600)}\u0447`;
  return `${Math.round(s / 86400)}\u0434`;
}
function Glyph({ kind }) {
  const paths = {
    edit: "M4 20h4l10-10-4-4L4 16v4zm12.7-12.7 1.6-1.6a1 1 0 0 0 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0l-1.6 1.6 3 3z",
    unplug: "M8.5 7.5 6 10a4.5 4.5 0 0 0 0 6.4l1.6 1.6M15.5 16.5 18 14a4.5 4.5 0 0 0 0-6.4l-1.6-1.6M9 15l6-6",
    trash: "M9 3h6l1 2h4v2H4V5h4l1-2zM6 8h12l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8z"
  };
  return (0, import_react.createElement)("svg", {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: kind === "unplug" ? "none" : "currentColor",
    stroke: kind === "unplug" ? "currentColor" : "none",
    strokeWidth: kind === "unplug" ? 1.8 : 0,
    strokeLinecap: "round",
    "aria-hidden": "true"
  }, (0, import_react.createElement)("path", { d: paths[kind] }));
}
function GlyphButton({ kind, title, onClick, disabled, className }) {
  return (0, import_react.createElement)("button", {
    className: `glyph ${className ?? ""}`,
    // position: fixed у подсказки — потому что панель настроек обрезает всё,
    // что выходит за её границы
    "data-tip": title,
    "aria-label": title,
    disabled: Boolean(disabled),
    onClick
  }, (0, import_react.createElement)(Glyph, { kind }));
}
function NodeEditor({ node, busy, error, onSave, onCancel }) {
  const outside = () => node.aliases.filter((alias) => alias.toLowerCase() !== node.name.toLowerCase());
  const [name2, setName] = (0, import_react.useState)(node.name);
  const [aliases, setAliases] = (0, import_react.useState)(outside().join(", "));
  (0, import_react.useEffect)(() => {
    setName(node.name);
    setAliases(node.aliases.filter((alias) => alias.toLowerCase() !== node.name.toLowerCase()).join(", "));
  }, [node.id, node.name, node.aliases.join(",")]);
  const submit = () => onSave(node.id, { name: name2.trim(), aliases: splitAliases(aliases) });
  return (0, import_react.createElement)("div", { className: "editor" }, [
    (0, import_react.createElement)("div", { key: "title", className: "row" }, [
      (0, import_react.createElement)("strong", { key: "t" }, `\u0423\u0437\u0435\u043B ${node.id}`),
      (0, import_react.createElement)("span", { key: "n", className: "muted" }, "\u043F\u0440\u0430\u0432\u043A\u0430 \u0438\u043C\u0435\u043D\u0438 \u0438 \u0430\u043B\u0438\u0430\u0441\u043E\u0432")
    ]),
    (0, import_react.createElement)("div", { key: "name" }, [
      (0, import_react.createElement)("label", { key: "l" }, "\u0418\u043C\u044F \u0443\u0437\u043B\u0430"),
      (0, import_react.createElement)("input", {
        key: "i",
        value: name2,
        onChange: (event) => setName(event.target.value),
        onKeyDown: (event) => {
          if (event.key === "Enter") submit();
        }
      })
    ]),
    (0, import_react.createElement)("div", { key: "aliases" }, [
      (0, import_react.createElement)("label", { key: "l" }, "\u0410\u043B\u0438\u0430\u0441\u044B \u0447\u0435\u0440\u0435\u0437 \u0437\u0430\u043F\u044F\u0442\u0443\u044E (\u043F\u043E \u043B\u044E\u0431\u043E\u043C\u0443 \u0438\u0437 \u043D\u0438\u0445 \u0443\u0437\u0435\u043B \u043C\u043E\u0436\u043D\u043E \u043F\u043E\u0437\u0432\u0430\u0442\u044C)"),
      (0, import_react.createElement)("textarea", {
        key: "t",
        rows: 2,
        value: aliases,
        onChange: (event) => setAliases(event.target.value)
      })
    ]),
    error ? (0, import_react.createElement)("div", { key: "error", className: "msg bad", style: { minHeight: 0 } }, error) : null,
    (0, import_react.createElement)("div", { key: "actions", className: "row" }, [
      (0, import_react.createElement)("button", { key: "save", className: "primary", disabled: busy || !name2.trim(), onClick: submit }, "\u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C"),
      (0, import_react.createElement)("button", { key: "cancel", disabled: busy, onClick: onCancel }, "\u043E\u0442\u043C\u0435\u043D\u0430")
    ])
  ]);
}
function NodeRow({ node, busy, onEdit, onRevoke, onDelete }) {
  return (0, import_react.createElement)("tr", null, [
    (0, import_react.createElement)("td", { key: "id" }, (0, import_react.createElement)("code", null, node.id)),
    (0, import_react.createElement)("td", { key: "name" }, [
      (0, import_react.createElement)("div", { key: "n" }, [
        (0, import_react.createElement)("span", { key: "name" }, node.name),
        (0, import_react.createElement)("span", {
          key: "pill",
          // цвет плашки говорит о свежести связи: зелёный — только что, синий —
          // больше минуты, серый — больше пяти, красный — связи нет вовсе
          className: `pill ${pillState(node)}`,
          title: node.lastSeen ? `\u043F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u0441\u0432\u044F\u0437\u044C: ${ago(node.lastSeen)} \u043D\u0430\u0437\u0430\u0434` : "\u0441\u0432\u044F\u0437\u0438 \u0435\u0449\u0451 \u043D\u0435 \u0431\u044B\u043B\u043E"
        }, pillOnline(node) ? "online" : "offline")
      ]),
      (0, import_react.createElement)("div", { key: "a", className: "aliases" }, node.aliases.filter((alias) => alias !== node.name).join(", ") || "\u0431\u0435\u0437 \u0430\u043B\u0438\u0430\u0441\u043E\u0432"),
      // аптайм отдельной строкой под именем: видно, работает ли узел с ночи или
      // только что перезапустился
      node.online && uptimeText(node.uptimeSeconds) ? (0, import_react.createElement)("div", { key: "u", className: "muted", style: { fontSize: 12, marginTop: 2 } }, `\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 ${uptimeText(node.uptimeSeconds)}`) : null
    ]),
    (0, import_react.createElement)("td", { key: "apis" }, (0, import_react.createElement)(
      "div",
      { className: "chips" },
      node.apis.length ? node.apis.map((api) => (0, import_react.createElement)("span", { key: api.id, className: "chip" }, `${api.name}${api.version ? `@${api.version}` : ""}`)) : (0, import_react.createElement)("span", { className: "muted" }, "\u2014")
    )),
    (0, import_react.createElement)("td", { key: "access" }, [
      (0, import_react.createElement)("div", { key: "modes", style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" } }, [
        modeBadge("base", node.base, "base"),
        modeBadge("upto", node.access, "upto"),
        approverBadge(node.approver)
      ]),
      node.clientVersion ? (0, import_react.createElement)("div", { key: "v", className: "muted", style: { fontSize: 12 } }, node.clientVersion) : null
    ]),
    (0, import_react.createElement)("td", { key: "actions" }, (0, import_react.createElement)("div", { className: "actions" }, [
      (0, import_react.createElement)(GlyphButton, { key: "e", kind: "edit", title: "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C", disabled: busy, onClick: () => onEdit(node.id) }),
      (0, import_react.createElement)(GlyphButton, { key: "t", kind: "unplug", title: "\u041E\u0442\u043E\u0437\u0432\u0430\u0442\u044C \u0442\u043E\u043A\u0435\u043D", disabled: busy, onClick: () => onRevoke(node.id) }),
      (0, import_react.createElement)(GlyphButton, { key: "d", kind: "trash", title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C", disabled: busy, className: "danger", onClick: () => onDelete(node.id) })
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
  const [audit, setAudit] = (0, import_react.useState)([]);
  const [settings, setSettings] = (0, import_react.useState)(null);
  const [tab, setTab] = (0, import_react.useState)("connections");
  const only = (name2) => ({ display: tab === name2 ? "block" : "none" });
  const tabButton = (id, label) => (0, import_react.createElement)("button", {
    key: id,
    className: tab === id ? "tab active" : "tab",
    disabled: busy,
    onClick: () => setTab(id)
  }, label);
  const [editing, setEditing] = (0, import_react.useState)(null);
  const [tip, setTip] = (0, import_react.useState)(null);
  const [editorError, setEditorError] = (0, import_react.useState)("");
  const say = (text, kind = "") => setMessage({ text, kind });
  async function load() {
    try {
      const [list, waiting, events] = await Promise.all([
        request("/nodes"),
        request("/pending"),
        request("/audit?limit=50").catch(() => ({ audit: [] }))
      ]);
      setNodes(list.nodes ?? []);
      setEpoch(list.epoch ?? null);
      setPending(waiting.pending ?? []);
      setAudit(events.audit ?? []);
      try {
        setSettings(await request("/settings"));
      } catch {
        setSettings(null);
      }
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
      return { ok: true };
    } catch (error) {
      say(error.message, "bad");
      return { ok: false, error: error.message };
    } finally {
      setBusy(false);
    }
  }
  const showTipFor = (event) => {
    const target = event.target?.closest?.("button[data-tip]");
    if (!target) return;
    const rect = target.getBoundingClientRect();
    setTip({ text: target.getAttribute("data-tip"), x: rect.left + rect.width / 2, y: rect.bottom + 6 });
  };
  const hideTipIfLeft = (event) => {
    const target = event.target?.closest?.("button[data-tip]");
    if (!target) return;
    if (event.relatedTarget && target.contains(event.relatedTarget)) return;
    setTip(null);
  };
  return (0, import_react.createElement)("div", {
    className: "dshn",
    onMouseOver: showTipFor,
    onMouseOut: hideTipIfLeft,
    onFocusIn: (event) => {
      const target = event.target?.closest?.("button[data-tip]");
      if (!target) return;
      const rect = target.getBoundingClientRect();
      setTip({ text: target.getAttribute("data-tip"), x: rect.left + rect.width / 2, y: rect.bottom + 6 });
    },
    onFocusOut: () => setTip(null),
    onScroll: () => setTip(null)
  }, [
    (0, import_react.createElement)(
      "div",
      { key: "msg", className: `msg ${message.kind}` },
      message.text || (epoch != null ? `epoch ${epoch}, \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432 ${nodes.length}` : "")
    ),
    // Панель разбита на вкладки: подключения — то, с чего начинают, аудит —
    // то, куда смотрят редко, настройки — то, что меняют один раз.
    (0, import_react.createElement)("div", { key: "tabs", className: "tabs" }, [
      tabButton("connections", "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F"),
      tabButton("audit", "\u0410\u0443\u0434\u0438\u0442"),
      tabButton("settings", "\u041E\u0431\u0449\u0438\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438")
    ]),
    secret ? (0, import_react.createElement)("div", { key: "secret", className: "secret" }, `\u0442\u043E\u043A\u0435\u043D (\u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u043E\u0434\u0438\u043D \u0440\u0430\u0437): ${secret}`) : null,
    (0, import_react.createElement)("section", { key: "pair", style: only("connections") }, [
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
    (0, import_react.createElement)("section", { key: "pending", style: only("connections") }, [
      (0, import_react.createElement)("h3", { key: "h" }, `\u0417\u0430\u044F\u0432\u043A\u0438 \u0431\u0435\u0437 \u043A\u043E\u0434\u0430 (${pending.length})`),
      pending.length === 0 ? (0, import_react.createElement)("div", { key: "e", className: "empty" }, "\u043D\u0435\u0442") : (0, import_react.createElement)("table", { key: "t" }, [
        (0, import_react.createElement)("thead", { key: "head" }, (0, import_react.createElement)("tr", null, [
          (0, import_react.createElement)("th", { key: "n" }, "\u0438\u043C\u044F"),
          (0, import_react.createElement)("th", { key: "i" }, "id"),
          (0, import_react.createElement)("th", { key: "a" }, "\u0430\u0434\u0440\u0435\u0441"),
          (0, import_react.createElement)("th", { key: "w" }, "\u0432\u0438\u0441\u0438\u0442"),
          (0, import_react.createElement)("th", { key: "x" }, "")
        ])),
        (0, import_react.createElement)("tbody", { key: "body" }, pending.map((row2) => (0, import_react.createElement)("tr", { key: row2.uuid }, [
          (0, import_react.createElement)("td", { key: "n" }, row2.name),
          (0, import_react.createElement)("td", { key: "i" }, (0, import_react.createElement)("code", null, row2.short)),
          (0, import_react.createElement)("td", { key: "a" }, row2.ip ?? "\u2014"),
          (0, import_react.createElement)("td", { key: "w" }, `${row2.waiting} \u0441`),
          (0, import_react.createElement)("td", { key: "x" }, (0, import_react.createElement)("div", { className: "row" }, [
            (0, import_react.createElement)("button", { key: "y", className: "primary", disabled: busy, onClick: () => run({ op: "approve", id: row2.uuid }, "\u0434\u043E\u043F\u0443\u0449\u0435\u043D") }, "\u0434\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C"),
            (0, import_react.createElement)("button", { key: "r", className: "danger", disabled: busy, onClick: () => run({ op: "reject", id: row2.uuid }, "\u043E\u0442\u043A\u043B\u043E\u043D\u0451\u043D") }, "\u043E\u0442\u043A\u043B\u043E\u043D\u0438\u0442\u044C")
          ]))
        ])))
      ])
    ]),
    (0, import_react.createElement)("section", { key: "nodes", style: only("connections") }, [
      (0, import_react.createElement)("h3", { key: "h" }, `\u0423\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430 (${nodes.length})`),
      nodes.length === 0 ? (0, import_react.createElement)("div", { key: "e", className: "empty" }, "\u043D\u0435\u0442") : (0, import_react.createElement)("table", { key: "t" }, [
        (0, import_react.createElement)("thead", { key: "head" }, (0, import_react.createElement)("tr", null, [
          (0, import_react.createElement)("th", { key: "i" }, "id"),
          (0, import_react.createElement)("th", { key: "n" }, "\u0438\u043C\u044F / \u0430\u043B\u0438\u0430\u0441\u044B"),
          (0, import_react.createElement)("th", { key: "a" }, "API"),
          (0, import_react.createElement)("th", { key: "d" }, "\u0434\u043E\u0441\u0442\u0443\u043F"),
          (0, import_react.createElement)("th", { key: "x" }, "")
        ])),
        (0, import_react.createElement)("tbody", { key: "body" }, nodes.flatMap((node) => {
          const row2 = (0, import_react.createElement)(NodeRow, {
            key: `row-${node.id}`,
            node,
            busy,
            onEdit: (id) => {
              setEditorError("");
              setEditing((current) => current === id ? null : id);
            },
            onRevoke: (id) => {
              if (typeof window !== "undefined" && !window.confirm(`\u041E\u0442\u043E\u0437\u0432\u0430\u0442\u044C \u0442\u043E\u043A\u0435\u043D \u0443\u0437\u043B\u0430 ${id}? \u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u043F\u0435\u0440\u0435\u0441\u0442\u0430\u043D\u0435\u0442 \u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u0441\u0440\u0430\u0437\u0443.`)) return;
              setSecret(null);
              run({ op: "token", id }, "\u0442\u043E\u043A\u0435\u043D \u043F\u0435\u0440\u0435\u0432\u044B\u043F\u0443\u0449\u0435\u043D");
            },
            onDelete: (id) => {
              if (typeof window !== "undefined" && !window.confirm(`\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0443\u0437\u0435\u043B ${id}?`)) return;
              if (editing === id) setEditing(null);
              run({ op: "delete", id }, "\u0443\u0434\u0430\u043B\u0451\u043D");
            }
          });
          if (editing !== node.id) return [row2];
          return [
            (0, import_react.createElement)("tr", { key: `editor-${node.id}` }, (0, import_react.createElement)("td", { colSpan: 5, style: { padding: "4px 8px 12px" } }, (0, import_react.createElement)(NodeEditor, {
              node,
              busy,
              error: editorError,
              onCancel: () => {
                setEditorError("");
                setEditing(null);
              },
              onSave: async (id, body) => {
                const taken = nodes.find((other) => other.id !== id && other.aliases.some((alias) => alias.toLowerCase() === String(body.name).toLowerCase()));
                if (taken) {
                  setEditorError(`\u0418\u043C\u044F \xAB${body.name}\xBB \u0443\u0436\u0435 \u0437\u0430\u043D\u044F\u0442\u043E \u0443\u0437\u043B\u043E\u043C ${taken.id} (${taken.name})`);
                  return;
                }
                const result = await run({ op: "update", id, body }, "\u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E");
                if (result.ok) {
                  setEditorError("");
                  setEditing(null);
                } else setEditorError(result.error);
              }
            }))),
            row2
          ];
        }))
      ])
    ]),
    tip ? (0, import_react.createElement)("div", {
      key: "tip",
      className: "tipbox",
      style: { left: `${Math.round(tip.x)}px`, top: `${Math.round(tip.y)}px`, transform: "translateX(-50%)" }
    }, tip.text) : null,
    (0, import_react.createElement)("section", { key: "audit", style: only("audit") }, [
      (0, import_react.createElement)("h3", { key: "h" }, "\u0410\u0443\u0434\u0438\u0442 (\u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u0441\u043E\u0431\u044B\u0442\u0438\u044F)"),
      audit.length === 0 ? (0, import_react.createElement)("div", { key: "e", className: "empty" }, "\u043F\u043E\u043A\u0430 \u043F\u0443\u0441\u0442\u043E") : (0, import_react.createElement)("table", { key: "t" }, [
        (0, import_react.createElement)("thead", { key: "head" }, (0, import_react.createElement)("tr", null, [
          (0, import_react.createElement)("th", { key: "w" }, "\u043A\u043E\u0433\u0434\u0430"),
          (0, import_react.createElement)("th", { key: "k" }, "\u0447\u0442\u043E"),
          (0, import_react.createElement)("th", { key: "n" }, "\u0443\u0437\u0435\u043B"),
          (0, import_react.createElement)("th", { key: "m" }, "\u0440\u0435\u0436\u0438\u043C"),
          (0, import_react.createElement)("th", { key: "c" }, "\u043A\u043E\u043C\u0430\u043D\u0434\u0430")
        ])),
        (0, import_react.createElement)("tbody", { key: "body" }, audit.map((row2) => (0, import_react.createElement)("tr", { key: row2.id }, [
          (0, import_react.createElement)("td", { key: "w", className: "muted" }, new Date(row2.at).toLocaleTimeString()),
          (0, import_react.createElement)("td", { key: "k" }, row2.kind === "denied" ? (0, import_react.createElement)("span", { style: { color: "#ef4444" } }, "\u043E\u0442\u043A\u0430\u0437") : row2.kind === "approve" ? `${row2.outcome === "approved" ? "\u0440\u0430\u0437\u0440\u0435\u0448\u0438\u043B" : "\u0437\u0430\u043F\u0440\u0435\u0442\u0438\u043B"}` : "\u0438\u0441\u043F\u043E\u043B\u043D\u0435\u043D\u043E"),
          (0, import_react.createElement)("td", { key: "n" }, row2.nodeName ? [row2.nodeName, (0, import_react.createElement)("span", { key: "id", className: "muted" }, ` #${row2.node}`)] : "\u2014"),
          (0, import_react.createElement)("td", { key: "m" }, (0, import_react.createElement)("code", null, row2.mode ?? "\u2014")),
          (0, import_react.createElement)("td", { key: "c" }, (0, import_react.createElement)("code", null, String(row2.command ?? "").slice(0, 120)))
        ])))
      ])
    ]),
    (0, import_react.createElement)("section", { key: "create", style: only("connections") }, [
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
    ]),
    (0, import_react.createElement)("section", { key: "settings", style: only("settings") }, [
      (0, import_react.createElement)("h3", { key: "h" }, "\u041E\u0431\u0449\u0438\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438"),
      (0, import_react.createElement)(
        "div",
        { key: "note", className: "muted" },
        "\u041C\u0435\u043D\u044F\u044E\u0442\u0441\u044F \u0432 \u043A\u043E\u043D\u0444\u0438\u0433\u0435 \u043F\u043B\u0430\u0433\u0438\u043D\u0430 \u0438 \u043F\u0440\u0438\u043C\u0435\u043D\u044F\u044E\u0442\u0441\u044F \u043F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u043A\u0430. \u0417\u0434\u0435\u0441\u044C \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u043E, \u0447\u0442\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0443\u0435\u0442 \u0441\u0435\u0439\u0447\u0430\u0441."
      ),
      settings ? (0, import_react.createElement)("table", { key: "t" }, [
        (0, import_react.createElement)("tbody", { key: "b" }, [
          row(
            "self \u2014 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0438 \u0445\u043E\u0441\u0442\u0430, \u043A\u0443\u0434\u0430 \u043C\u043E\u0436\u043D\u043E \u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441 \u0443\u0437\u043B\u043E\u0432",
            (settings.selfRoots ?? []).length ? settings.selfRoots.join(", ") : "\u043D\u0435\u0442 (self \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D)"
          ),
          row("\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u043C\u043E\u0434\u0435\u043B\u044C \u0436\u0434\u0451\u0442 \u043E\u0442\u0432\u0435\u0442\u0430 \u043D\u0430 \u0432\u043E\u043F\u0440\u043E\u0441", `${settings.approvalWaitSeconds} \u0441 (0 \u2014 \u0434\u043E \u043E\u0442\u043C\u0435\u043D\u044B)`),
          row("\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0432\u043E\u043F\u0440\u043E\u0441 \u0436\u0438\u0432\u0451\u0442 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 \u0443\u0437\u043B\u0430", `${settings.approvalTtlSeconds} \u0441`),
          row("\u0443\u0437\u0435\u043B \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u0436\u0438\u0432\u044B\u043C \u043F\u043E\u0441\u043B\u0435 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0439 \u0441\u0432\u044F\u0437\u0438", `${settings.aliveTimeoutSeconds} \u0441`),
          row("\u043F\u0438\u043D\u0433 \u043F\u043E \u0441\u043E\u043A\u0435\u0442\u0443", settings.wsPingSeconds ? `\u043A\u0430\u0436\u0434\u044B\u0435 ${settings.wsPingSeconds} \u0441` : "\u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D")
        ])
      ]) : (0, import_react.createElement)("div", { className: "muted" }, "\u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438"),
      (0, import_react.createElement)(
        "div",
        { key: "selfnote", className: "muted", style: { marginTop: 8 } },
        "\u041A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u043D\u0430 \u0445\u043E\u0441\u0442 \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u043E\u0432 \u0438\u0437 self: \u044D\u0442\u043E \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u0435, \u043F\u043E\u0442\u043E\u043C\u0443 \u0447\u0442\u043E \u0434\u0430\u043B\u044C\u0448\u0435 \u043C\u043E\u0434\u0435\u043B\u044C \u043C\u043E\u0436\u0435\u0442 \u0442\u0440\u043E\u0433\u0430\u0442\u044C \u0438\u0445 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u043C shell \u2014 \u0443\u0436\u0435 \u043F\u043E\u0434 \u043F\u0435\u0441\u043E\u0447\u043D\u0438\u0446\u0435\u0439 DSH."
      )
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
