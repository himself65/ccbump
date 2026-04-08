import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import semver from 'semver'
import prompts from 'prompts'
import kleur from 'kleur'

export interface BumpOptions {
  /**
   * Version or release type to bump to.
   * If not provided, prompts interactively.
   */
  release?: string
  /** Working directory (defaults to process.cwd()) */
  cwd?: string
  /** Additional files to update version in */
  files?: string[]
  /** Whether to git commit after bumping */
  commit?: boolean
  /** Whether to git tag after bumping */
  tag?: boolean
  /** Whether to git push after bumping */
  push?: boolean
  /** Skip confirmation prompt */
  yes?: boolean
  /**
   * Custom script to execute after version files are updated, before git operations.
   * The script receives CCBUMP_VERSION (new), CCBUMP_OLD_VERSION (old), and CCBUMP_CWD as env vars.
   * Any files created/modified by the script will be included in the git commit.
   */
  execute?: string
}

const RELEASE_TYPES = ['patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease'] as const
type ReleaseType = typeof RELEASE_TYPES[number]

interface VersionFile {
  path: string
  /** JSON key path to the version field, e.g. ['version'] or ['metadata', 'version'] */
  keys: string[][]
}

function getVersionFiles(cwd: string, extraFiles: string[]): VersionFile[] {
  const files: VersionFile[] = [
    {
      path: resolve(cwd, '.claude-plugin/plugin.json'),
      keys: [['version']],
    },
    {
      path: resolve(cwd, '.claude-plugin/marketplace.json'),
      keys: [['metadata', 'version'], ['plugins', '0', 'version']],
    },
  ]

  for (const file of extraFiles) {
    files.push({
      path: resolve(cwd, file),
      keys: [['version']],
    })
  }

  return files
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function writeJson(path: string, data: any): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

function getNestedValue(obj: any, keys: string[]): any {
  let current = obj
  for (const key of keys) {
    if (current == null) return undefined
    current = current[key]
  }
  return current
}

function setNestedValue(obj: any, keys: string[], value: any): void {
  let current = obj
  for (let i = 0; i < keys.length - 1; i++) {
    current = current[keys[i]]
  }
  current[keys[keys.length - 1]] = value
}

function getCurrentVersion(cwd: string): string {
  const pluginPath = resolve(cwd, '.claude-plugin/plugin.json')
  const data = readJson(pluginPath)
  return data.version
}

function updateVersion(files: VersionFile[], newVersion: string): string[] {
  const updated: string[] = []

  for (const file of files) {
    let data: any
    try {
      data = readJson(file.path)
    } catch {
      continue
    }

    let changed = false
    for (const keys of file.keys) {
      const current = getNestedValue(data, keys)
      if (current !== undefined && current !== newVersion) {
        setNestedValue(data, keys, newVersion)
        changed = true
      }
    }

    if (changed) {
      writeJson(file.path, data)
      updated.push(file.path)
    }
  }

  return updated
}

function runCustomScript(cwd: string, script: string, newVersion: string, oldVersion: string): string[] {
  // Snapshot tracked file mtimes + untracked list before running the script
  const gitStatusBefore = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trim()

  execSync(script, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      CCBUMP_VERSION: newVersion,
      CCBUMP_OLD_VERSION: oldVersion,
      CCBUMP_CWD: cwd,
    },
  })

  // Detect files changed by the script
  const gitStatusAfter = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trim()
  const beforeFiles = new Set(gitStatusBefore.split('\n').filter(Boolean))
  const newChanges = gitStatusAfter
    .split('\n')
    .filter(Boolean)
    .filter((line) => !beforeFiles.has(line))
    .map((line) => line.slice(3).trim()) // strip status prefix like "?? " or " M "

  return newChanges
}

function gitCommitTagPush(cwd: string, version: string, files: string[], options: { commit: boolean; tag: boolean; push: boolean }): void {
  const exec = (cmd: string) => execSync(cmd, { cwd, stdio: 'inherit' })

  if (options.commit) {
    exec(`git add ${files.map(f => `"${f}"`).join(' ')}`)
    exec(`git commit -m "chore: release v${version}"`)
  }

  if (options.tag) {
    exec(`git tag v${version}`)
  }

  if (options.push) {
    exec('git push')
    if (options.tag) {
      exec(`git push origin v${version}`)
    }
  }
}

