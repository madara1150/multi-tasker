import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { AppState, ClaudeStatus, DeviceCode, GithubStatus, Repo, Workspace } from '../../shared/types'
import { call, isMac, on } from './api'
import { errorText, makeT, TContext, useT, type T } from './i18n'
import { Icon, Logo } from './icons'
import { AddRepoModal, ArchiveModal, CreatePrModal, GithubCodeModal, NewWorkspaceModal, SettingsModal } from './Modals'
import { Palette } from './Palette'
import { applyTheme } from './themes'
import { WorkspaceView } from './Workspace'

export type Modal =
  | { type: 'settings'; tab?: string }
  | { type: 'addRepo' }
  | { type: 'newWorkspace'; repoId: string }
  | { type: 'createPr'; wsId: string }
  | { type: 'archive'; wsId: string }
  | null

interface Ctx {
  state: AppState
  claude: ClaudeStatus | null
  github: GithubStatus | null
  selected: Workspace | null
  busy: string[]
  select: (wsId: string | null) => void
  setModal: (m: Modal) => void
  toast: (text: string, kind?: 'ok' | 'error') => void
  /** Runs an action and shows its error as a toast. Returns undefined on failure. */
  run: <R>(fn: () => Promise<R>) => Promise<R | undefined>
  refreshStatus: () => void
  connectGithub: () => void
  connectClaude: () => void
  toggleSpotlight: (ws: Workspace) => void
}

const AppCtx = createContext<Ctx>(null as unknown as Ctx)
export const useApp = (): Ctx => useContext(AppCtx)

export function App(): ReactElement | null {
  const [state, setState] = useState<AppState | null>(null)
  const [claude, setClaude] = useState<ClaudeStatus | null>(null)
  const [github, setGithub] = useState<GithubStatus | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(() => localStorage.getItem('selected'))
  const [busy, setBusy] = useState<string[]>([])
  const [modal, setModal] = useState<Modal>(null)
  const [palette, setPalette] = useState(false)
  const [toastMsg, setToastMsg] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null)
  const [device, setDevice] = useState<DeviceCode | null>(null)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)

  const t: T = useMemo(() => makeT(state?.settings.language ?? 'en'), [state?.settings.language])

  const refreshStatus = useCallback(() => {
    void call<ClaudeStatus>('claude:status').then(setClaude)
    void call<GithubStatus>('github:status').then(setGithub)
  }, [])

  useEffect(() => {
    void call<AppState>('state:get').then(setState)
    void call<string[]>('claude:busy').then(setBusy)
    refreshStatus()
    const offs = [on('state', setState), on('busy', setBusy), on('github:device', setDevice)]
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onMq = (): void => setSystemDark(mq.matches)
    mq.addEventListener('change', onMq)
    return () => {
      offs.forEach((off) => off())
      mq.removeEventListener('change', onMq)
    }
  }, [refreshStatus])

  useEffect(() => {
    if (state) applyTheme(state.settings, systemDark)
  }, [state, systemDark])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      } else if (mod && e.key === ',') {
        e.preventDefault()
        setModal({ type: 'settings' })
      } else if (e.key === 'Escape') {
        setPalette(false)
        setModal(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toast = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    setToastMsg({ text, kind })
    setTimeout(() => setToastMsg((cur) => (cur?.text === text ? null : cur)), kind === 'error' ? 7000 : 3500)
  }, [])

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
    if (id) localStorage.setItem('selected', id)
    else localStorage.removeItem('selected')
  }, [])

  // Hook used by tools/screenshots.mjs to drive the real UI.
  useEffect(() => {
    ;(window as any).__baton = { select, setModal, setPalette }
  }, [select])

  if (!state) return null

  const run = async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    try {
      return await fn()
    } catch (err) {
      toast(errorText(t, err), 'error')
      return undefined
    }
  }

  const connectGithub = (): void => {
    void (async () => {
      try {
        await call('github:login')
        toast(`GitHub: ${t('connected')}`)
      } catch (err) {
        if (!(err instanceof Error && err.message === 'CANCELLED')) toast(errorText(t, err), 'error')
      }
    })().finally(() => {
      setDevice(null)
      refreshStatus()
    })
  }

  const connectClaude = (): void => {
    toast(t('claudeLoginBody'))
    void run(() => call('claude:login')).finally(refreshStatus)
  }

  const toggleSpotlight = (ws: Workspace): void => {
    const current = state.spotlights.find((s) => s.repoId === ws.repoId)
    void run(async () => {
      if (current?.workspaceId === ws.id) {
        await call('spotlight:off', ws.repoId)
        toast(t('spotlightOffToast', { ref: current.originalRef }))
      } else {
        await call('spotlight:on', ws.id)
        toast(t('spotlightOnToast'))
      }
    })
  }

  const selected = state.workspaces.find((w) => w.id === selectedId) ?? null
  const ctx: Ctx = {
    state, claude, github, selected, busy, select, setModal, toast, run,
    refreshStatus, connectGithub, connectClaude, toggleSpotlight
  }

  return (
    <TContext.Provider value={t}>
      <AppCtx.Provider value={ctx}>
        <div className={`app ${isMac ? 'mac' : ''}`}>
          <Sidebar onPalette={() => setPalette(true)} />
          <main className="main">{selected ? <WorkspaceView key={selected.id} ws={selected} /> : <Welcome />}</main>
        </div>
        {modal?.type === 'settings' && <SettingsModal tab={modal.tab} />}
        {modal?.type === 'addRepo' && <AddRepoModal />}
        {modal?.type === 'newWorkspace' && <NewWorkspaceModal repoId={modal.repoId} />}
        {modal?.type === 'createPr' && <CreatePrModal wsId={modal.wsId} />}
        {modal?.type === 'archive' && <ArchiveModal wsId={modal.wsId} />}
        {device && <GithubCodeModal device={device} />}
        {palette && <Palette onClose={() => setPalette(false)} />}
        {toastMsg && (
          <div className={`toast ${toastMsg.kind}`} role="status">
            {toastMsg.text}
          </div>
        )}
      </AppCtx.Provider>
    </TContext.Provider>
  )
}

