import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChatItem, Repo, Settings, Workspace } from '../shared/types'
import { claudeLogin, claudeStatus, isRunning, runClaude, stopAll, stopClaude } from './claude'
import * as g from './git'
import { cancelGithubLogin, createPullRequest, githubClone, githubLogin, githubRepos, githubStatus } from './github'
import { runShots } from './shots'
import { Store } from './store'

// Apps started from Finder/Dock get a minimal PATH; borrow the login shell's so
// git, gh and claude are found wherever the user installed them.
if (process.platform !== 'win32') {
  try {
    const shellPath = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "%s" "$PATH"'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    if (shellPath) process.env.PATH = shellPath
  } catch {
    process.env.PATH = `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`
  }
}

if (process.env.BATON_USER_DATA) app.setPath('userData', process.env.BATON_USER_DATA)

const NAMES = [
  'allegro', 'adagio', 'presto', 'largo', 'vivace', 'andante', 'forte', 'legato', 'staccato',
  'crescendo', 'rondo', 'sonata', 'fugue', 'cadenza', 'encore', 'tempo', 'aria', 'coda',
  'canon', 'nocturne', 'prelude', 'scherzo', 'waltz', 'ballad'
]

let win: BrowserWindow | null = null
let store: Store

const send = (channel: string, payload: unknown): void => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}
const pushState = (): void => {
  store.save()
  send('state', store.state)
}
const pushChat = (wsId: string, item: ChatItem): void => {
  store.addChat(wsId, item)
  send('chat:item', { wsId, item })
}
const info = (wsId: string, text: string): void =>
  pushChat(wsId, { id: randomUUID(), role: 'info', text, ts: Date.now() })

function repoOf(id: string): Repo {
  const repo = store.state.repos.find((r) => r.id === id)
  if (!repo) throw new Error('Repository not found')
  return repo
}
function wsOf(id: string): Workspace {
  const ws = store.state.workspaces.find((w) => w.id === id)
  if (!ws) throw new Error('Workspace not found')
  return ws
}
const slug = (s: string): string =>
  s.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')

async function addRepo(dir: string): Promise<Repo> {
  if (!(await g.isRepo(dir))) throw new Error('NOT_A_REPO')
  const info = await g.repoInfo(dir)
  const existing = store.state.repos.find((r) => r.path === info.root)
  if (existing) return existing
  const repo: Repo = {
    id: randomUUID(),
    name: info.name,
    path: info.root,
    baseBranch: info.baseBranch,
    remote: info.remote,
    setupScript: ''
  }
  store.state.repos.push(repo)
  pushState()
  return repo
}

function runSetup(ws: Workspace, script: string): void {
  info(ws.id, `setup:start:${script}`)
  const shellCmd = process.platform === 'win32' ? 'cmd' : process.env.SHELL || '/bin/sh'
  const shellArgs = process.platform === 'win32' ? ['/c', script] : ['-lc', script]
  execFile(shellCmd, shellArgs, { cwd: ws.path, timeout: 15 * 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, _out, stderr) => {
    info(ws.id, err ? `setup:fail:${(stderr || err.message).trim().slice(-600)}` : 'setup:done')
  })
}

function openPath(target: string, how: 'finder' | 'terminal' | 'editor'): Promise<void> {
  if (how === 'finder') return shell.openPath(target).then(() => undefined)
  if (process.platform === 'darwin') {
    const appName = how === 'terminal' ? 'Terminal' : 'Visual Studio Code'
    return g.run('open', ['-a', appName, target]).then(() => undefined)
  }
  if (how === 'editor') return g.run('code', [target]).then(() => undefined)
  return g.run('cmd', ['/c', 'start', 'cmd', '/K', `cd /d ${target}`]).then(() => undefined)
}

