import * as THREE from 'three'
import { createDollModelFactory, type DollModelFactory, type DollModelInstance } from './dolls/createDollModel'
import { getDollRolePreset } from './dolls/dollRolePresets'
import { ThreeResourceOwnership, type ThreeDisposableResource } from './dolls/threeResourceOwnership'
import { calculateOfficeCameraFrustum, OFFICE_VISUAL_CONTRACT } from './officeCamera'
import {
  type OfficeSeatId,
  type OfficeSeatProjection,
  type OfficeSeatTone,
  type OfficeSeatRenderState,
  type OfficeThemeMode,
  type RendererOptions,
  type OfficeWebGLRenderer
} from './officeWebGLRenderer'

export {
  type OfficeSeatId,
  type OfficeSeatProjection,
  type OfficeSeatTone,
  type OfficeSeatRenderState,
  type OfficeThemeMode,
  type RendererOptions,
  type OfficeWebGLRenderer
}

interface SeatConfig {
  id: OfficeSeatId
  roleId: OfficeSeatId
  order: string
  name: string
  appType: string
  colorHex: `#${string}`
  gridPos: [number, number, number]
  isDefaultSleep?: boolean
}

const SEAT_CONFIGS: SeatConfig[] = [
  // 第一排（上）：左 01 数据管理员，右 02 AI 代班员
  { id: 'data', roleId: 'data', order: '01', name: '数据管理员', appType: '数据连接与安全通道', colorHex: getDollRolePreset('data').scarfColor, gridPos: [...OFFICE_VISUAL_CONTRACT.layout.seats.data] },
  { id: 'ai', roleId: 'ai', order: '02', name: 'AI 代班员', appType: 'AI 托管守护看板', colorHex: getDollRolePreset('ai').scarfColor, gridPos: [...OFFICE_VISUAL_CONTRACT.layout.seats.ai] },

  // 第二排（下）：左 03 洞察分析师（休眠态），右 04 任务技术员
  { id: 'insight', roleId: 'insight', order: '03', name: '洞察分析师', appType: 'DeepSeek 洞察推理', colorHex: getDollRolePreset('insight').scarfColor, gridPos: [...OFFICE_VISUAL_CONTRACT.layout.seats.insight], isDefaultSleep: true },
  { id: 'tasks', roleId: 'tasks', order: '04', name: '任务技术员', appType: '移动端多端调度', colorHex: getDollRolePreset('tasks').scarfColor, gridPos: [...OFFICE_VISUAL_CONTRACT.layout.seats.tasks] }
]

/**
 * Three.js renderer 的最小运行外壳。生产默认使用真实 WebGLRenderer；测试只替换 GPU 壳，
 * scene、camera、raycaster、模型工厂和所有 Object3D 仍使用真实 Three.js 对象。
 */
export interface OfficeThreeRendererShell extends ThreeDisposableResource {
  shadowMap: { enabled: boolean; type: THREE.ShadowMapType }
  outputColorSpace: THREE.ColorSpace
  toneMapping: THREE.ToneMapping
  toneMappingExposure: number
  setSize: (width: number, height: number, updateStyle?: boolean) => void
  setPixelRatio: (ratio: number) => void
  render: (scene: THREE.Scene, camera: THREE.Camera) => void
}

export type OfficeThreeResourceLabel =
  | 'renderer'
  | 'floor:geometry'
  | 'floor:material'
  | 'floor:shadow-geometry'
  | 'floor:shadow-material'
  | `seat:${OfficeSeatId}:${string}`

export interface OfficeThreeRendererDependencies {
  createRenderer?: (canvas: HTMLCanvasElement) => OfficeThreeRendererShell
  createCanvasTexture?: (canvas: HTMLCanvasElement) => THREE.CanvasTexture
  createDollFactory?: () => DollModelFactory
  /**
   * 初始化边界通知：生产不注入；测试可在“资源已经登记”之后抛错，证明 rollback
   * 覆盖尚未挂入 scene 的对象。它不暴露运行状态，也不会被 UI 传递。
   */
  afterResourceTracked?: (label: OfficeThreeResourceLabel, resource: ThreeDisposableResource) => void
}

export interface OfficeThreeRendererOptions extends RendererOptions {
  dependencies?: OfficeThreeRendererDependencies
}

