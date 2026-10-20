/**
 * The plugin's single platform-adaptation module (design §5.9): every platform
 * difference lives here and the other modules stay platform-neutral, so injecting
 * a platform makes the Windows rules testable off Windows. A batch target
 * (`thincoder.cmd`) needs the interpreter — an executable path cannot start a
 * batch file — and `call` keeps `cmd /s` from stripping a quoted path's quotes.
 *
 * @module dsh-subagent-thincoder/platform
 */

import { realpathSync } from 'node:fs'

import { launchError } from './errors.mjs'

/** Extensions whose targets must be started through the command interpreter. */
const BATCH_EXTENSIONS = ['.cmd', '.bat']

/**
 * Characters the command interpreter interprets itself (`%` `&` `|` `<` `>` `^`):
 * a configured `args` entry carrying one is refused before any process exists.
 */
const CMD_METACHARACTERS = ['%', '&', '|', '<', '>', '^']

/** The one place this plugin reads the host platform. */
export function currentPlatform() {
  return process.platform
}

/** The workspace path inside a continuation key (P10): Windows folds case so two
 * variants of one workspace make one key; POSIX keeps the path verbatim. */
export function keyPath(path, platform) {
  const value = String(path)
  return platform === 'win32' ? value.toLowerCase() : value
}

/** The workspace's real path on disk (P10): symlink aliases and the filesystem's
 * own case form collapse here; any failure — missing, unreadable — falls back
 * to the given path, so this never throws. */
export function canonicalPath(path) {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

/** Whether a resolved command is a batch target (so it needs the interpreter). */
export function isBatchTarget(path) {
  const lower = String(path).toLowerCase()
  return BATCH_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

/** Read one environment key the way the dsh subprocess seam reads it (P9): the
 * exact key first; absent, and only on Windows, a case-insensitive scan. */
function environmentValue(env, name, platform) {
  if (env === null || typeof env !== 'object') return undefined
  const exact = env[name]
  if (exact !== undefined || platform !== 'win32') return exact
  const wanted = name.toUpperCase()
  return Object.entries(env).find(([key]) => key.toUpperCase() === wanted)?.[1]
}

/** Resolve the interpreter through the SAME public face as the command:
 * configured `ComSpec` → host `ComSpec` → `'cmd.exe'`, a miss yielding to the
 * next source. Both `ComSpec` reads follow the platform's own case rules (P9). */
async function resolveInterpreter(subprocess, env, platform) {
  const nonEmpty = (value) => (typeof value === 'string' && value !== '' ? value : undefined)
  const configured = nonEmpty(environmentValue(env, 'ComSpec', platform))
  const host = nonEmpty(environmentValue(process.env, 'ComSpec', platform))
  for (const candidate of [configured, host, 'cmd.exe']) {
    if (candidate === undefined) continue
    try {
      const resolved = await subprocess.resolveExecutable(candidate, env)
      if (typeof resolved === 'string' && resolved !== '') return resolved
    } catch {
      // An unresolvable source yields to the next one in the pinned order.
    }
  }
  return undefined
}

/**
 * Resolve the final argv a child is started with (design §5.9 rules 1–4). POSIX
 * gets the command and args verbatim; on Windows the command resolves to an
 * absolute path, a batch target wraps as `[interpreter, '/d', '/s', '/c', 'call',
 * target, ...args]`, and any other target starts directly. A metacharacter in
 * `args`, a name that will not resolve, or a target the seam does not give back
 * as a non-empty string, throws before any process exists; `platform` defaults
 * to the host platform.
 *
 * @returns The final argv to start the child with.
 */
export async function resolveLaunchArgv({ subprocess, command, args, env, platform = currentPlatform() }) {
  const argv = Array.isArray(args) ? args : []
  if (platform !== 'win32') return [command, ...argv]

  // A pure string judgement, made BEFORE the command is resolved: a refused
  // launch must not even probe the filesystem.
  const hit = CMD_METACHARACTERS.find((character) => argv.some(
    (arg) => typeof arg === 'string' && arg.includes(character),
  ))
  if (hit !== undefined) {
    throw launchError(command, `a configured args entry contains ${JSON.stringify(hit)}, which the command interpreter interprets itself`)
  }

  let target
  try {
    target = await subprocess.resolveExecutable(command, env)
  } catch (error) {
    throw launchError(command, error instanceof Error ? error.message : String(error))
  }
  // A resolved target that is not a non-empty string is unusable: refuse it here,
  // before the extension branch, with the same judgement the interpreter face uses.
  if (typeof target !== 'string' || target === '') {
    throw launchError(command, 'the resolver returned no usable path for the command')
  }
  if (!isBatchTarget(target)) return [target, ...argv]

  const interpreter = await resolveInterpreter(subprocess, env, platform)
  if (interpreter === undefined) {
    throw launchError(command, "no command interpreter could be resolved (tried the configured ComSpec, the host's ComSpec, and 'cmd.exe')")
  }
  return [interpreter, '/d', '/s', '/c', 'call', target, ...argv]
}

/** The launch-face single source (B4): a face's behaviour leaves (`command` /
 * `args` / `env`) resolved to the final argv — the only caller of
 * `resolveLaunchArgv`. A face's plumbing fields (`ctx`, `cwd`) are not read. */
export async function resolveChildArgv(subprocess, spec) {
  return resolveLaunchArgv({ subprocess, command: spec.command, args: spec.args, env: spec.env })
}
