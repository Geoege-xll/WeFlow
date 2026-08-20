import { describe, expect, it } from 'vitest'
import { calculateInitialWindowBounds, NORMAL_WINDOW_HEIGHT, NORMAL_WINDOW_WIDTH } from '../electron/windowGeometry'

describe('main window geometry', () => {
  it('centers the normal target in a capable work area', () => {
    expect(calculateInitialWindowBounds({ x: 0, y: 0, width: 1920, height: 1080 })).toEqual({ x: 420, y: 200, width: NORMAL_WINDOW_WIDTH, height: NORMAL_WINDOW_HEIGHT, minWidth: 1080, minHeight: 680 })
  })

  it('preserves the target on an exactly capable work area', () => {
    expect(calculateInitialWindowBounds({ x: 100, y: 40, width: 1080, height: 680 })).toMatchObject({ x: 100, y: 40, width: 1080, height: 680, minWidth: 1080, minHeight: 680 })
  })

  it('clamps size and effective minimums to a smaller work area', () => {
    expect(calculateInitialWindowBounds({ x: 0, y: 0, width: 900, height: 600 })).toEqual({ x: 0, y: 0, width: 900, height: 600, minWidth: 900, minHeight: 600 })
  })
})