// Every handler is callable from the renderer as window.baton.invoke(name, ...args).
export const actions: Record<string, (...args: any[]) => unknown> = {
  'state:get': () => store.state,

  'settings:update': (patch: Partial<Settings>) => {
    Object.assign(store.state.settings, patch)
    pushState()
  },

  'app:openExternal': (url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  },

  'app:pickFolder': async () => {
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  },

  // ── Claude ────────────────────────────────────────────────────────────────
  'claude:status': async () => {
    const status = await claudeStatus()
    // Keep the account address out of README screenshots.
    if (process.env.BATON_SHOTS && status.email) status.email = 'you@example.com'
    return status
  },
  'claude:login': () => claudeLogin((text) => send('claude:login-output', text)),
  'claude:busy': () => store.state.workspaces.filter((w) => isRunning(w.id)).map((w) => w.id),

  'claude:send': (wsId: string, text: string) => {
    const ws = wsOf(wsId)
    if (isRunning(wsId) || !text.trim()) return
    pushChat(wsId, { id: randomUUID(), role: 'user', text, ts: Date.now() })
    const done = runClaude(wsId, {
      cwd: ws.path,
      prompt: text,
      sessionId: ws.sessionId,
      permissionMode: store.state.settings.permissionMode,
      model: store.state.settings.model,
      onItem: (item) => pushChat(wsId, item),
      onSession: (sessionId) => {
        if (ws.sessionId !== sessionId) {
          ws.sessionId = sessionId
          store.save()
        }
      }
    }).then(() => send('busy', actions['claude:busy']()))
    send('busy', actions['claude:busy']())
    return process.env.BATON_SHOTS ? done : undefined
  },

  'claude:stop': (wsId: string) => stopClaude(wsId),
  'chat:get': (wsId: string) => store.chat(wsId),
  'chat:clear': (wsId: string) => {
    const ws = wsOf(wsId)
    store.clearChat(wsId)
    delete ws.sessionId
    pushState()
  },

  // ── GitHub ────────────────────────────────────────────────────────────────
  'github:status': () => githubStatus(),
  'github:login': () => githubLogin((device) => send('github:device', device)),
  'github:cancelLogin': () => cancelGithubLogin(),
  'github:repos': () => githubRepos(),
  'github:clone': async (nameWithOwner: string) => {
    const dest = path.join(store.state.settings.homeDir, 'repos', nameWithOwner.split('/')[1])
    if (!existsSync(dest)) await githubClone(nameWithOwner, dest)
    return addRepo(dest)
  },

  // ── Repositories ──────────────────────────────────────────────────────────
  'repo:pick': async () => {
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    return res.canceled ? null : addRepo(res.filePaths[0])
  },
  'repo:add': (dir: string) => addRepo(dir),
  'repo:branches': (id: string) => g.listBranches(repoOf(id).path),
  'repo:update': (id: string, patch: Partial<Pick<Repo, 'baseBranch' | 'setupScript' | 'name'>>) => {
    Object.assign(repoOf(id), patch)
    pushState()
  },
  'repo:remove': (id: string) => {
    if (store.state.workspaces.some((w) => w.repoId === id)) throw new Error('HAS_WORKSPACES')
    store.state.repos = store.state.repos.filter((r) => r.id !== id)
    pushState()
  },
  'repo:open': (id: string, how: 'finder' | 'terminal' | 'editor') => openPath(repoOf(id).path, how),

  // ── Workspaces ────────────────────────────────────────────────────────────
  'ws:create': async (repoId: string, opts: { name?: string; base?: string } = {}) => {
    const repo = repoOf(repoId)
    const used = new Set(store.state.workspaces.filter((w) => w.repoId === repoId).map((w) => w.name))
    const root = path.join(store.state.settings.homeDir, 'workspaces', repo.name)
    let name = slug(opts.name ?? '')
    if (!name) {
      const free = NAMES.filter((n) => !used.has(n) && !existsSync(path.join(root, n)))
      name = free.length ? free[Math.floor(Math.random() * free.length)] : `ws-${Date.now().toString(36)}`
    }
    if (used.has(name) || existsSync(path.join(root, name))) throw new Error('NAME_TAKEN')
    let branch = `${store.state.settings.branchPrefix}${name}`
    for (let i = 2; await g.branchExists(repo.path, branch); i++) {
      branch = `${store.state.settings.branchPrefix}${name}-${i}`
    }
    const ws: Workspace = {
      id: randomUUID(),
      repoId,
      name,
      branch,
      baseBranch: opts.base || repo.baseBranch,
      path: path.join(root, name),
      createdAt: Date.now()
    }
    await g.createWorktree(repo.path, ws.path, ws.branch, ws.baseBranch)
    store.state.workspaces.push(ws)
    pushState()
    if (repo.setupScript.trim()) runSetup(ws, repo.setupScript.trim())
    return ws
  },

  'ws:archive': async (id: string, deleteBranch: boolean) => {
    const ws = wsOf(id)
    const repo = repoOf(ws.repoId)
    stopClaude(id)
    if (store.state.spotlights.some((s) => s.workspaceId === id)) await actions['spotlight:off'](repo.id)
    await g.removeWorktree(repo.path, ws.path, ws.branch, deleteBranch)
    store.state.workspaces = store.state.workspaces.filter((w) => w.id !== id)
    pushState()
  },

  'ws:diff': (id: string) => {
    const ws = wsOf(id)
    return g.diffWorkspace(ws.path, ws.baseBranch)
  },

  'ws:open': (id: string, how: 'finder' | 'terminal' | 'editor') => openPath(wsOf(id).path, how),

  'ws:createPr': async (id: string, opts: { title: string; body: string }) => {
    const ws = wsOf(id)
    if (await g.hasUncommitted(ws.path)) await g.commitAll(ws.path, opts.title)
    await g.pushBranch(ws.path, ws.branch)
    ws.prUrl = await createPullRequest(ws.path, { ...opts, base: ws.baseBranch, head: ws.branch })
    pushState()
    return ws.prUrl
  },

  // ── Spotlight ─────────────────────────────────────────────────────────────
  'spotlight:on': async (wsId: string) => {
    const ws = wsOf(wsId)
    const repo = repoOf(ws.repoId)
    const current = store.state.spotlights.find((s) => s.repoId === repo.id)
    if (current) {
      current.snapshot = await g.spotlightSync(repo.path, ws.path)
      current.workspaceId = wsId
      current.syncedAt = Date.now()
    } else {
      const res = await g.spotlightOn(repo.path, ws.path)
      store.state.spotlights.push({ repoId: repo.id, workspaceId: wsId, syncedAt: Date.now(), ...res })
    }
    pushState()
  },

  'spotlight:off': async (repoId: string) => {
    const current = store.state.spotlights.find((s) => s.repoId === repoId)
    if (!current) return
    await g.spotlightOff(repoOf(repoId).path, current.originalRef)
    store.state.spotlights = store.state.spotlights.filter((s) => s.repoId !== repoId)
    pushState()
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 620,
    show: false,
    backgroundColor: '#0e1016',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => {
    if (!process.env.BATON_SHOTS) return win?.show()
    // Screenshot run: stay in the background and ignore stray clicks.
    win?.showInactive()
    win?.setIgnoreMouseEvents(true)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

void app.whenReady().then(() => {
  store = new Store(app.getPath('userData'), process.env.BATON_HOME || path.join(os.homedir(), 'Baton'))
  ipcMain.handle('baton', async (_e, name: string, ...args: unknown[]) => {
    const fn = actions[name]
    if (!fn) return { ok: false, error: `Unknown action ${name}` }
    try {
      return { ok: true, data: await fn(...args) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  createWindow()
  if (process.env.BATON_SHOTS && win) void runShots(win, actions, () => store.state)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', () => {
  stopAll()
  cancelGithubLogin()
})
