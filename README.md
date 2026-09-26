# Pickle Chain token list and address tags

The curated list of tokens on **Pickle Chain**, and the labels Pickle apps
show for well-known contract addresses. Each network has its own folder:

| Folder | Network | Status |
| --- | --- | --- |
| [`testnet/`](testnet) | Pickle Chain testnet, chain ID `78270` | Live |
| [`mainnet/`](mainnet) | Pickle Chain mainnet | Published here when mainnet launches |

Each network folder holds:

| File | What it is |
| --- | --- |
| `tokenlist.json` | Tokens, in the standard [Uniswap Token Lists](https://tokenlists.org) format. Wallets, DEX interfaces and aggregators can import it as is. |
| `tags.json` | Address tags: a name, a category and a project for protocol contracts, pools and apps. Schema: [`schemas/tags.schema.json`](schemas/tags.schema.json). |
| `logos/tokens/` | One logo per token, named after its checksummed address. |
| `logos/tags/` | Project logos that tags point to. |

Being on a list is what gives a token its verified mark on the Pickle
explorer, the Pepper exchange and the other Pickle apps. The mark says the
token was reviewed and its contract address is the right one. It is not
investment advice or an endorsement.

## Use it

Testnet raw URLs, always the latest `main`:

```
https://raw.githubusercontent.com/PickleChain/token-list/main/testnet/tokenlist.json
https://raw.githubusercontent.com/PickleChain/token-list/main/testnet/tags.json
```

Logos:

```
https://raw.githubusercontent.com/PickleChain/token-list/main/testnet/logos/tokens/<checksumAddress>.png
https://raw.githubusercontent.com/PickleChain/token-list/main/testnet/logos/tokens/<checksumAddress>.svg
https://raw.githubusercontent.com/PickleChain/token-list/main/testnet/logos/tags/<file>
```

Always read the `logoURI` of a token (or the `logo` of a tag) instead of
building the URL yourself: a token may have a PNG or an SVG.

For websites, fetch the lists server-side and serve them from your own
origin rather than hot-linking `raw.githubusercontent.com` from visitors'
browsers. That keeps viewers' IP addresses away from a third party, avoids
GitHub's rate limits and lets you keep the last good copy if GitHub is
unreachable. The Pickle apps do exactly this.

### In a wallet or DEX interface

Add the testnet `tokenlist.json` raw URL as a custom token list. Every entry
has `chainId: 78270`.

### tags.json in short

```jsonc
{
  "chainId": 78270,
  "version": { "major": 1, "minor": 0, "patch": 0 },
  "categories": { "dex": { "name": "DEX", "description": "..." } },
  "tags": {
    "0xcC44Da8d4258086C3C999fb35a0a35618d7b83DC": {
      "name": "Pepper router",      // what an explorer shows instead of the address
      "category": "dex",           // a key of "categories"
      "project": "Pepper",
      "url": "https://pepper.picklechain.xyz",
      "logo": "https://raw.githubusercontent.com/PickleChain/token-list/main/testnet/logos/tags/pepper.png",
      "note": "PepperRouter: swaps and liquidity on the constant-product pools."
    }
  }
}
```

Keys are EIP-55 checksummed addresses. `url` and `logo` may be `null`;
`note` is optional.

## What is on the lists

- **Tokens** are added by review, never automatically. Tokens launched with
  the Pepper token factory or the Toolkit are not added just because they
  exist.
- **Tags** cover contracts: protocol, bridge, DEX, pools, toolkit, names,
  oracle and arcade contracts. Personal wallets (EOAs) are not tagged.

## Add a token or a tag

Open a pull request against the folder of the network the contract is on.
[CONTRIBUTING.md](CONTRIBUTING.md) has the exact steps, the criteria and the
logo rules. In short:

1. Add the entry to `<network>/tokenlist.json` or `<network>/tags.json`.
2. Add the logo under `<network>/logos/`: PNG 256x256 or SVG, 100 KB at
   most. A list may only point to logos in its own network folder.
3. Bump that file's `version` and update its `timestamp`.
4. Run `npm test` (Node 22 or later, no install needed).

Every pull request is checked by the same validator in GitHub Actions.

## Validation

`npm test` runs [`scripts/validate.mjs`](scripts/validate.mjs) and its tests.
It has no dependencies. For every network folder that holds lists it checks:

- the JSON shape of both files against the Token Lists rules and
  `schemas/tags.schema.json`;
- the network's chain ID everywhere (configured per folder in the script; a
  folder that holds lists without a configured chain ID fails, and an empty
  one is skipped);
- EIP-55 checksums on every address;
- no duplicate addresses, symbols or tag names;
- every logo URL points to a file in the same network folder that exists,
  has an allowed type (checked from the bytes, not the name), size and
  dimensions, and contains nothing active (no scripts, handlers or external
  references in SVGs);
- no logo file that nothing references, and no list or logo left at the
  repository root;
- with `--base <ref>` (CI does this on pull requests), the version bump each
  change needs: removing an entry is a major bump, adding one is minor,
  changing one is patch.

## License

Code and data: [MIT](LICENSE). Logos belong to their respective owners and
are included only to identify the tokens and projects they represent.
