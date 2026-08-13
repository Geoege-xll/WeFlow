import { useState, type RefObject } from 'react'
import { Settings, X } from 'lucide-react'
import type { OmniMindRuntimeState } from '../../../shared/omnimind/contracts'
import { omniMindZhCN } from './locale'

const stateText = (state: OmniMindRuntimeState): string => omniMindZhCN.hosting[state]

export interface OmniMindRuntimePresentation {
  active: boolean
  switchDisabled: boolean
  emptyText?: string
}

const runtimePresentation: Record<OmniMindRuntimeState, OmniMindRuntimePresentation> = {
  stopped: { active: false, switchDisabled: false, emptyText: omniMindZhCN.empty.stopped },
  validating: { active: false, switchDisabled: true, emptyText: omniMindZhCN.runtime.validatingEmpty },
  starting: { active: false, switchDisabled: true, emptyText: omniMindZhCN.runtime.startingEmpty },
  running: { active: true, switchDisabled: false, emptyText: omniMindZhCN.empty.running },
  degraded: { active: true, switchDisabled: false, emptyText: omniMindZhCN.runtime.degradedEmpty },
  stopping: { active: false, switchDisabled: true, emptyText: omniMindZhCN.runtime.stoppingEmpty },
  failed: { active: false, switchDisabled: false }
}

export const getOmniMindRuntimePresentation = (state: OmniMindRuntimeState): OmniMindRuntimePresentation => runtimePresentation[state]

export function OmniMindHostingHeader({
  state,
  loading = false,
  permissionReady = true,
  permissionExplanationOpen = false,
  permissionRequestBusy = false,
  onEnable,
  onDisable,
  onSettings,
  onOpenActiveModal,
  onClose,
  settingsButtonRef,
  switchRef
}: {
  state: OmniMindRuntimeState;
  loading?: boolean;
  permissionReady?: boolean;
  permissionExplanationOpen?: boolean;
  permissionRequestBusy?: boolean;
  onEnable: () => Promise<void>;
  onDisable: () => Promise<void>;
  onSettings: () => void;
  onOpenActiveModal?: () => void;
  onClose?: () => void;
  settingsButtonRef?: RefObject<HTMLButtonElement | null>;
  switchRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const presentation = getOmniMindRuntimePresentation(state)

  const toggle = async (): Promise<void> => {
    setBusy(true)
    setError(false)
    try {
      if (presentation.active) {
        if (onOpenActiveModal) {
          onOpenActiveModal()
        } else {
          await onDisable()
        }
      } else {
        await onEnable()
        onOpenActiveModal?.()
      }
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <header className={`omnimind-hosting-header runtime-${state}`}>
      <div className="omnimind-hosting-copy">
        <h2>{omniMindZhCN.queueTitle}</h2>
        <p aria-live="polite">
          <span className="omnimind-runtime-dot" aria-hidden="true" />
          <span>{loading ? omniMindZhCN.loading : stateText(state)}</span>
          <span className="omnimind-runtime-separator" aria-hidden="true">·</span>
          <span>{omniMindZhCN.queueContext}</span>
        </p>
      </div>
      <button
        ref={switchRef}
        type="button"
        role="switch"
        style={{ minWidth: 44, minHeight: 44 }}
        aria-label={omniMindZhCN.hosting.switch}
        aria-checked={presentation.active}
        aria-disabled="false"
        aria-describedby={!presentation.active && !permissionReady ? 'omnimind-takeover-permission-description' : undefined}
        aria-expanded={!presentation.active && !permissionReady ? permissionExplanationOpen : undefined}
        aria-controls={!presentation.active && !permissionReady ? 'omnimind-permission-jit' : undefined}
        aria-busy={busy || loading || permissionRequestBusy}
        disabled={busy || loading || permissionRequestBusy || presentation.switchDisabled}
        onClick={() => void toggle()}
      >
        <span className="omnimind-sr-only">{presentation.active ? omniMindZhCN.hosting.disable : omniMindZhCN.hosting.enable}</span>
      </button>
      <span id="omnimind-takeover-permission-description" className="omnimind-sr-only">{omniMindZhCN.permissions.jit.switchDescription}</span>
      <button
        ref={settingsButtonRef}
        type="button"
        style={{ minWidth: 44, minHeight: 44 }}
        aria-label={omniMindZhCN.hosting.settings}
        onClick={onSettings}
      >
        <Settings size={20} aria-hidden="true" />
      </button>
      {onClose && (
        <button
          type="button"
          style={{ minWidth: 44, minHeight: 44 }}
          aria-label="关闭任务队列"
          title="关闭任务队列"
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      )}
      {error && <p role="alert">{omniMindZhCN.hosting.commandFailed}</p>}
    </header>
  )
}
