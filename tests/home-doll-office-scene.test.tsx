// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DollOfficeScene, type DollOfficeRole } from '../src/features/home/DollOfficeScene'
import { createOfficeWebGLRenderer } from '../src/features/home/officeWebGLRenderer'

const roles: DollOfficeRole[] = [
  { id: 'data', order: '01', title: '数据管理员', responsibility: '维护安全连接。', status: '数据已就绪', statusTitle: '数据可以安全读取', statusDescription: '只显示安全摘要。', tone: 'ready', activity: 'standby' },
  { id: 'ai', order: '02', title: 'AI 代班员', responsibility: '执行自动托管。', status: '正在值守', statusTitle: 'AI 代班员正在值守', statusDescription: '按真实队列串行执行。', tone: 'ready', activity: 'working' },
  { id: 'insight', order: '03', title: '洞察分析师', responsibility: '生成可核验洞察。', status: '筹备中', statusTitle: '筹备中 · 尚未接入', statusDescription: '不展示假指标。', tone: 'muted', activity: 'sleeping' },
  { id: 'tasks', order: '04', title: '任务技术员', responsibility: '执行可追踪任务。', status: '筹备中', statusTitle: '筹备中 · 尚未接入', statusDescription: '不展示假任务。', tone: 'muted', activity: 'standby' }
]

interface FakeWebGLFailure {
  createShaderAt?: number
  compileShaderAt?: number
  createProgram?: boolean
  linkProgram?: boolean
  uniformAt?: number
  createBufferAt?: number
}

const createFakeWebGL = (failure: FakeWebGLFailure = {}) => {
  const calls = {
    enable: vi.fn(),
    clear: vi.fn(),
    drawArrays: vi.fn(),
    uniformMatrix4fv: vi.fn(),
    uniform3fv: vi.fn(),
    clearColor: vi.fn(),
    shaderSource: vi.fn(),
    deleteShader: vi.fn(),
    deleteBuffer: vi.fn(),
    deleteProgram: vi.fn()
  }
  const resources = {
    shaders: [] as WebGLShader[],
    programs: [] as WebGLProgram[],
    buffers: [] as WebGLBuffer[]
  }
  let attribute = 0
  let shaderCreation = 0
  let shaderCompilation = 0
  let uniformLookup = 0
  let bufferCreation = 0
  const constants = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    TRIANGLES: 0x0004,
    DEPTH_TEST: 0x0b71,
    CULL_FACE: 0x0b44,
    BACK: 0x0405,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100
  }
  const gl = {
    ...constants,
    createShader: vi.fn((type: number) => {
      shaderCreation += 1
      if (failure.createShaderAt === shaderCreation) return null
      const shader = { resource: 'shader', id: shaderCreation, type } as unknown as WebGLShader
      resources.shaders.push(shader)
      return shader
    }), shaderSource: calls.shaderSource, compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => {
      shaderCompilation += 1
      return failure.compileShaderAt !== shaderCompilation
    }), getShaderInfoLog: vi.fn(() => 'shader_compile_failure'), deleteShader: calls.deleteShader,
    createProgram: vi.fn(() => {
      if (failure.createProgram) return null
      const program = { resource: 'program', id: resources.programs.length + 1 } as unknown as WebGLProgram
      resources.programs.push(program)
      return program
    }), attachShader: vi.fn(), linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true), getProgramInfoLog: vi.fn(() => ''), deleteProgram: calls.deleteProgram,
    getAttribLocation: vi.fn(() => attribute++), getUniformLocation: vi.fn(() => {
      uniformLookup += 1
      return failure.uniformAt === uniformLookup ? null : ({ resource: 'uniform', id: uniformLookup } as unknown as WebGLUniformLocation)
    }),
    createBuffer: vi.fn(() => {
      bufferCreation += 1
      if (failure.createBufferAt === bufferCreation) return null
      const buffer = { resource: 'buffer', id: bufferCreation } as unknown as WebGLBuffer
      resources.buffers.push(buffer)
      return buffer
    }), bindBuffer: vi.fn(), bufferData: vi.fn(), deleteBuffer: calls.deleteBuffer,
    viewport: vi.fn(), enable: calls.enable, cullFace: vi.fn(), clearColor: calls.clearColor, clear: calls.clear,
    useProgram: vi.fn(), uniform3fv: calls.uniform3fv, uniformMatrix4fv: calls.uniformMatrix4fv, uniform1f: vi.fn(),
    enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(), drawArrays: calls.drawArrays
  } as unknown as WebGLRenderingContext
  if (failure.linkProgram) vi.mocked(gl.getProgramParameter).mockReturnValue(false)
  return { gl, calls, constants, resources }
}

