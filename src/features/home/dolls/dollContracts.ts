/**
 * 首页四个固定数字员工的稳定身份。
 *
 * 这里刻意不出现数据库、账号或 OmniMind 运行时类型：渲染器只应该认识“哪一个
 * 玩偶”和“它当前采用什么中立姿态”，不能反向依赖业务状态机。
 */
export type DollRoleId = 'data' | 'ai' | 'insight' | 'tasks'

/**
 * renderer-neutral 的玩偶活动合同。
 *
 * - standby：安静值守，不播放打字动画；
 * - checking：正在检查/切换，只允许状态光变化，不伪装成执行任务；
 * - working：唯一允许播放循环打字动作的状态；
 * - paused：明确暂停，保持静止；
 * - warning：连接或运行异常，保持安全静止；
 * - sleeping：尚未接入能力的休眠姿态，可显示呼吸/睡眠提示，但不能打字。
 */
export type DollActivity = 'standby' | 'checking' | 'working' | 'paused' | 'warning' | 'sleeping'