function createMonitorTexture(
  config: SeatConfig,
  isIdle: boolean,
  createCanvasTexture: (canvas: HTMLCanvasElement) => THREE.CanvasTexture
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 640
  const ctx = canvas.getContext('2d')
  const finalizeTexture = (texture: THREE.CanvasTexture): THREE.CanvasTexture => {
    // Canvas 监视器内容本身按 sRGB 绘制；显式标注可避免 Three 在线性色彩空间中把屏幕压暗。
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    return texture
  }
  if (!ctx) return finalizeTexture(createCanvasTexture(canvas))

  if (isIdle) {
    // 纯黑关机待机屏 (Standby Mode)
    ctx.fillStyle = '#05070A'
    ctx.fillRect(0, 0, 1024, 640)

    ctx.strokeStyle = '#1E293B'
    ctx.lineWidth = 14
    ctx.strokeRect(16, 16, 992, 608)

    ctx.font = 'bold 38px "Fira Code", monospace'
    ctx.fillStyle = '#334155'
    ctx.textAlign = 'center'
    ctx.fillText('[ STANDBY - SLEEP MODE ]', 512, 310)

    ctx.font = '22px "Fira Code", monospace'
    ctx.fillStyle = '#1E293B'
    ctx.fillText('Agent Resting · Click to Connect', 512, 370)
  } else {
    // 亮蓝/多彩应用程序界面 (Vibrant Marvis Monitor Screens)
    ctx.fillStyle = '#0284C7'
    ctx.fillRect(0, 0, 1024, 640)

    // Top Header Bar
    ctx.fillStyle = '#0369A1'
    ctx.fillRect(0, 0, 1024, 76)

    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 26px "Fira Code", sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(`APP: ${config.appType} (${config.order} - ${config.name})`, 32, 48)

    ctx.font = '18px "Fira Code", monospace'
    ctx.fillStyle = '#BAE6FD'
    ctx.fillText('STATUS: ONLINE | LATENCY 12ms', 620, 48)

    // Main App Window Container
    ctx.fillStyle = '#F8FAFC'
    ctx.fillRect(24, 96, 976, 520)

    ctx.strokeStyle = '#E2E8F0'
    ctx.lineWidth = 4
    ctx.strokeRect(24, 96, 976, 520)

    if (config.id === 'data') {
      // 01 数据管理员: 天蓝背景 + 白色弹窗 + 进度滑块 + 绿色按钮
      ctx.fillStyle = '#0284C7'
      ctx.fillRect(50, 130, 924, 450)

      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(180, 190, 660, 330)
      ctx.strokeStyle = '#CBD5E1'
      ctx.lineWidth = 2
      ctx.strokeRect(180, 190, 660, 330)

      ctx.fillStyle = '#0284C7'
      ctx.font = 'bold 22px "Fira Code", sans-serif'
      ctx.fillText('数据读取与解密通道已就绪', 220, 245)

      ctx.fillStyle = '#64748B'
      ctx.font = '16px "Fira Code", monospace'
      ctx.fillText('已安全连接本地 SQLite 消息数据库', 220, 285)

      ctx.fillStyle = '#E2E8F0'
      ctx.fillRect(220, 340, 580, 14)
      ctx.fillStyle = '#0284C7'
      ctx.fillRect(220, 340, 420, 14)
      ctx.beginPath()
      ctx.arc(640, 347, 12, 0, Math.PI * 2)
      ctx.fillStyle = '#0284C7'
      ctx.fill()

      ctx.fillStyle = '#22C55E'
      ctx.fillRect(660, 430, 140, 48)
      ctx.fillStyle = '#FFFFFF'
      ctx.font = 'bold 18px "Fira Code", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('确认连接', 730, 460)
    } else if (config.id === 'ai') {
      // 02 AI 代班员: 浅蓝底色 + 白色完整数据看板 + 4 条彩色趋势折线
      ctx.fillStyle = '#F1F5F9'
      ctx.fillRect(50, 130, 220, 450)
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(280, 130, 694, 450)

      ctx.fillStyle = '#0F172A'
      ctx.font = 'bold 20px "Fira Code", sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('AI 智能代班总览看板', 310, 175)

      const colors = ['#EC4899', '#8B5CF6', '#3B82F6', '#10B981']
      colors.forEach((c, idx) => {
        ctx.strokeStyle = c
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.moveTo(320, 240 + idx * 75)
        ctx.lineTo(460, 220 + idx * 75)
        ctx.lineTo(600, 260 + idx * 75)
        ctx.lineTo(760, 210 + idx * 75)
        ctx.lineTo(920, 230 + idx * 75)
        ctx.stroke()
      })
    } else {
      // 04 任务技术员: 3 列彩色移动卡片应用预览
      ctx.fillStyle = '#0284C7'
      ctx.fillRect(50, 130, 924, 450)

      const cardColors = ['#F97316', '#06B6D4', '#8B5CF6']
      cardColors.forEach((c, idx) => {
        const cx = 120 + idx * 270
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(cx, 160, 240, 390)
        ctx.fillStyle = c
        ctx.fillRect(cx, 160, 240, 90)
        ctx.fillStyle = '#F1F5F9'
        ctx.fillRect(cx + 20, 275, 200, 24)
        ctx.fillRect(cx + 20, 315, 200, 18)
        ctx.fillRect(cx + 20, 345, 140, 18)
        ctx.fillStyle = c
        ctx.fillRect(cx + 20, 480, 200, 44)
      })
    }
  }

  return finalizeTexture(createCanvasTexture(canvas))
}

