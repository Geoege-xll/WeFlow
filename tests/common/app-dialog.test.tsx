// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppDialog } from '../../src/components/common/AppDialog'

afterEach(cleanup)

describe('AppDialog accessibility contract', () => {
  it('labels, traps, dismisses, and restores focus after the application is interactive again', async () => {
    const openerRef = createRef<HTMLButtonElement>()
    const onClose = vi.fn()
    const { rerender } = render(<div id="root"><button ref={openerRef}>打开中心</button></div>)
    openerRef.current?.focus()

    rerender(<>
      <div id="root"><button ref={openerRef}>打开中心</button></div>
      <AppDialog
        open
        onClose={onClose}
        title="托管中心"
        subtitle="关闭不会停止托管"
        closeAriaLabel="关闭托管中心"
        openerRef={openerRef}
      >
        <button>首项</button><button>末项</button>
      </AppDialog>
    </>)

    const dialog = screen.getByRole('dialog', { name: '托管中心', description: '关闭不会停止托管' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭托管中心' })))

    const last = screen.getByRole('button', { name: '末项' })
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭托管中心' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()

    rerender(<>
      <div id="root"><button ref={openerRef}>打开中心</button></div>
      <AppDialog open={false} onClose={onClose} title="托管中心" openerRef={openerRef} />
    </>)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(document.activeElement).toBe(openerRef.current)
  })
})
