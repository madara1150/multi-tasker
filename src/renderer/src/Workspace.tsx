import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { ChatItem, DiffFile, Workspace } from '../../shared/types'
import { call, on } from './api'
import { useApp } from './App'
import { useT, type T } from './i18n'
import { Icon } from './icons'

export function WorkspaceView({ ws }: { ws: Workspace }): ReactElement {
  const { state, busy, setModal, run, toast, toggleSpotlight } = useApp()
  const t = useT()
  const repo = state.repos.find((r) => r.id === ws.repoId)!
  const isBusy = busy.includes(ws.id)
  const spot = state.spotlights.find((s) => s.repoId === ws.repoId)
  const spotHere = spot?.workspaceId === ws.id
  const spotOther = spot && !spotHere ? state.workspaces.find((w) => w.id === spot.workspaceId) : undefined

  const [items, setItems] = useState<ChatItem[]>([])
  const [files, setFiles] = useState<DiffFile[]>([])
  const [openMenu, setOpenMenu] = useState(false)

  const refreshDiff = useCallback(() => {
    void call<DiffFile[]>('ws:diff', ws.id).then(setFiles, () => setFiles([]))
  }, [ws.id])

  useEffect(() => {
    void call<ChatItem[]>('chat:get', ws.id).then(setItems)
    refreshDiff()
    return on('chat:item', (p: { wsId: string; item: ChatItem }) => {
      if (p.wsId !== ws.id) return
      setItems((prev) => [...prev, p.item])
      if (p.item.role === 'tool' || p.item.role === 'result') setTimeout(refreshDiff, 400)
    })
  }, [ws.id, refreshDiff])

  const open = (how: string): void => {
    setOpenMenu(false)
    void run(() => call('ws:open', ws.id, how))
  }

  return (
    <div className="workspace">
      <header className="ws-header drag">
        <div className="ws-title">
          <h2>{ws.name}</h2>
          <span className="chip">
            <Icon name="branch" size={13} />
            {ws.branch}
          </span>
          <span className="muted small">
            {repo.name} · {ws.baseBranch}
          </span>
        </div>
        <div className="ws-actions no-drag">
          <button
            className={`btn ${spotHere ? 'lit' : ''}`}
            title={t('spotlightTip')}
            aria-pressed={spotHere}
            onClick={() => toggleSpotlight(ws)}
            data-testid="spotlight"
          >
            <Icon name="spotlight" />
            {t('spotlight')}
          </button>
          {ws.prUrl ? (
            <button className="btn" onClick={() => void call('app:openExternal', ws.prUrl)}>
              <Icon name="external" />
              {t('viewPr')}
            </button>
          ) : (
            <button className="btn" onClick={() => setModal({ type: 'createPr', wsId: ws.id })}>
              <Icon name="pr" />
              {t('createPr')}
            </button>
          )}
          <div className="menu-wrap">
            <button className="btn" aria-haspopup="menu" aria-expanded={openMenu} onClick={() => setOpenMenu((v) => !v)}>
              <Icon name="folder" />
              {t('openIn')}
            </button>
            {openMenu && (
              <div className="menu" role="menu">
                <button role="menuitem" onClick={() => open('finder')}>{t('finder')}</button>
                <button role="menuitem" onClick={() => open('terminal')}>{t('terminal')}</button>
                <button role="menuitem" onClick={() => open('editor')}>{t('editor')}</button>
              </div>
            )}
          </div>
          <button
            className="icon-btn"
            title={t('archive')}
            aria-label={t('archive')}
            onClick={() => setModal({ type: 'archive', wsId: ws.id })}
          >
            <Icon name="trash" />
          </button>
        </div>
      </header>

      {spotHere && (
        <div className="banner lit">
          <Icon name="spotlight" />
          <span>
            {t('spotlightBanner')} <code>{repo.path}</code>
          </span>
          <button
            className="btn small"
            onClick={() =>
              void run(async () => {
                await call('spotlight:on', ws.id)
                toast(t('spotlightSyncToast'))
              })
            }
          >
            {t('spotlightSync')}
          </button>
          <button className="btn small" onClick={() => toggleSpotlight(ws)}>
            {t('spotlightOff')}
          </button>
        </div>
      )}
      {spotOther && (
        <div className="banner">
          <Icon name="spotlight" />
          <span>{t('spotlightOther', { name: spotOther.name })}</span>
          <button className="btn small" onClick={() => toggleSpotlight(ws)}>
            {t('spotlightSwitch')}
          </button>
        </div>
      )}

      <div className="ws-body">
        <Chat ws={ws} items={items} busy={isBusy} onClear={() => setItems([])} />
        <Changes files={files} onRefresh={refreshDiff} />
      </div>
    </div>
  )
}

// ── Chat ────────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

/** Small Markdown subset: fenced code, inline code and bold. */
function renderText(text: string): ReactNode[] {
  const out: ReactNode[] = []
  text.split(/```/).forEach((part, i) => {
    if (i % 2 === 1) {
      out.push(<pre key={i}>{part.replace(/^[a-zA-Z0-9_+-]*\n/, '')}</pre>)
      return
    }
    const inline = part.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/).map((seg, j) => {
      if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) return <code key={j}>{seg.slice(1, -1)}</code>
      if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
        return <strong key={j}>{seg.slice(2, -2).replaceAll('`', '')}</strong>
      }
      return seg
    })
    out.push(<span key={i}>{inline}</span>)
  })
  return out
}

/** Shows tool paths relative to the workspace (macOS may prefix them with /private). */
function relativeTo(text: string, cwd: string): string {
  const at = text.indexOf(`${cwd}/`)
  return at >= 0 && at <= '/private'.length ? text.slice(at + cwd.length + 1) : text
}

