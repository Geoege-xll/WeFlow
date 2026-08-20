// @vitest-environment jsdom
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDollModelFactory, type DollModelFactory } from '../src/features/home/dolls/createDollModel'
import { getDollRolePreset } from '../src/features/home/dolls/dollRolePresets'
import {
  createOfficeThreeRenderer,
  type OfficeThreeRendererDependencies,
  type OfficeThreeRendererShell,
  type OfficeThreeResourceLabel
} from '../src/features/home/officeThreeRenderer'
import type { OfficeSeatProjection, OfficeSeatRenderState } from '../src/features/home/officeWebGLRenderer'
import { OFFICE_VISUAL_CONTRACT } from '../src/features/home/officeCamera'

interface FakeRenderer extends OfficeThreeRendererShell {
  setSize: ReturnType<typeof vi.fn>
  setPixelRatio: ReturnType<typeof vi.fn>
  render: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  lastScene: THREE.Scene | null
  lastCamera: THREE.Camera | null
}

const createFakeRenderer = (disposeError?: Error): FakeRenderer => {
  const shell: FakeRenderer = {
    shadowMap: { enabled: false, type: THREE.BasicShadowMap },
    outputColorSpace: THREE.LinearSRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 0.5,
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    render: vi.fn((scene: THREE.Scene, camera: THREE.Camera) => {
      // 真实 WebGLRenderer.render 会在 raycaster 前刷新世界矩阵；fake GPU 壳只复刻这一必要行为。
      scene.updateMatrixWorld(true)
      camera.updateMatrixWorld(true)
      shell.lastScene = scene
      shell.lastCamera = camera
    }),
    dispose: vi.fn(() => {
      if (disposeError) throw disposeError
    }),
    lastScene: null,
    lastCamera: null
  }
  return shell
}

const createCanvasContext = (): CanvasRenderingContext2D => new Proxy({}, {
  get: (target, property) => {
    if (!(property in target)) Reflect.set(target, property, vi.fn())
    return Reflect.get(target, property)
  },
  set: (target, property, value) => Reflect.set(target, property, value)
}) as CanvasRenderingContext2D

const setCanvasSize = (canvas: HTMLCanvasElement, width = 764, height = 420): void => {
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: height })
  canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) })
}

const projectToCanvas = (point: THREE.Vector3, camera: THREE.Camera, canvas: HTMLCanvasElement): { x: number; y: number } => {
  const projected = point.clone().project(camera)
  return {
    x: ((projected.x + 1) * canvas.clientWidth) / 2,
    y: ((-projected.y + 1) * canvas.clientHeight) / 2
  }
}

const states: OfficeSeatRenderState[] = [
  { id: 'data', tone: 'working', activity: 'checking', selected: false },
  { id: 'ai', tone: 'ready', activity: 'working', selected: false },
  { id: 'insight', tone: 'muted', activity: 'sleeping', selected: true },
  { id: 'tasks', tone: 'muted', activity: 'standby', selected: true }
]

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(createCanvasContext())
})

afterEach(() => vi.restoreAllMocks())

