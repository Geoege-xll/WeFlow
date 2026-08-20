export const NORMAL_WINDOW_WIDTH = 1080
export const NORMAL_WINDOW_HEIGHT = 680
export const NORMAL_MIN_WIDTH = 1080
export const NORMAL_MIN_HEIGHT = 680

export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface InitialWindowBounds {
  x: number
  y: number
  width: number
  height: number
  minWidth: number
  minHeight: number
}

export const calculateInitialWindowBounds = (workArea: WorkArea): InitialWindowBounds => {
  const width = Math.min(NORMAL_WINDOW_WIDTH, Math.max(1, workArea.width))
  const height = Math.min(NORMAL_WINDOW_HEIGHT, Math.max(1, workArea.height))
  const minWidth = Math.min(NORMAL_MIN_WIDTH, width)
  const minHeight = Math.min(NORMAL_MIN_HEIGHT, height)
  return {
    x: workArea.x + Math.max(0, Math.floor((workArea.width - width) / 2)),
    y: workArea.y + Math.max(0, Math.floor((workArea.height - height) / 2)),
    width,
    height,
    minWidth,
    minHeight
  }
}