export async function bump(options: BumpOptions = {}): Promise<void> {
  const cwd = resolve(options.cwd ?? process.cwd())
  const currentVersion = getCurrentVersion(cwd)

  console.log(`\n${kleur.bold('ccbump')} — Claude Code plugin version bump\n`)
  console.log(`  Current version: ${kleur.cyan(currentVersion)}\n`)

  let newVersion: string

  if (options.release) {
    if (RELEASE_TYPES.includes(options.release as ReleaseType)) {
      const v = semver.inc(currentVersion, options.release as ReleaseType)
      if (!v) {
        console.error(kleur.red(`Failed to increment version with release type: ${options.release}`))
        process.exit(1)
      }
      newVersion = v
    } else if (semver.valid(options.release)) {
      newVersion = options.release
    } else {
      console.error(kleur.red(`Invalid version or release type: ${options.release}`))
      process.exit(1)
    }
  } else {
    // Interactive mode
    const choices = RELEASE_TYPES
      .map((type) => {
        const v = semver.inc(currentVersion, type)
        return v ? { title: `${type} (${v})`, value: v } : null
      })
      .filter(Boolean) as { title: string; value: string }[]

    choices.push({ title: 'custom', value: 'custom' })

    const { version } = await prompts({
      type: 'select',
      name: 'version',
      message: 'Select release type',
      choices,
    })

    if (!version) {
      console.log(kleur.yellow('Cancelled.'))
      process.exit(0)
    }

    if (version === 'custom') {
      const { custom } = await prompts({
        type: 'text',
        name: 'custom',
        message: 'Enter custom version',
        validate: (v: string) => semver.valid(v) ? true : 'Invalid semver version',
      })
      if (!custom) {
        console.log(kleur.yellow('Cancelled.'))
        process.exit(0)
      }
      newVersion = custom
    } else {
      newVersion = version
    }
  }

  const files = getVersionFiles(cwd, options.files ?? [])
  const filePaths = files.map((f) => f.path.replace(cwd + '/', ''))

  console.log(`\n  ${kleur.bold('Bumping version:')} ${kleur.cyan(currentVersion)} → ${kleur.green(newVersion)}`)
  console.log(`  ${kleur.bold('Files:')}`)
  for (const f of filePaths) {
    console.log(`    - ${f}`)
  }

  const doCommit = options.commit ?? true
  const doTag = options.tag ?? true
  const doPush = options.push ?? true

  if (doCommit) console.log(`  ${kleur.bold('Commit:')} yes`)
  if (doTag) console.log(`  ${kleur.bold('Tag:')} v${newVersion}`)
  if (doPush) console.log(`  ${kleur.bold('Push:')} yes`)
  if (options.execute) console.log(`  ${kleur.bold('Execute:')} ${options.execute}`)

  if (!options.yes) {
    const { confirmed } = await prompts({
      type: 'confirm',
      name: 'confirmed',
      message: 'Confirm?',
      initial: true,
    })

    if (!confirmed) {
      console.log(kleur.yellow('\nCancelled.'))
      process.exit(0)
    }
  }

  console.log()
  const updated = updateVersion(files, newVersion)
  for (const f of updated) {
    console.log(`  ${kleur.green('✓')} ${f.replace(cwd + '/', '')}`)
  }

  if (options.execute) {
    console.log(`\n  ${kleur.bold('Running script:')} ${options.execute}`)
    const scriptFiles = runCustomScript(cwd, options.execute, newVersion, currentVersion)
    for (const f of scriptFiles) {
      console.log(`  ${kleur.green('✓')} ${f} ${kleur.dim('(from script)')}`)
      updated.push(resolve(cwd, f))
    }
  }

  gitCommitTagPush(cwd, newVersion, updated, { commit: doCommit, tag: doTag, push: doPush })

  console.log(`\n${kleur.green('Done!')} Released v${newVersion}\n`)
}
