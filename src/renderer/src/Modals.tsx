import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { DeviceCode, GithubRepo, PermissionMode, Repo, Settings } from '../../shared/types'
import { call } from './api'
import { useApp } from './App'
import { useT } from './i18n'
import { Icon } from './icons'
import { ACCENTS, THEMES } from './themes'

function Dialog({
  title,
  wide,
  onClose,
  children
}: {
  title: string
  wide?: boolean
  onClose?: () => void
  children: ReactNode
}): ReactElement {
  const { setModal } = useApp()
  const close = onClose ?? (() => setModal(null))
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <h3>{title}</h3>
          <button className="icon-btn" aria-label="Close" onClick={close}>
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): ReactElement {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="muted small">{hint}</span>}
    </label>
  )
}

// ── Add repository ──────────────────────────────────────────────────────────

export function AddRepoModal(): ReactElement {
  const { github, setModal, run, connectGithub } = useApp()
  const t = useT()
  const [tab, setTab] = useState<'folder' | 'github'>('folder')
  const [repos, setRepos] = useState<GithubRepo[] | null>(null)
  const [filter, setFilter] = useState('')
  const [cloning, setCloning] = useState<string | null>(null)

  useEffect(() => {
    if (tab === 'github' && github?.loggedIn && !repos) {
      void run(() => call<GithubRepo[]>('github:repos')).then((r) => setRepos(r ?? []))
    }
  }, [tab, github?.loggedIn]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (): void => {
    void run(() => call<Repo | null>('repo:pick')).then((repo) => repo && setModal({ type: 'newWorkspace', repoId: repo.id }))
  }
  const clone = (name: string): void => {
    setCloning(name)
    void run(() => call<Repo>('github:clone', name)).then((repo) => {
      setCloning(null)
      if (repo) setModal({ type: 'newWorkspace', repoId: repo.id })
    })
  }
  const shown = (repos ?? []).filter((r) => r.nameWithOwner.toLowerCase().includes(filter.toLowerCase()))

  return (
    <Dialog title={t('addRepoTitle')}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'folder'} className={tab === 'folder' ? 'active' : ''} onClick={() => setTab('folder')}>
          {t('fromFolder')}
        </button>
        <button role="tab" aria-selected={tab === 'github'} className={tab === 'github' ? 'active' : ''} onClick={() => setTab('github')}>
          {t('fromGithub')}
        </button>
      </div>
      {tab === 'folder' ? (
        <div className="dialog-body center">
          <p className="muted">{t('chooseFolderHint')}</p>
          <button className="btn primary" onClick={pick}>
            <Icon name="folder" />
            {t('chooseFolder')}
          </button>
        </div>
      ) : !github?.loggedIn ? (
        <div className="dialog-body center">
          <p className="muted">{github && !github.installed ? t('installGh') : t('githubNeeded')}</p>
          {github?.installed && (
            <button className="btn primary" onClick={connectGithub}>
              {t('connect')}
            </button>
          )}
        </div>
      ) : (
        <div className="dialog-body">
          <input autoFocus placeholder={t('filterRepos')} aria-label={t('filterRepos')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul className="gh-list">
            {repos === null && <li className="muted pad">…</li>}
            {shown.map((r) => (
              <li key={r.nameWithOwner}>
                <div className="gh-info">
                  <strong>
                    {r.nameWithOwner} {r.isPrivate && <span className="tag">{t('private')}</span>}
                  </strong>
                  {r.description && <span className="muted small">{r.description}</span>}
                </div>
                <button className="btn small" disabled={cloning !== null} onClick={() => clone(r.nameWithOwner)}>
                  {cloning === r.nameWithOwner ? t('cloning') : t('clone')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  )
}

// ── New workspace ───────────────────────────────────────────────────────────

export function NewWorkspaceModal({ repoId }: { repoId: string }): ReactElement {
  const { state, setModal, select, run } = useApp()
  const t = useT()
  const repo = state.repos.find((r) => r.id === repoId)!
  const [name, setName] = useState('')
  const [base, setBase] = useState(repo.baseBranch)
  const [branches, setBranches] = useState<string[]>([repo.baseBranch])
  const [working, setWorking] = useState(false)

  useEffect(() => {
    void call<string[]>('repo:branches', repoId).then((list) => {
      setBranches(list.includes(repo.baseBranch) ? list : [repo.baseBranch, ...list])
    })
  }, [repoId, repo.baseBranch])

  const create = (): void => {
    setWorking(true)
    void run(() => call<{ id: string }>('ws:create', repoId, { name, base })).then((ws) => {
      setWorking(false)
      if (ws) {
        select(ws.id)
        setModal(null)
      }
    })
  }

  return (
    <Dialog title={t('newWorkspaceTitle', { repo: repo.name })}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          create()
        }}
      >
        <Field label={t('wsName')} hint={t('wsNameHint')}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="allegro" />
        </Field>
        <Field label={t('baseBranch')}>
          <select value={base} onChange={(e) => setBase(e.target.value)}>
            {branches.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </Field>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={() => setModal(null)}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={working} data-testid="create-ws">
            {t('create')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// ── Create pull request ─────────────────────────────────────────────────────

export function CreatePrModal({ wsId }: { wsId: string }): ReactElement {
  const { state, setModal, run, toast } = useApp()
  const t = useT()
  const ws = state.workspaces.find((w) => w.id === wsId)!
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [working, setWorking] = useState(false)

  const create = (): void => {
    setWorking(true)
    void run(() => call<string>('ws:createPr', wsId, { title, body })).then((url) => {
      setWorking(false)
      if (url) {
        toast(t('prCreated'))
        setModal(null)
        void call('app:openExternal', url)
      }
    })
  }

  return (
    <Dialog title={`${t('createPr')} · ${ws.branch}`}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          create()
        }}
      >
        <Field label={t('prTitle')}>
          <input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t('prBody')}>
          <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <p className="muted small">{t('prHint', { base: ws.baseBranch })}</p>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={() => setModal(null)}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={working || !title.trim()}>
            {t('createPr')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// ── Archive ─────────────────────────────────────────────────────────────────

export function ArchiveModal({ wsId }: { wsId: string }): ReactElement {
  const { state, setModal, select, run } = useApp()
  const t = useT()
  const ws = state.workspaces.find((w) => w.id === wsId)!
  const [deleteBranch, setDeleteBranch] = useState(false)
  const [working, setWorking] = useState(false)

  const archive = (): void => {
    setWorking(true)
    void run(async () => {
      await call('ws:archive', wsId, deleteBranch)
      select(null)
      setModal(null)
    }).then(() => setWorking(false))
  }

  return (
    <Dialog title={t('archiveTitle', { name: ws.name })}>
      <div className="dialog-body">
        <p>{t('archiveBody')}</p>
        <label className="check">
          <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} />
          {t('archiveDeleteBranch', { branch: ws.branch })}
        </label>
        <div className="dialog-foot">
          <button className="btn" onClick={() => setModal(null)}>
            {t('cancel')}
          </button>
          <button className="btn danger" disabled={working} onClick={archive}>
            {t('archive')}
          </button>
        </div>
      </div>
    </Dialog>
  )
}

// ── GitHub device code ──────────────────────────────────────────────────────

export function GithubCodeModal({ device }: { device: DeviceCode }): ReactElement {
  const t = useT()
  const [opened, setOpened] = useState(false)
  return (
    <Dialog title={t('githubCodeTitle')} onClose={() => void call('github:cancelLogin')}>
      <div className="dialog-body center">
        <p className="muted">{t('githubCodeBody')}</p>
        <div className="device-code">{device.code}</div>
        <button
          className="btn primary"
          onClick={() => {
            void navigator.clipboard.writeText(device.code)
            void call('app:openExternal', device.url)
            setOpened(true)
          }}
        >
          <Icon name="external" />
          {t('copyAndOpen')}
        </button>
        {opened && <p className="muted small">{t('waitingGithub')}</p>}
      </div>
    </Dialog>
  )
}

// ── Settings ────────────────────────────────────────────────────────────────

export function SettingsModal({ tab: initial }: { tab?: string }): ReactElement {
  const t = useT()
  const [tab, setTab] = useState(initial ?? 'appearance')
  const tabs: [string, string, string][] = [
    ['appearance', t('appearance'), 'palette'],
    ['claude', t('claude'), 'chat'],
    ['github', t('github'), 'pr'],
    ['repos', t('repos'), 'folder'],
    ['general', t('general'), 'gear']
  ]
  return (
    <Dialog title={t('settings')} wide>
      <div className="settings">
        <nav className="settings-nav">
          {tabs.map(([id, label, icon]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} data-testid={`tab-${id}`}>
              <Icon name={icon} />
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-pane">
          {tab === 'appearance' && <AppearancePane />}
          {tab === 'claude' && <ClaudePane />}
          {tab === 'github' && <GithubPane />}
          {tab === 'repos' && <ReposPane />}
          {tab === 'general' && <GeneralPane />}
        </div>
      </div>
    </Dialog>
  )
}

function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const { state } = useApp()
  return [state.settings, (patch) => void call('settings:update', patch)]
}

function AppearancePane(): ReactElement {
  const t = useT()
  const [s, update] = useSettings()
  return (
    <>
      <h4>{t('theme')}</h4>
      <div className="theme-grid">
        {THEMES.map((th) => (
          <button
            key={th.id}
            className={`theme-card ${s.theme === th.id ? 'active' : ''}`}
            aria-pressed={s.theme === th.id}
            onClick={() => update({ theme: th.id })}
          >
            <span className="theme-preview" style={{ background: th.bg, borderColor: th.border }}>
              <span style={{ background: th.panel, borderColor: th.border }} />
              <span style={{ background: th.raised }} />
              <i style={{ background: s.accent }} />
            </span>
            <span className="theme-name">{th.id}</span>
          </button>
        ))}
        <button
          className={`theme-card ${s.theme === 'system' ? 'active' : ''}`}
          aria-pressed={s.theme === 'system'}
          onClick={() => update({ theme: 'system' })}
        >
          <span className="theme-preview split">
            <span style={{ background: '#181818' }} />
            <span style={{ background: '#ffffff' }} />
          </span>
          <span className="theme-name">{t('themeSystem')}</span>
        </button>
      </div>

      <h4>{t('accent')}</h4>
      <div className="swatches">
        {ACCENTS.map((c) => (
          <button
            key={c}
            className={`swatch ${s.accent === c ? 'active' : ''}`}
            style={{ background: c }}
            aria-label={c}
            aria-pressed={s.accent === c}
            onClick={() => update({ accent: c })}
          />
        ))}
        <label className="swatch-custom">
          <input type="color" value={s.accent} onChange={(e) => update({ accent: e.target.value })} />
          {t('custom')}
        </label>
      </div>

      <h4>
        {t('fontSize')} <span className="muted">{s.fontSize}px</span>
      </h4>
      <input
        type="range"
        min={12}
        max={18}
        step={1}
        value={s.fontSize}
        aria-label={t('fontSize')}
        onChange={(e) => update({ fontSize: Number(e.target.value) })}
      />

      <h4>{t('language')}</h4>
      <div className="seg">
        <button className={s.language === 'th' ? 'active' : ''} onClick={() => update({ language: 'th' })}>
          ไทย
        </button>
        <button className={s.language === 'en' ? 'active' : ''} onClick={() => update({ language: 'en' })}>
          English
        </button>
      </div>
    </>
  )
}

function ClaudePane(): ReactElement {
  const { claude, connectClaude, refreshStatus } = useApp()
  const t = useT()
  const [s, update] = useSettings()
  const modes: [PermissionMode, string, string][] = [
    ['acceptEdits', t('permAccept'), t('permAcceptHint')],
    ['bypassPermissions', t('permBypass'), t('permBypassHint')],
    ['plan', t('permPlan'), t('permPlanHint')]
  ]
  return (
    <>
      <h4>{t('account')}</h4>
      <div className="account">
        <span className={`dot ${claude?.loggedIn ? 'ok' : 'off'}`} />
        <div className="account-info">
          <strong>
            {!claude ? '…' : !claude.installed ? t('notInstalled') : claude.loggedIn ? t('connected') : t('notConnected')}
          </strong>
          <span className="muted small">
            {claude?.loggedIn
              ? [claude.email, claude.plan, `Claude Code ${claude.version}`].filter(Boolean).join(' · ')
              : claude && !claude.installed
                ? t('installClaude')
                : t('stepClaudeHint')}
          </span>
        </div>
        {claude?.installed && !claude.loggedIn && (
          <button className="btn primary" onClick={connectClaude}>
            {t('signIn')}
          </button>
        )}
        <button className="btn" onClick={refreshStatus}>
          {t('recheck')}
        </button>
      </div>

      <h4>{t('model')}</h4>
      <select value={s.model} onChange={(e) => update({ model: e.target.value })} aria-label={t('model')}>
        <option value="">{t('modelDefault')}</option>
        <option value="fable">Fable</option>
        <option value="opus">Opus</option>
        <option value="sonnet">Sonnet</option>
        <option value="haiku">Haiku</option>
      </select>

      <h4>{t('permission')}</h4>
      <div className="radio-list" role="radiogroup" aria-label={t('permission')}>
        {modes.map(([id, label, hint]) => (
          <label key={id} className={s.permissionMode === id ? 'active' : ''}>
            <input type="radio" name="perm" checked={s.permissionMode === id} onChange={() => update({ permissionMode: id })} />
            <div>
              <strong>{label}</strong>
              <span className="muted small">{hint}</span>
            </div>
          </label>
        ))}
      </div>
    </>
  )
}

function GithubPane(): ReactElement {
  const { github, connectGithub, refreshStatus } = useApp()
  const t = useT()
  return (
    <>
      <h4>{t('account')}</h4>
      <div className="account">
        <span className={`dot ${github?.loggedIn ? 'ok' : 'off'}`} />
        <div className="account-info">
          <strong>
            {!github ? '…' : !github.installed ? t('notInstalled') : github.loggedIn ? `${t('connected')} · ${github.login}` : t('notConnected')}
          </strong>
          <span className="muted small">{github && !github.installed ? t('installGh') : t('stepGithubHint')}</span>
        </div>
        {github?.installed && !github.loggedIn && (
          <button className="btn primary" onClick={connectGithub}>
            {t('connect')}
          </button>
        )}
        <button className="btn" onClick={refreshStatus}>
          {t('recheck')}
        </button>
      </div>
    </>
  )
}

function ReposPane(): ReactElement {
  const { state, setModal, run } = useApp()
  const t = useT()
  return (
    <>
      {state.repos.length === 0 && <p className="muted">{t('noRepos')}</p>}
      {state.repos.map((repo) => (
        <RepoCard key={repo.id} repo={repo} onRemove={() => void run(() => call('repo:remove', repo.id))} />
      ))}
      <button className="btn" onClick={() => setModal({ type: 'addRepo' })}>
        <Icon name="plus" />
        {t('addRepo')}
      </button>
    </>
  )
}

function RepoCard({ repo, onRemove }: { repo: Repo; onRemove: () => void }): ReactElement {
  const t = useT()
  const [branches, setBranches] = useState<string[]>([repo.baseBranch])
  const [script, setScript] = useState(repo.setupScript)
  const saved = useRef(repo.setupScript)
  useEffect(() => {
    void call<string[]>('repo:branches', repo.id).then((list) =>
      setBranches(list.includes(repo.baseBranch) ? list : [repo.baseBranch, ...list])
    )
  }, [repo.id, repo.baseBranch])
  const saveScript = (): void => {
    if (script === saved.current) return
    saved.current = script
    void call('repo:update', repo.id, { setupScript: script })
  }
  return (
    <div className="card">
      <div className="card-head">
        <Icon name="folder" />
        <div className="account-info">
          <strong>{repo.name}</strong>
          <span className="muted small">{repo.path}</span>
        </div>
        <button className="btn small" title={t('removeHint')} onClick={onRemove}>
          {t('remove')}
        </button>
      </div>
      <Field label={t('baseBranch')}>
        <select value={repo.baseBranch} onChange={(e) => void call('repo:update', repo.id, { baseBranch: e.target.value })}>
          {branches.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </Field>
      <Field label={t('setupScript')} hint={t('setupScriptHint')}>
        <input value={script} placeholder="npm install" onChange={(e) => setScript(e.target.value)} onBlur={saveScript} />
      </Field>
    </div>
  )
}

function GeneralPane(): ReactElement {
  const t = useT()
  const [s, update] = useSettings()
  const [prefix, setPrefix] = useState(s.branchPrefix)
  return (
    <>
      <h4>{t('homeDir')}</h4>
      <div className="account">
        <Icon name="folder" />
        <div className="account-info">
          <strong>{s.homeDir}</strong>
          <span className="muted small">{t('homeDirHint')}</span>
        </div>
        <button
          className="btn"
          onClick={() => void call<string | null>('app:pickFolder').then((dir) => dir && update({ homeDir: dir }))}
        >
          {t('change')}
        </button>
      </div>
      <h4>{t('branchPrefix')}</h4>
      <input value={prefix} onChange={(e) => setPrefix(e.target.value)} onBlur={() => update({ branchPrefix: prefix })} aria-label={t('branchPrefix')} />
    </>
  )
}
