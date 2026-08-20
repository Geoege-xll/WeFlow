// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDataConnectionReadiness } from '../src/features/account/useDataConnectionReadiness'
import { useAppStore } from '../src/stores/appStore'

const installConfigReader = (get: ReturnType<typeof vi.fn>): void => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      config: {
        get,
        set: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined)
      }
    }
  })
}

const ReadinessProbe = () => {
  const readiness = useDataConnectionReadiness()
  return <section>
    <output data-testid="status">{readiness.status}</output>
    <output data-testid="ready">{String(readiness.ready)}</output>
    <output data-testid="db-connected">{String(readiness.dbConnected)}</output>
    <output data-testid="account-identified">{String(readiness.accountIdentified)}</output>
    <button type="button" onClick={readiness.reload}>reload</button>
  </section>
}

afterEach(() => {
  cleanup()
  useAppStore.getState().reset()
})

describe('数据连接 readiness 单一业务模型', () => {
  it('does not keep a second persisted-account identity inside the runtime app store', () => {
    const runtimeState = useAppStore.getState() as unknown as Record<string, unknown>
    expect(runtimeState).not.toHaveProperty('myWxid')
    expect(runtimeState).not.toHaveProperty('setMyWxid')
  })

  it('combines the runtime database truth with the persisted account truth without exposing the ID', async () => {
    const persistedWxid = 'wxid_private_persisted'
    installConfigReader(vi.fn().mockResolvedValue(persistedWxid))
    useAppStore.setState({ isDbConnected: true })

    const { container } = render(<ReadinessProbe />)

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    expect(screen.getByTestId('ready').textContent).toBe('true')
    expect(screen.getByTestId('db-connected').textContent).toBe('true')
    expect(screen.getByTestId('account-identified').textContent).toBe('true')
    expect(container.textContent).not.toContain(persistedWxid)
  })

  it.each([
    ['a whitespace string', '   '],
    ['null', null],
    ['undefined', undefined]
  ])('fails closed as account-missing when the persisted identity is %s', async (_case, value) => {
    installConfigReader(vi.fn().mockResolvedValue(value))
    useAppStore.setState({ isDbConnected: true })

    render(<ReadinessProbe />)

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('account-missing'))
    expect(screen.getByTestId('ready').textContent).toBe('false')
    expect(screen.getByTestId('account-identified').textContent).toBe('false')
  })

  it.each([
    ['an object', { privateMarker: 'ipc-object-private-marker' }],
    ['an array', ['ipc-array-private-marker']],
    ['a boolean', true],
    ['a number', 987654321]
  ])('treats the invalid IPC runtime value %s as read-failed', async (_case, value) => {
    installConfigReader(vi.fn().mockResolvedValue(value))
    useAppStore.setState({ isDbConnected: true })

    const { container } = render(<ReadinessProbe />)

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('read-failed'))
    expect(screen.getByTestId('ready').textContent).toBe('false')
    expect(screen.getByTestId('account-identified').textContent).toBe('false')
    // 损坏配置只能影响安全状态，不能把可唯一识别的序列化内容或隐私标记带入界面。
    // boolean 的文本会与探针中真实的 dbConnected 布尔输出重合，因此它由上方三项状态断言覆盖。
    if (typeof value !== 'boolean') {
      expect(container.textContent).not.toContain(JSON.stringify(value))
    }
    if (typeof value === 'object' && value !== null) {
      expect(container.textContent).not.toContain('privateMarker' in value
        ? String(value.privateMarker)
        : String(value[0]))
    }
  })

  it('recovers from an invalid runtime value after an explicit reload without exposing either value', async () => {
    const invalidValue = { account: 'ipc-corrupt-private-value' }
    const recoveredWxid = 'wxid_private_recovered_after_reload'
    const get = vi.fn()
      .mockResolvedValueOnce(invalidValue)
      .mockResolvedValueOnce(recoveredWxid)
    installConfigReader(get)
    useAppStore.setState({ isDbConnected: true })

    const { container } = render(<ReadinessProbe />)

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('read-failed'))
    expect(screen.getByTestId('ready').textContent).toBe('false')
    expect(screen.getByTestId('account-identified').textContent).toBe('false')
    expect(container.textContent).not.toContain(invalidValue.account)

    fireEvent.click(screen.getByRole('button', { name: 'reload' }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    expect(screen.getByTestId('ready').textContent).toBe('true')
    expect(screen.getByTestId('account-identified').textContent).toBe('true')
    expect(container.textContent).not.toContain(invalidValue.account)
    expect(container.textContent).not.toContain(recoveredWxid)
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('keeps read failures distinct and supports an explicit fail-closed reload', async () => {
    const get = vi.fn()
      .mockRejectedValueOnce(new Error('private ipc detail'))
      .mockResolvedValueOnce('account-after-reload')
    installConfigReader(get)
    useAppStore.setState({ isDbConnected: true })

    render(<ReadinessProbe />)

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('read-failed'))
    expect(screen.getByTestId('ready').textContent).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'reload' }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('re-reads on wxid-changed and ignores an older slow result that resolves last', async () => {
    let resolveOld: ((value: string | null) => void) | undefined
    const oldRead = new Promise<string | null>((resolve) => { resolveOld = resolve })
    const get = vi.fn()
      .mockImplementationOnce(() => oldRead)
      .mockResolvedValueOnce('account-from-current-bundle')
    installConfigReader(get)
    useAppStore.setState({ isDbConnected: true })

    render(<ReadinessProbe />)
    await waitFor(() => expect(get).toHaveBeenCalledOnce())

    // detail 中即使携带另一个 ID 也只能作为刷新信号，不能直接成为身份真值。
    window.dispatchEvent(new CustomEvent('wxid-changed', { detail: { wxid: 'untrusted-event-detail' } }))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    resolveOld?.('')
    await Promise.resolve()
    await Promise.resolve()

    expect(screen.getByTestId('status').textContent).toBe('ready')
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('re-reads on window focus so a completed account guide can recover the homepage', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('account-created-in-guide')
    installConfigReader(get)
    useAppStore.setState({ isDbConnected: true })

    render(<ReadinessProbe />)
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('account-missing'))

    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'))
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('keeps the database-disconnected runtime truth authoritative', async () => {
    installConfigReader(vi.fn().mockResolvedValue('persisted-account'))
    useAppStore.setState({ isDbConnected: false })

    render(<ReadinessProbe />)

    await waitFor(() => expect(screen.getByTestId('account-identified').textContent).toBe('true'))
    expect(screen.getByTestId('status').textContent).toBe('disconnected')
    expect(screen.getByTestId('ready').textContent).toBe('false')
  })
})