function StatusDot({ ok }: { ok: boolean | null }): ReactElement {
  return <span className={`dot ${ok === null ? 'wait' : ok ? 'ok' : 'off'}`} />
}

function Sidebar({ onPalette }: { onPalette: () => void }): ReactElement {
  const { state, claude, github, selected, busy, select, setModal } = useApp()
  const t = useT()
  return (
    <aside className="sidebar">
      <div className="drag sidebar-top" />
      <div className="brand">
        <Logo size={26} />
        <span>Baton</span>
      </div>
      <button className="search-btn" onClick={onPalette} data-testid="open-palette">
        <Icon name="search" size={14} />
        <span>{t('search')}</span>
        <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>

      <div className="side-scroll">
        <div className="side-label">
          <span>{t('repos')}</span>
          <button className="icon-btn" title={t('addRepo')} aria-label={t('addRepo')} onClick={() => setModal({ type: 'addRepo' })}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        {state.repos.length === 0 && <p className="side-empty">{t('noRepos')}</p>}
        {state.repos.map(renderRepo)}
      </div>

      <div className="side-foot">
        <button className="conn" onClick={() => setModal({ type: 'settings', tab: 'claude' })}>
          <StatusDot ok={claude ? claude.loggedIn : null} />
          <span>Claude</span>
        </button>
        <button className="conn" onClick={() => setModal({ type: 'settings', tab: 'github' })}>
          <StatusDot ok={github ? github.loggedIn : null} />
          <span>GitHub{github?.login ? ` · ${github.login}` : ''}</span>
        </button>
        <button className="icon-btn" title={t('settings')} aria-label={t('settings')} onClick={() => setModal({ type: 'settings' })}>
          <Icon name="gear" />
        </button>
      </div>
    </aside>
  )

  function renderRepo(repo: Repo): ReactElement {
    const list = state.workspaces.filter((w) => w.repoId === repo.id)
    const spot = state.spotlights.find((s) => s.repoId === repo.id)
    return (
      <div className="repo" key={repo.id}>
        <div className="repo-head">
          <Icon name="folder" size={14} />
          <span className="repo-name" title={repo.path}>{repo.name}</span>
          <button
            className="icon-btn"
            title={t('newWorkspace')}
            aria-label={`${t('newWorkspace')}: ${repo.name}`}
            onClick={() => setModal({ type: 'newWorkspace', repoId: repo.id })}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
        {list.length === 0 && <p className="side-empty indent">{t('noWorkspaces')}</p>}
        {list.map((ws) => (
          <button
            key={ws.id}
            className={`ws-row ${selected?.id === ws.id ? 'active' : ''}`}
            onClick={() => select(ws.id)}
          >
            <span className={`ws-state ${busy.includes(ws.id) ? 'busy' : ''}`} />
            <span className="ws-name">{ws.name}</span>
            {spot?.workspaceId === ws.id && (
              <span className="ws-spot" title={t('spotlight')}>
                <Icon name="spotlight" size={13} />
              </span>
            )}
            {ws.prUrl && <span className="ws-pr">PR</span>}
          </button>
        ))}
      </div>
    )
  }
}

