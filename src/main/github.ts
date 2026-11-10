// GitHub access through the user's own `gh` CLI login. Baton never sees or stores a token.
import { spawn, type ChildProcess } from 'node:child_process'
import type { DeviceCode, GithubRepo, GithubStatus } from '../shared/types'
import { run } from './git'

export async function githubStatus(): Promise<GithubStatus> {
  try {
    await run('gh', ['--version'])
  } catch {
    return { installed: false, loggedIn: false }
  }
  try {
    const login = (await run('gh', ['api', 'user', '--jq', '.login'], { timeout: 20_000 })).trim()
    return { installed: true, loggedIn: !!login, login }
  } catch {
    return { installed: true, loggedIn: false }
  }
}

/**
 * Starts GitHub's device login. `onCode` receives the one-time code to type at
 * github.com/login/device; the promise settles when gh finishes.
 */
let loginChild: ChildProcess | null = null
let loginCancelled = false

export function cancelGithubLogin(): void {
  loginCancelled = true
  loginChild?.kill()
}

export function githubLogin(onCode: (device: DeviceCode) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    loginChild?.kill()
    loginCancelled = false
    const child = spawn(
      'gh',
      ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--skip-ssh-key'],
      { env: { ...process.env, GH_PROMPT_DISABLED: '1', BROWSER: 'echo' } }
    )
    let log = ''
    let sent = false
    const onData = (buf: Buffer): void => {
      log += buf.toString()
      const m = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/.exec(log)
      if (m && !sent) {
        sent = true
        onCode({ code: m[1], url: 'https://github.com/login/device' })
        child.stdin.write('\n')
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', () => reject(new Error('gh is not installed')))
    child.on('close', (code) => {
      if (loginChild === child) loginChild = null
      if (code === 0) resolve()
      else reject(new Error(loginCancelled ? 'CANCELLED' : log.trim() || 'Login failed'))
    })
    loginChild = child
    setTimeout(() => child.kill(), 10 * 60_000).unref()
  })
}

export async function githubRepos(): Promise<GithubRepo[]> {
  const text = await run(
    'gh',
    ['repo', 'list', '--limit', '200', '--json', 'nameWithOwner,description,isPrivate,updatedAt'],
    { timeout: 60_000 }
  )
  const repos = JSON.parse(text) as GithubRepo[]
  return repos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function githubClone(nameWithOwner: string, dest: string): Promise<void> {
  await run('gh', ['repo', 'clone', nameWithOwner, dest], { timeout: 15 * 60_000 })
}

export async function createPullRequest(
  wsPath: string,
  opts: { title: string; body: string; base: string; head: string }
): Promise<string> {
  const text = await run(
    'gh',
    ['pr', 'create', '--title', opts.title, '--body', opts.body, '--base', opts.base, '--head', opts.head],
    { cwd: wsPath, timeout: 60_000 }
  )
  const url = /https:\/\/\S+/.exec(text)
  return url ? url[0] : text.trim()
}
