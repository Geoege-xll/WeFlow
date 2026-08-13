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
  it('delays the loading skeleton until 300ms', async () => {
    vi.useFakeTimers()
    const contacts = deferred<{ success: boolean; contacts: [] }>()
    const sessions = deferred<{ success: boolean; sessions: [] }>()
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { chat: { getContacts: () => contacts.promise, getSessions: () => sessions.promise } } })
    render(<OmniMindManagedScopePicker value={{ mode: 'selected', conversations: [] }} ignoreOfficial={true} onChange={vi.fn()} />)
    expect(screen.queryByText('正在加载联系人…')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(299) })
    expect(screen.queryByText('正在加载联系人…')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(screen.getByText('正在加载联系人…')).toBeTruthy()
    contacts.resolve({ success: true, contacts: [] }); sessions.resolve({ success: true, sessions: [] })
    await act(async () => { await Promise.resolve() })
    vi.useRealTimers()
  })

  it('retains unavailable selected rows after loading fails', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { chat: {
      getContacts: async () => ({ success: false, error: 'failed' }), getSessions: async () => ({ success: false, error: 'failed' })
    } } })
    const onChange = vi.fn()
    render(<OmniMindManagedScopePicker value={{ mode: 'selected', conversations: [{ sessionId: 'missing', displayName: 'Missing customer' }] }} ignoreOfficial={true} onChange={onChange} />)
    await screen.findByRole('alert')
    expect(screen.getByText('Missing customer')).toBeTruthy()
    expect(screen.getByText('联系人暂不可用')).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/Missing customer/))
    expect(onChange).toHaveBeenCalledWith({ mode: 'selected', conversations: [] })
  })

  it('requires all-mode confirmation and re-enables official rows when the filter is off', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { chat: {
      getContacts: async () => ({ success: true, contacts: [{ username: 'official', displayName: 'Service', type: 'official' as const }] }),
      getSessions: async () => ({ success: true, sessions: [] })
    } } })
    const onChange = vi.fn()
    const { rerender } = render(<OmniMindManagedScopePicker value={{ mode: 'selected', conversations: [] }} ignoreOfficial={true} onChange={onChange} />)
    await screen.findByText('Service')
    expect((screen.getByLabelText(/Service/) as HTMLInputElement).disabled).toBe(true)
    rerender(<OmniMindManagedScopePicker value={{ mode: 'selected', conversations: [] }} ignoreOfficial={false} onChange={onChange} />)
    expect((screen.getByLabelText(/Service/) as HTMLInputElement).disabled).toBe(false)
    fireEvent.click(screen.getByLabelText('全部联系人'))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'all', confirmedAt: 0 })
    rerender(<OmniMindManagedScopePicker value={{ mode: 'all', confirmedAt: 0 }} ignoreOfficial={false} onChange={onChange} />)
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
    render(<OmniMindManagedScopePicker value={{ mode: 'selected', conversations: [] }} ignoreOfficial={true} onChange={onChange} />)
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
    render(<OmniMindManagedScopePicker value={{ mode: 'all', confirmedAt: 1 }} ignoreOfficial={true} onChange={vi.fn()} />)
    expect(await screen.findByText('当前无法估算覆盖数')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('无法加载联系人')
  })

  it('debounces search for 200ms and bounds large result rendering', async () => {
    vi.useFakeTimers()
    const contacts = Array.from({ length: 55 }, (_, index) => ({ username: `user-${index}`, displayName: index === 54 ? 'Unique target' : `Customer ${index}`, type: 'friend' as const }))
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { chat: {
      getContacts: async () => ({ success: true, contacts }), getSessions: async () => ({ success: true, sessions: [] })
    } } })
    render(<OmniMindManagedScopePicker value={{ mode: 'selected', conversations: [] }} ignoreOfficial={false} onChange={vi.fn()} />)
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
    render(<OmniMindManagedScopePicker value={{ mode: 'selected', conversations: [{ sessionId: 'official', displayName: 'Service' }, { sessionId: 'friend', displayName: 'Friend' }] }} ignoreOfficial={true} onChange={onChange} />)
    await screen.findByText(/已选官方账号将从有效托管范围排除/)
    fireEvent.click(screen.getByRole('button', { name: '确认移除已过滤的官方账号' }))
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'selected', conversations: [{ sessionId: 'friend', displayName: 'Friend' }] })
  })
})