function infoText(t: T, text: string): { text: string; detail?: string; error?: boolean } {
  if (text === 'stopped') return { text: t('stopped') }
  if (text === 'setup:done') return { text: t('setupDone') }
  if (text.startsWith('setup:start:')) return { text: t('setupStart', { cmd: text.slice(12) }) }
  if (text.startsWith('setup:fail:')) return { text: t('setupFail'), detail: text.slice(11), error: true }
  return { text }
}

function Message({ item, cwd }: { item: ChatItem; cwd: string }): ReactElement | null {
  const t = useT()
  switch (item.role) {
    case 'user':
      return <div className="msg user">{item.text}</div>
    case 'assistant':
      return <div className="msg assistant">{renderText(item.text)}</div>
    case 'tool':
      return (
        <div className="msg tool">
          <Icon name="tool" size={13} />
          <strong>{item.tool}</strong>
          <span>{relativeTo(item.text, cwd)}</span>
        </div>
      )
    case 'error':
      return <div className="msg error">{item.text}</div>
    case 'result':
      return item.durationMs ? (
        <div className="msg meta">{t('finishedIn', { time: formatDuration(item.durationMs) })}</div>
      ) : null
    case 'info': {
      const info = infoText(t, item.text)
      return (
        <div className={`msg meta ${info.error ? 'bad' : ''}`}>
          {info.text}
          {info.detail && <pre>{info.detail}</pre>}
        </div>
      )
    }
  }
}

function Chat({
  ws,
  items,
  busy,
  onClear
}: {
  ws: Workspace
  items: ChatItem[]
  busy: boolean
  onClear: () => void
}): ReactElement {
  const { run } = useApp()
  const t = useT()
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [items.length, busy])
  useEffect(() => inputRef.current?.focus(), [ws.id])

  const submit = (): void => {
    const prompt = text.trim()
    if (!prompt || busy) return
    setText('')
    void run(() => call('claude:send', ws.id, prompt))
  }

  return (
    <section className="chat">
      <div className="chat-scroll">
        {items.length === 0 ? (
          <div className="chat-empty">
            <Icon name="chat" size={28} />
            <strong>{t('emptyChatTitle')}</strong>
            <span className="muted">{t('emptyChatBody', { branch: ws.branch, base: ws.baseBranch })}</span>
          </div>
        ) : (
          <div className="thread">
            {items.map((item) => (
              <Message key={item.id} item={item} cwd={ws.path} />
            ))}
            {busy && (
              <div className="msg meta working">
                <span className="pulse" />
                {t('working')}
              </div>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="composer">
        <textarea
          ref={inputRef}
          value={text}
          rows={Math.min(8, Math.max(2, text.split('\n').length))}
          placeholder={t('composerPlaceholder')}
          aria-label={t('composerPlaceholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="composer-row">
          <span className="muted small">{t('composerHint')}</span>
          <span className="spacer" />
          {items.length > 0 && !busy && (
            <button
              className="btn ghost small"
              onClick={() => void run(() => call('chat:clear', ws.id)).then(onClear)}
            >
              {t('clearChat')}
            </button>
          )}
          {busy ? (
            <button className="btn danger" onClick={() => void call('claude:stop', ws.id)}>
              <Icon name="stop" />
              {t('stop')}
            </button>
          ) : (
            <button className="btn primary" disabled={!text.trim()} onClick={submit} data-testid="send">
              {t('send')}
              <Icon name="send" />
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

// ── Changes ─────────────────────────────────────────────────────────────────

function Changes({ files, onRefresh }: { files: DiffFile[]; onRefresh: () => void }): ReactElement {
  const t = useT()
  const [openPath, setOpenPath] = useState<string | null>(null)
  const current = files.find((f) => f.path === openPath) ?? files[0]
  const added = files.reduce((n, f) => n + f.added, 0)
  const removed = files.reduce((n, f) => n + f.removed, 0)

  return (
    <aside className="changes">
      <div className="changes-head">
        <strong>{t('changes')}</strong>
        {files.length > 0 && (
          <span className="small">
            <span className="muted">{t('files', { n: files.length })}</span> <span className="add">+{added}</span>{' '}
            <span className="del">−{removed}</span>
          </span>
        )}
        <span className="spacer" />
        <button className="icon-btn" title={t('refresh')} aria-label={t('refresh')} onClick={onRefresh}>
          <Icon name="refresh" size={14} />
        </button>
      </div>
      {files.length === 0 ? (
        <p className="changes-empty muted">{t('noChanges')}</p>
      ) : (
        <>
          <ul className="file-list">
            {files.map((f) => (
              <li key={f.path}>
                <button className={f.path === current?.path ? 'active' : ''} onClick={() => setOpenPath(f.path)}>
                  <span className="file-name" title={f.path}>{f.path}</span>
                  <span className="add">+{f.added}</span>
                  <span className="del">−{f.removed}</span>
                </button>
              </li>
            ))}
          </ul>
          {current && <Patch patch={current.patch} />}
        </>
      )}
    </aside>
  )
}

function Patch({ patch }: { patch: string }): ReactElement {
  const lines = patch.split('\n')
  const start = lines.findIndex((l) => l.startsWith('@@'))
  const body = start === -1 ? [] : lines.slice(start)
  return (
    <pre className="patch" tabIndex={0}>
      {body.map((line, i) => {
        const cls = line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'plus' : line.startsWith('-') ? 'minus' : ''
        return (
          <span key={i} className={`line ${cls}`}>
            {line || ' '}
            {'\n'}
          </span>
        )
      })}
    </pre>
  )
}
