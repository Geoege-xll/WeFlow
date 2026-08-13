import { describe, expect, it } from 'vitest'
import { calculateInitialWindowBounds, NORMAL_WINDOW_HEIGHT, NORMAL_WINDOW_WIDTH } from '../electron/windowGeometry'

describe('main window geometry', () => {
  it('centers the normal target in a capable work area', () => {
    expect(calculateInitialWindowBounds({ x: 0, y: 0, width: 1920, height: 1080 })).toEqual({ x: 320, y: 140, width: NORMAL_WINDOW_WIDTH, height: NORMAL_WINDOW_HEIGHT, minWidth: 1100, minHeight: 700 })
  })

  it('preserves the target on an exactly capable work area', () => {
    expect(calculateInitialWindowBounds({ x: 100, y: 40, width: 1280, height: 800 })).toMatchObject({ x: 100, y: 40, width: 1280, height: 800, minWidth: 1100, minHeight: 700 })
  })

  it('clamps size and effective minimums to a smaller work area', () => {
    expect(calculateInitialWindowBounds({ x: 0, y: 0, width: 900, height: 600 })).toEqual({ x: 0, y: 0, width: 900, height: 600, minWidth: 900, minHeight: 600 })
  })
})
