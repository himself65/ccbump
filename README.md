# ccbump

Version bump tool for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugins. Inspired by [bumpp](https://github.com/antfu-collective/bumpp).

Bumps the `version` field in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, then optionally commits, tags, and pushes.

## Install

```bash
npm i -D ccbump
```

## Usage

```bash
# Interactive — pick patch/minor/major/etc.
npx ccbump

# Non-interactive
npx ccbump patch
npx ccbump minor --yes
npx ccbump 2.0.0

# Skip git operations
npx ccbump patch --no-commit --no-tag --no-push
```

## Options

| Flag | Description |
|------|-------------|
| `--cwd <dir>` | Working directory (default: cwd) |
| `--files <files>` | Additional files to update (comma-separated) |
| `--no-commit` | Skip git commit |
| `--no-tag` | Skip git tag |
| `--no-push` | Skip git push |
| `-y, --yes` | Skip confirmation prompt |

## Programmatic API

```ts
import { bump } from 'ccbump'

await bump({
  release: 'patch',
  yes: true,
  push: false,
})
```

## License

MIT
