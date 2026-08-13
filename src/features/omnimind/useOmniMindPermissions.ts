import { useCallback, useEffect, useRef, useState } from 'react'
import type { OmniMindPermissionKind, OmniMindPermissionSnapshot } from '../../../shared/omnimind/contracts'
import { omniMindZhCN } from './locale'

const initialSnapshot: OmniMindPermissionSnapshot = { accessibility: 'unknown', automation: 'unknown' }

export interface OmniMindPermissionsModel {
  snapshot: OmniMindPermissionSnapshot
  loading: boolean
  busyKind?: OmniMindPermissionKind
  ready: boolean
  returnKind?: OmniMindPermissionKind
  announcement: string
  request: (kind: OmniMindPermissionKind) => Promise<void>
  openSettings: (kind: OmniMindPermissionKind) => Promise<void>
  recheck: (kind: OmniMindPermissionKind) => Promise<void>
}

export function useOmniMindPermissions(): OmniMindPermissionsModel {
  const [snapshot, setSnapshot] = useState<OmniMindPermissionSnapshot>(initialSnapshot)
  const [loading, setLoading] = useState(true)
  const [returnKind, setReturnKind] = useState<OmniMindPermissionKind>()
  const [busyKind, setBusyKind] = useState<OmniMindPermissionKind>()
  const [announcement, setAnnouncement] = useState('')
  const activeHandoff = useRef<OmniMindPermissionKind | undefined>(undefined)

  useEffect(() => {
    let mounted = true
    const bridge = window.electronAPI.omniMind
    if (typeof bridge.getPermissions !== 'function' || typeof bridge.onPermissionsChanged !== 'function') {
      setLoading(false)
      return () => { mounted = false }
    }
    const unsubscribe = bridge.onPermissionsChanged((event) => {
      if (!mounted) return
      setSnapshot(event.snapshot)
      if (activeHandoff.current !== event.kind) return
      activeHandoff.current = undefined
      setReturnKind(event.kind)
      setAnnouncement(omniMindZhCN.permissions.returned[event.kind])
    })
    void bridge.getPermissions()
      .then((next) => { if (mounted) setSnapshot(next) })
      .catch(() => { if (mounted) setAnnouncement(omniMindZhCN.permissions.readFailed) })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false; unsubscribe() }
  }, [])

  const request = useCallback(async (kind: OmniMindPermissionKind): Promise<void> => {
    activeHandoff.current = kind
    setBusyKind(kind)
    setReturnKind(undefined)
    setAnnouncement(omniMindZhCN.permissions.requesting[kind])
    try { setSnapshot(await window.electronAPI.omniMind.requestPermission(kind)) }
    catch { setAnnouncement(omniMindZhCN.permissions.commandFailed) }
    finally { setBusyKind(undefined) }
  }, [])

  const openSettings = useCallback(async (kind: OmniMindPermissionKind): Promise<void> => {
    activeHandoff.current = kind
    setReturnKind(undefined)
    setAnnouncement(omniMindZhCN.permissions.opening[kind])
    try { await window.electronAPI.omniMind.openPermissionSettings(kind) }
    catch { setAnnouncement(omniMindZhCN.permissions.commandFailed) }
  }, [])

  const recheck = useCallback(async (kind: OmniMindPermissionKind): Promise<void> => {
    setBusyKind(kind)
    setAnnouncement(omniMindZhCN.permissions.checking)
    try {
      setSnapshot(await window.electronAPI.omniMind.recheckPermission(kind))
      setAnnouncement(omniMindZhCN.permissions.checked)
    } catch { setAnnouncement(omniMindZhCN.permissions.readFailed) }
    finally { setBusyKind(undefined) }
  }, [])

  return {
    snapshot,
    loading,
    busyKind,
    ready: snapshot.accessibility === 'granted' && snapshot.automation === 'granted',
    returnKind,
    announcement,
    request,
    openSettings,
    recheck
  }
}