export function createOfficeThreeRenderer(canvas: HTMLCanvasElement, options: OfficeThreeRendererOptions): OfficeWebGLRenderer {
  const officeResources = new ThreeResourceOwnership()
  const dependencies = options.dependencies ?? {}
  const createCanvasTexture = dependencies.createCanvasTexture ?? ((source) => new THREE.CanvasTexture(source))
  const trackResource = <T extends ThreeDisposableResource>(resource: T, label: OfficeThreeResourceLabel): T => {
    // 必须先取得释放所有权，再通知测试注入点；即使通知抛错，外层 catch 也能完整 rollback。
    officeResources.track(resource)
    dependencies.afterResourceTracked?.(label, resource)
    return resource
  }
  let dollFactory: DollModelFactory | null = null

  try {
    let disposed = false
    let currentTheme: OfficeThemeMode = 'light'
    let seats: OfficeSeatRenderState[] = SEAT_CONFIGS.map((seat) => ({
    id: seat.id,
    tone: 'muted',
    activity: getDollRolePreset(seat.id).defaultActivity,
    selected: false
  }))
  let hoveredSeatId: string | null = null
  const jumpTimers: Partial<Record<OfficeSeatId, number>> = {}

  let viewportWidth = canvas.clientWidth || 640
  let viewportHeight = canvas.clientHeight || 360
  let viewportPixelRatio = Math.min(window.devicePixelRatio || 1, 2)

  const visual = OFFICE_VISUAL_CONTRACT
  type ThemeColorToken = keyof typeof visual.themes.light
  type ThemeColorMaterial = THREE.MeshStandardMaterial | THREE.MeshBasicMaterial
  const themedMaterials: Array<{ material: ThemeColorMaterial; token: ThemeColorToken; softLit: boolean }> = []
  const trackThemedMaterial = <T extends ThemeColorMaterial>(
    material: T,
    token: ThemeColorToken,
    label: OfficeThreeResourceLabel,
    softLit = false
  ): T => {
    // 材质首先进入办公室资源 owner，再登记主题 token；初始化失败时仍由同一事务完整回滚。
    const tracked = trackResource(material, label)
    if (softLit && tracked instanceof THREE.MeshStandardMaterial) {
      tracked.emissive.set(visual.themes.light[token])
      tracked.emissiveIntensity = visual.scene.materialPolicy.softLitEmissiveIntensity.light
    }
    themedMaterials.push({ material: tracked, token, softLit })
    return tracked
  }

  // 1. 无边界暖米白摄影棚：背景负责清屏，雾把足够大的真实地面自然融入背景，不建立墙体或 DOM 遮罩。
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(visual.themes.light.wall)
  scene.fog = new THREE.FogExp2(visual.themes.light.fog, visual.scene.fogDensity)

  // 2. 固定 22° 正交机位：无 OrbitControls、无缩放、无拖拽，resize 只重新 fit 内容画框。
  const aspect = viewportWidth / Math.max(1, viewportHeight)
  const initialFrustum = calculateOfficeCameraFrustum(aspect)
  const camera = new THREE.OrthographicCamera(
    initialFrustum.left,
    initialFrustum.right,
    initialFrustum.top,
    initialFrustum.bottom,
    visual.camera.near,
    visual.camera.far
  )
  camera.position.set(...visual.camera.position)
  camera.lookAt(...visual.camera.target)

  // 3. WebGL Renderer。renderer 创建成功后立即登记，后续任意初始化异常都会释放它。
  const renderer = trackResource(
    dependencies.createRenderer?.(canvas) ?? new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'low-power'
    }),
    'renderer'
  )
  renderer.setPixelRatio(viewportPixelRatio)
  renderer.setSize(viewportWidth, viewportHeight, false)
  // Three 版本升级时默认色彩输出可能变化；这里锁定真实显示路径，防止暖米白 token 以线性值直接输出成脏灰。
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.toneMappingExposure = 1
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  // 4. Studio Lighting with Soft Left-Falling Shadows
  const ambientLight = new THREE.AmbientLight(visual.scene.ambientColor, visual.scene.ambientIntensity)
  ambientLight.name = 'OfficeAmbientLight'
  scene.add(ambientLight)

  const dirLight = new THREE.DirectionalLight(visual.scene.directionalColor, visual.scene.directionalIntensity)
  dirLight.name = 'OfficeDirectionalLight'
  dirLight.position.set(...visual.scene.directionalPosition)
  dirLight.castShadow = true
  dirLight.shadow.mapSize.set(2048, 2048)
  dirLight.shadow.camera.near = 0.5
  dirLight.shadow.camera.far = 150
  dirLight.shadow.camera.left = -22
  dirLight.shadow.camera.right = 22
  dirLight.shadow.camera.top = 22
  dirLight.shadow.camera.bottom = -22
  dirLight.shadow.bias = -0.0005
  dirLight.shadow.radius = 4
  scene.add(dirLight)

  // 5. 地面拆成“准确底色 + 独立阴影层”：Basic 底层不会被 PBR 整体压暗，ShadowMaterial 只叠加局部柔影。
  const floorGeo = trackResource(new THREE.PlaneGeometry(visual.scene.floor.fullSize[0], visual.scene.floor.fullSize[2]), 'floor:geometry')
  const floorMat = trackThemedMaterial(new THREE.MeshBasicMaterial({ color: visual.themes.light.floor }), 'floor', 'floor:material')
  const floorMesh = new THREE.Mesh(floorGeo, floorMat)
  floorMesh.name = 'OfficeFloor'
  floorMesh.rotation.x = -Math.PI / 2
  floorMesh.position.set(...visual.scene.floor.position)
  scene.add(floorMesh)

  const floorShadowGeo = trackResource(new THREE.PlaneGeometry(visual.scene.floor.fullSize[0], visual.scene.floor.fullSize[2]), 'floor:shadow-geometry')
  const floorShadowMat = trackResource(new THREE.ShadowMaterial({
    color: visual.themes.light.shadow,
    transparent: true,
    opacity: visual.scene.materialPolicy.floorShadowOpacity.light,
    depthWrite: false
  }), 'floor:shadow-material')
  const floorShadowMesh = new THREE.Mesh(floorShadowGeo, floorShadowMat)
  floorShadowMesh.name = 'OfficeFloorShadow'
  floorShadowMesh.rotation.x = -Math.PI / 2
  floorShadowMesh.position.set(
    visual.scene.floor.position[0],
    visual.scene.floor.position[1] + visual.scene.floor.shadowOffsetY,
    visual.scene.floor.position[2]
  )
  floorShadowMesh.receiveShadow = true
  scene.add(floorShadowMesh)

  // 6. 构建固定 2×2 四工位；桌椅与屏幕留在办公室层，玩偶本体交给独立工厂。
  const seatGroupMap = new Map<string, THREE.Group>()
  const ringMatMap = new Map<string, THREE.MeshBasicMaterial>()
  const dollModelMap = new Map<OfficeSeatId, DollModelInstance>()
  // 玩偶工厂保持独立资源所有者；办公室 owner 从不登记工厂的 geometry/material/texture。
  const activeDollFactory = dependencies.createDollFactory?.() ?? createDollModelFactory()
  dollFactory = activeDollFactory

    SEAT_CONFIGS.forEach((config) => {
    const group = new THREE.Group()
    group.name = config.id

    const isIdle = config.isDefaultSleep || false

    const workstation = visual.workstation

    // 桌椅比例直接读取集中合同，保证四席只复用一套 Web 已确认的造型参数。
    const deskGeo = trackResource(new THREE.BoxGeometry(...workstation.desk.size), `seat:${config.id}:desk-geometry`)
    const deskMat = trackThemedMaterial(new THREE.MeshStandardMaterial({ color: visual.themes.light.desk, roughness: 0.42, metalness: 0 }), 'desk', `seat:${config.id}:desk-material`, true)
    const desk = new THREE.Mesh(deskGeo, deskMat)
    desk.name = 'Desk'
    desk.position.set(...workstation.desk.position)
    desk.castShadow = true
    desk.receiveShadow = true
    group.add(desk)

    // Desk Rim (#E2E8F0)
    const rimGeo = trackResource(new THREE.BoxGeometry(...workstation.rim.size), `seat:${config.id}:rim-geometry`)
    const rimMat = trackThemedMaterial(new THREE.MeshStandardMaterial({ color: visual.themes.light.deskRim, roughness: 0.5 }), 'deskRim', `seat:${config.id}:rim-material`, true)
    const rim = new THREE.Mesh(rimGeo, rimMat)
    rim.name = 'DeskRim'
    rim.position.set(...workstation.rim.position)
    group.add(rim)

    // 4 Slim Legs
    const legGeo = trackResource(new THREE.CylinderGeometry(
      workstation.leg.fullSize[0] / 2,
      workstation.leg.fullSize[2] / 2,
      workstation.leg.fullSize[1],
      16
    ), `seat:${config.id}:leg-geometry`)
    const legMat = trackThemedMaterial(new THREE.MeshStandardMaterial({ color: visual.themes.light.structure, roughness: 0.58 }), 'structure', `seat:${config.id}:leg-material`, true)
    workstation.leg.positions.forEach(([lx, ly, lz]) => {
      const leg = new THREE.Mesh(legGeo, legMat)
      leg.position.set(lx, ly, lz)
      leg.castShadow = true
      group.add(leg)
    })

    // 3-tier Cabinet on right
    const cabinetGeo = trackResource(new THREE.BoxGeometry(...workstation.cabinet.size), `seat:${config.id}:cabinet-geometry`)
    const cabinetMat = trackThemedMaterial(new THREE.MeshStandardMaterial({ color: visual.themes.light.cabinet, roughness: 0.52 }), 'cabinet', `seat:${config.id}:cabinet-material`, true)
    const cabinet = new THREE.Mesh(cabinetGeo, cabinetMat)
    cabinet.name = 'Cabinet'
    cabinet.position.set(...workstation.cabinet.position)
    cabinet.castShadow = true
    group.add(cabinet)

    // Handles
    const handleGeo = trackResource(new THREE.BoxGeometry(...workstation.handle.fullSize), `seat:${config.id}:handle-geometry`)
    const handleMat = trackThemedMaterial(new THREE.MeshStandardMaterial({ color: visual.themes.light.handle, roughness: 0.5 }), 'handle', `seat:${config.id}:handle-material`, true)
    workstation.handle.positions.forEach(([hx, hy, hz]) => {
      const handle = new THREE.Mesh(handleGeo, handleMat)
      handle.position.set(hx, hy, hz)
      group.add(handle)
    })

    // Chair
    const chairGroup = new THREE.Group()
    chairGroup.position.set(...workstation.chair.position)
    const seatCushionGeo = trackResource(new THREE.BoxGeometry(...workstation.chair.cushionSize), `seat:${config.id}:chair-seat-geometry`)
    const chairMat = trackThemedMaterial(new THREE.MeshStandardMaterial({ color: visual.themes.light.chair, roughness: 0.62 }), 'chair', `seat:${config.id}:chair-material`, true)
    const seatCushion = new THREE.Mesh(seatCushionGeo, chairMat)
    seatCushion.name = 'ChairCushion'
    seatCushion.position.set(...workstation.chair.cushionPosition)
    seatCushion.castShadow = true
    chairGroup.add(seatCushion)

    const chairBackGeo = trackResource(new THREE.BoxGeometry(...workstation.chair.backSize), `seat:${config.id}:chair-back-geometry`)
    const chairBack = new THREE.Mesh(chairBackGeo, chairMat)
    chairBack.name = 'ChairBack'
    chairBack.position.set(...workstation.chair.backPosition)
    chairBack.castShadow = true
    chairGroup.add(chairBack)

    const chairBaseGeo = trackResource(new THREE.CylinderGeometry(
      workstation.chair.baseFullSize[0] / 2,
      workstation.chair.baseFullSize[2] / 2,
      workstation.chair.baseFullSize[1],
      16
    ), `seat:${config.id}:chair-base-geometry`)
    const chairBase = new THREE.Mesh(chairBaseGeo, legMat)
    chairBase.position.set(...workstation.chair.basePosition)
    chairGroup.add(chairBase)

    group.add(chairGroup)

    // 显示器保持垂直，固定 22° 镜头自然看到屏幕；不再额外倾斜造成透视错觉。
    const screenTexture = trackResource(createMonitorTexture(config, isIdle, createCanvasTexture), `seat:${config.id}:monitor-texture`)
    const monitorFrameGeo = trackResource(new THREE.BoxGeometry(...workstation.monitor.frameSize), `seat:${config.id}:monitor-frame-geometry`)
    const monitorFrameMat = trackThemedMaterial(new THREE.MeshStandardMaterial({ color: visual.themes.light.monitorFrame }), 'monitorFrame', `seat:${config.id}:monitor-frame-material`)
    const monitorFrame = new THREE.Mesh(monitorFrameGeo, monitorFrameMat)
    monitorFrame.name = 'MonitorFrame'
    monitorFrame.position.set(...workstation.monitor.framePosition)
    monitorFrame.castShadow = true
    group.add(monitorFrame)

    const screenPlaneGeo = trackResource(new THREE.PlaneGeometry(workstation.monitor.screenSize[0], workstation.monitor.screenSize[1]), `seat:${config.id}:monitor-screen-geometry`)
    const screenPlaneMat = trackResource(new THREE.MeshBasicMaterial({ map: screenTexture }), `seat:${config.id}:monitor-screen-material`)
    const screenPlane = new THREE.Mesh(screenPlaneGeo, screenPlaneMat)
    screenPlane.name = 'MonitorScreen'
    screenPlane.position.set(...workstation.monitor.screenPosition)
    group.add(screenPlane)

    const monitorStandGeo = trackResource(new THREE.CylinderGeometry(
      workstation.monitor.standFullSize[0] / 2,
      workstation.monitor.standFullSize[2] / 2,
      workstation.monitor.standFullSize[1],
      16
    ), `seat:${config.id}:monitor-stand-geometry`)
    const monitorStand = new THREE.Mesh(monitorStandGeo, legMat)
    monitorStand.name = 'MonitorStand'
    monitorStand.position.set(...workstation.monitor.standPosition)
    group.add(monitorStand)

    // 岗位牌是桌前沿的真实 3D 底座；DOM 只叠加清晰文字和键盘入口，不再绘制悬浮状态卡。
    const nameplate = visual.layout.nameplate
    const nameplateGeo = trackResource(new THREE.BoxGeometry(...nameplate.baseFullSize), `seat:${config.id}:nameplate-base-geometry`)
    const nameplateMat = trackThemedMaterial(new THREE.MeshStandardMaterial({
      color: visual.themes.light.nameplate,
      roughness: 0.62,
      metalness: 0.02
    }), 'nameplate', `seat:${config.id}:nameplate-base-material`, true)
    const nameplateBase = new THREE.Mesh(nameplateGeo, nameplateMat)
    nameplateBase.name = 'NameplateBase'
    nameplateBase.position.set(...nameplate.basePosition)
    nameplateBase.castShadow = true
    group.add(nameplateBase)

    const nameplateAccentGeo = trackResource(new THREE.BoxGeometry(...nameplate.accentFullSize), `seat:${config.id}:nameplate-accent-geometry`)
    const nameplateAccentMat = trackResource(new THREE.MeshStandardMaterial({
      color: config.colorHex,
      roughness: 0.48,
      metalness: 0.02
    }), `seat:${config.id}:nameplate-accent-material`)
    const nameplateAccent = new THREE.Mesh(nameplateAccentGeo, nameplateAccentMat)
    nameplateAccent.name = 'NameplateAccent'
    nameplateAccent.position.set(...nameplate.accentPosition)
    group.add(nameplateAccent)

    // 玩偶本体由唯一参数化工厂创建；办公室只负责把实例放进对应工位。
    const doll = activeDollFactory.create(config.id)
    group.add(doll.root)
    dollModelMap.set(config.id, doll)

    // Floor Hover Glow Ring
    const hoverRingGeo = trackResource(new THREE.RingGeometry(visual.layout.hoverRingInnerRadius, visual.layout.hoverRingOuterRadius, 32), `seat:${config.id}:hover-ring-geometry`)
    const ringMat = trackResource(new THREE.MeshBasicMaterial({
      color: config.colorHex,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide
    }), `seat:${config.id}:hover-ring-material`)
    ringMatMap.set(config.id, ringMat)
    const hoverRing = new THREE.Mesh(hoverRingGeo, ringMat)
    hoverRing.name = 'HoverRing'
    hoverRing.rotation.x = -Math.PI / 2
    hoverRing.position.y = 0.02
    group.add(hoverRing)

    group.position.set(config.gridPos[0], config.gridPos[1], config.gridPos[2])
    scene.add(group)
    seatGroupMap.set(config.id, group)
    })

  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2()
  const resizeViewport = (width: number, height: number, pixelRatio: number): void => {
    // ResizeObserver 偶尔会在隐藏/卸载边界给出 0 或 NaN；忽略该帧，保留最后一个有效画框。
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    const nextWidth = Math.max(1, width)
    const nextHeight = Math.max(1, height)
    const nextPixelRatio = Math.min(2, Math.max(1, Number.isFinite(pixelRatio) ? pixelRatio : 1))
    viewportWidth = nextWidth
    viewportHeight = nextHeight
    const nextFrustum = calculateOfficeCameraFrustum(nextWidth / nextHeight)
    camera.left = nextFrustum.left
    camera.right = nextFrustum.right
    camera.top = nextFrustum.top
    camera.bottom = nextFrustum.bottom
    camera.updateProjectionMatrix()
    if (nextPixelRatio !== viewportPixelRatio) {
      viewportPixelRatio = nextPixelRatio
      renderer.setPixelRatio(nextPixelRatio)
    }
    // updateStyle=false 保证 CSS 尺寸只由三区 grid 决定，renderer 只同步 GPU backing store。
    renderer.setSize(nextWidth, nextHeight, false)
  }
  // 到这里场景组装完整，办公室资源的唯一清理凭证正式移交给返回的 renderer。
  const disposeOfficeResources = officeResources.transfer()

  return {
    setSeats: (nextSeats: OfficeSeatRenderState[]) => {
      seats = nextSeats.map((s) => ({ ...s }))
    },
    setTheme: (nextTheme: OfficeThemeMode) => {
      if (currentTheme !== nextTheme) {
        currentTheme = nextTheme
        const palette = visual.themes[nextTheme]
        scene.background = new THREE.Color(palette.wall)
        scene.fog = new THREE.FogExp2(palette.fog, visual.scene.fogDensity)
        // 所有办公室材质通过 token 表一次性切换；玩偶角色色仍由玩偶工厂独立持有。
        themedMaterials.forEach(({ material, token, softLit }) => {
          material.color.set(palette[token])
          if (softLit && material instanceof THREE.MeshStandardMaterial) {
            material.emissive.set(palette[token])
            material.emissiveIntensity = visual.scene.materialPolicy.softLitEmissiveIntensity[nextTheme]
          }
        })
        floorShadowMat.color.set(palette.shadow)
        floorShadowMat.opacity = visual.scene.materialPolicy.floorShadowOpacity[nextTheme]
      }
    },
    resize: resizeViewport,
    setPointer: (x: number | null, y: number | null) => {
      if (x !== null && y !== null) {
        const rect = canvas.getBoundingClientRect()
        mouse.x = (x / rect.width) * 2 - 1
        mouse.y = -(y / rect.height) * 2 + 1
        raycaster.setFromCamera(mouse, camera)
        const intersects = raycaster.intersectObjects(Array.from(seatGroupMap.values()), true)
        if (intersects.length > 0) {
          let rootGroup: THREE.Object3D | null = intersects[0].object
          while (rootGroup && !seatGroupMap.has(rootGroup.name) && rootGroup.parent) {
            rootGroup = rootGroup.parent
          }
          if (rootGroup && seatGroupMap.has(rootGroup.name)) {
            hoveredSeatId = rootGroup.name
            return
          }
        }
      }
      hoveredSeatId = null
    },
    triggerJump: (seatId: OfficeSeatId) => {
      jumpTimers[seatId] = performance.now()
    },
    render: (timeMs: number, animate: boolean) => {
      if (disposed) return
      const curW = viewportWidth
      const curH = viewportHeight

      const elapsed = timeMs * 0.001

      // 工位 hover、玩偶活动和选中光环分别由各自职责层更新；业务状态不会进入模型工厂。
      seatGroupMap.forEach((group, seatId) => {
        const isHovered = hoveredSeatId === seatId
        const targetY = isHovered ? visual.layout.hoverLift : 0
        group.position.y += (targetY - group.position.y) * 0.12

        const seatState = seats.find((s) => s.id === seatId)
        const activity = seatState?.activity ?? getDollRolePreset(seatId as OfficeSeatId).defaultActivity
        dollModelMap.get(seatId as OfficeSeatId)?.update(activity, isHovered, elapsed, animate)

        const ringMat = ringMatMap.get(seatId)
        if (ringMat) {
          const targetRingOpacity = isHovered ? 0.85 : 0
          ringMat.opacity += (targetRingOpacity - ringMat.opacity) * 0.12
        }
      })

      renderer.render(scene, camera)

      // 将桌前 3D 牌面中心投影给 DOM 文本按钮；两层共享一个锚点，resize 时不会出现漂浮卡片。
      const projectionObj: Partial<Record<OfficeSeatId, { x: number; y: number }>> = {}
      SEAT_CONFIGS.forEach((config) => {
        if (config.roleId) {
          const group = seatGroupMap.get(config.id)
          if (group) {
            const pos = new THREE.Vector3(
              group.position.x + visual.layout.nameplate.projectionAnchor[0],
              group.position.y + visual.layout.nameplate.projectionAnchor[1],
              group.position.z + visual.layout.nameplate.projectionAnchor[2]
            )
            pos.project(camera)
            const screenX = ((pos.x + 1) * curW) / 2
            const screenY = ((-pos.y + 1) * curH) / 2
            projectionObj[config.roleId] = { x: screenX, y: screenY }
          }
        }
      })
      options.onProjection(projectionObj as OfficeSeatProjection)
    },
    hitTest: (clientX: number, clientY: number): OfficeSeatId | null => {
      const rect = canvas.getBoundingClientRect()
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const intersects = raycaster.intersectObjects(Array.from(seatGroupMap.values()), true)
      if (intersects.length > 0) {
        let rootGroup: THREE.Object3D | null = intersects[0].object
        while (rootGroup && !seatGroupMap.has(rootGroup.name) && rootGroup.parent) {
          rootGroup = rootGroup.parent
        }
        if (rootGroup && (rootGroup.name === 'data' || rootGroup.name === 'ai' || rootGroup.name === 'insight' || rootGroup.name === 'tasks')) {
          return rootGroup.name as OfficeSeatId
        }
      }
      return null
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      // 两个资源域各自持有唯一凭证；即使底层 GPU 清理失败，也不能阻断另一资源域。
      disposeOfficeResources()
      try {
        activeDollFactory.dispose()
      } catch {
        // 第三方/测试工厂的异常不应破坏 React context-lost 或卸载链路。
      }
      seatGroupMap.clear()
      dollModelMap.clear()
      ringMatMap.clear()
    }
  }
  } catch (error) {
    // 清理异常永远不能覆盖真正的组装错误；两个 owner 各自隔离底层 dispose 异常。
    try {
      dollFactory?.dispose()
    } catch {
      // 继续回滚办公室资源，并在最后原样重抛 error。
    }
    officeResources.rollback()
    throw error
  }
}
