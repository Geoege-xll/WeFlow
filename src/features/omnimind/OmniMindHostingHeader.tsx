import { X } from 'lucide-react'
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
  paused: { active: true, switchDisabled: false, emptyText: omniMindZhCN.runtime.pausedEmpty },
  degraded: { active: true, switchDisabled: false, emptyText: omniMindZhCN.runtime.degradedEmpty },
  stopping: { active: false, switchDisabled: true, emptyText: omniMindZhCN.runtime.stoppingEmpty },
  failed: { active: false, switchDisabled: false }
}

export const getOmniMindRuntimePresentation = (state: OmniMindRuntimeState): OmniMindRuntimePresentation => runtimePresentation[state]

export function OmniMindHostingHeader({
  state,
  loading = false,
  onClose
}: {
  state: OmniMindRuntimeState;
  loading?: boolean;
  onClose?: () => void;
}) {
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
      {onClose && (
        <button
          type="button"
          aria-label="关闭任务队列"
          title="关闭任务队列"
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      )}
    </header>
  )
}
