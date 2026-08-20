import type { OmniMindRuntimeState } from '../../../../shared/omnimind/contracts'
import type { DataConnectionReadinessStatus } from '../../account/useDataConnectionReadiness'
import type { DollActivity, DollRoleId } from './dollContracts'

/**
 * 数据管理员只表达真实的安全读取状态。连接异常、账号缺失和读取失败统一停在警示姿态，
 * 绝不能因为页面仍可 hover 就播放“正在处理数据”的假动作。
 */
export function mapDataReadinessToDollActivity(status: DataConnectionReadinessStatus): DollActivity {
  if (status === 'checking') return 'checking'
  if (status === 'ready') return 'standby'
  return 'warning'
}

/**
 * AI 代班员的视觉活动由权威运行时状态单向派生。
 *
 * checking 与 working 被刻意分开：预检、启动和停止只显示检查姿态；只有主进程确认
 * runtimeState=running 时才允许打字循环，避免用过渡动画暗示任务已经在执行。
 */
export function mapOmniMindRuntimeToDollActivity(state: OmniMindRuntimeState): DollActivity {
  switch (state) {
    case 'validating':
    case 'starting':
    case 'stopping':
      return 'checking'
    case 'running':
      return 'working'
    case 'paused':
      return 'paused'
    case 'degraded':
    case 'failed':
      return 'warning'
    case 'stopped':
      return 'standby'
  }
}

/**
 * 尚未接入真实能力的两个岗位采用永久安全映射，不接收任何托管或数据运行态。
 * 这条纯函数同时作为未来扩展边界：能力正式接线之前，调用方无法把筹备席映射为 working。
 */
export function mapPlannedRoleToDollActivity(id: Extract<DollRoleId, 'insight' | 'tasks'>): DollActivity {
  return id === 'insight' ? 'sleeping' : 'standby'
}

