// JSON-file persistence. No Electron imports so it can be unit-tested.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS, type AppState, type ChatItem } from '../shared/types'

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, file)
}

export class Store {
  state: AppState
  private chats = new Map<string, ChatItem[]>()
  private file: string

  constructor(
    private dir: string,
    defaultHome: string
  ) {
    this.file = path.join(dir, 'state.json')
    const saved = readJson<Partial<AppState>>(this.file, {})
    this.state = {
      settings: { ...DEFAULT_SETTINGS, homeDir: defaultHome, ...saved.settings },
      repos: saved.repos ?? [],
      workspaces: saved.workspaces ?? [],
      spotlights: saved.spotlights ?? []
    }
    if (!this.state.settings.homeDir) this.state.settings.homeDir = defaultHome
  }

  save(): void {
    writeJson(this.file, this.state)
  }

  private chatFile(wsId: string): string {
    return path.join(this.dir, 'chats', `${wsId}.json`)
  }

  chat(wsId: string): ChatItem[] {
    let items = this.chats.get(wsId)
    if (!items) {
      items = readJson<ChatItem[]>(this.chatFile(wsId), [])
      this.chats.set(wsId, items)
    }
    return items
  }

  addChat(wsId: string, item: ChatItem): void {
    this.chat(wsId).push(item)
    writeJson(this.chatFile(wsId), this.chat(wsId))
  }

  clearChat(wsId: string): void {
    this.chats.set(wsId, [])
    if (existsSync(this.chatFile(wsId))) writeJson(this.chatFile(wsId), [])
  }
}
