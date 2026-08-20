import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as configService from '../../services/config'
import { useAppStore } from '../../stores/appStore'

export type DataConnectionReadinessStatus = 'checking' | 'disconnected' | 'account-missing' | 'read-failed' | 'ready'

type AccountIdentityReadState = 'checking' | 'identified' | 'missing' | 'read-failed'

/**
 * 把持久配置 IPC 的真实返回值收敛为首页可消费的安全状态。
 *
 * `configService.getMyWxid()` 的 TypeScript 返回类型只是 renderer 侧声明，无法约束已经落盘的
 * 旧配置或主进程 IPC 在运行时真正返回的值，因此这里必须重新按 `unknown` 校验。只有 trim 后
 * 非空的字符串才代表已识别账号；null、undefined 与空白字符串表示账号尚未配置；对象、数组、
 * 布尔值、数字等所有结构损坏值都按读取失败处理。这里刻意不使用 String(value) 做宽松转换，
 * 既避免把损坏配置误判为账号，也保证真实值不会进入 React 状态、DOM 或错误文案。
 */
const classifyPersistedAccountIdentity = (value: unknown): AccountIdentityReadState => {
  if (value === null || value === undefined) return 'missing'
  if (typeof value !== 'string') return 'read-failed'
  return value.trim().length > 0 ? 'identified' : 'missing'
}

export interface DataConnectionReadiness {
  status: DataConnectionReadinessStatus
  ready: boolean
  dbConnected: boolean
  accountIdentified: boolean
  reload: () => void
}

/**
 * 聚合首页“数据是否可用于托管”的单一业务模型。
 *
 * 权威边界：运行时数据库连接只来自 useAppStore.isDbConnected；当前账号身份只来自
 * configService.getMyWxid() 对持久 account bundle 的读取。这里在 IPC 的 unknown 运行时边界
 * 严格校验后，仅派生“是否识别”的 boolean，绝不把真实 ID 返回给首页，也不把 ID 复制回
 * Zustand，从而避免第二份无人维护的身份真值在应用重启后失真。
 *
 * 每次刷新都会先进入 checking 并 fail closed。sequence 保证旧的慢请求无法覆盖较新的账号
 * 结果；卸载时同时递增序号并关闭 mounted 标记，防止异步回调写入已卸载组件。
 * `wxid-changed` 的 detail 只是一条“配置可能变化”的通知，身份仍必须重新读取持久配置。
 */
export function useDataConnectionReadiness(): DataConnectionReadiness {
  const dbConnected = useAppStore((state) => state.isDbConnected)
  const [identityState, setIdentityState] = useState<AccountIdentityReadState>('checking')
  const mountedRef = useRef(false)
  const sequenceRef = useRef(0)

  const reload = useCallback((): void => {
    const sequence = ++sequenceRef.current
    setIdentityState('checking')
    void configService.getMyWxid().then(
      (value) => {
        if (!mountedRef.current || sequence !== sequenceRef.current) return
        // 服务层的 TS 断言不是 IPC 运行时校验；先提升为 unknown，再做严格、默认拒绝的分类。
        const runtimeValue: unknown = value
        setIdentityState(classifyPersistedAccountIdentity(runtimeValue))
      },
      () => {
        if (!mountedRef.current || sequence !== sequenceRef.current) return
        setIdentityState('read-failed')
      }
    )
  }, [])

  useEffect(() => {
    mountedRef.current = true
    reload()

    const handleWxidChanged = (): void => reload()
    const handleFocus = (): void => reload()
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') reload()
    }

    window.addEventListener('wxid-changed', handleWxidChanged)
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      mountedRef.current = false
      sequenceRef.current += 1
      window.removeEventListener('wxid-changed', handleWxidChanged)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
    // 数据库从断开恢复为已连接时也重新读取持久账号，确保独立引导窗口完成后无需重载首页。
  }, [dbConnected, reload])

  return useMemo(() => {
    const status: DataConnectionReadinessStatus = !dbConnected
      ? 'disconnected'
      : identityState === 'identified'
        ? 'ready'
        : identityState === 'missing'
          ? 'account-missing'
          : identityState === 'read-failed'
            ? 'read-failed'
            : 'checking'
    return {
      status,
      ready: status === 'ready',
      dbConnected,
      accountIdentified: identityState === 'identified',
      reload
    }
  }, [dbConnected, identityState, reload])
}
