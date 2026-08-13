import { useCallback, useEffect, useRef, useState } from 'react'
import type { OmniMindSendResult, OmniMindSettings, OmniMindSettingsInput, OmniMindSnapshot } from '../../../shared/omnimind/contracts'

const emptySnapshot: OmniMindSnapshot = { runtimeState: 'stopped', waiting: [], recent: [] }

export function useOmniMind(): {
  snapshot: OmniMindSnapshot; settings?: OmniMindSettings; loading: boolean; error?: string
  reload: () => Promise<void>; enable: () => Promise<void>; disable: () => Promise<void>
  saveSettings: (settings: OmniMindSettingsInput) => Promise<void>; cancelTask: (id: string) => Promise<void>; retryTask: (id: string) => Promise<void>
  sendGeneratedReply: (id: string) => Promise<OmniMindSendResult>; abandonGeneratedReply: (id: string) => Promise<void>
} {
  const [snapshot, setSnapshot] = useState(emptySnapshot)
  const [settings, setSettings] = useState<OmniMindSettings>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const liveVersion = useRef(0)
  const reload = useCallback(async (): Promise<void> => {
    const versionAtRequest = liveVersion.current
    setError(undefined)
    try {
      const [nextSnapshot, nextSettings] = await Promise.all([window.electronAPI.omniMind.getSnapshot(), window.electronAPI.omniMind.getSettings()])
      if (liveVersion.current === versionAtRequest) setSnapshot(nextSnapshot)
      setSettings(nextSettings)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'snapshot_failed') } finally { setLoading(false) }
  }, [])
  useEffect(() => {
    const unsubscribe = window.electronAPI.omniMind.onSnapshotChanged((next) => { liveVersion.current += 1; setSnapshot(next) })
    void reload()
    return unsubscribe
  }, [reload])
  return {
    snapshot, settings, loading, error, reload,
    enable: async () => setSnapshot(await window.electronAPI.omniMind.enable()),
    disable: async () => setSnapshot(await window.electronAPI.omniMind.disable()),
    saveSettings: async (input) => { await window.electronAPI.omniMind.saveSettings(input); await reload() },
    cancelTask: async (id) => { await window.electronAPI.omniMind.cancelTask(id) },
    retryTask: async (id) => { await window.electronAPI.omniMind.retryTask(id) }
    ,sendGeneratedReply: async (id) => window.electronAPI.omniMind.sendGeneratedReply(id),
    abandonGeneratedReply: async (id) => { await window.electronAPI.omniMind.abandonGeneratedReply(id) }
  }
}
