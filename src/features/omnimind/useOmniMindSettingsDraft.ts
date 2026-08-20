import { useCallback, useMemo, useReducer, useRef, useState } from 'react'
import type { OmniMindSettings, OmniMindSettingsInput } from '../../../shared/omnimind/contracts'
import {
  createOmniMindSettingsDraft,
  diffOmniMindSettings,
  toOmniMindSettingsInput,
  validateOmniMindSettingsDraft,
  type OmniMindSettingsDraft
} from '../../../shared/omnimind/settings-domain'

interface DraftState {
  saved: OmniMindSettings
  draft: OmniMindSettingsDraft
  revision: number
}

type DraftField = keyof OmniMindSettingsDraft
type DraftFieldRevisions = Record<DraftField, number>

export interface OmniMindSettingsSaveTransaction {
  input: OmniMindSettingsInput
  revision: number
}

type DraftAction =
  | { type: 'patch'; patch: Partial<OmniMindSettingsDraft>; revision: number }
  | { type: 'replace'; saved: OmniMindSettings; draft: OmniMindSettingsDraft; revision: number }

const reducer = (state: DraftState, action: DraftAction): DraftState => {
  if (action.type === 'patch') return { ...state, draft: { ...state.draft, ...action.patch }, revision: action.revision }
  return { saved: action.saved, draft: action.draft, revision: action.revision }
}

const createFieldRevisions = (): DraftFieldRevisions => ({
  pythonBaseUrl: 0,
  managedScope: 0,
  autoSend: 0,
  apiKeyDraft: 0,
  batchWindowMs: 0
})

const settingsFromTransaction = (previous: OmniMindSettings, input: OmniMindSettingsInput): OmniMindSettings => ({
  schemaVersion: 4,
  pythonBaseUrl: input.pythonBaseUrl,
  managedScope: input.managedScope,
  autoSend: input.autoSend,
  hasApiKey: previous.hasApiKey || Boolean(input.apiKeyDraft),
  batchWindowMs: input.batchWindowMs
})

export interface OmniMindSaveCompletion {
  cleanAfterSave: boolean
  retainedApiKeyDraft: boolean
}

/**
 * 弹窗的持久设置只通过这个控制器读写。焦点、标签页、权限请求和临时提示仍属于 UI/系统能力，
 * 不混入持久设置模型，从而明确“配置草稿”和“实时权限状态”的业务边界。
 */
export const useOmniMindSettingsDraft = (initialSettings: OmniMindSettings) => {
  const [state, dispatch] = useReducer(reducer, {
    saved: initialSettings,
    draft: createOmniMindSettingsDraft(initialSettings),
    revision: 0
  })
  // ref 在事件处理器中同步递增，避免 React 批量渲染期间 Promise 先返回而读到旧 revision。
  const revisionRef = useRef(0)
  const savedRef = useRef(initialSettings)
  const draftRef = useRef(createOmniMindSettingsDraft(initialSettings))
  const fieldRevisionsRef = useRef<DraftFieldRevisions>(createFieldRevisions())
  const [knownOfficialSessionIds, setKnownOfficialSessionIds] = useState<ReadonlySet<string>>(new Set())
  const differences = useMemo(() => diffOmniMindSettings(state.saved, state.draft), [state.saved, state.draft])
  const validationIssues = useMemo(
    () => validateOmniMindSettingsDraft(state.draft, knownOfficialSessionIds),
    [knownOfficialSessionIds, state.draft]
  )

  const patch = useCallback((next: Partial<OmniMindSettingsDraft>): void => {
    const revision = revisionRef.current + 1
    revisionRef.current = revision
    draftRef.current = { ...draftRef.current, ...next }
    const fieldRevisions = { ...fieldRevisionsRef.current }
    for (const field of Object.keys(next) as DraftField[]) fieldRevisions[field] = revision
    fieldRevisionsRef.current = fieldRevisions
    dispatch({ type: 'patch', patch: next, revision })
  }, [])
  const buildSaveTransaction = useCallback((): OmniMindSettingsSaveTransaction => ({
    input: toOmniMindSettingsInput(draftRef.current),
    revision: revisionRef.current
  }), [])
  const markSaved = useCallback((transaction: OmniMindSettingsSaveTransaction): OmniMindSaveCompletion => {
    const saved = settingsFromTransaction(savedRef.current, transaction.input)
    const committedDraft = createOmniMindSettingsDraft(saved)
    const currentDraft = draftRef.current
    const fieldRevisions = fieldRevisionsRef.current
    const mergedDraft = { ...committedDraft }
    // 每个字段独立判断是否在事务发出后又被编辑：未再修改的提交值归入 baseline，
    // 只有真正的后续输入才留在草稿。尤其 Key 已提交但只改了其他字段时必须清空明文草稿。
    for (const field of Object.keys(fieldRevisions) as DraftField[]) {
      if (fieldRevisions[field] > transaction.revision) {
        ;(mergedDraft as Record<DraftField, OmniMindSettingsDraft[DraftField]>)[field] = currentDraft[field]
      }
    }
    savedRef.current = saved
    draftRef.current = mergedDraft
    dispatch({ type: 'replace', saved, draft: mergedDraft, revision: revisionRef.current })
    const cleanAfterSave = !diffOmniMindSettings(saved, mergedDraft).dirty
    return {
      cleanAfterSave,
      retainedApiKeyDraft: fieldRevisions.apiKeyDraft > transaction.revision
    }
  }, [])
  const markKeyCleared = useCallback((revision: number): boolean => {
    const retainedApiKeyDraft = fieldRevisionsRef.current.apiKeyDraft > revision
    const saved = { ...savedRef.current, hasApiKey: false }
    const draft = retainedApiKeyDraft ? draftRef.current : { ...draftRef.current, apiKeyDraft: '' }
    savedRef.current = saved
    draftRef.current = draft
    dispatch({ type: 'replace', saved, draft, revision: revisionRef.current })
    return !retainedApiKeyDraft
  }, [])

  return {
    savedSettings: state.saved,
    draft: state.draft,
    hasApiKey: state.saved.hasApiKey,
    differences,
    dirty: differences.dirty,
    criticalDirty: differences.critical,
    validationIssues,
    revision: state.revision,
    patch,
    buildSaveTransaction,
    markSaved,
    markKeyCleared,
    setKnownOfficialSessionIds
  }
}
