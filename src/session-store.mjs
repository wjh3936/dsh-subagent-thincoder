/**
 * The durable session-link store: "which thincoder session slot belongs to
 * this dsh session + workspace".
 *
 * This is the mechanism that makes the delegation CONTINUABLE across
 * delegates: a delegation that establishes a session records its id here, and
 * the next delegation under the same dsh session and workspace resumes that
 * slot instead of opening a new one. The record is therefore a pointer, not a
 * cache — an unreadable record must fail loud rather than silently start over,
 * which is why the record schema is part of the domain declaration and not an
 * informal convention.
 *
 * Domain naming is constrained: `UNIT_NAME_RE` is `/^[a-z][a-z0-9_]*$/`
 * (`@deepseek-ai/dsh-storage/lib/index.js:80`), so the name is
 * `subagent_thincoder` with an underscore — a hyphenated name fails at
 * declaration time. The name must also NOT be `thincoder`: a domain name may
 * only be opened once per facility, and the separate `dsh-thincoder` plugin
 * already holds `thincoder` open for as long as the process lives.
 *
 * Version discipline: the `single` layout stores the whole unit as one
 * document and its `parse` rejects ANY version difference. Adding a table
 * later must therefore NOT bump `version` — a version-1 document that lacks
 * the new table loads with it empty, which is the compatibility being relied
 * on here.
 *
 * @module dsh-subagent-thincoder/session-store
 */

import { resolve } from 'node:path'

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

import { canonicalPath, currentPlatform, keyPath } from './platform.mjs'

/** The store's domain name (underscore, not hyphen — see the module docstring). */
export const DOMAIN_NAME = 'subagent_thincoder'

/** The single table name inside the store's domain. */
export const SESSION_LINKS = 'session_links'

/**
 * One session link: the dsh session + workspace it belongs to, the thincoder
 * session it points at, and when it was last written.
 *
 * `updatedAt` is declared an integer because a fractional value would be
 * rejected by this same schema when the unit is reopened, which fails the
 * whole `single`-layout document — one bad write must not cost every other
 * link its readability.
 */
export const linkRecord = z.object({
  parentSessionId: z.string().min(1),
  cwd: z.string().min(1),
  sessionId: z.string().min(1),
  updatedAt: z.number().int().min(0),
})

/** The store's domain declaration: identity, version, layout, and its one table. */
export const domain = defineDomain({
  name: DOMAIN_NAME,
  version: 1,
  layout: 'single',
  tables: {
    [SESSION_LINKS]: domainTable(linkRecord),
  },
})

/**
 * The durable key for one session link.
 *
 * The key carries BOTH dimensions of the link, because either one alone
 * collides: two dsh sessions delegating in one workspace must not share a
 * slot, and one dsh session delegating into two workspaces must not either.
 * The NUL separator is this repository's established key separator (a NUL
 * cannot appear in a session id or a path).
 *
 * The workspace is canonicalised to its real path on disk, so `./w`, `w`, a
 * symlink alias, and the two case forms a case-insensitive filesystem gives
 * one directory all collapse into one key — one workspace must not accumulate
 * links and lose the continuity this store exists to provide. A path that
 * cannot be read keeps its resolved form (the default `canonicalPath` falls
 * back; a throwing `canonicalize` is caught here too, so key construction
 * never throws). Windows `platform` also folds case; normalisation reaches the
 * KEY only, never the `cwd` recorded or handed to the child (P10).
 *
 * @param parentSessionId - The delegating dsh session's id (non-empty).
 * @param cwd - The workspace the child runs in (non-empty).
 * @param platform - The platform whose case fold applies (Windows; P10).
 * @param canonicalize - The path normaliser; defaults to the filesystem's.
 * @returns The canonical durable key.
 */
export function linkKey(parentSessionId, cwd, platform = currentPlatform(), canonicalize = canonicalPath) {
  if (typeof parentSessionId !== 'string' || parentSessionId.length === 0) {
    throw new Error('dsh-subagent-thincoder: a session link needs a non-empty parent session id')
  }
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new Error('dsh-subagent-thincoder: a session link needs a non-empty workspace path')
  }
  const resolved = resolve(cwd)
  let normalized = resolved
  try { normalized = canonicalize(resolved) } catch { /* unreadable path: keep `resolved` */ }
  return `${parentSessionId}\u0000${keyPath(normalized, platform)}`
}

/**
 * Open the session-link domain and expose the operations one delegation needs.
 *
 * The caller owns the returned handle's lifetime and closes it from its own
 * effect disposer; the caller may also hand the same store to several
 * delegations, which is why the reads are synchronous (from memory) and the
 * writes ride the domain's own write chain.
 *
 * There is deliberately no lock: two concurrent delegations in one workspace
 * each read and write their own link, and a conflict converges by
 * last-write-wins on the domain's chain. A plugin-owned lock would serialise
 * delegations that thincoder itself allows to overlap.
 *
 * @param ctx - Plugin context carrying `ctx.storageDomain`.
 * @returns The store handle: `remember` / `lookup` / `close`.
 */
export async function openSessionStore(ctx) {
  const opened = await ctx.storageDomain.open(domain)
  const table = opened.table(SESSION_LINKS)
  let disposal

  return {
    /**
     * Write one link durably.
     *
     * The record is validated here before it is queued: the domain's schema is
     * enforced when the unit is READ, so writing a malformed record would not
     * fail this call — it would fail every later open of the whole document.
     *
     * @param key - The key from {@link linkKey}.
     * @param record - The full record; no partial merge.
     * @returns Resolution after durability and event emission.
     */
    remember(key, record) {
      return table.put(key, linkRecord.parse(record))
    },

    /**
     * Read one link, synchronously from memory.
     * @param key - The key from {@link linkKey}.
     * @returns The stored record, or `undefined` when this link has none.
     */
    lookup(key) {
      return table.get(key)
    },

    /**
     * Release the domain. Idempotent — repeated calls share one teardown.
     * @returns Resolution after the domain is closed.
     */
    close() {
      disposal ??= opened.close()
      return disposal
    },
  }
}
