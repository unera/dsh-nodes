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

// src/client/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");
var SETTINGS_ID = "dsh-nodes";
var ADMIN_URL = "/api/dsh-nodes/admin";
function NodesSection() {
  return (0, import_react.h)("div", { style: { display: "flex", flexDirection: "column", gap: "8px", height: "100%" } }, [
    (0, import_react.h)("div", { key: "links", style: { display: "flex", gap: "12px", alignItems: "center", fontSize: "13px", opacity: 0.8 } }, [
      (0, import_react.h)("span", { key: "hint" }, "\u0423\u0437\u043B\u044B dsh-nodes: \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0451\u043D\u043D\u044B\u0435 \u043C\u0430\u0448\u0438\u043D\u044B \u0438 \u0437\u0430\u044F\u0432\u043A\u0438 \u043D\u0430 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435"),
      (0, import_react.h)("a", { key: "open", href: ADMIN_URL, target: "_blank", rel: "noreferrer", style: { color: "inherit" } }, "\u043E\u0442\u043A\u0440\u044B\u0442\u044C \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E")
    ]),
    (0, import_react.h)("iframe", {
      key: "frame",
      src: ADMIN_URL,
      title: "dsh-nodes",
      style: { flex: "1 1 auto", width: "100%", minHeight: "520px", border: "1px solid rgba(128,128,128,.3)", borderRadius: "8px", background: "transparent" }
    })
  ]);
}
function apply(ctx) {
  const slots = ctx?.slots;
  if (!slots?.register) return;
  slots.inject("settings.section", () => slots.register(
    { name: "settings.section", id: SETTINGS_ID, order: 35, label: () => "\u0423\u0437\u043B\u044B" },
    NodesSection
  ));
}

    return module.exports;
  }
});
