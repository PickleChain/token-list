#!/usr/bin/env node
// Validates the token list and address tags of every network folder
// (testnet/, mainnet/). Zero dependencies: run it with plain
// `node scripts/validate.mjs` (or `npm test`).
//
// A network folder with no JSON in it is skipped (mainnet/ until it
// launches). A folder that holds lists is validated against the chain id
// configured for it in NETWORKS below; JSON in a folder whose chain id is not
// configured yet fails, so nothing is published for a chain by accident.
//
//   --base <git-ref>   also enforce the version-bump rules against the files
//                      as they are at <git-ref> (CI passes the PR's base).
//
// Exit code 0 when everything passes, 1 otherwise. Every problem is printed,
// not just the first one.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { toChecksumAddress } from "./lib/keccak.mjs";

// The chain each network folder describes. Mainnet's id is not known yet: set
// it here in the same pull request that adds mainnet/tokenlist.json.
export const NETWORKS = {
  testnet: { chainId: 78270 },
  mainnet: { chainId: null },
};
export const CHAIN_ID = NETWORKS.testnet.chainId;
export const RAW_PREFIX = "https://raw.githubusercontent.com/PickleChain/token-list/main/";
export const LIST_FILES = ["tokenlist.json", "tags.json"];
const TESTNET = { name: "testnet", chainId: NETWORKS.testnet.chainId };
export const MAX_LOGO_BYTES = 100 * 1024;
export const PNG_SIZE = 256;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
// The Uniswap Token Lists schema's own patterns and limits (schema v1.x).
const LIST_NAME_RE = /^[\w ]+$/;
const KEYWORD_RE = /^[\w ]+$/;
const TAG_ID_RE = /^[\w]+$/;
const TOKEN_NAME_RE = /^[ \S+]+$/;
const SYMBOL_RE = /^\S+$/;

function isInt(v, min, max) {
  return Number.isInteger(v) && v >= min && v <= max;
}

function checkVersion(v, where, errors) {
  if (!v || typeof v !== "object") return errors.push(`${where}: version must be an object`);
  for (const k of ["major", "minor", "patch"]) {
    if (!isInt(v[k], 0, Number.MAX_SAFE_INTEGER)) errors.push(`${where}: version.${k} must be a non-negative integer`);
  }
  const extra = Object.keys(v).filter((k) => !["major", "minor", "patch"].includes(k));
  if (extra.length) errors.push(`${where}: version has unknown keys ${extra.join(", ")}`);
}

function checkTimestamp(ts, where, errors) {
  if (typeof ts !== "string" || Number.isNaN(Date.parse(ts)) || !/^\d{4}-\d{2}-\d{2}T/.test(ts)) {
    errors.push(`${where}: timestamp must be an ISO 8601 date-time`);
  }
}

function checkAddress(addr, where, errors) {
  if (typeof addr !== "string" || !ADDRESS_RE.test(addr)) {
    errors.push(`${where}: "${addr}" is not an address`);
    return false;
  }
  const want = toChecksumAddress(addr);
  if (want !== addr) {
    errors.push(`${where}: "${addr}" is not EIP-55 checksummed (expected ${want})`);
    return false;
  }
  return true;
}

/**
 * The path inside the network folder a raw GitHub URL points at
 * ("logos/tokens/0x...png"), or null if it is not a logo of THIS network in
 * this repository: a testnet list may not use a mainnet logo, or the reverse.
 */
export function localPathOf(url, network = "testnet") {
  const prefix = `${RAW_PREFIX}${network}/`;
  if (typeof url !== "string" || !url.startsWith(prefix)) return null;
  const rel = url.slice(prefix.length);
  if (!/^logos\/(tokens|tags)\/[A-Za-z0-9._-]+\.(png|svg)$/.test(rel) || rel.includes("..")) return null;
  return rel;
}

