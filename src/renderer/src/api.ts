interface Bridge {
  platform: string
  invoke(name: string, ...args: unknown[]): Promise<{ ok: boolean; data?: unknown; error?: string }>
  on(event: string, cb: (payload: any) => void): () => void
}

declare global {
  interface Window {
    baton: Bridge
  }
}

/** Calls an action in the main process; rejects with the action's error message. */
export async function call<T = any>(name: string, ...args: unknown[]): Promise<T> {
  const res = await window.baton.invoke(name, ...args)
  if (!res.ok) throw new Error(res.error)
  return res.data as T
}

export const on = (event: string, cb: (payload: any) => void): (() => void) => window.baton.on(event, cb)
export const isMac = window.baton.platform === 'darwin'
