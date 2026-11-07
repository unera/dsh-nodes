window.__ModuleLoader__.load({
  id: "@dr-co/dsh-nodes",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
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
var React = __toESM(require("react"), 1);

// src/client/i18n.js
var NS = "dsh-nodes";
var en = {
  "tab.connections": "Connections",
  "tab.audit": "Audit",
  "tab.settings": "Settings",
  "nodes.title": "Nodes",
  "nodes.none": "no nodes connected",
  "nodes.name": "name / aliases",
  "nodes.apis": "APIs",
  "nodes.access": "access",
  "nodes.actions": "actions",
  "nodes.noAliases": "no aliases",
  "nodes.new": "New node manually",
  "nodes.namePlaceholder": "name, e.g. nbw",
  "nodes.aliasesPlaceholder": "aliases, comma separated (any of them addresses the node)",
  "nodes.create": "create and issue a token",
  "nodes.edit": "edit name and aliases",
  "nodes.editTitle": "Edit",
  "nodes.revoke": "Revoke token",
  "nodes.delete": "Delete",
  "nodes.deleteTitle": "Delete",
  "nodes.save": "save",
  "nodes.cancel": "cancel",
  "nodes.created": "node created",
  "nodes.saved": "saved",
  "nodes.deleted": "deleted",
  "nodes.tokenReissued": "token reissued",
  "pair.title": "Connect a client",
  "pair.ttl": "link lifetime, seconds",
  "pair.make": "generate a link",
  "pair.note": "On the node: dshnc connect <link>. Nothing to confirm here \u2014 the code is single-use.",
  "pair.ready": "link ready",
  "pending.title": "Requests without a code",
  "pending.allow": "allow",
  "pending.deny": "deny",
  "pending.allowed": "allowed",
  "pending.denied": "denied",
  "audit.title": "Audit (recent events)",
  "audit.empty": "nothing yet",
  "audit.when": "when",
  "audit.what": "what",
  "audit.node": "node",
  "audit.mode": "mode",
  "audit.command": "command",
  "audit.exec": "ran",
  "audit.denied": "denied",
  "audit.approved": "allowed",
  "audit.rejected": "refused",
  "settings.title": "Settings",
  "settings.note": "Changed in the plugin config and applied after a restart. Here is what is in effect now.",
  "settings.self": "self \u2014 host directories files may be copied into",
  "settings.selfOff": "none (self is off)",
  "settings.wait": "how long the model waits for an answer",
  "settings.ttl": "how long a question lives in the node queue",
  "settings.alive": "node is considered alive after the last contact",
  "settings.ping": "socket ping",
  "settings.off": "off",
  "settings.failed": "could not read settings",
  "settings.selfNote": "Copying to the host works only for directories from self: it is a separate permission, because the model can then touch them with a local shell \u2014 already under the DSH sandbox.",
  "mode.ro": "ro \u2014 read only (read-only)",
  "mode.rw": "rw \u2014 write inside allowed directories (workspace-write)",
  "mode.fa": "FA \u2014 no sandbox: full access (danger-full-access)",
  "mode.baseHint": "base: {explain}. The command starts in this mode.",
  "mode.uptoHint": "upto: {explain}. Node ceiling: nothing goes wider even with approval.",
  "approver.web": "web: the human in DSH is asked \u2014 the question arrives in the GUI",
  "approver.local": "local: the human at this machine is asked \u2014 a dialog pops up on the node",
  "approver.none": "none: questions are off \u2014 a sandbox denial is final",
  "pill.online": "online",
  "pill.offline": "offline",
  "pill.never": "never seen",
  "pill.lastSeen": "last contact: {ago} ago",
  "pill.noContact": "no contact yet",
  "pill.working": "running {uptime}",
  "state.ready": "ready",
  "state.hung": "hanging",
  "state.unreachable": "unreachable",
  "summary.epoch": "epoch {epoch}, nodes {count}",
  "common.seconds": "{value} s",
  "common.waitForever": "{value} s (0 \u2014 until the call is cancelled)"
};
var ru = {
  "tab.connections": "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F",
  "tab.audit": "\u0410\u0443\u0434\u0438\u0442",
  "tab.settings": "\u041E\u0431\u0449\u0438\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
  "nodes.title": "\u0423\u0437\u043B\u044B",
  "nodes.none": "\u0443\u0437\u043B\u043E\u0432 \u043D\u0435\u0442",
  "nodes.name": "\u0438\u043C\u044F / \u0430\u043B\u0438\u0430\u0441\u044B",
  "nodes.apis": "API",
  "nodes.access": "\u0434\u043E\u0441\u0442\u0443\u043F",
  "nodes.actions": "\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F",
  "nodes.noAliases": "\u0431\u0435\u0437 \u0430\u043B\u0438\u0430\u0441\u043E\u0432",
  "nodes.new": "\u041D\u043E\u0432\u044B\u0439 \u0443\u0437\u0435\u043B \u0432\u0440\u0443\u0447\u043D\u0443\u044E",
  "nodes.namePlaceholder": "\u0438\u043C\u044F, \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 nbw",
  "nodes.aliasesPlaceholder": "\u0430\u043B\u0438\u0430\u0441\u044B \u0447\u0435\u0440\u0435\u0437 \u0437\u0430\u043F\u044F\u0442\u0443\u044E (\u043F\u043E \u043B\u044E\u0431\u043E\u043C\u0443 \u0438\u0437 \u043D\u0438\u0445 \u0443\u0437\u0435\u043B \u043C\u043E\u0436\u043D\u043E \u043F\u043E\u0437\u0432\u0430\u0442\u044C)",
  "nodes.create": "\u0441\u043E\u0437\u0434\u0430\u0442\u044C \u0438 \u0432\u044B\u0434\u0430\u0442\u044C \u0442\u043E\u043A\u0435\u043D",
  "nodes.edit": "\u043F\u0440\u0430\u0432\u043A\u0430 \u0438\u043C\u0435\u043D\u0438 \u0438 \u0430\u043B\u0438\u0430\u0441\u043E\u0432",
  "nodes.editTitle": "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C",
  "nodes.revoke": "\u041E\u0442\u043E\u0437\u0432\u0430\u0442\u044C \u0442\u043E\u043A\u0435\u043D",
  "nodes.delete": "\u0423\u0434\u0430\u043B\u0438\u0442\u044C",
  "nodes.deleteTitle": "\u0423\u0434\u0430\u043B\u0438\u0442\u044C",
  "nodes.save": "\u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C",
  "nodes.cancel": "\u043E\u0442\u043C\u0435\u043D\u0430",
  "nodes.created": "\u0443\u0437\u0435\u043B \u0441\u043E\u0437\u0434\u0430\u043D",
  "nodes.saved": "\u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E",
  "nodes.deleted": "\u0443\u0434\u0430\u043B\u0451\u043D",
  "nodes.tokenReissued": "\u0442\u043E\u043A\u0435\u043D \u043F\u0435\u0440\u0435\u0432\u044B\u043F\u0443\u0449\u0435\u043D",
  "pair.title": "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u0430",
  "pair.ttl": "\u0441\u0435\u043A\u0443\u043D\u0434\u044B \u0436\u0438\u0437\u043D\u0438 \u0441\u0441\u044B\u043B\u043A\u0438",
  "pair.make": "\u0441\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441\u0441\u044B\u043B\u043A\u0443",
  "pair.note": "\u041D\u0430 \u0443\u0437\u043B\u0435: dshnc connect <\u0441\u0441\u044B\u043B\u043A\u0430>. \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u0442\u044C \u0437\u0434\u0435\u0441\u044C \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0443\u0436\u043D\u043E, \u043A\u043E\u0434 \u043E\u0434\u043D\u043E\u0440\u0430\u0437\u043E\u0432\u044B\u0439.",
  "pair.ready": "\u0441\u0441\u044B\u043B\u043A\u0430 \u0433\u043E\u0442\u043E\u0432\u0430",
  "pending.title": "\u0417\u0430\u044F\u0432\u043A\u0438 \u0431\u0435\u0437 \u043A\u043E\u0434\u0430",
  "pending.allow": "\u0434\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C",
  "pending.deny": "\u043E\u0442\u043A\u043B\u043E\u043D\u0438\u0442\u044C",
  "pending.allowed": "\u0434\u043E\u043F\u0443\u0449\u0435\u043D",
  "pending.denied": "\u043E\u0442\u043A\u043B\u043E\u043D\u0451\u043D",
  "audit.title": "\u0410\u0443\u0434\u0438\u0442 (\u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u0441\u043E\u0431\u044B\u0442\u0438\u044F)",
  "audit.empty": "\u043F\u043E\u043A\u0430 \u043F\u0443\u0441\u0442\u043E",
  "audit.when": "\u043A\u043E\u0433\u0434\u0430",
  "audit.what": "\u0447\u0442\u043E",
  "audit.node": "\u0443\u0437\u0435\u043B",
  "audit.mode": "\u0440\u0435\u0436\u0438\u043C",
  "audit.command": "\u043A\u043E\u043C\u0430\u043D\u0434\u0430",
  "audit.exec": "\u0438\u0441\u043F\u043E\u043B\u043D\u0435\u043D\u043E",
  "audit.denied": "\u043E\u0442\u043A\u0430\u0437",
  "audit.approved": "\u0440\u0430\u0437\u0440\u0435\u0448\u0438\u043B",
  "audit.rejected": "\u0437\u0430\u043F\u0440\u0435\u0442\u0438\u043B",
  "settings.title": "\u041E\u0431\u0449\u0438\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
  "settings.note": "\u041C\u0435\u043D\u044F\u044E\u0442\u0441\u044F \u0432 \u043A\u043E\u043D\u0444\u0438\u0433\u0435 \u043F\u043B\u0430\u0433\u0438\u043D\u0430 \u0438 \u043F\u0440\u0438\u043C\u0435\u043D\u044F\u044E\u0442\u0441\u044F \u043F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u043A\u0430. \u0417\u0434\u0435\u0441\u044C \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u043E, \u0447\u0442\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0443\u0435\u0442 \u0441\u0435\u0439\u0447\u0430\u0441.",
  "settings.self": "self \u2014 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0438 \u0445\u043E\u0441\u0442\u0430, \u043A\u0443\u0434\u0430 \u043C\u043E\u0436\u043D\u043E \u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441 \u0443\u0437\u043B\u043E\u0432",
  "settings.selfOff": "\u043D\u0435\u0442 (self \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D)",
  "settings.wait": "\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u043C\u043E\u0434\u0435\u043B\u044C \u0436\u0434\u0451\u0442 \u043E\u0442\u0432\u0435\u0442\u0430 \u043D\u0430 \u0432\u043E\u043F\u0440\u043E\u0441",
  "settings.ttl": "\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0432\u043E\u043F\u0440\u043E\u0441 \u0436\u0438\u0432\u0451\u0442 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 \u0443\u0437\u043B\u0430",
  "settings.alive": "\u0443\u0437\u0435\u043B \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u0436\u0438\u0432\u044B\u043C \u043F\u043E\u0441\u043B\u0435 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0439 \u0441\u0432\u044F\u0437\u0438",
  "settings.ping": "\u043F\u0438\u043D\u0433 \u043F\u043E \u0441\u043E\u043A\u0435\u0442\u0443",
  "settings.off": "\u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D",
  "settings.failed": "\u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
  "settings.selfNote": "\u041A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u043D\u0430 \u0445\u043E\u0441\u0442 \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u043E\u0432 \u0438\u0437 self: \u044D\u0442\u043E \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u0435, \u043F\u043E\u0442\u043E\u043C\u0443 \u0447\u0442\u043E \u0434\u0430\u043B\u044C\u0448\u0435 \u043C\u043E\u0434\u0435\u043B\u044C \u043C\u043E\u0436\u0435\u0442 \u0442\u0440\u043E\u0433\u0430\u0442\u044C \u0438\u0445 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u043C shell \u2014 \u0443\u0436\u0435 \u043F\u043E\u0434 \u043F\u0435\u0441\u043E\u0447\u043D\u0438\u0446\u0435\u0439 DSH.",
  "mode.ro": "ro \u2014 \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u0435\u043D\u0438\u0435 (read-only)",
  "mode.rw": "rw \u2014 \u0437\u0430\u043F\u0438\u0441\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u043D\u0443\u0442\u0440\u0438 \u0440\u0430\u0437\u0440\u0435\u0448\u0451\u043D\u043D\u044B\u0445 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u043E\u0432 (workspace-write)",
  "mode.fa": "FA \u2014 \u0431\u0435\u0437 \u043F\u0435\u0441\u043E\u0447\u043D\u0438\u0446\u044B: \u043F\u043E\u043B\u043D\u044B\u0439 \u0434\u043E\u0441\u0442\u0443\u043F (danger-full-access)",
  "mode.baseHint": "base: {explain}. \u0412 \u044D\u0442\u043E\u043C \u0440\u0435\u0436\u0438\u043C\u0435 \u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u0441\u0442\u0430\u0440\u0442\u0443\u0435\u0442.",
  "mode.uptoHint": "upto: {explain}. \u041F\u043E\u0442\u043E\u043B\u043E\u043A \u0443\u0437\u043B\u0430: \u0432\u044B\u0448\u0435 \u043D\u0435 \u043F\u043E\u0434\u043D\u0438\u043C\u0435\u0442\u0441\u044F \u0434\u0430\u0436\u0435 \u0441 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u0435\u043C.",
  "approver.web": "web: \u0441\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u0435\u0442 \u0447\u0435\u043B\u043E\u0432\u0435\u043A \u0432 DSH \u2014 \u0432\u043E\u043F\u0440\u043E\u0441 \u043F\u0440\u0438\u0445\u043E\u0434\u0438\u0442 \u0432 GUI",
  "approver.local": "local: \u0441\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u0435\u0442 \u0447\u0435\u043B\u043E\u0432\u0435\u043A \u0437\u0430 \u044D\u0442\u043E\u0439 \u043C\u0430\u0448\u0438\u043D\u043E\u0439 \u2014 \u0432\u043E\u043F\u0440\u043E\u0441 \u0432\u0441\u043F\u043B\u044B\u0432\u0430\u0435\u0442 \u043D\u0430 \u0443\u0437\u043B\u0435 (zenity \u0438 \u043F\u043E\u0434\u043E\u0431\u043D\u043E\u0435)",
  "approver.none": "none: \u0432\u043E\u043F\u0440\u043E\u0441\u044B \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u044B \u2014 \u043E\u0442\u043A\u0430\u0437 \u043F\u0435\u0441\u043E\u0447\u043D\u0438\u0446\u044B \u043E\u043A\u043E\u043D\u0447\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0439",
  "pill.online": "online",
  "pill.offline": "offline",
  "pill.never": "\u043D\u0438\u043A\u043E\u0433\u0434\u0430",
  "pill.lastSeen": "\u043F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u0441\u0432\u044F\u0437\u044C: {ago} \u043D\u0430\u0437\u0430\u0434",
  "pill.noContact": "\u0441\u0432\u044F\u0437\u0438 \u0435\u0449\u0451 \u043D\u0435 \u0431\u044B\u043B\u043E",
  "pill.working": "\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 {uptime}",
  "state.ready": "\u0433\u043E\u0442\u043E\u0432\u0430",
  "state.hung": "\u0432\u0438\u0441\u0438\u0442",
  "state.unreachable": "\u043D\u0435\u0442 \u0441\u0432\u044F\u0437\u0438",
  "summary.epoch": "epoch {epoch}, \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432 {count}",
  "common.seconds": "{value} \u0441",
  "common.waitForever": "{value} \u0441 (0 \u2014 \u0434\u043E \u043E\u0442\u043C\u0435\u043D\u044B \u0432\u044B\u0437\u043E\u0432\u0430)"
};
var zh = {
  "tab.connections": "\u8FDE\u63A5",
  "tab.audit": "\u5BA1\u8BA1",
  "tab.settings": "\u8BBE\u7F6E",
  "nodes.title": "\u8282\u70B9",
  "nodes.none": "\u8FD8\u6CA1\u6709\u8282\u70B9",
  "nodes.name": "\u540D\u79F0 / \u522B\u540D",
  "nodes.apis": "API",
  "nodes.access": "\u6743\u9650",
  "nodes.actions": "\u64CD\u4F5C",
  "nodes.noAliases": "\u6CA1\u6709\u522B\u540D",
  "nodes.new": "\u624B\u52A8\u65B0\u5EFA\u8282\u70B9",
  "nodes.namePlaceholder": "\u540D\u79F0\uFF0C\u4F8B\u5982 nbw",
  "nodes.aliasesPlaceholder": "\u522B\u540D\uFF0C\u9017\u53F7\u5206\u9694",
  "nodes.create": "\u521B\u5EFA\u5E76\u53D1\u653E\u4EE4\u724C",
  "nodes.edit": "\u4FEE\u6539\u540D\u79F0\u548C\u522B\u540D",
  "nodes.editTitle": "\u7F16\u8F91",
  "nodes.revoke": "\u64A4\u9500\u4EE4\u724C",
  "nodes.delete": "\u5220\u9664",
  "nodes.deleteTitle": "\u5220\u9664",
  "nodes.save": "\u4FDD\u5B58",
  "nodes.cancel": "\u53D6\u6D88",
  "nodes.created": "\u8282\u70B9\u5DF2\u521B\u5EFA",
  "nodes.saved": "\u5DF2\u4FDD\u5B58",
  "nodes.deleted": "\u5DF2\u5220\u9664",
  "nodes.tokenReissued": "\u4EE4\u724C\u5DF2\u91CD\u65B0\u53D1\u653E",
  "pair.title": "\u8FDE\u63A5\u5BA2\u6237\u7AEF",
  "pair.ttl": "\u94FE\u63A5\u6709\u6548\u671F\uFF0C\u79D2",
  "pair.make": "\u751F\u6210\u94FE\u63A5",
  "pair.note": "\u5728\u8282\u70B9\u4E0A\u6267\u884C\uFF1Adshnc connect <\u94FE\u63A5>\u3002\u8FD9\u91CC\u65E0\u9700\u786E\u8BA4\uFF0C\u4EE3\u7801\u53EA\u80FD\u4F7F\u7528\u4E00\u6B21\u3002",
  "pair.ready": "\u94FE\u63A5\u5DF2\u751F\u6210",
  "pending.title": "\u672A\u51ED\u7801\u7684\u7533\u8BF7",
  "pending.allow": "\u5141\u8BB8",
  "pending.deny": "\u62D2\u7EDD",
  "pending.allowed": "\u5DF2\u5141\u8BB8",
  "pending.denied": "\u5DF2\u62D2\u7EDD",
  "audit.title": "\u5BA1\u8BA1\uFF08\u6700\u8FD1\u4E8B\u4EF6\uFF09",
  "audit.empty": "\u8FD8\u6CA1\u6709\u8BB0\u5F55",
  "audit.when": "\u65F6\u95F4",
  "audit.what": "\u4E8B\u4EF6",
  "audit.node": "\u8282\u70B9",
  "audit.mode": "\u6A21\u5F0F",
  "audit.command": "\u547D\u4EE4",
  "audit.exec": "\u5DF2\u6267\u884C",
  "audit.denied": "\u88AB\u62D2",
  "audit.approved": "\u5DF2\u5141\u8BB8",
  "audit.rejected": "\u5DF2\u62D2\u7EDD",
  "settings.title": "\u8BBE\u7F6E",
  "settings.note": "\u5728\u63D2\u4EF6\u914D\u7F6E\u4E2D\u4FEE\u6539\uFF0C\u91CD\u542F\u540E\u751F\u6548\u3002\u8FD9\u91CC\u663E\u793A\u5F53\u524D\u751F\u6548\u7684\u503C\u3002",
  "settings.self": "self \u2014 \u53EF\u4ECE\u8282\u70B9\u590D\u5236\u5230\u7684\u5BBF\u4E3B\u76EE\u5F55",
  "settings.selfOff": "\u65E0\uFF08self \u5DF2\u5173\u95ED\uFF09",
  "settings.wait": "\u6A21\u578B\u7B49\u5F85\u56DE\u7B54\u7684\u65F6\u957F",
  "settings.ttl": "\u95EE\u9898\u5728\u8282\u70B9\u961F\u5217\u4E2D\u7684\u5B58\u6D3B\u65F6\u95F4",
  "settings.alive": "\u6700\u540E\u4E00\u6B21\u8054\u7CFB\u540E\u89C6\u4E3A\u5728\u7EBF\u7684\u65F6\u957F",
  "settings.ping": "\u5957\u63A5\u5B57 ping",
  "settings.off": "\u5DF2\u5173\u95ED",
  "settings.failed": "\u65E0\u6CD5\u8BFB\u53D6\u8BBE\u7F6E",
  "settings.selfNote": "\u53EA\u6709\u5728 self \u4E2D\u5217\u51FA\u7684\u76EE\u5F55\u624D\u80FD\u63A5\u6536\u590D\u5236\uFF1A\u8FD9\u662F\u5355\u72EC\u7684\u6388\u6743\uFF0C\u56E0\u4E3A\u4E4B\u540E\u6A21\u578B\u53EF\u4EE5\u7528\u672C\u5730 shell \u64CD\u4F5C\u5B83\u4EEC\uFF08\u5DF2\u5728 DSH \u6C99\u7BB1\u4E0B\uFF09\u3002",
  "mode.ro": "ro \u2014 \u53EA\u8BFB",
  "mode.rw": "rw \u2014 \u53EA\u5141\u8BB8\u5728\u6388\u6743\u76EE\u5F55\u5185\u5199\u5165",
  "mode.fa": "FA \u2014 \u65E0\u6C99\u7BB1\uFF1A\u5B8C\u5168\u8BBF\u95EE",
  "mode.baseHint": "base: {explain}\u3002\u547D\u4EE4\u4EE5\u6B64\u6A21\u5F0F\u542F\u52A8\u3002",
  "mode.uptoHint": "upto: {explain}\u3002\u8282\u70B9\u4E0A\u9650\uFF1A\u5373\u4F7F\u786E\u8BA4\u4E5F\u4E0D\u4F1A\u66F4\u5BBD\u3002",
  "approver.web": "web\uFF1A\u8BE2\u95EE DSH \u4E2D\u7684\u4EBA\uFF0C\u95EE\u9898\u51FA\u73B0\u5728\u56FE\u5F62\u754C\u9762",
  "approver.local": "local\uFF1A\u8BE2\u95EE\u672C\u673A\u7684\u4EBA\uFF0C\u8282\u70B9\u4E0A\u5F39\u51FA\u5BF9\u8BDD\u6846",
  "approver.none": "none\uFF1A\u4E0D\u63D0\u95EE\uFF0C\u6C99\u7BB1\u62D2\u7EDD\u5373\u4E3A\u6700\u7EC8\u7ED3\u679C",
  "pill.online": "online",
  "pill.offline": "offline",
  "pill.never": "\u4ECE\u672A",
  "pill.lastSeen": "\u6700\u540E\u8054\u7CFB\uFF1A{ago} \u524D",
  "pill.noContact": "\u8FD8\u6CA1\u6709\u8054\u7CFB\u8FC7",
  "pill.working": "\u5DF2\u8FD0\u884C {uptime}",
  "state.ready": "\u5C31\u7EEA",
  "state.hung": "\u65E0\u54CD\u5E94",
  "state.unreachable": "\u65E0\u8FDE\u63A5",
  "summary.epoch": "epoch {epoch}\uFF0C\u8BBE\u5907 {count}",
  "common.seconds": "{value} \u79D2",
  "common.waitForever": "{value} \u79D2\uFF080 \u2014 \u76F4\u5230\u8C03\u7528\u88AB\u53D6\u6D88\uFF09"
};

// src/client/index.js
var Base = React.Component ?? Object;
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
function row(what, value) {
  return (0, import_react.createElement)("tr", { key: what }, [
    (0, import_react.createElement)("td", { key: "w", className: "muted" }, what),
    (0, import_react.createElement)("td", { key: "v" }, (0, import_react.createElement)("code", null, String(value)))
  ]);
}
var MODE_SHORT = {
  "read-only": "ro",
  "workspace-write": "rw",
  "danger-full-access": "FA",
  ro: "ro",
  rw: "rw",
  full: "FA"
};
var MODE_KEY = {
  "read-only": "mode.ro",
  "workspace-write": "mode.rw",
  "danger-full-access": "mode.fa",
  ro: "mode.ro",
  rw: "mode.rw",
  full: "mode.fa"
};
function modeBadge(label, mode, kind) {
  if (!mode) return null;
  const text = MODE_SHORT[mode] ?? mode;
  const tone = { ro: "ro", rw: "rw", full: "fa", "read-only": "ro", "workspace-write": "rw", "danger-full-access": "fa" }[mode] ?? null;
  const explain = t(MODE_KEY[mode] ?? String(mode));
  const hint = kind === "base" ? t("mode.baseHint", { explain }) : t("mode.uptoHint", { explain });
  return (0, import_react.createElement)("span", { key: label, className: `badge ${tone ?? ""}`, title: hint }, `${label}:${text}`);
}
function approverBadge(approver) {
  const view = {
    server: { glyph: "\u{1F310}", key: "approver.web" },
    local: { glyph: "\u{1F4BB}", key: "approver.local" },
    none: { glyph: "\u2205", key: "approver.none" }
  }[approver];
  if (!view) return null;
  return (0, import_react.createElement)("span", { key: "approver", className: "badge", title: t(view.key) }, view.glyph);
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
  if (!ms) return t("pill.never");
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
      (0, import_react.createElement)("span", { key: "n", className: "muted" }, t("nodes.edit"))
    ]),
    (0, import_react.createElement)("div", { key: "name" }, [
      (0, import_react.createElement)("label", { key: "l" }, t("nodes.title")),
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
      (0, import_react.createElement)("label", { key: "l" }, t("nodes.aliasesPlaceholder")),
      (0, import_react.createElement)("textarea", {
        key: "t",
        rows: 2,
        value: aliases,
        onChange: (event) => setAliases(event.target.value)
      })
    ]),
    error ? (0, import_react.createElement)("div", { key: "error", className: "msg bad", style: { minHeight: 0 } }, error) : null,
    (0, import_react.createElement)("div", { key: "actions", className: "row" }, [
      (0, import_react.createElement)("button", { key: "save", className: "primary", disabled: busy || !name2.trim(), onClick: submit }, t("nodes.save")),
      (0, import_react.createElement)("button", { key: "cancel", disabled: busy, onClick: onCancel }, t("nodes.cancel"))
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
          title: node.lastSeen ? t("pill.lastSeen", { ago: ago(node.lastSeen) }) : t("pill.noContact")
        }, pillOnline(node) ? t("pill.online") : t("pill.offline"))
      ]),
      (0, import_react.createElement)("div", { key: "a", className: "aliases" }, node.aliases.filter((alias) => alias !== node.name).join(", ") || t("nodes.noAliases")),
      // аптайм отдельной строкой под именем: видно, работает ли узел с ночи или
      // только что перезапустился
      node.online && uptimeText(node.uptimeSeconds) ? (0, import_react.createElement)("div", { key: "u", className: "muted", style: { fontSize: 12, marginTop: 2 } }, t("pill.working", { uptime: uptimeText(node.uptimeSeconds) })) : null
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
      (0, import_react.createElement)(GlyphButton, { key: "e", kind: "edit", title: t("nodes.editTitle"), disabled: busy, onClick: () => onEdit(node.id) }),
      (0, import_react.createElement)(GlyphButton, { key: "t", kind: "unplug", title: t("nodes.revoke"), disabled: busy, onClick: () => onRevoke(node.id) }),
      (0, import_react.createElement)(GlyphButton, { key: "d", kind: "trash", title: t("nodes.delete"), disabled: busy, className: "danger", onClick: () => onDelete(node.id) })
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
      message.text || (epoch != null ? t("summary.epoch", { epoch, count: nodes.length }) : "")
    ),
    // Панель разбита на вкладки: подключения — то, с чего начинают, аудит —
    // то, куда смотрят редко, настройки — то, что меняют один раз.
    (0, import_react.createElement)("div", { key: "tabs", className: "tabs" }, [
      tabButton("connections", t("tab.connections")),
      tabButton("audit", t("tab.audit")),
      tabButton("settings", t("tab.settings"))
    ]),
    secret ? (0, import_react.createElement)("div", { key: "secret", className: "secret" }, `\u0442\u043E\u043A\u0435\u043D (\u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u043E\u0434\u0438\u043D \u0440\u0430\u0437): ${secret}`) : null,
    (0, import_react.createElement)("section", { key: "pair", style: only("connections") }, [
      (0, import_react.createElement)("h3", { key: "h" }, t("pair.title")),
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
              say(t("pair.ready"), "good");
            } catch (error) {
              say(error.message, "bad");
            }
          }
        }, t("pair.make")),
        (0, import_react.createElement)("span", { key: "t", className: "muted" }, t("pair.ttl"))
      ]),
      link ? (0, import_react.createElement)("div", { key: "l", className: "secret" }, link) : null,
      (0, import_react.createElement)(
        "div",
        { key: "hint", className: "muted", style: { fontSize: 12, marginTop: 6 } },
        t("pair.note")
      )
    ]),
    (0, import_react.createElement)("section", { key: "pending", style: only("connections") }, [
      (0, import_react.createElement)("h3", { key: "h" }, `\u0417\u0430\u044F\u0432\u043A\u0438 \u0431\u0435\u0437 \u043A\u043E\u0434\u0430 (${pending.length})`),
      pending.length === 0 ? (0, import_react.createElement)("div", { key: "e", className: "empty" }, t("nodes.none")) : (0, import_react.createElement)("table", { key: "t" }, [
        (0, import_react.createElement)("thead", { key: "head" }, (0, import_react.createElement)("tr", null, [
          (0, import_react.createElement)("th", { key: "n" }, t("nodes.name")),
          (0, import_react.createElement)("th", { key: "i" }, "id"),
          (0, import_react.createElement)("th", { key: "a" }, t("pending.title")),
          (0, import_react.createElement)("th", { key: "w" }, t("state.hung")),
          (0, import_react.createElement)("th", { key: "x" }, "")
        ])),
        (0, import_react.createElement)("tbody", { key: "body" }, pending.map((row2) => (0, import_react.createElement)("tr", { key: row2.uuid }, [
          (0, import_react.createElement)("td", { key: "n" }, row2.name),
          (0, import_react.createElement)("td", { key: "i" }, (0, import_react.createElement)("code", null, row2.short)),
          (0, import_react.createElement)("td", { key: "a" }, row2.ip ?? "\u2014"),
          (0, import_react.createElement)("td", { key: "w" }, `${row2.waiting} \u0441`),
          (0, import_react.createElement)("td", { key: "x" }, (0, import_react.createElement)("div", { className: "row" }, [
            (0, import_react.createElement)("button", { key: "y", className: "primary", disabled: busy, onClick: () => run({ op: "approve", id: row2.uuid }, t("pending.allowed")) }, t("pending.allow")),
            (0, import_react.createElement)("button", { key: "r", className: "danger", disabled: busy, onClick: () => run({ op: "reject", id: row2.uuid }, t("pending.denied")) }, t("pending.deny"))
          ]))
        ])))
      ])
    ]),
    (0, import_react.createElement)("section", { key: "nodes", style: only("connections") }, [
      (0, import_react.createElement)("h3", { key: "h" }, `\u0423\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430 (${nodes.length})`),
      nodes.length === 0 ? (0, import_react.createElement)("div", { key: "e", className: "empty" }, t("nodes.none")) : (0, import_react.createElement)("table", { key: "t" }, [
        (0, import_react.createElement)("thead", { key: "head" }, (0, import_react.createElement)("tr", null, [
          (0, import_react.createElement)("th", { key: "i" }, "id"),
          (0, import_react.createElement)("th", { key: "n" }, t("nodes.name")),
          (0, import_react.createElement)("th", { key: "a" }, "API"),
          (0, import_react.createElement)("th", { key: "d" }, t("nodes.access")),
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
              run({ op: "token", id }, t("nodes.tokenReissued"));
            },
            onDelete: (id) => {
              if (typeof window !== "undefined" && !window.confirm(`\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0443\u0437\u0435\u043B ${id}?`)) return;
              if (editing === id) setEditing(null);
              run({ op: "delete", id }, t("nodes.deleted"));
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
                const result = await run({ op: "update", id, body }, t("nodes.saved"));
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
      (0, import_react.createElement)("h3", { key: "h" }, t("audit.title")),
      audit.length === 0 ? (0, import_react.createElement)("div", { key: "e", className: "empty" }, t("audit.empty")) : (0, import_react.createElement)("table", { key: "t" }, [
        (0, import_react.createElement)("thead", { key: "head" }, (0, import_react.createElement)("tr", null, [
          (0, import_react.createElement)("th", { key: "w" }, t("audit.when")),
          (0, import_react.createElement)("th", { key: "k" }, t("audit.what")),
          (0, import_react.createElement)("th", { key: "n" }, t("audit.node")),
          (0, import_react.createElement)("th", { key: "m" }, t("audit.mode")),
          (0, import_react.createElement)("th", { key: "c" }, t("audit.command"))
        ])),
        (0, import_react.createElement)("tbody", { key: "body" }, audit.map((row2) => (0, import_react.createElement)("tr", { key: row2.id }, [
          (0, import_react.createElement)("td", { key: "w", className: "muted" }, new Date(row2.at).toLocaleTimeString()),
          (0, import_react.createElement)("td", { key: "k" }, row2.kind === "denied" ? (0, import_react.createElement)("span", { style: { color: "#ef4444" } }, t("audit.denied")) : row2.kind === "approve" ? `${row2.outcome === "approved" ? t("audit.approved") : t("audit.rejected")}` : t("audit.exec")),
          (0, import_react.createElement)("td", { key: "n" }, row2.nodeName ? [row2.nodeName, (0, import_react.createElement)("span", { key: "id", className: "muted" }, ` #${row2.node}`)] : "\u2014"),
          (0, import_react.createElement)("td", { key: "m" }, (0, import_react.createElement)("code", null, row2.mode ?? "\u2014")),
          (0, import_react.createElement)("td", { key: "c" }, (0, import_react.createElement)("code", null, String(row2.command ?? "").slice(0, 120)))
        ])))
      ])
    ]),
    (0, import_react.createElement)("section", { key: "create", style: only("connections") }, [
      (0, import_react.createElement)("h3", { key: "h" }, t("nodes.new")),
      (0, import_react.createElement)("div", { key: "r", className: "row" }, [
        (0, import_react.createElement)("input", { key: "i", value: newName, placeholder: t("nodes.namePlaceholder"), style: { width: 220 }, onChange: (e) => setNewName(e.target.value) }),
        (0, import_react.createElement)("button", {
          key: "b",
          disabled: busy || !newName.trim(),
          onClick: () => {
            run({ op: "create", body: { name: newName.trim() } }, t("nodes.created"));
            setNewName("");
          }
        }, t("nodes.create"))
      ])
    ]),
    (0, import_react.createElement)("section", { key: "settings", style: only("settings") }, [
      (0, import_react.createElement)("h3", { key: "h" }, t("tab.settings")),
      (0, import_react.createElement)(
        "div",
        { key: "note", className: "muted" },
        t("settings.note")
      ),
      settings ? (0, import_react.createElement)("table", { key: "t" }, [
        (0, import_react.createElement)("tbody", { key: "b" }, [
          row(
            t("settings.self"),
            (settings.selfRoots ?? []).length ? settings.selfRoots.join(", ") : t("settings.selfOff")
          ),
          row(t("settings.wait"), t("common.waitForever", { value: settings.approvalWaitSeconds })),
          row(t("settings.ttl"), t("common.seconds", { value: settings.approvalTtlSeconds })),
          row(t("settings.alive"), t("common.seconds", { value: settings.aliveTimeoutSeconds })),
          row(t("settings.ping"), settings.wsPingSeconds ? t("common.seconds", { value: settings.wsPingSeconds }) : t("settings.off"))
        ])
      ]) : (0, import_react.createElement)("div", { className: "muted" }, t("settings.failed")),
      (0, import_react.createElement)(
        "div",
        { key: "selfnote", className: "muted", style: { marginTop: 8 } },
        t("settings.selfNote")
      )
    ])
  ]);
}
var name = "dsh-nodes";
var inject = ["slots", "locale"];
var Boundary = class extends Base {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    try {
      console.error("[dsh-nodes] \u043F\u0430\u043D\u0435\u043B\u044C \u0443\u043F\u0430\u043B\u0430:", error);
    } catch {
    }
  }
  render() {
    if (this.state.error) {
      return (0, import_react.createElement)("div", { className: "msg bad" }, `\u043F\u0430\u043D\u0435\u043B\u044C dsh-nodes \u0443\u043F\u0430\u043B\u0430: ${this.state.error?.message ?? this.state.error}`);
    }
    return this.props.children;
  }
};
var translate = (key, vars) => {
  const text = String(ru[key] ?? en[key] ?? key);
  if (vars) return text.replace(/\{(\w+)\}/g, (_, name2) => String(vars[name2] ?? `{${name2}}`));
  return text;
};
var t = (key, vars) => translate(key, vars);
function mountLocale(ctx) {
  const locale = ctx?.locale;
  if (typeof locale?.register !== "function" || typeof locale?.bind !== "function") {
    console.warn("[dsh-nodes] \u043B\u043E\u043A\u0430\u043B\u044C \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430: \u0441\u0442\u0440\u043E\u043A\u0438 \u0431\u0435\u0440\u0443\u0442\u0441\u044F \u0438\u0437 \u0441\u0432\u043E\u0435\u0433\u043E \u0441\u043B\u043E\u0432\u0430\u0440\u044F");
    return;
  }
  const install = () => {
    try {
      locale.addLanguage({ id: "ru", label: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439", fallback: "en" });
    } catch (error) {
      if (!/already/i.test(String(error?.message ?? error))) {
        console.warn("[dsh-nodes] \u044F\u0437\u044B\u043A ru \u043D\u0435 \u043E\u0431\u044A\u044F\u0432\u043B\u0435\u043D:", error);
      }
    }
    try {
      locale.register(NS, { en, ru, zh });
    } catch (error) {
      console.warn("[dsh-nodes] \u0441\u043B\u043E\u0432\u0430\u0440\u0438 \u043D\u0435 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u044B:", error);
    }
  };
  try {
    if (typeof ctx?.effect === "function") ctx.effect(install, "dsh-nodes: dictionaries");
    else install();
  } catch (error) {
    console.warn("[dsh-nodes] \u0441\u043B\u043E\u0432\u0430\u0440\u0438 \u043D\u0435 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u044B:", error);
  }
  try {
    translate = locale.bind(NS);
  } catch (error) {
    console.warn("[dsh-nodes] \u043F\u0435\u0440\u0435\u0432\u043E\u0434 \u043D\u0435 \u043F\u0440\u0438\u0432\u044F\u0437\u0430\u043D:", error);
  }
}
function apply(ctx) {
  try {
    const disposeStyles = mountStyles();
    if (typeof ctx?.effect === "function") ctx.effect(() => disposeStyles);
    mountLocale(ctx);
    const slots = ctx?.slots;
    if (!slots?.register) {
      console.warn("[dsh-nodes] \u0441\u043B\u043E\u0442\u044B \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B: \u043F\u0430\u043D\u0435\u043B\u044C \u043D\u0435 \u0441\u043C\u043E\u043D\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0430");
      return;
    }
    slots.inject("settings.section", () => slots.register(
      { name: "settings.section", id: "dsh-nodes", order: 35, locale: NS, label: () => t("nodes.title") },
      // панель завёрнута в ловушку: ошибка рендера покажет текст, а не пустоту
      () => (0, import_react.createElement)(Boundary, null, (0, import_react.createElement)(NodesPanel, null))
    ));
  } catch (error) {
    console.warn("[dsh-nodes] \u043A\u043B\u0438\u0435\u043D\u0442\u0441\u043A\u0430\u044F \u043F\u043E\u043B\u043E\u0432\u0438\u043D\u0430 \u043D\u0435 \u0441\u043C\u043E\u043D\u0442\u0438\u0440\u043E\u0432\u0430\u043B\u0430\u0441\u044C:", error);
  }
}

    return module.exports;
  }
});
