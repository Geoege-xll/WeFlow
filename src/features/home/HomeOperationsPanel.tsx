import { AlertTriangle, Bot, Database, RefreshCw, Settings, Sparkles, Square, UserRoundCog, Wrench } from 'lucide-react'
import type { RefObject } from 'react'
import type { OfficeSeatTone } from './officeWebGLRenderer'

interface DataModuleModel {
  status: string
  tone: OfficeSeatTone
  title: string
  description: string
  account: string
  database: string
  key: string
  checking: boolean
  primaryLabel: string
  primaryKind: 'recheck' | 'recover'
  onRecheck: () => void
  onRecover: () => void
  onAccountManagement: () => void
}

interface AiModuleModel {
  status: string
  tone: OfficeSeatTone
  title: string
  description: string
  dataWarning?: { text: string; danger: boolean; action: string; disabled: boolean; onAction: () => void }
  commandError?: string
  primary?: { label: string; disabled: boolean; onClick: (opener: HTMLButtonElement) => void }
  canEnd: boolean
  endDisabled: boolean
  onEnd: (opener: HTMLButtonElement) => void
  settingsDisabled: boolean
  settingsRef: RefObject<HTMLButtonElement | null>
  onSettings: (opener: HTMLButtonElement) => void
  onPermissions?: (opener: HTMLButtonElement) => void
  onReload: () => void
}

/**
 * 左下固定操作区只承载“管理与操作”，与上方只读岗位卡、右侧任务队列严格分工。
 * 数据和托管模型均由 HomeWorkbench 基于既有 hooks 派生；此组件不读取 IPC、配置或 store，
 * 从而不会复制 readiness、权限或运行时状态机。
 */
export function HomeOperationsPanel({ data, ai }: { data: DataModuleModel; ai: AiModuleModel }) {
  return (
    <section className="home-zone home-operations-zone" aria-label="岗位操作区">
      <div className="home-operations-grid">
        <article className="home-ops-module home-data-module" aria-labelledby="home-data-module-title">
          <header className="home-module-header">
            <span className="home-module-index"><Database aria-hidden="true" /></span>
            <div><p>01 · 数据连接</p><h2 id="home-data-module-title">数据管理员</h2></div>
            <span className={`home-module-badge tone-${data.tone}`}>{data.status}</span>
          </header>
          <div className="home-module-status"><strong>{data.title}</strong><p>{data.description}</p></div>
          <dl className="home-data-facts" aria-label="安全连接摘要">
            <div><dt>账号</dt><dd>{data.account}</dd></div>
            <div><dt>数据库</dt><dd>{data.database}</dd></div>
            <div><dt>密钥</dt><dd>{data.key}</dd></div>
          </dl>
          <div className="home-module-actions">
            <button type="button" className="home-primary-action" disabled={data.checking} onClick={data.primaryKind === 'recheck' ? data.onRecheck : data.onRecover}><RefreshCw aria-hidden="true" />{data.primaryLabel}</button>
            <button type="button" onClick={data.onAccountManagement}><UserRoundCog aria-hidden="true" />账号管理</button>
          </div>
        </article>

        <article className="home-ops-module home-ai-module" aria-labelledby="home-ai-module-title">
          <header className="home-module-header">
            <span className="home-module-index"><Bot aria-hidden="true" /></span>
            <div><p>02 · 托管控制</p><h2 id="home-ai-module-title">AI 代班员</h2></div>
            <span className={`home-module-badge tone-${ai.tone}`}>{ai.status}</span>
          </header>
          <div className="home-module-status"><strong>{ai.title}</strong><p>{ai.description}</p></div>
          {ai.dataWarning && <div className={`home-module-alert ${ai.dataWarning.danger ? 'danger' : ''}`} role={ai.dataWarning.danger ? 'alert' : 'status'}><AlertTriangle aria-hidden="true" /><span>{ai.dataWarning.text}</span><button type="button" disabled={ai.dataWarning.disabled} onClick={ai.dataWarning.onAction}>{ai.dataWarning.action}</button></div>}
          {ai.commandError && <div className="home-module-alert danger" role="alert"><AlertTriangle aria-hidden="true" /><span>{ai.commandError}</span><button type="button" onClick={ai.onReload}>重新检查</button></div>}
          <div className="home-module-actions home-ai-actions">
            {ai.primary && <button type="button" className="home-primary-action" disabled={ai.primary.disabled} onClick={(event) => ai.primary?.onClick(event.currentTarget)}><Sparkles aria-hidden="true" />{ai.primary.label}</button>}
            {ai.canEnd && <button type="button" className="home-danger-action" disabled={ai.endDisabled} onClick={(event) => ai.onEnd(event.currentTarget)}><Square aria-hidden="true" />结束托管</button>}
            <button ref={ai.settingsRef} type="button" disabled={ai.settingsDisabled} onClick={(event) => ai.onSettings(event.currentTarget)}><Settings aria-hidden="true" />托管设置</button>
          </div>
        </article>

        <article className="home-ops-module home-extension-module" aria-labelledby="home-extension-module-title">
          <header className="home-module-header">
            <span className="home-module-index"><Wrench aria-hidden="true" /></span>
            <div><p>03 · 扩展</p><h2 id="home-extension-module-title">扩展工作位</h2></div>
          </header>
          <div className="home-extension-slots">
            <div><h3>洞察分析师</h3><span>筹备中</span><small>尚未接入真实分析能力</small></div>
            <div><h3>任务技术员</h3><span>筹备中</span><small>尚未接入真实任务能力</small></div>
          </div>
        </article>
      </div>
    </section>
  )
}
