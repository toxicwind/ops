# AGENTS.md — <PEN_NAME> (pens/<PEN_NAME>)

> **Part of the estate's pens family.** A pens repo is a **thin coordinator**,
> not a product monorepo. It owns only its own metadata + `bin/` symlink
> surface. Products are peer standalone checkouts, referenced not owned.

## This repo is submoduleless by design

There are **no submodules** here. The repo's `.gitignore` is the kitchen-sink:

```
*
!.gitignore
!README.md
!LICENSE
!package.json
!mise.toml
!AGENTS.md
!bin/
!bin/**
!docs/
!docs/**
```

Any product checkout dropped into `products/` is **auto-ignored**. **No
`git submodule add`, no gitlinks** (mode 160000), no nested `.git` pollution
in the index.

## Rules

1. Never `git submodule add`; never commit a gitlink.
2. A product is a peer clone: `git clone <url> products/<name>`.
3. The pen repo's `git status` stays clean regardless of product work.
4. `bin/` entries are symlinked into `~/.local/bin` and pinned by the
   estate-ops manifest; `bin-verify.sh` treats a broken link as FAIL.
5. Runtime language is **Bun/TypeScript**.
6. Secrets live in the secretsmith keyring — never in this repo.
