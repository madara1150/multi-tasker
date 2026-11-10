// Talks to Claude through the Claude Code CLI installed on this computer,
// using whatever account the user signed in with there. No Electron imports.
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { ChatItem, ClaudeStatus, PermissionMode } from '../shared/types'
import { run } from './git'

export async function claudeStatus(): Promise<ClaudeStatus> {
  let version: string
  try {
    version = (await run('claude', ['--version'], { timeout: 20_000 })).trim().split(' ')[0]
  } catch {
    return { installed: false, loggedIn: false }
  }
  try {
    const info = JSON.parse(await run('claude', ['auth', 'status', '--json'], { timeout: 20_000 }))
    return {
      installed: true,
      loggedIn: !!info.loggedIn,
      version,
      email: info.email,
      plan: info.subscriptionType ?? info.authMethod
    }
  } catch {
    return { installed: true, loggedIn: false, version }
  }
}

/** Runs `claude auth login`, which opens the browser; resolves when sign-in finishes. */
export function claudeLogin(onOutput: (text: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['auth', 'login'], { env: process.env })
    let log = ''
    const onData = (buf: Buffer): void => {
      log += buf.toString()
      onOutput(buf.toString())
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', () => reject(new Error('claude is not installed')))
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(log.trim() || 'Login failed'))))
    setTimeout(() => child.kill(), 10 * 60_000).unref()
  })
}

const item = (role: ChatItem['role'], text: string, extra: Partial<ChatItem> = {}): ChatItem => ({
  id: randomUUID(),
  role,
  text,
  ts: Date.now(),
  ...extra
})

function toolDetail(input: Record<string, unknown> | undefined): string {
  if (!input) return ''
  for (const key of ['file_path', 'command', 'pattern', 'path', 'url', 'query', 'description']) {
    const v = input[key]
    if (typeof v === 'string' && v) return v
  }
  return ''
}

/** Turns one line of `claude --output-format stream-json` into chat items. */
export function parseStreamLine(line: string): { items: ChatItem[]; sessionId?: string } {
  let ev: Record<string, any>
  try {
    ev = JSON.parse(line)
  } catch {
    return { items: [] }
  }
  const sessionId = typeof ev.session_id === 'string' ? ev.session_id : undefined
  const items: ChatItem[] = []
  if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
    for (const block of ev.message.content) {
      if (block.type === 'text' && block.text?.trim()) items.push(item('assistant', block.text))
      if (block.type === 'tool_use') {
        items.push(item('tool', toolDetail(block.input), { tool: String(block.name) }))
      }
    }
  } else if (ev.type === 'result' || 'total_cost_usd' in ev) {
    const failed = ev.is_error === true || (ev.subtype && ev.subtype !== 'success')
    if (failed) items.push(item('error', String(ev.result ?? ev.subtype ?? 'Claude stopped with an error')))
    items.push(item('result', '', { durationMs: ev.duration_ms, costUsd: ev.total_cost_usd }))
  }
  return { items, sessionId }
}

export interface ClaudeRun {
  cwd: string
  prompt: string
  sessionId?: string
  permissionMode: PermissionMode
  model: string
  onItem: (item: ChatItem) => void
  onSession: (sessionId: string) => void
}

const running = new Map<string, ChildProcess>()

export const isRunning = (key: string): boolean => running.has(key)

const stopped = new Set<string>()

export function stopClaude(key: string): void {
  const child = running.get(key)
  if (!child) return
  stopped.add(key)
  child.kill('SIGINT')
}

export function stopAll(): void {
  for (const child of running.values()) child.kill()
}

/** Sends one prompt to Claude in `cwd` and streams the reply. Resolves when the turn ends. */
export function runClaude(key: string, opts: ClaudeRun): Promise<void> {
  return new Promise((resolve) => {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', opts.permissionMode]
    if (opts.model) args.push('--model', opts.model)
    if (opts.sessionId) args.push('--resume', opts.sessionId)

    const child = spawn('claude', args, { cwd: opts.cwd, env: process.env })
    running.set(key, child)
    let buffer = ''
    let stderr = ''
    let gotResult = false

    const handle = (line: string): void => {
      if (!line.trim()) return
      const parsed = parseStreamLine(line)
      if (parsed.sessionId) opts.onSession(parsed.sessionId)
      for (const it of parsed.items) {
        if (it.role === 'result') gotResult = true
        opts.onItem(it)
      }
    }

    child.stdout.on('data', (buf: Buffer) => {
      buffer += buf.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      lines.forEach(handle)
    })
    child.stderr.on('data', (buf: Buffer) => (stderr += buf.toString()))
    child.on('error', () => {
      running.delete(key)
      opts.onItem(item('error', 'Claude Code is not installed'))
      resolve()
    })
    child.on('close', (code) => {
      handle(buffer)
      running.delete(key)
      if (stopped.delete(key)) opts.onItem(item('info', 'stopped'))
      else if (!gotResult) opts.onItem(item('error', stderr.trim() || `Claude exited with code ${code}`))
      resolve()
    })
    child.stdin.end(opts.prompt)
  })
}
