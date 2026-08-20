import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { calculateOfficeCameraFrustum, calculateOfficeNameplatePixelSize, OFFICE_VISUAL_CONTRACT } from '../src/features/home/officeCamera'
import {
  buildOfficeFallbackDollPrimitives,
  buildOfficeFallbackStationPrimitives
} from '../src/features/home/officeWebGLRenderer'

const createContractCamera = (width: number, height: number): THREE.OrthographicCamera => {
  const contract = OFFICE_VISUAL_CONTRACT.camera
  const frustum = calculateOfficeCameraFrustum(width / height)
  const camera = new THREE.OrthographicCamera(
    frustum.left,
    frustum.right,
    frustum.top,
    frustum.bottom,
    contract.near,
    contract.far
  )
  camera.position.set(...contract.position)
  camera.lookAt(...contract.target)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  return camera
}

const projectBounds = (width: number, height: number): THREE.Vector3[] => {
  const camera = createContractCamera(width, height)
  const { min, max } = OFFICE_VISUAL_CONTRACT.camera.contentBounds
  const projected: THREE.Vector3[] = []
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) projected.push(new THREE.Vector3(x, y, z).project(camera))
    }
  }
  return projected
}

describe('首页 3D 办公室集中视觉合同', () => {
  it('locks the approved 22-degree fixed orthographic camera without interactive state', () => {
    const { camera } = OFFICE_VISUAL_CONTRACT
    expect(camera.yawDegrees).toBe(0)
    expect(camera.pitchDegrees).toBe(22)
    expect(camera.position[0]).toBe(0)
    expect(camera.position[1]).toBeCloseTo(15.9869, 4)
    expect(camera.position[2]).toBe(34)
    expect(camera.target).toEqual([0, 2.25, 0])
    expect(camera.safeFrameRatio).toBe(0.88)

    const measuredPitch = Math.atan2(
      camera.position[1] - camera.target[1],
      camera.position[2] - camera.target[2]
    ) * 180 / Math.PI
    expect(measuredPitch).toBeCloseTo(22, 8)
  })

  it.each([[764, 420], [560, 360]] as const)('fits every content-bound corner inside %sx%s', (width, height) => {
    projectBounds(width, height).forEach((point) => {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(OFFICE_VISUAL_CONTRACT.camera.safeFrameRatio + 1e-6)
      expect(Math.abs(point.y)).toBeLessThanOrEqual(OFFICE_VISUAL_CONTRACT.camera.safeFrameRatio + 1e-6)
    })
  })

  it('safely falls back to a square aspect for invalid resize values', () => {
    const square = calculateOfficeCameraFrustum(1)
    expect(calculateOfficeCameraFrustum(Number.NaN)).toEqual(square)
    expect(calculateOfficeCameraFrustum(0)).toEqual(square)
    expect(calculateOfficeCameraFrustum(Number.POSITIVE_INFINITY)).toEqual(square)
  })

  it('keeps the OmniMindWeChat office in a centered two-column by two-row arrangement', () => {
    const seats = OFFICE_VISUAL_CONTRACT.layout.seats
    expect(seats.data).toEqual([-5.25, 0, -6.5])
    expect(seats.ai).toEqual([5.25, 0, -6.5])
    expect(seats.insight).toEqual([-5.25, 0, 6.5])
    expect(seats.tasks).toEqual([5.25, 0, 6.5])

    const camera = createContractCamera(764, 420)
    const projectSeat = (position: readonly [number, number, number]): THREE.Vector3 => new THREE.Vector3(
      position[0],
      OFFICE_VISUAL_CONTRACT.layout.nameplate.projectionAnchor[1],
      position[2] + OFFICE_VISUAL_CONTRACT.layout.nameplate.projectionAnchor[2]
    ).project(camera)
    const data = projectSeat(seats.data)
    const ai = projectSeat(seats.ai)
    const insight = projectSeat(seats.insight)
    const tasks = projectSeat(seats.tasks)
    expect(data.y).toBeCloseTo(ai.y, 8)
    expect(insight.y).toBeCloseTo(tasks.y, 8)
    expect(data.x).toBeCloseTo(insight.x, 8)
    expect(ai.x).toBeCloseTo(tasks.x, 8)
    expect(data.x).toBeCloseTo(-ai.x, 8)
  })

  it('locks the Web workstation, floor, light and doll proportions used by both renderers', () => {
    const { scene, workstation, doll } = OFFICE_VISUAL_CONTRACT
    expect(OFFICE_VISUAL_CONTRACT.themes.light).toMatchObject({
      wall: '#F3EEE5', fog: '#F3EEE5', floor: '#EEE7DC', desk: '#FAF7F0',
      structure: '#E2D9CC', chair: '#E0D7CA'
    })
    expect(OFFICE_VISUAL_CONTRACT.themes.dark.wall).toBe('#0F172A')
    expect(OFFICE_VISUAL_CONTRACT.themes.dark.desk).not.toBe(OFFICE_VISUAL_CONTRACT.themes.light.desk)
    expect(scene.fogDensity).toBe(0.005)
    expect(scene.ambientIntensity).toBe(1.15)
    expect(scene.directionalIntensity).toBe(0.55)
    expect(scene.fallbackLighting).toEqual({ base: 0.92, diffuse: 0.08 })
    expect(scene.materialPolicy).toEqual({
      softLitEmissiveIntensity: { light: 0.18, dark: 0 },
      floorShadowOpacity: { light: 0.12, dark: 0.18 }
    })
    expect(scene.floor).toMatchObject({ fullSize: [120, 0.02, 120], shadowOffsetY: 0.006 })
    expect(workstation.desk.size).toEqual([5.2, 0.16, 2.5])
    expect(workstation.rim.size).toEqual([5.22, 0.02, 2.52])
    expect(workstation.monitor.frameSize).toEqual([3.4, 2.1, 0.08])
    expect(workstation.chair.cushionSize).toEqual([1.4, 0.15, 1.4])
    expect(doll).toMatchObject({
      headRadius: 0.55,
      hornRadius: 0.12,
      hornHeight: 0.38,
      scarfRadius: 0.58,
      scarfTube: 0.1,
      torsoRadius: 0.65,
      torsoLength: 0.9,
      armHeight: 0.6
    })
    expect(doll.pointLight).toEqual({ intensity: 1.5, distance: 3.5, position: [0, 1, 0] })
  })

  it('extends only the desk width while preserving generous two-column clearance', () => {
    const { workstation, layout } = OFFICE_VISUAL_CONTRACT
    const columnDistance = layout.seats.ai[0] - layout.seats.data[0]
    expect(columnDistance - workstation.desk.size[0]).toBeCloseTo(5.3, 8)
    expect(workstation.desk.size[2]).toBe(2.5)
    expect(workstation.monitor.framePosition).toEqual([0, 3.1, -0.7])
    expect(OFFICE_VISUAL_CONTRACT.doll.normalPosition).toEqual([0, 1.4, 0.9])
    expect(layout.nameplate.baseFullSize[0]).toBeLessThan(workstation.desk.size[0])
    expect(layout.hoverRingOuterRadius * 2).toBeLessThan(columnDistance)
  })

  it('uses a controlled warm range for background, fog and floor without a cold wall token', () => {
    const toRgb = (hex: string): number[] => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
    const light = OFFICE_VISUAL_CONTRACT.themes.light
    const wall = toRgb(light.wall)
    const floor = toRgb(light.floor)
    expect(light.fog).toBe(light.wall)
    wall.forEach((channel, index) => expect(Math.abs(channel - floor[index])).toBeLessThanOrEqual(16))
    expect(wall[0]).toBeGreaterThanOrEqual(wall[2])
    expect(floor[0]).toBeGreaterThanOrEqual(floor[2])
  })

  it('keeps the gamma-aware fallback floor above the approved minimum even on an unlit face', () => {
    const floor = OFFICE_VISUAL_CONTRACT.themes.light.floor
    const baseLight = OFFICE_VISUAL_CONTRACT.scene.fallbackLighting.base
    const channels = [1, 3, 5].map((offset) => Number.parseInt(floor.slice(offset, offset + 2), 16) / 255)
    const toLinear = (value: number): number => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    const toSrgb = (value: number): number => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
    const rendered = channels.map((value) => Math.round(toSrgb(toLinear(value) * baseLight) * 255))
    expect(rendered).toEqual([229, 223, 212])
    ;[225, 218, 205].forEach((minimum, index) => expect(rendered[index]).toBeGreaterThanOrEqual(minimum))
  })

  it.each([[764, 420], [560, 360]] as const)('covers every fixed-camera corner ray with the real floor at %sx%s', (width, height) => {
    const camera = createContractCamera(width, height)
    const floor = OFFICE_VISUAL_CONTRACT.scene.floor
    const raycaster = new THREE.Raycaster()
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        raycaster.setFromCamera(new THREE.Vector2(x, y), camera)
        const distance = (floor.position[1] - raycaster.ray.origin.y) / raycaster.ray.direction.y
        const point = raycaster.ray.at(distance, new THREE.Vector3())
        expect(Math.abs(point.x - floor.position[0])).toBeLessThan(floor.fullSize[0] / 2)
        expect(Math.abs(point.z - floor.position[2])).toBeLessThan(floor.fullSize[2] / 2)
      }
    }
  })

  it.each([[764, 420], [560, 360]] as const)('keeps desktop-front nameplates complete and separate at %sx%s', (width, height) => {
    const camera = createContractCamera(width, height)
    const nameplate = OFFICE_VISUAL_CONTRACT.layout.nameplate
    const monitor = OFFICE_VISUAL_CONTRACT.workstation.monitor
    const labelSize = calculateOfficeNameplatePixelSize(width, height)
    const projectPoint = (point: THREE.Vector3): { x: number; y: number } => {
      const projected = point.project(camera)
      return { x: (projected.x + 1) * width / 2, y: (-projected.y + 1) * height / 2 }
    }
    const labelRects: Array<{ left: number; right: number; top: number; bottom: number }> = []

    Object.values(OFFICE_VISUAL_CONTRACT.layout.seats).forEach((seat) => {
      const labelPoint = projectPoint(new THREE.Vector3(
        seat[0] + nameplate.projectionAnchor[0],
        seat[1] + nameplate.projectionAnchor[1],
        seat[2] + nameplate.projectionAnchor[2]
      ))
      const monitorBottomY = projectPoint(new THREE.Vector3(
        seat[0] + monitor.framePosition[0],
        seat[1] + monitor.framePosition[1] - monitor.frameSize[1] / 2,
        seat[2] + monitor.framePosition[2]
      )).y
      const baseLeft = projectPoint(new THREE.Vector3(seat[0] - nameplate.baseFullSize[0] / 2, seat[1] + nameplate.basePosition[1], seat[2] + nameplate.basePosition[2]))
      const baseRight = projectPoint(new THREE.Vector3(seat[0] + nameplate.baseFullSize[0] / 2, seat[1] + nameplate.basePosition[1], seat[2] + nameplate.basePosition[2]))
      expect(Math.abs(labelSize[0] - (baseRight.x - baseLeft.x))).toBeLessThanOrEqual(6)
      const left = labelPoint.x + labelSize[0] * nameplate.dom.translateRatio[0]
      const top = labelPoint.y + labelSize[1] * nameplate.dom.translateRatio[1]
      // 桌牌必须位于显示器下方，至少留下 12px 净距；它不会再遮住屏幕或玩偶头部。
      expect(top - monitorBottomY).toBeGreaterThanOrEqual(12)
      labelRects.push({ left, right: left + labelSize[0], top, bottom: top + labelSize[1] })
    })

    labelRects.forEach((rect, index) => {
      // 精确复现生产 CSS 的中心投影与 translate(-50%,-50%)；四边都来自同一 DOM 合同。
      expect(rect.left).toBeGreaterThanOrEqual(nameplate.dom.viewportSafeMarginPx)
      expect(rect.right).toBeLessThanOrEqual(width - nameplate.dom.viewportSafeMarginPx)
      expect(rect.top).toBeGreaterThanOrEqual(nameplate.dom.viewportSafeMarginPx)
      expect(rect.bottom).toBeLessThanOrEqual(height - nameplate.dom.viewportSafeMarginPx)
      labelRects.slice(index + 1).forEach((candidate) => {
        const overlaps = rect.left < candidate.right && rect.right > candidate.left && rect.top < candidate.bottom && rect.bottom > candidate.top
        expect(overlaps).toBe(false)
      })
    })
  })

  it('derives fallback world transforms and half extents from the production contract helpers', () => {
    const station = buildOfficeFallbackStationPrimitives('ai')
    const desk = station.find((primitive) => primitive.id === 'desk')
    const monitor = station.find((primitive) => primitive.id === 'monitor-frame')
    const chair = station.find((primitive) => primitive.id === 'chair-cushion')
    expect(desk).toMatchObject({ worldPosition: [5.25, 1.8, -6.5], halfExtents: [2.6, 0.08, 1.25] })
    expect(monitor).toMatchObject({ worldPosition: [5.25, 3.1, -7.2], halfExtents: [1.7, 1.05, 0.04] })
    expect(chair).toMatchObject({ worldPosition: [5.25, 1.1, -5.3], halfExtents: [0.7, 0.075, 0.7] })
    expect(station.find((primitive) => primitive.id === 'nameplate-base')).toMatchObject({
      worldPosition: [5.25, 1.62, -5.21], halfExtents: [0.95, 0.2, 0.04], colorKey: 'nameplate'
    })

    const workingDoll = buildOfficeFallbackDollPrimitives('ai', 'working')
    expect(workingDoll.find((primitive) => primitive.id === 'doll-head')).toMatchObject({
      shape: 'sphere',
      worldPosition: [5.25, 2.8, -5.6],
      halfExtents: [0.55, 0.55, 0.55]
    })
    const leftArm = workingDoll.find((primitive) => primitive.id === 'doll-arm-0')
    expect(leftArm?.worldPosition[0]).toBeCloseTo(4.9, 8)
    expect(leftArm?.worldPosition[1]).toBeCloseTo(1.85, 8)
    expect(leftArm?.worldPosition[2]).toBeCloseTo(-5.8, 8)
    expect(leftArm?.halfExtents).toEqual([0.08, 0.3, 0.07])
    expect(buildOfficeFallbackDollPrimitives('insight', 'sleeping').some((primitive) => primitive.id.startsWith('doll-arm-'))).toBe(false)
  })
})
