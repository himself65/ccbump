#!/usr/bin/env node
import cac from 'cac'
import { bump } from './index.js'

const cli = cac('ccbump')

cli
  .command('[release]', 'Bump .claude-plugin version')
  .option('--cwd <dir>', 'Working directory')
  .option('--files <files>', 'Additional files to update (comma-separated)')
  .option('--no-commit', 'Skip git commit')
  .option('--no-tag', 'Skip git tag')
  .option('--no-push', 'Skip git push')
  .option('-y, --yes', 'Skip confirmation')
  .action(async (release: string | undefined, options: any) => {
    await bump({
      release,
      cwd: options.cwd,
      files: options.files?.split(',').map((f: string) => f.trim()),
      commit: options.commit,
      tag: options.tag,
      push: options.push,
      yes: options.yes,
    })
  })

cli.help()
cli.version('0.1.0')

cli.parse()
