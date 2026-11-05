# hestia tooling — CoreELEC box primitives

The estate's CoreELEC box (hestia, 10.0.0.246) has a canonical toolset built
on the **5-times rule** (any pattern used 5+ times → a permanent modular
entrypoint'd helper). These live in `pens/estate/products/estate-ops/`.

## hestia-ssh (`hestia-ssh.ts`)

The ONE sshpass+ssh helper. `-T` always (no "stdin is not a terminal"),
token-friendly `read` (capped), `exec`/`scp`/`pull`.

```bash
bun hestia-ssh.ts exec "cat /path"          # run a command
bun hestia-ssh.ts read /path --max 60000    # read a file (capped)
bun hestia-ssh.ts scp <local> <remote>      # copy local -> box
bun hestia-ssh.ts pull <remote> <local>     # copy box -> local
```

Import: `import { hestiaExec, hestiaRead, hestiaScp, hestiaPull } from "./hestia-ssh.ts"`.

## skin-hot-reload (`skin-hot-reload.ts`)

Watches the estate `skin.eternal` source, rsyncs the changed file to hestia,
re-renders the live Kodi home via JSON-RPC. A UX change shows on the TV
~150ms after save.

```bash
bun skin-hot-reload.ts
```

## skin-settings-gen (`skin-settings-gen.ts`)

GENERATIVE skin settings: the live `settings.xml` is generated from a schema
(additive, preserves existing values — never drops a live setting).

```bash
bun skin-settings-gen.ts
```

## hestia-shot (`hestia-shot.ts`)

Autonomous screenshot of the box framebuffer (compressed on-box with gzip,
busybox-compatible), pulled, converted to PPM/webp, optionally fed to
vision-kit for a measured verdict.

```bash
bun hestia-shot.ts --out /tmp/tv.ppm
bun hestia-shot.ts --vision "describe the Netflix autoplay"
```

## device-shot (`device-shot.ts`)

Unified capture for hestia (framebuffer), the LG TV (CDP), and the Marantz
AVR (via the box framebuffer — the AVR is the HDMI sink).

```bash
bun device-shot.ts hestia   # box
bun device-shot.ts lg       # LG TV (CDP)
bun device-shot.ts marantz  # AVR (box framebuffer)
bun device-shot.ts all      # all three
```

## Box facts

- Host `10.0.0.246`, SSH `root:coreelec` (POSIX sh, no bash).
- JSON-RPC `http://10.0.0.246:25270/jsonrpc` (port in `config/ports.env`).
- Audio: ALSA `AML-AUGESOUND`, HDMI passthrough to the Marantz.
- Skin: `skin.eternal` (the Netflix-Max Kodi skin fork).
- Update lockdown: `addons.updatemode=0`, `/storage/.update` empty,
  `update-bl301` disabled.