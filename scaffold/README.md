# <PEN_NAME>

One of the pens family (`pens/{barn,olympus,ranch,geode,estate}`). Holds a
curated collection of products. Submodule-LESS: peer products are standalone
checkouts, referenced-not-owned.

## Products

| Product | Subdir | Notes |
|---|---|---|
| <product-a> | `<product-a>/` | ... |
| <product-b> | `<product-b>/` | ... |

## Tooling

- **bin surface**: entrypoints symlinked into `~/.local/bin` (see
  `pens/barn/estate-ops/bin/manifest.yaml`), verified by `bin-verify.sh`.
- **scaffold**: `bin/make-pen.ts` instantiates a new pen from this template.
- **README generator**: `bin/readme-gen.ts` regenerates each pen's README
  from that pen's actual product set, so a README can never go stale.

## Apply

```bash
bun ./bin/make-pen.ts --pen <name> --title "<Title>" --blurb "<one line>"
```

`--force` rewrites the pen's **metadata only**. It never deletes `products/`,
`docs/`, or anything else — there is no code path in this script that removes
a pen.

## License

MIT
