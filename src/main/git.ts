// Git operations. This file must not import Electron so it can be unit-tested.
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { DiffFile } from '../shared/types'

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  input?: string
  timeout?: number
}

export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        maxBuffer: 64 * 1024 * 1024,
        timeout: opts.timeout ?? 120_000
      },
      (err, stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code
          if (code === 'ENOENT') return reject(new Error(`${cmd} is not installed`))
          return reject(new Error((stderr || stdout || err.message).trim()))
        }
        resolve(stdout)
      }
    )
    if (opts.input !== undefined) child.stdin?.end(opts.input)
  })
}

export const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> =>
  run('git', args, { cwd, env })

const out = async (p: Promise<string>): Promise<string> => (await p).trim()

export async function isRepo(dir: string): Promise<boolean> {
  try {
    return (await out(git(dir, ['rev-parse', '--is-inside-work-tree']))) === 'true'
  } catch {
    return false
  }
}

export async function repoInfo(
  dir: string
): Promise<{ root: string; name: string; baseBranch: string; remote: string }> {
  const root = await out(git(dir, ['rev-parse', '--show-toplevel']))
  let remote = ''
  try {
    remote = await out(git(root, ['remote', 'get-url', 'origin']))
  } catch {
    /* no remote */
  }
  let baseBranch = ''
  try {
    const head = await out(git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']))
    baseBranch = head.replace(/^origin\//, '')
  } catch {
    baseBranch = (await out(git(root, ['branch', '--show-current']))) || 'main'
  }
  return { root, name: path.basename(root), baseBranch, remote }
}

export async function listBranches(repoPath: string): Promise<string[]> {
  const text = await git(repoPath, ['branch', '--format=%(refname:short)'])
  return text.split('\n').map((s) => s.trim()).filter(Boolean)
}

export async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  try {
    await git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
    return true
  } catch {
    return false
  }
}

export async function createWorktree(
  repoPath: string,
  wsPath: string,
  branch: string,
  base: string
): Promise<void> {
  await mkdir(path.dirname(wsPath), { recursive: true })
  await git(repoPath, ['worktree', 'add', '-b', branch, wsPath, base])
}

export async function removeWorktree(
  repoPath: string,
  wsPath: string,
  branch: string,
  deleteBranch: boolean
): Promise<void> {
  try {
    await git(repoPath, ['worktree', 'remove', '--force', wsPath])
  } catch {
    // The folder may already be gone; drop the stale registration instead.
    await rm(wsPath, { recursive: true, force: true })
    await git(repoPath, ['worktree', 'prune'])
  }
  if (deleteBranch) {
    try {
      await git(repoPath, ['branch', '-D', branch])
    } catch {
      /* branch already gone */
    }
  }
}

/** Runs `fn` with a throwaway index that holds the full working tree (untracked files included). */
async function withFullIndex<T>(
  wsPath: string,
  fn: (env: NodeJS.ProcessEnv) => Promise<T>
): Promise<T> {
  const index = path.join(os.tmpdir(), `baton-index-${randomUUID()}`)
  const env = { GIT_INDEX_FILE: index }
  try {
    await git(wsPath, ['read-tree', 'HEAD'], env)
    await git(wsPath, ['add', '-A'], env)
    return await fn(env)
  } finally {
    await rm(index, { force: true })
    await rm(`${index}.lock`, { force: true })
  }
}

async function mergeBase(wsPath: string, base: string): Promise<string> {
  try {
    return await out(git(wsPath, ['merge-base', 'HEAD', base]))
  } catch {
    return 'HEAD'
  }
}

/** Everything the workspace changed relative to where it branched off, committed or not. */
export async function diffWorkspace(wsPath: string, base: string): Promise<DiffFile[]> {
  const from = await mergeBase(wsPath, base)
  const [numstat, patch] = await withFullIndex(wsPath, (env) =>
    Promise.all([
      git(wsPath, ['diff', '--cached', '--numstat', from], env),
      git(wsPath, ['diff', '--cached', '--no-color', '--no-ext-diff', from], env)
    ])
  )
  const patches = new Map<string, string>()
  for (const chunk of patch.split(/^(?=diff --git )/m)) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk)
    if (m) patches.set(m[2], chunk)
  }
  return numstat
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [a, r, ...rest] = line.split('\t')
      const file = rest.join('\t')
      return {
        path: file,
        added: a === '-' ? 0 : Number(a),
        removed: r === '-' ? 0 : Number(r),
        patch: patches.get(file) ?? ''
      }
    })
}

export async function hasUncommitted(dir: string, includeUntracked = true): Promise<boolean> {
  const args = ['status', '--porcelain']
  if (!includeUntracked) args.push('--untracked-files=no')
  return (await out(git(dir, args))) !== ''
}

export async function commitAll(wsPath: string, message: string): Promise<void> {
  await git(wsPath, ['add', '-A'])
  await git(wsPath, ['commit', '-m', message])
}

/**
 * Stores the workspace's current files (untracked included) as a commit that
 * is not on any branch, and returns its hash. The workspace is left untouched.
 */
export async function snapshot(wsPath: string): Promise<string> {
  return withFullIndex(wsPath, async (env) => {
    const tree = await out(git(wsPath, ['write-tree'], env))
    return out(
      git(wsPath, [
        '-c', 'user.name=Baton',
        '-c', 'user.email=baton@localhost',
        'commit-tree', tree, '-p', 'HEAD', '-m', 'Baton spotlight snapshot'
      ])
    )
  })
}

export class DirtyRootError extends Error {
  constructor() {
    super('DIRTY_ROOT')
    this.name = 'DirtyRootError'
  }
}

async function currentRef(repoPath: string): Promise<string> {
  try {
    return await out(git(repoPath, ['symbolic-ref', '--short', '-q', 'HEAD']))
  } catch {
    return out(git(repoPath, ['rev-parse', 'HEAD']))
  }
}

/**
 * Spotlight: make the repo root show the workspace's files so they can be
 * tested with whatever is already set up there (dev server, node_modules, .env).
 * The root is switched to a detached snapshot commit; no branch is moved.
 */
export async function spotlightOn(
  repoPath: string,
  wsPath: string
): Promise<{ originalRef: string; snapshot: string }> {
  if (await hasUncommitted(repoPath, false)) throw new DirtyRootError()
  const originalRef = await currentRef(repoPath)
  const snap = await snapshot(wsPath)
  await git(repoPath, ['checkout', '--detach', snap])
  return { originalRef, snapshot: snap }
}

/** Refresh the repo root with the workspace's latest files. */
export async function spotlightSync(repoPath: string, wsPath: string): Promise<string> {
  if (await hasUncommitted(repoPath, false)) throw new DirtyRootError()
  const snap = await snapshot(wsPath)
  await git(repoPath, ['checkout', '--detach', snap])
  return snap
}

/** Put the repo root back on the branch it was on before Spotlight. */
export async function spotlightOff(repoPath: string, originalRef: string): Promise<void> {
  if (await hasUncommitted(repoPath, false)) throw new DirtyRootError()
  await git(repoPath, ['checkout', originalRef])
}

export async function pushBranch(wsPath: string, branch: string): Promise<void> {
  await git(wsPath, ['push', '-u', 'origin', branch])
}