/** Problems with one logo file's bytes (type sniffed from the bytes, not the name). */
export function logoProblems(rel, bytes) {
  const out = [];
  if (bytes.length === 0) return [`${rel}: empty file`];
  if (bytes.length > MAX_LOGO_BYTES) out.push(`${rel}: ${bytes.length} bytes, the limit is ${MAX_LOGO_BYTES}`);
  if (rel.endsWith(".png")) {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 24 || !sig.every((b, i) => bytes[i] === b)) return [...out, `${rel}: not a PNG file`];
    const w = bytes.readUInt32BE(16);
    const h = bytes.readUInt32BE(20);
    if (w !== PNG_SIZE || h !== PNG_SIZE) out.push(`${rel}: PNG is ${w}x${h}, it must be ${PNG_SIZE}x${PNG_SIZE}`);
  } else if (rel.endsWith(".svg")) {
    const text = bytes.toString("utf8");
    const head = text.replace(/^﻿/, "").trimStart();
    if (!/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) out.push(`${rel}: not an SVG document`);
    if (/<script/i.test(text)) out.push(`${rel}: SVG must not contain <script>`);
    if (/<foreignObject/i.test(text)) out.push(`${rel}: SVG must not contain <foreignObject>`);
    if (/\son[a-z]+\s*=/i.test(text)) out.push(`${rel}: SVG must not contain event handler attributes`);
    if (/(?:xlink:)?href\s*=\s*["'](?!#)/i.test(text)) out.push(`${rel}: SVG must not reference external resources`);
    if (/url\(\s*["']?(?!#)/i.test(text)) out.push(`${rel}: SVG must not load external resources through url()`);
    if (/<!ENTITY|<!DOCTYPE/i.test(text)) out.push(`${rel}: SVG must not declare a DOCTYPE or entities`);
  } else {
    out.push(`${rel}: only .png and .svg logos are accepted`);
  }
  return out;
}

/** JSON.parse drops duplicate keys silently; find them in the raw text of an object. */
export function duplicateAddressKeys(text) {
  const seen = new Map();
  const dups = [];
  for (const m of text.matchAll(/"(0x[0-9a-fA-F]{40})"\s*:/g)) {
    const k = m[1].toLowerCase();
    if (seen.has(k)) dups.push(m[1]);
    seen.set(k, true);
  }
  return dups;
}

export function validateTokenList(list, errors, logoRefs, net = TESTNET) {
  const W = `${net.name}/tokenlist.json`;
  const P = `${RAW_PREFIX}${net.name}/`;
  if (!list || typeof list !== "object" || Array.isArray(list)) return errors.push(`${W}: must be a JSON object`);
  const allowed = ["name", "timestamp", "version", "tokens", "keywords", "tags", "logoURI", "tokenMap"];
  for (const k of Object.keys(list)) if (!allowed.includes(k)) errors.push(`${W}: unknown top-level key "${k}"`);
  if (typeof list.name !== "string" || !LIST_NAME_RE.test(list.name) || list.name.length > 30) {
    errors.push(`${W}: name must be 1-30 word characters or spaces`);
  }
  checkTimestamp(list.timestamp, W, errors);
  checkVersion(list.version, W, errors);
  if (list.keywords !== undefined) {
    if (!Array.isArray(list.keywords) || list.keywords.length > 20) errors.push(`${W}: keywords must be an array of at most 20`);
    else {
      const set = new Set();
      for (const kw of list.keywords) {
        if (typeof kw !== "string" || !KEYWORD_RE.test(kw) || kw.length > 20) errors.push(`${W}: keyword "${kw}" is invalid`);
        if (set.has(kw)) errors.push(`${W}: keyword "${kw}" is repeated`);
        set.add(kw);
      }
    }
  }
  const tagDefs = list.tags || {};
  if (list.tags !== undefined) {
    if (typeof list.tags !== "object" || Array.isArray(list.tags)) errors.push(`${W}: tags must be an object`);
    else {
      if (Object.keys(tagDefs).length > 20) errors.push(`${W}: at most 20 tag definitions`);
      for (const [id, def] of Object.entries(tagDefs)) {
        if (!TAG_ID_RE.test(id) || id.length > 10) errors.push(`${W}: tag id "${id}" must be 1-10 word characters`);
        if (!def || typeof def.name !== "string" || !def.name || def.name.length > 20) errors.push(`${W}: tag "${id}" needs a name of 1-20 characters`);
        if (!def || typeof def.description !== "string" || !def.description || def.description.length > 200) {
          errors.push(`${W}: tag "${id}" needs a description of 1-200 characters`);
        }
      }
    }
  }
  if (list.logoURI !== undefined) {
    const rel = localPathOf(list.logoURI, net.name);
    if (!rel) errors.push(`${W}: logoURI must be a file in this repository under ${P}logos/`);
    else logoRefs.add(rel);
  }
  if (!Array.isArray(list.tokens) || list.tokens.length === 0) return errors.push(`${W}: tokens must be a non-empty array`);
  if (list.tokens.length > 10000) errors.push(`${W}: at most 10000 tokens`);
  const addrs = new Map();
  const symbols = new Map();
  const tokenKeys = ["chainId", "address", "decimals", "name", "symbol", "logoURI", "tags", "extensions"];
  list.tokens.forEach((t, i) => {
    const where = `${W}: tokens[${i}]${t && t.symbol ? ` (${t.symbol})` : ""}`;
    if (!t || typeof t !== "object") return errors.push(`${where}: must be an object`);
    for (const k of Object.keys(t)) if (!tokenKeys.includes(k)) errors.push(`${where}: unknown key "${k}"`);
    if (t.chainId !== net.chainId) errors.push(`${where}: chainId must be ${net.chainId}`);
    const okAddr = checkAddress(t.address, where, errors);
    if (okAddr) {
      const key = t.address.toLowerCase();
      if (addrs.has(key)) errors.push(`${where}: address repeats tokens[${addrs.get(key)}]`);
      addrs.set(key, i);
    }
    if (!isInt(t.decimals, 0, 255)) errors.push(`${where}: decimals must be an integer 0-255`);
    if (typeof t.name !== "string" || !t.name || t.name.length > 40 || !TOKEN_NAME_RE.test(t.name)) {
      errors.push(`${where}: name must be 1-40 characters`);
    }
    if (typeof t.symbol !== "string" || !t.symbol || t.symbol.length > 20 || !SYMBOL_RE.test(t.symbol)) {
      errors.push(`${where}: symbol must be 1-20 characters with no whitespace`);
    } else {
      const key = t.symbol.toLowerCase();
      if (symbols.has(key)) errors.push(`${where}: symbol "${t.symbol}" repeats tokens[${symbols.get(key)}]`);
      symbols.set(key, i);
    }
    if (typeof t.logoURI !== "string") errors.push(`${where}: logoURI is required`);
    else {
      const rel = localPathOf(t.logoURI, net.name);
      if (!rel || !rel.startsWith("logos/tokens/")) {
        errors.push(`${where}: logoURI must be ${P}logos/tokens/<checksum address>.png|svg`);
      } else {
        logoRefs.add(rel);
        const base = rel.slice("logos/tokens/".length).replace(/\.(png|svg)$/, "");
        if (okAddr && base !== t.address) errors.push(`${where}: logo file must be named after the checksummed address (${t.address})`);
      }
    }
    if (t.tags !== undefined) {
      if (!Array.isArray(t.tags) || t.tags.length > 10) errors.push(`${where}: tags must be an array of at most 10`);
      else for (const tag of t.tags) if (!Object.prototype.hasOwnProperty.call(tagDefs, tag)) errors.push(`${where}: tag "${tag}" is not defined in tags`);
    }
    if (t.extensions !== undefined) {
      if (!t.extensions || typeof t.extensions !== "object" || Array.isArray(t.extensions)) errors.push(`${where}: extensions must be an object`);
      else {
        const entries = Object.entries(t.extensions);
        if (entries.length > 10) errors.push(`${where}: at most 10 extensions`);
        for (const [k, v] of entries) {
          if (k.length > 40) errors.push(`${where}: extension key "${k}" is longer than 40 characters`);
          const scalar = v === null || ["string", "number", "boolean"].includes(typeof v);
          if (!scalar) errors.push(`${where}: extension "${k}" must be a string, number, boolean or null`);
          if (typeof v === "string" && v.length > 500) errors.push(`${where}: extension "${k}" is longer than 500 characters`);
        }
      }
    }
  });
}

export function validateTags(doc, errors, logoRefs, rawText = "", net = TESTNET) {
  const W = `${net.name}/tags.json`;
  const P = `${RAW_PREFIX}${net.name}/`;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return errors.push(`${W}: must be a JSON object`);
  const allowed = ["$schema", "name", "timestamp", "version", "chainId", "categories", "tags"];
  for (const k of Object.keys(doc)) if (!allowed.includes(k)) errors.push(`${W}: unknown top-level key "${k}"`);
  if (typeof doc.name !== "string" || !doc.name || doc.name.length > 60) errors.push(`${W}: name must be 1-60 characters`);
  checkTimestamp(doc.timestamp, W, errors);
  checkVersion(doc.version, W, errors);
  if (doc.chainId !== net.chainId) errors.push(`${W}: chainId must be ${net.chainId}`);
  const cats = doc.categories;
  if (!cats || typeof cats !== "object" || Array.isArray(cats) || !Object.keys(cats).length) {
    errors.push(`${W}: categories must be a non-empty object`);
  } else {
    for (const [id, def] of Object.entries(cats)) {
      if (!/^[a-z][a-z0-9-]{0,19}$/.test(id)) errors.push(`${W}: category id "${id}" must be lowercase, 1-20 characters`);
      if (!def || typeof def.name !== "string" || !def.name || def.name.length > 20) errors.push(`${W}: category "${id}" needs a name of 1-20 characters`);
      if (!def || typeof def.description !== "string" || !def.description || def.description.length > 200) {
        errors.push(`${W}: category "${id}" needs a description of 1-200 characters`);
      }
      const extra = def ? Object.keys(def).filter((k) => !["name", "description"].includes(k)) : [];
      if (extra.length) errors.push(`${W}: category "${id}" has unknown keys ${extra.join(", ")}`);
    }
  }
  if (!doc.tags || typeof doc.tags !== "object" || Array.isArray(doc.tags)) return errors.push(`${W}: tags must be an object`);
  for (const dup of duplicateAddressKeys(rawText)) errors.push(`${W}: address ${dup} is tagged more than once`);
  const tagKeys = ["name", "category", "project", "url", "logo", "note"];
  const names = new Map();
  for (const [addr, t] of Object.entries(doc.tags)) {
    const where = `${W}: ${addr}`;
    checkAddress(addr, where, errors);
    if (!t || typeof t !== "object") {
      errors.push(`${where}: must be an object`);
      continue;
    }
    for (const k of Object.keys(t)) if (!tagKeys.includes(k)) errors.push(`${where}: unknown key "${k}"`);
    for (const k of ["name", "category", "project", "url", "logo"]) if (!(k in t)) errors.push(`${where}: "${k}" is required (use null for url or logo when there is none)`);
    if (typeof t.name !== "string" || !t.name.trim() || t.name.length > 40) errors.push(`${where}: name must be 1-40 characters`);
    else {
      const key = t.name.toLowerCase();
      if (names.has(key)) errors.push(`${where}: name "${t.name}" is already used by ${names.get(key)}`);
      names.set(key, addr);
    }
    if (typeof t.category !== "string" || !cats || !Object.prototype.hasOwnProperty.call(cats, t.category)) {
      errors.push(`${where}: category "${t.category}" is not defined in categories`);
    }
    if (typeof t.project !== "string" || !t.project || t.project.length > 40) errors.push(`${where}: project must be 1-40 characters`);
    if (t.url !== null && t.url !== undefined && (typeof t.url !== "string" || !/^https:\/\/[^\s]+$/.test(t.url) || t.url.length > 200)) {
      errors.push(`${where}: url must be an https URL or null`);
    }
    if (t.logo !== null && t.logo !== undefined) {
      const rel = localPathOf(t.logo, net.name);
      if (!rel || !rel.startsWith("logos/tags/")) errors.push(`${where}: logo must be ${P}logos/tags/<file>.png|svg or null`);
      else logoRefs.add(rel);
    }
    if (t.note !== undefined && (typeof t.note !== "string" || !t.note || t.note.length > 200)) errors.push(`${where}: note must be 1-200 characters`);
  }
}

export function checkLogoFiles(root, logoRefs, errors, label = "") {
  const at = (rel) => (label ? `${label}/${rel}` : rel);
  for (const rel of [...logoRefs].sort()) {
    const abs = join(root, ...rel.split("/"));
    if (!existsSync(abs)) {
      errors.push(`${at(rel)}: referenced but missing (case matters on GitHub)`);
      continue;
    }
    // A case-insensitive file system would find Foo.png for foo.png; GitHub will not.
    const dir = dirname(abs);
    const name = rel.split("/").pop();
    if (!readdirSync(dir).includes(name)) errors.push(`${at(rel)}: referenced with a different letter case than the file on disk`);
    errors.push(...logoProblems(at(rel), readFileSync(abs)));
  }
  for (const sub of ["tokens", "tags"]) {
    const dir = join(root, "logos", sub);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name === ".gitkeep") continue;
      const rel = `logos/${sub}/${name}`;
      if (!statSync(join(dir, name)).isFile()) errors.push(`${at(rel)}: only files belong in logos/${sub}/`);
      else if (!logoRefs.has(rel)) errors.push(`${at(rel)}: not referenced by this network's tokenlist.json or tags.json; remove it`);
    }
  }
}

function cmp(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function fmt(v) {
  return `${v.major}.${v.minor}.${v.patch}`;
}

/**
 * The smallest bump a change needs, Uniswap's rules:
 * removing an entry is major, adding one is minor, changing one is patch.
 */
export function requiredBump(before, after, keyOf) {
  const a = new Map(before.map((x) => [keyOf(x), JSON.stringify(x)]));
  const b = new Map(after.map((x) => [keyOf(x), JSON.stringify(x)]));
  if ([...a.keys()].some((k) => !b.has(k))) return "major";
  if ([...b.keys()].some((k) => !a.has(k))) return "minor";
  if ([...b.entries()].some(([k, v]) => a.get(k) !== v)) return "patch";
  return "none";
}

export function checkBump(label, oldDoc, newDoc, oldItems, newItems, keyOf, errors) {
  const changed = JSON.stringify(oldDoc) !== JSON.stringify(newDoc);
  if (!changed) return;
  const need = requiredBump(oldItems, newItems, keyOf);
  const ov = oldDoc.version;
  const nv = newDoc.version;
  if (cmp(nv, ov) <= 0) {
    errors.push(`${label}: the file changed but version stayed ${fmt(ov)}; bump it`);
    return;
  }
  const ok =
    need === "major" ? nv.major > ov.major
      : need === "minor" ? nv.major > ov.major || (nv.major === ov.major && nv.minor > ov.minor)
        : true;
  if (!ok) errors.push(`${label}: this change needs a ${need} version bump (was ${fmt(ov)}, now ${fmt(nv)})`);
  if (Date.parse(newDoc.timestamp) <= Date.parse(oldDoc.timestamp)) errors.push(`${label}: update timestamp when the version changes`);
}

function gitShow(ref, file) {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function readJson(abs, label, errors) {
  if (!existsSync(abs)) {
    errors.push(`${label}: missing`);
    return [null, ""];
  }
  const text = readFileSync(abs, "utf8");
  try {
    return [JSON.parse(text), text];
  } catch (err) {
    errors.push(`${label}: not valid JSON (${err.message})`);
    return [null, text];
  }
}

function jsonFilesIn(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...jsonFilesIn(abs).map((n) => `${name}/${n}`));
    else if (name.toLowerCase().endsWith(".json")) out.push(name);
  }
  return out;
}

/** One network folder. Returns counts, or null when it holds no lists yet. */
export function validateNetwork(root, name, errors, notes, { base = null, networks = NETWORKS } = {}) {
  const dir = join(root, name);
  const json = jsonFilesIn(dir);
  if (!json.length) {
    notes.push(`${name}/: no lists yet, skipped`);
    return null;
  }
  const chainId = networks[name] && networks[name].chainId;
  if (!Number.isInteger(chainId)) {
    errors.push(`${name}/: holds ${json.join(", ")} but no chain id is configured for ${name} in scripts/validate.mjs (NETWORKS)`);
    return null;
  }
  for (const f of json) if (!LIST_FILES.includes(f)) errors.push(`${name}/${f}: unexpected JSON file; a network folder holds ${LIST_FILES.join(" and ")}`);
  const net = { name, chainId };
  const logoRefs = new Set();
  const [list] = readJson(join(dir, "tokenlist.json"), `${name}/tokenlist.json`, errors);
  const [tags, tagsText] = readJson(join(dir, "tags.json"), `${name}/tags.json`, errors);
  if (list) validateTokenList(list, errors, logoRefs, net);
  if (tags) validateTags(tags, errors, logoRefs, tagsText, net);
  checkLogoFiles(dir, logoRefs, errors, name);
  if (base) {
    const oldList = gitShow(base, `${name}/tokenlist.json`);
    const oldTags = gitShow(base, `${name}/tags.json`);
    if (oldList && list && list.version) {
      const o = JSON.parse(oldList);
      checkBump(`${name}/tokenlist.json`, o, list, o.tokens || [], list.tokens || [], (t) => `${t.chainId}:${String(t.address).toLowerCase()}`, errors);
    } else notes.push(`${name}/tokenlist.json: not present at ${base}, version rules skipped`);
    if (oldTags && tags && tags.version) {
      const o = JSON.parse(oldTags);
      const entries = (d) => Object.entries(d.tags || {}).map(([k, v]) => ({ k: k.toLowerCase(), v }));
      checkBump(`${name}/tags.json`, o, tags, entries(o), entries(tags), (e) => e.k, errors);
    } else notes.push(`${name}/tags.json: not present at ${base}, version rules skipped`);
  }
  return { tokens: list?.tokens?.length || 0, tags: Object.keys(tags?.tags || {}).length, logos: logoRefs.size };
}

export function validateRepo(root = ROOT, { base = null, networks = NETWORKS } = {}) {
  const errors = [];
  const notes = [];
  // Lists and logos belong to a network: nothing of the kind at the root.
  for (const stray of [...LIST_FILES, "logos"]) {
    if (existsSync(join(root, stray))) errors.push(`${stray}: belongs inside a network folder (${Object.keys(networks).join("/, ")}/), not at the root`);
  }
  const counts = {};
  for (const name of Object.keys(networks)) {
    const c = validateNetwork(root, name, errors, notes, { base, networks });
    if (c) counts[name] = c;
  }
  if (!Object.keys(counts).length && !errors.length) errors.push("no network folder holds a list");
  return { errors, notes, counts };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const i = process.argv.indexOf("--base");
  const base = i > 0 ? process.argv[i + 1] : null;
  const { errors, notes, counts } = validateRepo(ROOT, { base });
  for (const n of notes) console.log(`note: ${n}`);
  if (errors.length) {
    for (const e of errors) console.error(`error: ${e.split(sep).join("/")}`);
    console.error(`\n${errors.length} problem(s) found.`);
    process.exit(1);
  }
  for (const [name, c] of Object.entries(counts)) {
    console.log(`ok: ${name}: ${c.tokens} tokens, ${c.tags} tags, ${c.logos} logos (${relative(process.cwd(), join(ROOT, name)) || name})`);
  }
}
