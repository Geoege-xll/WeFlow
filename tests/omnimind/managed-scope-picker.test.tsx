// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OmniMindManagedScopePicker } from '../../src/features/omnimind/OmniMindManagedScopePicker'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('OmniMind managed scope picker', () => {
  it('shows the permanent official-account exclusion fact without any policy control', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { chat: {
      getContacts: async () => ({ success: true, contacts: [] }),
      getSessions: async () => ({ success: true, sessions: [] })
    } } })
    const onChange = vi.fn()
    render(<OmniMindManagedScopePicker
      value={{ mode: 'selected', conversations: [] }}
      onChange={onChange}
    />)

    expect(screen.getAllByText(/官方账号固定不回复/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /过滤官方账号/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /过滤官方账号/ })).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('delays the loading skeleton until 300ms', async () => {
    vi.useFakeTimers()
    const contacts = deferred<{ success: boolean; contacts: [] }>()
    const sessions = deferred<{ success: boolean; sessions: [] }>()
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { chat: { getContacts: () => contacts.promise, getSessions: () => sessions.promise } } })
    render(<OmniMindManagedScopePicker value={{ mode: 'selected', conversations: [] }} onChange={vi.fn()} />)
    expect(screen.queryByText('正在加载联系人与最近会话…')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(299) })
    expect(screen.queryByText('正在加载联系人与最近会话…')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(screen.getByText('正在加载联系人与最近会话…')).toBeTruthy()
    contacts.resolve({ success: true, contacts: [] }); sessions.resolve({ success: true, sessions: [] })
    await act(async () => { await Promise.resolve() })
    vi.useRealTimers()
  })

  it('retains unavailable selected rows after loading fails', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { chat: {
      getContacts: async () => ({ success: false, error: 'failed' }), getSessions: async () => ({ success: false, error: 'failed' })
    } } })
    const onChange = vi.fn()
    render(<OmniMindManagedScopePicker value={{ mode: 'selected', conversations: [{ sessionId: 'missing', displayName: 'Missing customer' }] }} onChange={onChange} />)
    await screen.findByRole('alert')
    expect(screen.getByText('Missing customer')).toBeTruthy()
    expect(screen.getByText('当前会话不可用于新增托管')).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/Missing customer/))
    expect(onChange).toHaveBeenCalledWith({ mode: 'selected', conversations: [] })
  })

  it('requires all-mode confirmation and disables official rows', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { chat: {
      getContacts: async () => ({ success: true, contacts: [{ username: 'official', displayName: 'Service', type: 'official' as const }] }),
      getSessions: async () => ({ success: true, sessions: [] })
    } } })
    const onChange = vi.fn()
    const { rerender } = render(<OmniMindManagedScopePicker value={{ mode: 'selected', conversations: [] }} onChange={onChange} />)
    await screen.findByText('Service')
    expect(screen.getAllByText(/官方账号固定不回复/).length).toBeGreaterThan(0)
    expect((screen.getByLabelText(/Service/) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('全部联系人'))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'all', confirmedAt: 0 })
    rerender(<OmniMindManagedScopePicker value={{ mode: 'all', confirmedAt: 0 }} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText(/我了解 AI/))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'all', confirmedAt: expect.any(Number) })
  })
  it('loads lite contacts with sessions and confirms selecting every hostable contact', async () => {
    const getContacts = vi.fn(async () => ({ success: true, contacts: [
      { username: 'alice', displayName: 'Alice', remark: '客户', type: 'friend' as const },
      { username: 'official', displayName: 'Service', type: 'official' as const }
    ] }))
    const getSessions = vi.fn(async () => ({ success: true, sessions: [{ username: 'alice', displayName: 'Alice recent', lastTimestamp: 10 }] }))
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { chat: { getContacts, getSessions } } })
    const onChange = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<OmniMindManagedScopePicker value={{ mode: 'selected', conversations: [] }} onChange={onChange} />)
    await screen.findByText('Alice')
    expect(getContacts).toHaveBeenCalledWith({ lite: true })
    fireEvent.click(screen.getByRole('button', { name: /全选全部可托管联系人/ }))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'selected', conversations: [{ sessionId: 'alice', displayName: 'Alice' }] })
    expect((screen.getByLabelText(/Service/) as HTMLInputElement).disabled).toBe(true)
    await waitFor(() => expect(getSessions).toHaveBeenCalledTimes(1))
  })

  it('reports unknown all-mode coverage when contact loading fails', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { chat: {
      getContacts: async () => ({ success: false }), getSessions: async () => ({ success: false })
    } } })
    render(<OmniMindManagedScopePicker value={{ mode: 'all', confirmedAt: 1 }} onChange={vi.fn()} />)
    expect(await screen.findByText('当前无法估算覆盖数')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('无法加载联系人')
  })

  it('debounces search for 200ms and bounds large result rendering', async () => {
    vi.useFakeTimers()
    const contacts = Array.from({ length: 55 }, (_, index) => ({ username: `user-${index}`, displayName: index === 54 ? 'Unique target' : `Customer ${index}`, type: 'friend' as const }))
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { chat: {
      getContacts: async () => ({ success: true, contacts }), getSessions: async () => ({ success: true, sessions: [] })
    } } })
    render(<OmniMindManagedScopePicker value={{ mode: 'selected', conversations: [] }} onChange={vi.fn()} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(document.querySelectorAll('.omnimind-contact-list > label').length).toBe(40)
    fireEvent.change(screen.getByLabelText(/搜索姓名/), { target: { value: 'Unique target' } })
    expect(screen.queryByText('Unique target')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(199) })
    expect(screen.queryByText('Unique target')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(screen.getByText('Unique target')).toBeTruthy()
  })

  it('lists and explicitly removes selected official accounts excluded by policy', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { chat: {
      getContacts: async () => ({ success: true, contacts: [{ username: 'official', displayName: 'Service', type: 'official' as const }, { username: 'friend', displayName: 'Friend', type: 'friend' as const }] }),
      getSessions: async () => ({ success: true, sessions: [] })
    } } })
    const onChange = vi.fn()
    render(<OmniMindManagedScopePicker value={{ mode: 'selected', conversations: [{ sessionId: 'official', displayName: 'Service' }, { sessionId: 'friend', displayName: 'Friend' }] }} onChange={onChange} />)
    await screen.findByText(/历史范围中的官方账号不会触发托管/)
    fireEvent.click(screen.getByRole('button', { name: '移除历史官方账号' }))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'selected', conversations: [{ sessionId: 'friend', displayName: 'Friend' }] })
  })

  it('merges contacts with session-only group/private/official rows by case-insensitive session identity', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { chat: {
      getContacts: async () => ({ success: true, contacts: [{ username: 'ALICE', displayName: '联系人名称优先', remark: '重点客户', type: 'friend' as const }] }),
      getSessions: async () => ({ success: true, sessions: [
        { username: 'alice', displayName: '最近会话名称', lastTimestamp: 30 },
        { username: 'team@chatroom', displayName: '项目群', lastTimestamp: 20 },
        { username: 'session-private', displayName: '仅会话私聊', lastTimestamp: 10 },
        { username: 'gh_notice', displayName: '服务通知', lastTimestamp: 5 }
      ] })
    } } })
    const onChange = vi.fn()
    const { container } = render(<OmniMindManagedScopePicker value={{ mode: 'selected', conversations: [] }} onChange={onChange} />)

    await screen.findByText('联系人名称优先')
    expect(screen.queryByText('最近会话名称')).toBeNull()
    expect(container.querySelectorAll('[aria-label="托管 联系人名称优先"]')).toHaveLength(1)
    expect((screen.getByLabelText('托管 项目群') as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByLabelText('托管 仅会话私聊') as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByLabelText('托管 服务通知') as HTMLInputElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '私聊' }))
    expect(screen.getByText('联系人名称优先')).toBeTruthy()
    expect(screen.getByText('仅会话私聊')).toBeTruthy()
    expect(screen.queryByText('项目群')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    fireEvent.click(screen.getByLabelText('托管 项目群'))
    fireEvent.click(screen.getByLabelText('托管 仅会话私聊'))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'selected', conversations: [
      { sessionId: 'team@chatroom', displayName: '项目群' },
      { sessionId: 'session-private', displayName: '仅会话私聊' }
    ] })
  })

  it('searches session ids and selects only hostable rows from the current filtered view', async () => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { chat: {
      getContacts: async () => ({ success: true, contacts: [] }),
      getSessions: async () => ({ success: true, sessions: [
        { username: 'alpha@chatroom', displayName: 'Alpha group', lastTimestamp: 2 },
        { username: 'beta-private-id', displayName: 'Beta', lastTimestamp: 1 },
        { username: 'gh_alpha', displayName: 'Alpha official', lastTimestamp: 3 }
      ] })
    } } })
    const onChange = vi.fn()
    render(<OmniMindManagedScopePicker value={{ mode: 'selected', conversations: [] }} onChange={onChange} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    fireEvent.change(screen.getByLabelText(/搜索姓名/), { target: { value: 'alpha' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    fireEvent.click(screen.getByRole('button', { name: /^全选当前 \(1\)$/ }))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'selected', conversations: [{ sessionId: 'alpha@chatroom', displayName: 'Alpha group' }] })
  })
})
