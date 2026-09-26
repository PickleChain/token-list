# Contributing

Additions and fixes come in as pull requests, against the folder of the
network the contract is on: `testnet/` today, `mainnet/` once mainnet
launches (a list there also needs mainnet's chain ID set in `NETWORKS` in
`scripts/validate.mjs`). Every pull request is checked
by `npm test` in GitHub Actions, and reviewed by a maintainer before merge.

## Criteria for a token

A token is added when all of the following hold:

- It is deployed on the Pickle Chain network of that folder (testnet: chain ID `78270`) and its source is
  verified or published, so anyone can read what it does.
- The pull request is opened by, or confirmed by, the token's team: link a
  post from the project's own website or official account that names the
  contract address.
- The name and symbol do not imitate another token or project. A token that
  calls itself PKL, WETH or another listed symbol will not be added.
- It has real use: liquidity on Pepper, holders, or a live product. A token
  launched a few minutes ago with no activity is not added yet.
- The contract has no hidden mint, blacklist or fee switch that the team has
  not disclosed.

Maintainers can remove a token at any time, for example after an exploit, a
rug pull, a migration to a new contract, or a misleading change of metadata.

## Criteria for a tag

Tags are for **contracts** that people meet in transactions: protocol
contracts, routers, factories, pools, vaults, games, bridges. Personal
wallets (EOAs) are not tagged. The project must be live on Pickle Chain and
the address must be verifiable from the project's own documentation or
deployment files.

## Add a token

1. Get the checksummed address (EIP-55 mixed case). The validator prints the
   expected form if yours is wrong.
2. Add the logo to `<network>/logos/tokens/`, named exactly after the
   checksummed address: `testnet/logos/tokens/0xAbC...123.png` (or `.svg`).
3. Append an entry to `tokens` in `<network>/tokenlist.json`:

   ```json
   {
     "chainId": 78270,
     "address": "0xAbC...123",
     "name": "Example Token",
     "symbol": "EXM",
     "decimals": 18,
     "logoURI": "https://raw.githubusercontent.com/PickleChain/token-list/main/testnet/logos/tokens/0xAbC...123.png",
     "extensions": { "website": "https://example.org" }
   }
   ```

   `tags` (ids defined in the list's top-level `tags`) and `extensions`
   (at most 10 scalar values) are optional.
4. Bump `version` (see below) and set `timestamp` to now (ISO 8601, UTC).
5. Run `npm test`.

## Add a tag

1. Add an entry to `tags` in `<network>/tags.json`, keyed by the checksummed address:

   ```json
   "0xAbC...123": {
     "name": "Example vault",
     "category": "protocol",
     "project": "Example",
     "url": "https://example.org",
     "logo": null,
     "note": "What this contract does, in one sentence."
   }
   ```

   - `name`: 1-40 characters, unique across the file. It replaces the address
     in explorers, so make it short and specific. When a contract is
     replaced, keep the old entry and suffix its name with `(previous)`.
   - `category`: one of the keys of `categories`. Propose a new category in
     the same pull request if none fits.
   - `url`: an `https://` link, or `null`.
   - `logo`: a file in the same network's `logos/tags/` given as its raw URL,
     or `null`.
     Several tags of the same project can share one logo file.
   - `note`: optional, at most 200 characters.
2. Bump `version` and `timestamp` in that `tags.json`.
3. Run `npm test`.

## Logo rules

- PNG exactly 256x256 pixels, or SVG.
- 100 KB at most.
- Square artwork that still reads at 20 pixels; a transparent or solid
  background is fine. Apps usually show logos in a circle.
- SVGs must be plain drawings: no `<script>`, no event handler attributes,
  no `<foreignObject>`, no external `href` or `url()`, no DOCTYPE.
- Only submit artwork you own or are allowed to use.

## Versions

Every list file carries its own `version`, following the Token Lists rules:

| Change | Bump |
| --- | --- |
| An entry removed | major |
| An entry added | minor |
| An entry changed (name, logo, note, decimals...) | patch |

CI enforces this against the base branch of the pull request.

## Running the checks

```sh
npm test          # validate every network folder's lists and logos, then the validator's own tests
node scripts/validate.mjs --base origin/main   # also check the version bumps
```

Node 22 or later. There is nothing to install.
