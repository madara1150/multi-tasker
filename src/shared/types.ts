export type Language = 'th' | 'en'
export type PermissionMode = 'acceptEdits' | 'bypassPermissions' | 'plan'

export interface Settings {
  /** Theme preset id, or "system" to follow the OS light/dark setting. */
  theme: string
  /** Accent colour as #rrggbb. */
  accent: string
  /** Base UI font size in px. */
  fontSize: number
  language: Language
  permissionMode: PermissionMode
  /** Claude model alias ("" = Claude Code default). */
  model: string
  /** Prefix for branches created for new workspaces. */
  branchPrefix: string
  /** Folder that holds cloned repos and workspace worktrees. */
  homeDir: string
}

export interface Repo {
  id: string
  name: string
  path: string
  /** Branch new workspaces start from. */
  baseBranch: string
  remote: string
  /** Shell command run once in every new workspace (e.g. "npm install"). */
  setupScript: string
}

export interface Workspace {
  id: string
  repoId: string
  name: string
  branch: string
  baseBranch: string
  path: string
  createdAt: number
  /** Claude Code session id, so the conversation can be resumed. */
  sessionId?: string
  prUrl?: string
}

/** A repo whose root folder currently mirrors one workspace. */
export interface Spotlight {
  repoId: string
  workspaceId: string
  /** Branch (or commit) the repo root was on before Spotlight was turned on. */
  originalRef: string
  snapshot: string
  syncedAt: number
}

export interface AppState {
  settings: Settings
  repos: Repo[]
  workspaces: Workspace[]
  spotlights: Spotlight[]
}

export type ChatRole = 'user' | 'assistant' | 'tool' | 'result' | 'error' | 'info'

export interface ChatItem {
  id: string
  role: ChatRole
  text: string
  /** Tool name for role "tool". */
  tool?: string
  ts: number
  durationMs?: number
  costUsd?: number
}

export interface ClaudeStatus {
  installed: boolean
  loggedIn: boolean
  version?: string
  email?: string
  plan?: string
}

export interface GithubStatus {
  installed: boolean
  loggedIn: boolean
  login?: string
}

export interface GithubRepo {
  nameWithOwner: string
  description: string
  isPrivate: boolean
  updatedAt: string
}

export interface DiffFile {
  path: string
  added: number
  removed: number
  /** Unified diff text for this file. */
  patch: string
}

export interface DeviceCode {
  code: string
  url: string
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'midnight',
  accent: '#7c8cff',
  fontSize: 14,
  language: 'th',
  permissionMode: 'acceptEdits',
  model: '',
  branchPrefix: 'baton/',
  homeDir: ''
}
