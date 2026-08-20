import type { DollActivity, DollRoleId } from './dollContracts'

export interface DollRolePreset {
  id: DollRoleId
  /** 围脖是四个实例唯一的强身份色，头、角、身体继续保持统一黑色轮廓。 */
  scarfColor: `#${string}`
  /** 仅用于 renderer 尚未收到首页状态之前的安全首帧。 */
  defaultActivity: DollActivity
  /** 每个岗位使用极小的节奏差，避免多个真实工作动画完全机械同步。 */
  motionPhase: number
}

/**
 * 四岗位的唯一视觉预设表。
 *
 * 新增岗位时只扩展预设和业务映射，不复制头部、双角、围脖、躯干或手臂 Mesh。
 * 后两席的默认姿态也明确表达“尚未接入”：洞察分析师休眠，任务技术员静态待机。
 */
export const DOLL_ROLE_PRESETS: Readonly<Record<DollRoleId, DollRolePreset>> = Object.freeze({
  data: Object.freeze({ id: 'data', scarfColor: '#22C55E', defaultActivity: 'standby', motionPhase: 0 }),
  ai: Object.freeze({ id: 'ai', scarfColor: '#EF4444', defaultActivity: 'standby', motionPhase: Math.PI / 2 }),
  insight: Object.freeze({ id: 'insight', scarfColor: '#0EA5E9', defaultActivity: 'sleeping', motionPhase: Math.PI }),
  tasks: Object.freeze({ id: 'tasks', scarfColor: '#EAB308', defaultActivity: 'standby', motionPhase: Math.PI * 1.5 })
})

export const DOLL_ROLE_IDS = Object.freeze(Object.keys(DOLL_ROLE_PRESETS) as DollRoleId[])

export function getDollRolePreset(id: DollRoleId): DollRolePreset {
  return DOLL_ROLE_PRESETS[id]
}

