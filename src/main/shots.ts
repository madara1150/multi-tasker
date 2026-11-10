// Screenshot mode (BATON_SHOTS=<dir>): drives the real app against a demo
// repository and saves PNGs for the README. Started by tools/screenshots.mjs.
import { app, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { AppState, Language, Workspace } from '../shared/types'

type Actions = Record<string, (...args: any[]) => unknown>
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const PROMPTS: Record<Language, string> = {
  th: 'เพิ่มปุ่มสลับโหมดมืด/สว่างที่มุมขวาบนของหน้าเว็บ และจำค่าที่เลือกไว้ใน localStorage ตอบสั้นๆ เป็นภาษาไทย',
  en: 'Add a dark/light mode toggle to the top-right corner of the page and remember the choice in localStorage. Keep your reply short.'
}

export async function runShots(win: BrowserWindow, actions: Actions, getState: () => AppState): Promise<void> {
  const dir = process.env.BATON_SHOTS!
  mkdirSync(dir, { recursive: true })
  const js = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code)
  const shot = async (name: string): Promise<void> => {
    await sleep(700)
    // Wait for a fresh frame, otherwise capturePage can return the previous one.
    await js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')
    await sleep(200)
    writeFileSync(path.join(dir, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    console.log(`saved ${name}.png`)
  }

  try {
    await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()))
    win.setContentSize(1440, 900)
    await sleep(1200)

    await actions['settings:update']({ language: 'th', theme: 'midnight', permissionMode: 'acceptEdits' })
    await js('window.__baton.select(null)')
    await shot('welcome-th')
    await actions['settings:update']({ language: 'en' })
    await shot('welcome-en')

    const repo = (await actions['repo:add'](process.env.BATON_DEMO_REPO)) as { id: string }
    const spaces: Record<Language, Workspace> = {
      th: (await actions['ws:create'](repo.id, { name: 'allegro' })) as Workspace,
      en: (await actions['ws:create'](repo.id, { name: 'adagio' })) as Workspace
    }
    // Two real Claude Code runs, in parallel, one per workspace.
    if (!process.env.BATON_SHOTS_NO_CLAUDE) {
      await Promise.all((['th', 'en'] as Language[]).map((lang) => actions['claude:send'](spaces[lang].id, PROMPTS[lang])))
    }

    for (const lang of ['th', 'en'] as Language[]) {
      await actions['settings:update']({ language: lang, theme: 'midnight', accent: '#7c8cff' })
      await js(`window.__baton.select(${JSON.stringify(spaces[lang].id)})`)
      await sleep(1200)
      await shot(`workspace-${lang}`)

      await actions['spotlight:on'](spaces[lang].id)
      await shot(`spotlight-${lang}`)
      await actions['spotlight:off'](repo.id)

      await js('window.__baton.setPalette(true)')
      await shot(`palette-${lang}`)
      await js('window.__baton.setPalette(false)')

      await js(`window.__baton.setModal({ type: 'settings', tab: 'appearance' })`)
      await shot(`themes-${lang}`)
      await js('window.__baton.setModal(null)')

      await actions['settings:update']({ theme: 'paper', accent: '#3ecf8e' })
      await shot(`light-${lang}`)
    }
    console.log(`spotlights left on: ${getState().spotlights.length}`)
  } catch (err) {
    console.error('screenshot run failed:', err)
    process.exitCode = 1
  } finally {
    app.quit()
  }
}