const expectDeletedOnce = (remove: ReturnType<typeof vi.fn>, resource: object): void => {
  expect(remove.mock.calls.filter(([candidate]) => candidate === resource)).toHaveLength(1)
}

const setCanvasSize = (canvas: HTMLCanvasElement, width = 640, height = 360): void => {
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: height })
  canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) })
}

let queuedFrames: FrameRequestCallback[]

beforeEach(() => {
  queuedFrames = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { queuedFrames.push(callback); return queuedFrames.length })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-mode')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const flushQueuedFrames = (): void => {
  const current = queuedFrames.splice(0)
  current.forEach((callback) => callback(16))
}

describe('首页 WebGL 玩偶办公室', () => {
  it('initializes depth-tested local WebGL geometry and renders four fixed stations', () => {
    const canvas = document.createElement('canvas')
    setCanvasSize(canvas)
    const { gl, calls, constants, resources } = createFakeWebGL()
    const onProjection = vi.fn()

    const renderer = createOfficeWebGLRenderer(canvas, { context: gl, onProjection })
    renderer.setSeats(roles.map((role) => ({ id: role.id, tone: role.tone, activity: role.activity, selected: role.id === 'ai' })))
    renderer.render(1000, true)

    expect(calls.enable).toHaveBeenCalledWith(constants.DEPTH_TEST)
    const shaderSources = calls.shaderSource.mock.calls.map(([, source]) => String(source)).join('\n')
    expect(shaderSources).toContain('vLight = 0.92 + diffuse * 0.08')
    expect(shaderSources).toContain('vec3 srgbToLinear')
    expect(shaderSources).toContain('vec3 linearToSrgb')
    expect(shaderSources).toContain('srgbToLinear(vColor) * vLight')
    expect(calls.clear).toHaveBeenCalledWith(constants.COLOR_BUFFER_BIT | constants.DEPTH_BUFFER_BIT)
    expect(calls.drawArrays.mock.calls.length).toBeGreaterThan(40)
    expect(onProjection).toHaveBeenCalledOnce()
    const modelMatrices = calls.uniformMatrix4fv.mock.calls
      .filter(([location]) => (location as unknown as { id?: number }).id === 1)
      .map(([, , matrix]) => Array.from(matrix as Float32Array))
    // 第一个 model 是 floor，第二个是 data 工位 desk；直接核验真实 drawObject 收到的矩阵，
    // 证明生产 render 路径确实消费合同 helper，而非测试只读一份常量表。
    expect(modelMatrices[1][12]).toBeCloseTo(-5.25, 6)
    expect(modelMatrices[1][13]).toBeCloseTo(1.8, 6)
    expect(modelMatrices[1][14]).toBeCloseTo(-6.5, 6)
    expect(modelMatrices[1][0]).toBeCloseTo(2.6, 6)
    expect(modelMatrices[1][5]).toBeCloseTo(0.08, 6)
    expect(modelMatrices[1][10]).toBeCloseTo(1.25, 6)
    // station primitive 的第 17 个对象是 data 桌牌底座；真实 model matrix 与集中合同一致。
    expect(modelMatrices[17][12]).toBeCloseTo(-5.25, 6)
    expect(modelMatrices[17][13]).toBeCloseTo(1.62, 6)
    expect(modelMatrices[17][14]).toBeCloseTo(-5.21, 6)
    expect(modelMatrices[17][0]).toBeCloseTo(0.95, 6)
    expect(modelMatrices[17][5]).toBeCloseTo(0.2, 6)
    expect(modelMatrices[17][10]).toBeCloseTo(0.04, 6)
    expect(calls.clearColor).toHaveBeenLastCalledWith(243 / 255, 238 / 255, 229 / 255, 1)
    const floorColor = calls.uniform3fv.mock.calls.find(([location]) => (location as unknown as { id?: number }).id === 3)?.[1] as Float32Array
    expect(floorColor[0]).toBeCloseTo(238 / 255, 5)
    expect(floorColor[1]).toBeCloseTo(231 / 255, 5)
    expect(floorColor[2]).toBeCloseTo(220 / 255, 5)
    const projection = onProjection.mock.calls[0][0]
    expect(renderer.hitTest(projection.data.x, projection.data.y)).toBe('data')
    renderer.setTheme('dark')
    renderer.render(1001, false)
    expect(calls.clearColor).toHaveBeenLastCalledWith(15 / 255, 23 / 255, 42 / 255, 1)
    renderer.setTheme('light')
    renderer.render(1002, false)
    expect(calls.clearColor).toHaveBeenLastCalledWith(243 / 255, 238 / 255, 229 / 255, 1)
    renderer.dispose()
    renderer.dispose()
    resources.shaders.forEach((shader) => expectDeletedOnce(calls.deleteShader, shader))
    resources.buffers.forEach((buffer) => expectDeletedOnce(calls.deleteBuffer, buffer))
    resources.programs.forEach((program) => expectDeletedOnce(calls.deleteProgram, program))
    expect(calls.deleteShader).toHaveBeenCalledTimes(2)
    expect(calls.deleteBuffer).toHaveBeenCalledTimes(4)
    expect(calls.deleteProgram).toHaveBeenCalledOnce()
  })

  it('projects a centered frontal two-by-two office and keeps every seat visible when the container narrows', () => {
    const canvas = document.createElement('canvas')
    setCanvasSize(canvas)
    const { gl } = createFakeWebGL()
    const onProjection = vi.fn()
    const renderer = createOfficeWebGLRenderer(canvas, { context: gl, onProjection })

    renderer.render(0, false)
    const projection = onProjection.mock.calls[0][0]
    const centerX = 640 / 2

    // 正面中轴相机必须让同排岗位水平、左右镜像；相同 X 的前后岗位必须同列。
    expect(projection.data.y).toBeCloseTo(projection.ai.y, 5)
    expect(projection.insight.y).toBeCloseTo(projection.tasks.y, 5)
    expect((projection.data.x + projection.ai.x) / 2).toBeCloseTo(centerX, 5)
    expect((projection.insight.x + projection.tasks.x) / 2).toBeCloseTo(centerX, 5)
    expect(projection.data.x).toBeCloseTo(projection.insight.x, 5)
    expect(projection.ai.x).toBeCloseTo(projection.tasks.x, 5)
    expect(projection.data.x).toBeLessThan(centerX)
    expect(projection.ai.x).toBeGreaterThan(centerX)
    // 后墙侧的 data/ai 是上排，靠观察者的 insight/tasks 是下排。
    expect(projection.insight.y).toBeGreaterThan(projection.data.y)

    setCanvasSize(canvas, 360, 640)
    renderer.resize(360, 640, 2)
    renderer.render(0, false)
    const narrowProjection = onProjection.mock.calls[1][0]
    Object.values(narrowProjection).forEach((point) => {
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(360)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThanOrEqual(640)
    })
    renderer.dispose()
  })

  it('rolls back shaders and program when compilation, program creation, or linking fails', () => {
    const canvas = document.createElement('canvas')
    setCanvasSize(canvas)

    const shaderCreationFailure = createFakeWebGL({ createShaderAt: 2 })
    expect(() => createOfficeWebGLRenderer(canvas, { context: shaderCreationFailure.gl, onProjection: vi.fn() })).toThrow('webgl_shader_create_failed')
    expect(shaderCreationFailure.resources.shaders).toHaveLength(1)
    expectDeletedOnce(shaderCreationFailure.calls.deleteShader, shaderCreationFailure.resources.shaders[0])
    expect(shaderCreationFailure.calls.deleteProgram).not.toHaveBeenCalled()

    const compileFailure = createFakeWebGL({ compileShaderAt: 1 })
    expect(() => createOfficeWebGLRenderer(canvas, { context: compileFailure.gl, onProjection: vi.fn() })).toThrow('shader_compile_failure')
    expect(compileFailure.resources.shaders).toHaveLength(1)
    expectDeletedOnce(compileFailure.calls.deleteShader, compileFailure.resources.shaders[0])
    expect(compileFailure.calls.deleteProgram).not.toHaveBeenCalled()

    const programFailure = createFakeWebGL({ createProgram: true })
    expect(() => createOfficeWebGLRenderer(canvas, { context: programFailure.gl, onProjection: vi.fn() })).toThrow('webgl_program_create_failed')
    programFailure.resources.shaders.forEach((shader) => expectDeletedOnce(programFailure.calls.deleteShader, shader))
    expect(programFailure.calls.deleteShader).toHaveBeenCalledTimes(2)
    expect(programFailure.calls.deleteProgram).not.toHaveBeenCalled()

    const linkFailure = createFakeWebGL({ linkProgram: true })
    expect(() => createOfficeWebGLRenderer(canvas, { context: linkFailure.gl, onProjection: vi.fn() })).toThrow('webgl_program_link_failed')
    linkFailure.resources.shaders.forEach((shader) => expectDeletedOnce(linkFailure.calls.deleteShader, shader))
    linkFailure.resources.programs.forEach((program) => expectDeletedOnce(linkFailure.calls.deleteProgram, program))
    expect(linkFailure.calls.deleteShader).toHaveBeenCalledTimes(2)
    expect(linkFailure.calls.deleteProgram).toHaveBeenCalledOnce()
  })

  it('rolls back the linked program on a missing uniform without deleting linked shaders twice', () => {
    const canvas = document.createElement('canvas')
    setCanvasSize(canvas)
    const failure = createFakeWebGL({ uniformAt: 1 })

    expect(() => createOfficeWebGLRenderer(canvas, { context: failure.gl, onProjection: vi.fn() })).toThrow('webgl_uniform_unavailable:uModel')

    failure.resources.shaders.forEach((shader) => expectDeletedOnce(failure.calls.deleteShader, shader))
    failure.resources.programs.forEach((program) => expectDeletedOnce(failure.calls.deleteProgram, program))
    expect(failure.calls.deleteShader).toHaveBeenCalledTimes(2)
    expect(failure.calls.deleteProgram).toHaveBeenCalledOnce()
    expect(failure.calls.deleteBuffer).not.toHaveBeenCalled()
  })

  it('rolls back the first buffer when the second buffer cannot be created', () => {
    const canvas = document.createElement('canvas')
    setCanvasSize(canvas)

    const firstBufferFailure = createFakeWebGL({ createBufferAt: 1 })
    expect(() => createOfficeWebGLRenderer(canvas, { context: firstBufferFailure.gl, onProjection: vi.fn() })).toThrow('webgl_buffer_create_failed')
    expect(firstBufferFailure.resources.buffers).toHaveLength(0)
    expect(firstBufferFailure.calls.deleteBuffer).not.toHaveBeenCalled()
    firstBufferFailure.resources.programs.forEach((program) => expectDeletedOnce(firstBufferFailure.calls.deleteProgram, program))
    expect(firstBufferFailure.calls.deleteProgram).toHaveBeenCalledOnce()

    const failure = createFakeWebGL({ createBufferAt: 2 })

    expect(() => createOfficeWebGLRenderer(canvas, { context: failure.gl, onProjection: vi.fn() })).toThrow('webgl_buffer_create_failed')

    expect(failure.resources.buffers).toHaveLength(1)
    expectDeletedOnce(failure.calls.deleteBuffer, failure.resources.buffers[0])
    expect(failure.calls.deleteBuffer).toHaveBeenCalledOnce()
    failure.resources.programs.forEach((program) => expectDeletedOnce(failure.calls.deleteProgram, program))
    expect(failure.calls.deleteProgram).toHaveBeenCalledOnce()
    failure.resources.shaders.forEach((shader) => expectDeletedOnce(failure.calls.deleteShader, shader))
    expect(failure.calls.deleteShader).toHaveBeenCalledTimes(2)
  })

  it('opens read-only cards for AI and every role, then restores focus on repeat and Escape', () => {
    const { gl } = createFakeWebGL()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gl)
    const { container } = render(<DollOfficeScene roles={roles} />)
    const canvas = container.querySelector('canvas') as HTMLCanvasElement
    setCanvasSize(canvas)
    flushQueuedFrames()

    const aiLabel = screen.getByRole('button', { name: '02 AI 代班员' })
    expect(aiLabel.textContent).toBe('02AI 代班员')
    expect(aiLabel.textContent).not.toContain('正在值守')
    fireEvent.click(aiLabel)
    const popover = container.querySelector('#home-office-role-popover') as HTMLElement
    expect(within(popover).getByRole('heading', { name: 'AI 代班员' })).toBeTruthy()
    expect(within(popover).queryByRole('button')).toBeNull()
    expect(within(popover).queryByRole('link')).toBeNull()
    expect(within(popover).queryByRole('textbox')).toBeNull()

    fireEvent.click(aiLabel)
    flushQueuedFrames()
    expect(container.querySelector('#home-office-role-popover')).toBeNull()
    expect(document.activeElement).toBe(aiLabel)

    const dataLabel = screen.getByRole('button', { name: '01 数据管理员' })
    fireEvent.click(dataLabel)
    fireEvent.keyDown(document, { key: 'Escape' })
    flushQueuedFrames()
    expect(container.querySelector('#home-office-role-popover')).toBeNull()
    expect(document.activeElement).toBe(dataLabel)

    ;(['insight', 'tasks'] as const).forEach((id) => {
      const role = roles.find((candidate) => candidate.id === id) as DollOfficeRole
      const label = screen.getByRole('button', { name: `${role.order} ${role.title}` })
      expect(label.textContent).not.toContain(role.status)
      fireEvent.click(label)
      expect(within(container.querySelector('#home-office-role-popover') as HTMLElement).getByRole('heading', { name: role.title })).toBeTruthy()
      fireEvent.click(label)
      expect(container.querySelector('#home-office-role-popover')).toBeNull()
    })
  })

  it('closes the card from a canvas blank click and provides a complete fallback when WebGL fails', () => {
    const { gl } = createFakeWebGL()
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gl)
    const { container, unmount } = render(<DollOfficeScene roles={roles} />)
    const canvas = container.querySelector('canvas') as HTMLCanvasElement
    setCanvasSize(canvas)
    flushQueuedFrames()
    fireEvent.click(screen.getByRole('button', { name: '03 洞察分析师' }))
    expect(container.querySelector('#home-office-role-popover')).not.toBeNull()
    fireEvent.click(canvas, { clientX: 1, clientY: 1 })
    expect(container.querySelector('#home-office-role-popover')).toBeNull()
    fireEvent(canvas, new Event('webglcontextlost', { cancelable: true }))
    expect(screen.getByText('二维安全模式')).toBeTruthy()
    unmount()

    getContext.mockReturnValue(null)
    const fallback = render(<DollOfficeScene roles={roles} />)
    expect(screen.getByText('二维安全模式')).toBeTruthy()
    const fallbackAi = screen.getByRole('button', { name: '02 AI 代班员' })
    expect(fallbackAi.textContent).toBe('02AI 代班员')
    expect(fallbackAi.textContent).not.toContain('正在值守')
    fireEvent.click(fallbackAi)
    const readOnlyCard = fallback.container.querySelector('#home-office-role-popover') as HTMLElement
    expect(within(readOnlyCard).getByText('按真实队列串行执行。')).toBeTruthy()
    expect(within(readOnlyCard).queryByRole('button')).toBeNull()
  })

  it('renders one static reduced-motion frame and pauses all frames while the page is hidden', () => {
    const reduced = createFakeWebGL()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(reduced.gl)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const visibleRender = render(<DollOfficeScene roles={roles} />)
    expect(reduced.calls.drawArrays.mock.calls.length).toBeGreaterThan(0)
    visibleRender.unmount()

    const hidden = createFakeWebGL()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(hidden.gl)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    render(<DollOfficeScene roles={roles} />)
    expect(hidden.calls.drawArrays).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  it('exposes no drag, wheel, zoom, rotate, or camera reset interaction handlers', () => {
    const sceneSource = readFile('../src/features/home/DollOfficeScene.tsx')
    expect(sceneSource).not.toMatch(/onWheel|onPointerDown|onPointerMove|onDrag/)
    expect(sceneSource).not.toMatch(/addEventListener\(['"](?:wheel|pointermove|pointerdown|mousemove)/)
    expect(sceneSource).not.toContain('resetCamera')
    expect(sceneSource).not.toContain('setZoom')
  })

  it('derives the studio and nameplate CSS variables from the shared visual contract', () => {
    const { gl } = createFakeWebGL()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gl)
    const { container } = render(<DollOfficeScene roles={roles} />)
    const scene = container.querySelector('.home-scene-zone') as HTMLElement
    expect(scene.style.getPropertyValue('--office-studio-background')).toBe('#F3EEE5')
    expect(scene.style.getPropertyValue('--office-nameplate-compact-width')).toBe('56px')
    expect(scene.style.getPropertyValue('--office-nameplate-desktop-width')).toBe('64px')
    expect(scene.style.getPropertyValue('--office-nameplate-translate-y')).toBe('-50%')
  })

  it('updates the 2D safe-mode studio through a real light-dark-light theme sequence', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const { container } = render(<DollOfficeScene roles={roles} />)
    const scene = container.querySelector('.home-scene-zone') as HTMLElement
    expect(screen.getByText('二维安全模式')).toBeTruthy()
    expect(scene.style.getPropertyValue('--office-studio-background')).toBe('#F3EEE5')

    document.documentElement.setAttribute('data-mode', 'dark')
    await waitFor(() => expect(scene.style.getPropertyValue('--office-studio-background')).toBe('#0F172A'))
    document.documentElement.setAttribute('data-mode', 'light')
    await waitFor(() => expect(scene.style.getPropertyValue('--office-studio-background')).toBe('#F3EEE5'))
  })

  it('coalesces container resizes, restores desktop backing size, and stops updates after unmount', () => {
    const { gl } = createFakeWebGL()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(gl)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 })

    let resizeCallback: ResizeObserverCallback | null = null
    const disconnect = vi.fn()
    class ControlledResizeObserver {
      constructor(callback: ResizeObserverCallback) { resizeCallback = callback }
      observe = vi.fn()
      disconnect = disconnect
      unobserve = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', ControlledResizeObserver)

    const view = render(<DollOfficeScene roles={roles} />)
    const canvas = view.container.querySelector('canvas') as HTMLCanvasElement
    const scene = view.container.querySelector('.home-scene-zone') as HTMLElement
    const pushSize = (width: number, height: number): void => {
      const rect = { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRectReadOnly
      resizeCallback?.([{ target: scene, contentRect: rect } as ResizeObserverEntry], {} as ResizeObserver)
    }

    // 同一帧快速到达的多个 contentRect 只应提交最后一组 764×420。
    pushSize(620, 360)
    pushSize(700, 390)
    pushSize(764, 420)
    flushQueuedFrames()
    expect(canvas.width).toBe(1528)
    expect(canvas.height).toBe(840)

    ;([[1000, 540], [560, 360], [764, 420]] as const).forEach(([width, height]) => {
      pushSize(width, height)
      flushQueuedFrames()
      expect(canvas.width).toBe(width * 2)
      expect(canvas.height).toBe(height * 2)
    })

    const finalWidth = canvas.width
    const finalHeight = canvas.height
    view.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
    pushSize(900, 500)
    flushQueuedFrames()
    expect(canvas.width).toBe(finalWidth)
    expect(canvas.height).toBe(finalHeight)
  })
})

function readFile(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}