function Welcome(): ReactElement {
  const { state, claude, github, select, setModal, connectClaude, connectGithub, refreshStatus } = useApp()
  const t = useT()
  const firstRepo = state.repos[0]
  const steps = [
    {
      done: !!claude?.loggedIn,
      title: t('stepClaude'),
      hint: claude && !claude.installed ? t('installClaude') : t('stepClaudeHint'),
      detail: claude?.loggedIn ? [claude.email, claude.plan].filter(Boolean).join(' · ') : '',
      action: claude && !claude.installed ? refreshStatus : connectClaude,
      label: claude && !claude.installed ? t('recheck') : t('signIn')
    },
    {
      done: !!github?.loggedIn,
      title: t('stepGithub'),
      hint: github && !github.installed ? t('installGh') : t('stepGithubHint'),
      detail: github?.login ?? '',
      action: github && !github.installed ? refreshStatus : connectGithub,
      label: github && !github.installed ? t('recheck') : t('connect')
    },
    {
      done: state.repos.length > 0,
      title: t('stepRepo'),
      hint: t('stepRepoHint'),
      detail: state.repos.map((r) => r.name).join(', '),
      action: () => setModal({ type: 'addRepo' }),
      label: t('addRepo')
    },
    {
      done: state.workspaces.length > 0,
      title: t('stepWorkspace'),
      hint: t('stepWorkspaceHint'),
      detail: '',
      action: () => (firstRepo ? setModal({ type: 'newWorkspace', repoId: firstRepo.id }) : setModal({ type: 'addRepo' })),
      label: t('newWorkspace')
    }
  ]
  return (
    <div className="welcome">
      <div className="drag welcome-drag" />
      <div className="welcome-card">
        <Logo size={56} />
        <h1>{t('welcomeTitle')}</h1>
        <p className="muted">{state.workspaces.length ? t('appTagline') : t('welcomeSub')}</p>
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={i} className={s.done ? 'done' : ''}>
              <span className="step-num">{s.done ? <Icon name="check" size={14} /> : i + 1}</span>
              <div className="step-body">
                <strong>{s.title}</strong>
                <span className="muted">{s.done && s.detail ? s.detail : s.hint}</span>
              </div>
              {!s.done && (
                <button className="btn primary" onClick={s.action}>
                  {s.label}
                </button>
              )}
            </li>
          ))}
        </ol>
        {state.workspaces.length > 0 && (
          <button className="btn" onClick={() => select(state.workspaces[0].id)}>
            {t('goTo')}: {state.workspaces[0].name}
          </button>
        )}
      </div>
    </div>
  )
}
