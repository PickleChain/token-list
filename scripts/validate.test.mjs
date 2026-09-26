// The validator's own tests: every rule it enforces fails when it should.
// Run with `npm test` (after the validator itself has passed on the repo).

import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, toChecksumAddress } from "./lib/keccak.mjs";
import {
  duplicateAddressKeys,
  localPathOf,
  logoProblems,
  requiredBump,
  checkBump,
  validateRepo,
  validateTags,
  validateTokenList,
} from "./validate.mjs";

const REPO = new URL("..", import.meta.url);
const LIST = JSON.parse(readFileSync(new URL("../testnet/tokenlist.json", import.meta.url), "utf8"));
const TAGS_TEXT = readFileSync(new URL("../testnet/tags.json", import.meta.url), "utf8");
const TAGS = JSON.parse(TAGS_TEXT);
const clone = (x) => JSON.parse(JSON.stringify(x));

function listErrors(list) {
  const errors = [];
  validateTokenList(list, errors, new Set());
  return errors;
}

function tagErrors(doc, text = JSON.stringify(doc)) {
  const errors = [];
  validateTags(doc, errors, new Set(), text);
  return errors;
}

test("keccak-256 matches known digests and EIP-55 vectors", () => {
  assert.equal(keccak256(""), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(keccak256("abc"), "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  for (const v of [
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
    "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
    "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
  ]) assert.equal(toChecksumAddress(v.toLowerCase()), v);
});

test("the shipped files pass", () => {
  assert.deepEqual(listErrors(LIST), []);
  assert.deepEqual(tagErrors(TAGS, TAGS_TEXT), []);
});

test("a token on another chain is refused", () => {
  const l = clone(LIST);
  l.tokens[0].chainId = 1;
  assert.match(listErrors(l).join("\n"), /chainId must be 78270/);
});

test("a lowercase address is refused with the checksum it should have", () => {
  const l = clone(LIST);
  l.tokens[0].address = l.tokens[0].address.toLowerCase();
  assert.match(listErrors(l).join("\n"), /not EIP-55 checksummed \(expected 0x8d1Ab7dD27a5Fd87452748012Dc7f319f51b877e\)/);
});

test("duplicate addresses and duplicate symbols are refused", () => {
  const l = clone(LIST);
  l.tokens.push(clone(l.tokens[0]));
  const out = listErrors(l).join("\n");
  assert.match(out, /address repeats tokens\[0\]/);
  assert.match(out, /symbol "PKL" repeats tokens\[0\]/);
  const m = clone(LIST);
  m.tokens[1].symbol = "pkl";
  assert.match(listErrors(m).join("\n"), /symbol "pkl" repeats/);
});

test("a logo hosted anywhere but this repository is refused", () => {
  const l = clone(LIST);
  l.tokens[0].logoURI = "https://example.com/pkl.png";
  assert.match(listErrors(l).join("\n"), /logoURI must be/);
  assert.equal(localPathOf("https://raw.githubusercontent.com/PickleChain/token-list/main/testnet/logos/../x.png"), null);
  assert.equal(localPathOf("https://raw.githubusercontent.com/Someone/token-list/main/testnet/logos/tokens/a.png"), null);
  assert.equal(localPathOf("https://raw.githubusercontent.com/PickleChain/token-list/main/testnet/logos/tokens/a.png"), "logos/tokens/a.png");
});

test("a logo must live in its own network's folder", () => {
  const l = clone(LIST);
  l.tokens[0].logoURI = l.tokens[0].logoURI.replace("/main/testnet/", "/main/mainnet/");
  assert.match(listErrors(l).join("\n"), /logoURI must be https:\/\/raw\.githubusercontent\.com\/PickleChain\/token-list\/main\/testnet\/logos\/tokens/);
  const old = clone(LIST);
  old.tokens[0].logoURI = old.tokens[0].logoURI.replace("/main/testnet/", "/main/");
  assert.match(listErrors(old).join("\n"), /logoURI must be/, "the pre-network root path is refused");
  assert.equal(localPathOf("https://raw.githubusercontent.com/PickleChain/token-list/main/mainnet/logos/tokens/a.png", "testnet"), null);
});

test("a token logo not named after its address is refused", () => {
  const l = clone(LIST);
  l.tokens[0].logoURI = l.tokens[1].logoURI;
  assert.match(listErrors(l).join("\n"), /named after the checksummed address/);
});

test("an undefined tag and bad decimals are refused", () => {
  const l = clone(LIST);
  l.tokens[0].tags = ["nope"];
  l.tokens[0].decimals = 256;
  const out = listErrors(l).join("\n");
  assert.match(out, /tag "nope" is not defined/);
  assert.match(out, /decimals must be an integer 0-255/);
});

test("logo bytes are judged by content: size, PNG dimensions, SVG hazards", () => {
  const png = (w, h) => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  assert.deepEqual(logoProblems("logos/tokens/a.png", png(256, 256)), []);
  assert.match(logoProblems("logos/tokens/a.png", png(512, 512)).join(), /must be 256x256/);
  assert.match(logoProblems("logos/tokens/a.png", Buffer.from("<svg></svg>")).join(), /not a PNG/);
  assert.match(logoProblems("logos/tokens/a.png", Buffer.concat([png(256, 256), Buffer.alloc(101 * 1024)])).join(), /limit is 102400/);
  const svg = (s) => Buffer.from(s);
  assert.deepEqual(logoProblems("logos/tokens/a.svg", svg('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>')), []);
  assert.match(logoProblems("logos/tokens/a.svg", svg("<svg><script>alert(1)</script></svg>")).join(), /<script>/);
  assert.match(logoProblems("logos/tokens/a.svg", svg('<svg onload="x()"></svg>')).join(), /event handler/);
  assert.match(logoProblems("logos/tokens/a.svg", svg('<svg><image href="https://x.test/a.png"/></svg>')).join(), /external resources/);
  assert.match(logoProblems("logos/tokens/a.svg", svg("<html></html>")).join(), /not an SVG/);
});

