// Renders the app icon to assets/icon-1024.png and assets/icon.png.
// Run with: npm run icon
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8f9dff"/><stop offset="1" stop-color="#5b4fe0"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="210" fill="url(#g)"/>
  <path d="M300 760c110 0 150-76 270-76s130 40 190 40" stroke="#fff" stroke-opacity=".45" stroke-width="44" stroke-linecap="round" fill="none"/>
  <path d="M286 738 668 356" stroke="#fff" stroke-width="72" stroke-linecap="round"/>
  <circle cx="716" cy="308" r="76" fill="#fff"/>
</svg>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } })
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((r) => setTimeout(r, 500))
  const image = (await win.webContents.capturePage()).resize({ width: 1024, height: 1024, quality: 'best' })
  const assets = path.join(__dirname, '..', 'assets')
  fs.mkdirSync(assets, { recursive: true })
  fs.writeFileSync(path.join(assets, 'icon-1024.png'), image.toPNG())
  fs.writeFileSync(path.join(assets, 'icon.png'), image.resize({ width: 256, height: 256, quality: 'best' }).toPNG())
  console.log('icons written to assets/')
  app.quit()
})
