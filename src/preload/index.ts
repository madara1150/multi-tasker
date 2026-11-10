import { contextBridge, ipcRenderer } from 'electron'

const EVENTS = ['state', 'chat:item', 'busy', 'github:device', 'claude:login-output']

contextBridge.exposeInMainWorld('baton', {
  platform: process.platform,
  invoke: (name: string, ...args: unknown[]) => ipcRenderer.invoke('baton', name, ...args),
  on: (event: string, cb: (payload: unknown) => void) => {
    if (!EVENTS.includes(event)) return () => undefined
    const listener = (_e: unknown, payload: unknown): void => cb(payload)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  }
})