test("tags: unknown category, lowercase key, duplicate key and duplicate name are refused", () => {
  const t = clone(TAGS);
  const [first] = Object.keys(t.tags);
  t.tags[first].category = "nope";
  assert.match(tagErrors(t).join("\n"), /category "nope" is not defined/);

  const u = clone(TAGS);
  u.tags[first.toLowerCase()] = u.tags[first];
  delete u.tags[first];
  assert.match(tagErrors(u).join("\n"), /not EIP-55 checksummed/);

  const text = `{"tags":{"${first}":{},"${first.toLowerCase()}":{}}}`;
  assert.deepEqual(duplicateAddressKeys(text), [first.toLowerCase()]);

  const v = clone(TAGS);
  const keys = Object.keys(v.tags);
  v.tags[keys[1]].name = v.tags[keys[0]].name;
  assert.match(tagErrors(v).join("\n"), /is already used by/);
});

test("tags: a chainId mismatch and a foreign logo are refused", () => {
  const t = clone(TAGS);
  t.chainId = 1;
  const [first] = Object.keys(t.tags);
  t.tags[first].logo = "https://example.com/logo.png";
  const out = tagErrors(t).join("\n");
  assert.match(out, /chainId must be 78270/);
  assert.match(out, /logo must be/);
});

test("version bumps follow the Token Lists rules", () => {
  const key = (t) => t.address.toLowerCase();
  const a = [{ address: "0xA", name: "A" }];
  assert.equal(requiredBump(a, a, key), "none");
  assert.equal(requiredBump(a, [...a, { address: "0xB" }], key), "minor");
  assert.equal(requiredBump(a, [{ address: "0xA", name: "A2" }], key), "patch");
  assert.equal(requiredBump(a, [], key), "major");

  const old = { version: { major: 1, minor: 0, patch: 0 }, timestamp: "2026-01-01T00:00:00Z", tokens: a };
  const errs = (next) => {
    const e = [];
    checkBump("tokenlist.json", old, next, old.tokens, next.tokens, key, e);
    return e.join("\n");
  };
  const added = [...a, { address: "0xB" }];
  assert.match(errs({ ...old, tokens: added }), /version stayed 1.0.0/);
  assert.match(errs({ ...old, tokens: added, version: { major: 1, minor: 0, patch: 1 }, timestamp: "2026-02-01T00:00:00Z" }), /needs a minor/);
  assert.equal(errs({ ...old, tokens: added, version: { major: 1, minor: 1, patch: 0 }, timestamp: "2026-02-01T00:00:00Z" }), "");
  assert.match(errs({ ...old, tokens: [], version: { major: 1, minor: 1, patch: 0 }, timestamp: "2026-02-01T00:00:00Z" }), /needs a major/);
  assert.match(errs({ ...old, tokens: added, version: { major: 1, minor: 1, patch: 0 } }), /update timestamp/);
});

function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), "token-list-"));
  cpSync(new URL("testnet/", REPO), join(dir, "testnet"), { recursive: true });
  mkdirSync(join(dir, "mainnet"));
  writeFileSync(join(dir, "mainnet", "README.md"), "soon\n");
  return dir;
}

test("the repo layout: testnet validated, an empty mainnet skipped", () => {
  const { errors, notes, counts } = validateRepo(scratchRepo());
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(counts), ["testnet"]);
  assert.ok(notes.some((n) => /mainnet\/: no lists yet, skipped/.test(n)));
});

test("JSON in mainnet/ fails loudly while mainnet has no configured chain id", () => {
  const dir = scratchRepo();
  writeFileSync(join(dir, "mainnet", "tokenlist.json"), "{}");
  assert.match(validateRepo(dir).errors.join("\n"), /mainnet\/: holds tokenlist\.json but no chain id is configured/);
});

test("once mainnet has a chain id its lists are validated against it", () => {
  const dir = scratchRepo();
  cpSync(join(dir, "testnet"), join(dir, "mainnet"), { recursive: true });
  const { errors } = validateRepo(dir, { networks: { testnet: { chainId: 78270 }, mainnet: { chainId: 1234 } } });
  const out = errors.join("\n");
  assert.match(out, /mainnet\/tokenlist\.json: tokens\[0\] \(PKL\): chainId must be 1234/);
  assert.match(out, /mainnet\/tags\.json: chainId must be 1234/);
  assert.match(out, /logoURI must be https:\/\/raw\.githubusercontent\.com\/PickleChain\/token-list\/main\/mainnet\//);
});

test("lists or logos left at the root are refused", () => {
  const dir = scratchRepo();
  writeFileSync(join(dir, "tokenlist.json"), "{}");
  mkdirSync(join(dir, "logos"));
  const out = validateRepo(dir).errors.join("\n");
  assert.match(out, /^tokenlist\.json: belongs inside a network folder/m);
  assert.match(out, /^logos: belongs inside a network folder/m);
});