describe('Three.js 四玩偶办公室生产组装', () => {
  it('runs the real scene/model/camera integration and animates only the working seat', () => {
    const canvas = document.createElement('canvas')
    setCanvasSize(canvas)
    const gpu = createFakeRenderer()
    const projections: OfficeSeatProjection[] = []
    const factory = createDollModelFactory()
    const officeResources: Array<{ label: OfficeThreeResourceLabel; resource: { dispose: () => void }; dispose: ReturnType<typeof vi.spyOn> }> = []
    const dependencies: OfficeThreeRendererDependencies = {
      createRenderer: () => gpu,
      createDollFactory: () => factory,
      afterResourceTracked: (label, resource) => {
        officeResources.push({ label, resource, dispose: vi.spyOn(resource, 'dispose') })
      }
    }

    const renderer = createOfficeThreeRenderer(canvas, { dependencies, onProjection: (projection) => projections.push(projection) })
    renderer.setSeats(states)
    renderer.render(0, true)

    const scene = gpu.lastScene as THREE.Scene
    const camera = gpu.lastCamera as THREE.OrthographicCamera
    expect(scene).toBeInstanceOf(THREE.Scene)
    expect(camera).toBeInstanceOf(THREE.OrthographicCamera)
    expect(projections).toHaveLength(1)
    expect(officeResources.every(({ resource }) => !factory.ownsResource(resource))).toBe(true)

    expect(gpu.outputColorSpace).toBe(THREE.SRGBColorSpace)
    expect(gpu.toneMapping).toBe(THREE.NoToneMapping)
    expect(gpu.toneMappingExposure).toBe(1)
    expect((scene.background as THREE.Color).getHexString().toUpperCase()).toBe('F3EEE5')
    expect(scene.fog).toBeInstanceOf(THREE.FogExp2)
    expect((scene.fog as THREE.FogExp2).density).toBe(OFFICE_VISUAL_CONTRACT.scene.fogDensity)
    expect(camera.position.toArray()).toEqual(OFFICE_VISUAL_CONTRACT.camera.position)
    const floor = scene.getObjectByName('OfficeFloor') as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
    const floorShadow = scene.getObjectByName('OfficeFloorShadow') as THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>
    expect(floor.geometry.parameters).toMatchObject({ width: 120, height: 120 })
    expect(floor.material.color.getHexString()).toBe('eee7dc')
    expect(floor.material).toBeInstanceOf(THREE.MeshBasicMaterial)
    expect(floorShadow.material).toBeInstanceOf(THREE.ShadowMaterial)
    expect(floorShadow.material.color.getHexString()).toBe('d8cec0')
    expect(floorShadow.material.opacity).toBe(0.12)
    expect(floorShadow.position.y).toBeCloseTo(-0.014, 8)
    expect(floorShadow.receiveShadow).toBe(true)
    expect((scene.getObjectByName('OfficeAmbientLight') as THREE.AmbientLight).intensity).toBe(1.15)
    expect((scene.getObjectByName('OfficeDirectionalLight') as THREE.DirectionalLight).intensity).toBe(0.55)

    const dataStation = scene.getObjectByName('data') as THREE.Group
    const desk = dataStation.getObjectByName('Desk') as THREE.Mesh<THREE.BoxGeometry>
    const monitor = dataStation.getObjectByName('MonitorFrame') as THREE.Mesh<THREE.BoxGeometry>
    const chair = dataStation.getObjectByName('ChairCushion') as THREE.Mesh<THREE.BoxGeometry>
    expect(desk.geometry.parameters).toMatchObject({ width: 5.2, height: 0.16, depth: 2.5 })
    expect((desk.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('faf7f0')
    expect((desk.material as THREE.MeshStandardMaterial).emissive.getHexString()).toBe('faf7f0')
    expect((desk.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0.18)
    expect(monitor.geometry.parameters).toMatchObject({ width: 3.4, height: 2.1, depth: 0.08 })
    expect(((monitor.material as THREE.MeshStandardMaterial).emissive).getHexString()).toBe('000000')
    expect(chair.geometry.parameters).toMatchObject({ width: 1.4, height: 0.15, depth: 1.4 })
    const nameplateBase = dataStation.getObjectByName('NameplateBase') as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
    const nameplateAccent = dataStation.getObjectByName('NameplateAccent') as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
    expect(nameplateBase.geometry.parameters).toMatchObject({ width: 1.9, height: 0.4, depth: 0.08 })
    expect(nameplateBase.position.toArray()).toEqual([0, 1.62, 1.29])
    expect(nameplateBase.material.color.getHexString()).toBe('faf7f0')
    expect(nameplateAccent.position.toArray()).toEqual([-0.79, 1.62, 1.335])
    expect(`#${nameplateAccent.material.color.getHexString()}`.toUpperCase()).toBe(getDollRolePreset('data').scarfColor.toUpperCase())
    expect(['data', 'ai', 'insight', 'tasks'].map((id) => (scene.getObjectByName(id) as THREE.Group).position.toArray())).toEqual([
      [-5.25, 0, -6.5],
      [5.25, 0, -6.5],
      [-5.25, 0, 6.5],
      [5.25, 0, 6.5]
    ])
    ;(['data', 'ai', 'tasks'] as const).forEach((id) => {
      const light = scene.getObjectByName(`Doll_${id}`)?.getObjectByName('RolePointLight') as THREE.PointLight
      expect(light).toBeInstanceOf(THREE.PointLight)
      expect(light.intensity).toBe(1.5)
      expect(light.distance).toBe(3.5)
      expect(light.position.toArray()).toEqual([0, 1, 0])
      expect(`#${light.color.getHexString()}`.toUpperCase()).toBe(getDollRolePreset(id).scarfColor.toUpperCase())
    })
    expect(scene.getObjectByName('Doll_insight')?.getObjectByName('RolePointLight')).toBeUndefined()

    // 主题只替换集中办公室材质；暗色 token 独立，切回亮色不会残留暗色或改动角色牌色标。
    renderer.setTheme('dark')
    renderer.render(1, false)
    expect((scene.background as THREE.Color).getHexString()).toBe('0f172a')
    expect(floor.material.color.getHexString()).toBe('0f172a')
    expect((desk.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('293340')
    expect((desk.material as THREE.MeshStandardMaterial).emissive.getHexString()).toBe('293340')
    expect((desk.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0)
    expect(floorShadow.material.color.getHexString()).toBe('080b0d')
    expect(floorShadow.material.opacity).toBe(0.18)
    expect(nameplateBase.material.color.getHexString()).toBe('293340')
    expect(`#${nameplateAccent.material.color.getHexString()}`.toUpperCase()).toBe(getDollRolePreset('data').scarfColor.toUpperCase())
    renderer.setTheme('light')
    renderer.render(2, false)
    expect((scene.background as THREE.Color).getHexString()).toBe('f3eee5')
    expect((scene.fog as THREE.FogExp2).color.getHexString()).toBe('f3eee5')
    expect(floor.material.color.getHexString()).toBe('eee7dc')
    expect((desk.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('faf7f0')
    expect((desk.material as THREE.MeshStandardMaterial).emissive.getHexString()).toBe('faf7f0')
    expect((desk.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0.18)
    expect((chair.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('e0d7ca')
    expect((chair.material as THREE.MeshStandardMaterial).emissive.getHexString()).toBe('e0d7ca')
    expect((chair.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0.18)
    expect(floorShadow.material.color.getHexString()).toBe('d8cec0')
    expect(floorShadow.material.opacity).toBe(0.12)

    const dataArm = scene.getObjectByName('Doll_data')?.getObjectByName('ArmLeft') as THREE.Mesh
    const aiArm = scene.getObjectByName('Doll_ai')?.getObjectByName('ArmLeft') as THREE.Mesh
    const tasksArm = scene.getObjectByName('Doll_tasks')?.getObjectByName('ArmLeft') as THREE.Mesh
    const insightArm = scene.getObjectByName('Doll_insight')?.getObjectByName('ArmLeft') as THREE.Mesh
    const dataStart = dataArm.rotation.x
    const aiStart = aiArm.rotation.x
    const tasksStart = tasksArm.rotation.x

    renderer.render(250, true)
    expect(aiArm.rotation.x).not.toBeCloseTo(aiStart, 6)
    expect(dataArm.rotation.x).toBeCloseTo(dataStart, 8)
    expect(tasksArm.rotation.x).toBeCloseTo(tasksStart, 8)
    expect(insightArm.visible).toBe(false)

    // 用真实正交相机投影玩偶头部并走 raycaster；hover 只抬升工位，不改变筹备席 activity。
    const tasksHead = scene.getObjectByName('Doll_tasks')?.getObjectByName('Head') as THREE.Mesh
    const tasksPoint = projectToCanvas(tasksHead.getWorldPosition(new THREE.Vector3()), camera, canvas)
    expect(renderer.hitTest(tasksPoint.x, tasksPoint.y)).toBe('tasks')
    renderer.setPointer?.(tasksPoint.x, tasksPoint.y)
    renderer.render(500, true)
    expect((scene.getObjectByName('tasks') as THREE.Group).position.y).toBeGreaterThan(0)
    expect(tasksArm.rotation.x).toBeCloseTo(tasksStart, 8)

    // resize 只更新固定正交画框；桌面→放大→紧凑→桌面恢复均消费容器 contentRect。
    const fixedCameraPosition = camera.position.clone()
    ;([[1000, 540], [560, 360], [764, 420]] as const).forEach(([nextWidth, nextHeight], index) => {
      setCanvasSize(canvas, nextWidth, nextHeight)
      renderer.resize(nextWidth, nextHeight, 3)
      renderer.render(750 + index, false)
      expect((camera.right - camera.left) / (camera.top - camera.bottom)).toBeCloseTo(nextWidth / nextHeight, 8)
      Object.values(projections.at(-1) as OfficeSeatProjection).forEach((point) => {
        expect(point.x).toBeGreaterThanOrEqual(0)
        expect(point.x).toBeLessThanOrEqual(nextWidth)
        expect(point.y).toBeGreaterThanOrEqual(0)
        expect(point.y).toBeLessThanOrEqual(nextHeight)
      })
    })
    expect(gpu.setPixelRatio).toHaveBeenLastCalledWith(2)
    expect(gpu.setSize).toHaveBeenLastCalledWith(764, 420, false)
    expect(camera.position).toEqual(fixedCameraPosition)

    // 同时覆盖办公室 owner 和独立玩偶 owner 的成功重复 dispose。
    const sharedHeadGeometry = (scene.getObjectByName('Head') as THREE.Mesh).geometry
    const scarfMaterial = (scene.getObjectByName('Scarf') as THREE.Mesh).material as THREE.Material
    const sleepSprite = scene.getObjectByName('Sleep_z') as THREE.Sprite
    const sleepMaterial = sleepSprite.material as THREE.SpriteMaterial
    const sleepTexture = sleepMaterial.map as THREE.Texture
    const sharedGeometryDispose = vi.spyOn(sharedHeadGeometry, 'dispose')
    const scarfDispose = vi.spyOn(scarfMaterial, 'dispose')
    const sleepMaterialDispose = vi.spyOn(sleepMaterial, 'dispose')
    const sleepTextureDispose = vi.spyOn(sleepTexture, 'dispose')

    renderer.dispose()
    renderer.dispose()

    officeResources.forEach(({ dispose }) => expect(dispose).toHaveBeenCalledOnce())
    expect(gpu.dispose).toHaveBeenCalledOnce()
    expect(sharedGeometryDispose).toHaveBeenCalledOnce()
    expect(scarfDispose).toHaveBeenCalledOnce()
    expect(sleepMaterialDispose).toHaveBeenCalledOnce()
    expect(sleepTextureDispose).toHaveBeenCalledOnce()
  })

  it.each([
    'seat:data:desk-material',
    'seat:data:monitor-texture'
  ] as const)('rolls back every owned resource after an interruption at %s', (failureLabel) => {
    const canvas = document.createElement('canvas')
    setCanvasSize(canvas)
    const cleanupError = new Error('cleanup_must_not_escape')
    const gpu = createFakeRenderer(cleanupError)
    const originalError = new Error(`original:${failureLabel}`)
    const tracked: Array<{ label: OfficeThreeResourceLabel; resource: { dispose: () => void }; dispose: ReturnType<typeof vi.spyOn> }> = []
    const dependencies: OfficeThreeRendererDependencies = {
      createRenderer: () => gpu,
      afterResourceTracked: (label, resource) => {
        const dispose = vi.spyOn(resource, 'dispose')
        tracked.push({ label, resource, dispose })
        if (label === failureLabel) throw originalError
      }
    }

    let thrown: unknown
    try {
      createOfficeThreeRenderer(canvas, { dependencies, onProjection: vi.fn() })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(originalError)
    expect(tracked.map(({ label }) => label)).toContain(failureLabel)
    tracked.forEach(({ dispose }) => expect(dispose).toHaveBeenCalledOnce())
    expect(gpu.dispose).toHaveBeenCalledOnce()
    if (failureLabel === 'seat:data:monitor-texture') {
      const texture = tracked.find(({ label }) => label === failureLabel)?.resource
      expect(texture).toBeInstanceOf(THREE.CanvasTexture)
    }
  })
})
