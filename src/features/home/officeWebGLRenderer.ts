import type { DollActivity, DollRoleId } from './dolls/dollContracts'
import { getDollRolePreset } from './dolls/dollRolePresets'
import {
  calculateOfficeCameraFrustum,
  fullSizeToHalfExtents,
  officeLocalToWorld,
  OFFICE_VISUAL_CONTRACT,
  type OfficeVector3
} from './officeCamera'

export type OfficeSeatId = DollRoleId
export type OfficeSeatTone = 'ready' | 'working' | 'warning' | 'danger' | 'muted'
export type OfficeThemeMode = 'light' | 'dark'

export interface OfficeSeatRenderState {
  id: OfficeSeatId
  tone: OfficeSeatTone
  /** 渲染器只消费中立活动，不再持有含糊且会产生双真值的 working 布尔值。 */
  activity: DollActivity
  selected: boolean
}

export type OfficeSeatProjection = Record<OfficeSeatId, { x: number; y: number }>

export interface OfficeWebGLRenderer {
  setSeats: (seats: OfficeSeatRenderState[]) => void
  setTheme: (theme: OfficeThemeMode) => void
  /** contentRect 是唯一尺寸真值；实现不得再从 window 或旧 backing store 反推布局。 */
  resize: (width: number, height: number, pixelRatio: number) => void
  render: (timeMs: number, animate: boolean) => void
  hitTest: (clientX: number, clientY: number) => OfficeSeatId | null
  dispose: () => void
}

export interface RendererOptions {
  onProjection: (projection: OfficeSeatProjection) => void
  /** 测试可注入受控上下文；生产始终由 canvas 按最小权限创建本地 WebGL。 */
  context?: WebGLRenderingContext
}

export type Vec3 = [number, number, number]
type Mat4 = Float32Array

interface Geometry {
  positionBuffer: WebGLBuffer
  normalBuffer: WebGLBuffer
  count: number
}

interface OfficeShaderLocations {
  position: number
  normal: number
  model: WebGLUniformLocation
  viewProjection: WebGLUniformLocation
  color: WebGLUniformLocation
  lightDirection: WebGLUniformLocation
  selected: WebGLUniformLocation
}

interface SceneObject {
  geometry: Geometry
  position: Vec3
  scale: Vec3
  rotation: Vec3
  color: Vec3
  selected: boolean
}

interface SeatDefinition {
  id: OfficeSeatId
  x: number
  z: number
}

export interface OfficeFallbackPrimitive {
  id: string
  shape: 'cube' | 'sphere'
  worldPosition: Vec3
  halfExtents: Vec3
  rotation: Vec3
  colorKey: 'desk' | 'deskRim' | 'trim' | 'chair' | 'cabinet' | 'handle' | 'doll' | 'monitorBezel' | 'screen' | 'nameplate' | 'role'
}

const SEATS: SeatDefinition[] = [
  { id: 'data', x: OFFICE_VISUAL_CONTRACT.layout.seats.data[0], z: OFFICE_VISUAL_CONTRACT.layout.seats.data[2] },
  { id: 'ai', x: OFFICE_VISUAL_CONTRACT.layout.seats.ai[0], z: OFFICE_VISUAL_CONTRACT.layout.seats.ai[2] },
  { id: 'insight', x: OFFICE_VISUAL_CONTRACT.layout.seats.insight[0], z: OFFICE_VISUAL_CONTRACT.layout.seats.insight[2] },
  { id: 'tasks', x: OFFICE_VISUAL_CONTRACT.layout.seats.tasks[0], z: OFFICE_VISUAL_CONTRACT.layout.seats.tasks[2] }
]

const asVec3 = (value: OfficeVector3): Vec3 => [value[0], value[1], value[2]]
const addLocalPositions = (first: OfficeVector3, second: OfficeVector3): Vec3 => [
  first[0] + second[0],
  first[1] + second[1],
  first[2] + second[2]
]

/**
 * 由唯一视觉合同生成 fallback 工位骨架。返回值直接进入 buildObjects，不是测试镜像；
 * 因此测试这些 worldPosition/halfExtents 等价于验证实际送入 model matrix 的基础变换。
 */
export function buildOfficeFallbackStationPrimitives(seatId: OfficeSeatId): OfficeFallbackPrimitive[] {
  const contract = OFFICE_VISUAL_CONTRACT
  const station = contract.workstation
  const seatPosition = contract.layout.seats[seatId]
  const primitives: OfficeFallbackPrimitive[] = []
  const add = (
    id: string,
    localPosition: OfficeVector3,
    fullSize: OfficeVector3,
    colorKey: OfficeFallbackPrimitive['colorKey'],
    shape: OfficeFallbackPrimitive['shape'] = 'cube'
  ): void => {
    primitives.push({
      id,
      shape,
      worldPosition: officeLocalToWorld(seatPosition, localPosition),
      halfExtents: fullSizeToHalfExtents(fullSize),
      rotation: [0, 0, 0],
      colorKey
    })
  }

  add('desk', station.desk.position, station.desk.size, 'desk')
  add('rim', station.rim.position, station.rim.size, 'deskRim')
  station.leg.positions.forEach((position, index) => add(`leg-${index}`, position, station.leg.fullSize, 'trim'))
  add('cabinet', station.cabinet.position, station.cabinet.size, 'cabinet')
  station.handle.positions.forEach((position, index) => add(`handle-${index}`, position, station.handle.fullSize, 'handle'))

  add('chair-cushion', addLocalPositions(station.chair.position, station.chair.cushionPosition), station.chair.cushionSize, 'chair')
  add('chair-back', addLocalPositions(station.chair.position, station.chair.backPosition), station.chair.backSize, 'chair')
  add('chair-base', addLocalPositions(station.chair.position, station.chair.basePosition), station.chair.baseFullSize, 'trim')
  add('monitor-frame', station.monitor.framePosition, station.monitor.frameSize, 'monitorBezel')
  add('monitor-screen', station.monitor.screenPosition, station.monitor.screenSize, 'screen')
  add('monitor-stand', station.monitor.standPosition, station.monitor.standFullSize, 'trim')
  // fallback 仍绘制真实牌底与角色色标，DOM 文字投影在同一中心上，语义与 Three 主场景一致。
  add('nameplate-base', contract.layout.nameplate.basePosition, contract.layout.nameplate.baseFullSize, 'nameplate')
  add('nameplate-accent', contract.layout.nameplate.accentPosition, contract.layout.nameplate.accentFullSize, 'role')
  return primitives
}

/**
 * 从合同生成岗位玩偶的静态基础姿态；animation 只允许在 buildObjects 中叠加手臂角度和微跳，
 * 不得重写中心与尺寸。sleeping 使用同一几何合同但移除手臂，避免降级模式制造打字状态。
 */
export function buildOfficeFallbackDollPrimitives(seatId: OfficeSeatId, activity: DollActivity): OfficeFallbackPrimitive[] {
  const contract = OFFICE_VISUAL_CONTRACT
  const doll = contract.doll
  const seatPosition = contract.layout.seats[seatId]
  const sleeping = activity === 'sleeping'
  const characterPosition = sleeping ? doll.sleepingPosition : doll.normalPosition
  const characterRotation = sleeping ? asVec3(doll.sleepingRotation) : [0, 0, 0] as Vec3
  const primitives: OfficeFallbackPrimitive[] = []
  const add = (
    id: string,
    localPosition: OfficeVector3,
    fullSize: OfficeVector3,
    colorKey: OfficeFallbackPrimitive['colorKey'],
    shape: OfficeFallbackPrimitive['shape'] = 'cube',
    localRotation: Vec3 = [0, 0, 0]
  ): void => {
    const characterLocal = addLocalPositions(characterPosition, localPosition)
    primitives.push({
      id,
      shape,
      worldPosition: officeLocalToWorld(seatPosition, characterLocal),
      halfExtents: fullSizeToHalfExtents(fullSize),
      rotation: [
        characterRotation[0] + localRotation[0],
        characterRotation[1] + localRotation[1],
        characterRotation[2] + localRotation[2]
      ],
      colorKey
    })
  }

  add('doll-torso', doll.torsoPosition, doll.torsoFullSize, 'doll', 'sphere')
  add('doll-head', doll.headPosition, doll.headFullSize, 'doll', 'sphere')
  doll.hornPositions.forEach((position, index) => add(
    `doll-horn-${index}`,
    position,
    doll.hornFullSize,
    'doll',
    'cube',
    [0, 0, doll.hornRotationsZ[index]]
  ))
  doll.fallbackScarfSegments.forEach((segment, index) => add(`doll-scarf-${index}`, segment.position, segment.fullSize, 'role'))
  if (!sleeping) {
    doll.armPositions.forEach((position, index) => add(
      `doll-arm-${index}`,
      position,
      doll.armFullSize,
      'doll',
      'cube',
      [doll.armStaticRotationX, 0, 0]
    ))
  }
  return primitives
}

/** 原生 WebGL 不保留第二套十进制颜色；每次切换主题都从共享十六进制 token 派生。 */
function createFallbackPalette(theme: OfficeThemeMode): Record<string, Vec3> {
  const tokens = OFFICE_VISUAL_CONTRACT.themes[theme]
  return {
    floor: hexToVec3(tokens.floor),
    desk: hexToVec3(tokens.desk),
    deskRim: hexToVec3(tokens.deskRim),
    trim: hexToVec3(tokens.structure),
    chair: hexToVec3(tokens.chair),
    cabinet: hexToVec3(tokens.cabinet),
    handle: hexToVec3(tokens.handle),
    doll: hexToVec3('#0F141F'),
    monitorBezel: hexToVec3(tokens.monitorFrame),
    nameplate: hexToVec3(tokens.nameplate)
  }
}

const VERTEX_SHADER = [
  'attribute vec3 aPosition;',
  'attribute vec3 aNormal;',
  'uniform mat4 uModel;',
  'uniform mat4 uViewProjection;',
  'uniform vec3 uColor;',
  'uniform vec3 uLightDirection;',
  'uniform float uSelected;',
  'varying vec3 vColor;',
  'varying float vLight;',
  'void main(){',
  '  vec3 worldNormal = normalize(mat3(uModel) * aNormal);',
  '  float diffuse = max(dot(worldNormal, normalize(uLightDirection)), 0.0);',
  // fallback 只保留非常柔和的明暗层次；最低 0.92 可让无边界米白地面保持明亮，不把背光面压成泥灰。
  `  vLight = ${OFFICE_VISUAL_CONTRACT.scene.fallbackLighting.base.toFixed(2)} + diffuse * ${OFFICE_VISUAL_CONTRACT.scene.fallbackLighting.diffuse.toFixed(2)};`,
  '  vColor = min(uColor + vec3(uSelected * 0.10), vec3(1.0));',
  '  gl_Position = uViewProjection * uModel * vec4(aPosition, 1.0);',
  '}'
].join('\n')

const FRAGMENT_SHADER = [
  'precision mediump float;',
  'varying vec3 vColor;',
  'varying float vLight;',
  // 合同十六进制颜色是 sRGB。必须先转线性空间计算光照，再转回 sRGB 输出；直接相乘会产生约 25% 的脏灰压暗。
  'vec3 srgbToLinear(vec3 value){',
  '  vec3 low = value / 12.92;',
  '  vec3 high = pow((value + 0.055) / 1.055, vec3(2.4));',
  '  return mix(low, high, step(vec3(0.04045), value));',
  '}',
  'vec3 linearToSrgb(vec3 value){',
  '  vec3 safeValue = max(value, vec3(0.0));',
  '  vec3 low = safeValue * 12.92;',
  '  vec3 high = 1.055 * pow(safeValue, vec3(1.0 / 2.4)) - 0.055;',
  '  return mix(low, high, step(vec3(0.0031308), safeValue));',
  '}',
  'void main(){',
  '  vec3 litLinear = srgbToLinear(vColor) * vLight;',
  '  gl_FragColor = vec4(linearToSrgb(litLinear), 1.0);',
  '}'
].join('\n')

export interface OfficeWebGLRenderer {
  setSeats: (seats: OfficeSeatRenderState[]) => void
  setTheme: (theme: OfficeThemeMode) => void
  resize: (width: number, height: number, pixelRatio: number) => void
  setPointer?: (x: number | null, y: number | null) => void
  triggerJump?: (seatId: OfficeSeatId) => void
  render: (timeMs: number, animate: boolean) => void
  hitTest: (clientX: number, clientY: number) => OfficeSeatId | null
  dispose: () => void
}

/**
 * 创建首页专用的本地 WebGL 安全降级渲染器（固定纯白演播厅 2×2 矩阵）。
 */
export function createOfficeWebGLRenderer(canvas: HTMLCanvasElement, options: RendererOptions): OfficeWebGLRenderer {
  const gl = options.context ?? canvas.getContext('webgl', {
    alpha: false,
    antialias: true,
    depth: true,
    powerPreference: 'low-power'
  })
  if (!gl) throw new Error('webgl_unavailable')

  const { program, locations, cube, sphere, disposeResources } = initializeOfficeWebGL(gl)
  let theme: OfficeThemeMode = 'light'
  let disposed = false
  let pointer: { x: number; y: number } | null = null
  let viewportWidth = canvas.clientWidth || 640
  let viewportHeight = canvas.clientHeight || 360
  let viewportPixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
  const jumpTimers: Partial<Record<OfficeSeatId, number>> = {}
  let projection: OfficeSeatProjection = defaultProjection(canvas)
  let seats: OfficeSeatRenderState[] = SEATS.map((seat) => ({
    id: seat.id,
    tone: 'muted',
    activity: getDollRolePreset(seat.id).defaultActivity,
    selected: false
  }))
  const resizeViewport = (width: number, height: number, pixelRatio: number): void => {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    viewportWidth = Math.max(1, width)
    viewportHeight = Math.max(1, height)
    viewportPixelRatio = Math.min(2, Math.max(1, Number.isFinite(pixelRatio) ? pixelRatio : 1))
    // 原生 WebGL 的 backing store 使用 capped DPR，投影与 hit-test 仍使用 CSS contentRect 尺寸。
    canvas.width = Math.max(1, Math.round(viewportWidth * viewportPixelRatio))
    canvas.height = Math.max(1, Math.round(viewportHeight * viewportPixelRatio))
  }
  resizeViewport(viewportWidth, viewportHeight, viewportPixelRatio)

  const addCube = (objects: SceneObject[], position: Vec3, objectScale: Vec3, color: Vec3, rotation: Vec3 = [0, 0, 0], selected = false): void => {
    objects.push({ geometry: cube, position, scale: objectScale, rotation, color, selected })
  }
  const addSphere = (objects: SceneObject[], position: Vec3, objectScale: Vec3, color: Vec3, selected = false): void => {
    objects.push({ geometry: sphere, position, scale: objectScale, rotation: [0, 0, 0], color, selected })
  }

  const buildObjects = (timeSeconds: number, animate: boolean): SceneObject[] => {
    const colors = createFallbackPalette(theme)
    const objects: SceneObject[] = []

    const resolvePrimitiveColor = (primitive: OfficeFallbackPrimitive, seatId: OfficeSeatId, roleColor: Vec3): Vec3 => {
      if (primitive.colorKey === 'role') return roleColor
      if (primitive.colorKey === 'screen') {
        if (seatId === 'insight') return [0.08, 0.09, 0.10]
        if (seatId === 'ai') return [0.35, 0.65, 0.98]
        return [0.22, 0.74, 0.97]
      }
      return colors[primitive.colorKey]
    }

    // 原生 WebGL 没有 PBR 平面，但中心和完整尺寸仍来自同一 floor 合同。
    addCube(
      objects,
      asVec3(OFFICE_VISUAL_CONTRACT.scene.floor.position),
      fullSizeToHalfExtents(OFFICE_VISUAL_CONTRACT.scene.floor.fullSize),
      colors.floor
    )

    // 2. 四大独立工位 (2x2 工位矩阵，行列间距宽阔通透)
    SEATS.forEach((definition) => {
      const seat = seats.find((candidate) => candidate.id === definition.id) ?? {
        id: definition.id,
        tone: 'muted' as const,
        activity: getDollRolePreset(definition.id).defaultActivity,
        selected: false
      }
      const isSleeping = seat.activity === 'sleeping'

      // 原生 WebGL fallback 与 Three.js 主渲染器读取同一角色预设，避免两套身份色漂移。
      const scarfColor = hexToVec3(getDollRolePreset(definition.id).scarfColor)

      // 微跳跃动画计算
      const jumpStart = jumpTimers[definition.id] ?? 0
      const jumpElapsed = (timeSeconds * 1000) - jumpStart
      const isJumping = jumpElapsed >= 0 && jumpElapsed <= 380
      const jumpProgress = isJumping ? jumpElapsed / 380 : 0
      const jumpY = isJumping ? Math.sin(jumpProgress * Math.PI) * 0.34 : 0
      const jumpSquash = isJumping ? Math.sin(jumpProgress * Math.PI * 2) * 0.08 : 0

      // LookAt 视线偏转计算
      let lookYaw = 0
      let lookPitch = 0
      if (pointer && projection[definition.id]) {
        const pSeat = projection[definition.id]
        const dx = (pointer.x - pSeat.x) / Math.max(1, canvas.clientWidth || 640)
        const dy = (pointer.y - pSeat.y) / Math.max(1, canvas.clientHeight || 360)
        lookYaw = Math.max(-0.25, Math.min(0.25, dx * 0.8))
        lookPitch = Math.max(-0.15, Math.min(0.15, dy * 0.5))
      }

      // 选中轮廓属于 fallback 特效；其半径仍读取共享 hover ring 合同。
      if (seat.selected) {
        addCube(objects, [definition.x, 0.008, definition.z], [
          OFFICE_VISUAL_CONTRACT.layout.hoverRingOuterRadius,
          0.005,
          OFFICE_VISUAL_CONTRACT.layout.hoverRingOuterRadius
        ], scarfColor, [0, 0, 0], true)
      }

      // 桌、沿、腿、柜、拉手、椅与显示器全部由生产 helper 生成实际 model matrix 基础变换。
      buildOfficeFallbackStationPrimitives(definition.id).forEach((primitive) => {
        const color = resolvePrimitiveColor(primitive, definition.id, scarfColor)
        if (primitive.shape === 'sphere') {
          addSphere(objects, primitive.worldPosition, primitive.halfExtents, color, seat.selected)
        } else {
          addCube(objects, primitive.worldPosition, primitive.halfExtents, color, primitive.rotation, seat.selected)
        }
      })

      // 屏幕应用画面 (与马威斯 1:1 对应)
      if (definition.id === 'data') {
        // 01 数据管理员: 天蓝色背景 + 白色弹窗 + 进度滑块 + 绿色操作按钮
        addCube(objects, [definition.x, 3.1, definition.z - 0.63], [1.05, 0.58, 0.01], [1.0, 1.0, 1.0], [0, 0, 0], true)
        addCube(objects, [definition.x - 0.20, 3.27, definition.z - 0.61], [0.55, 0.04, 0.01], [0.15, 0.55, 0.95], [0, 0, 0], true)
        addCube(objects, [definition.x, 3.07, definition.z - 0.61], [0.90, 0.03, 0.01], [0.15, 0.75, 0.95], [0, 0, 0], true)
        addCube(objects, [definition.x + 0.28, 2.89, definition.z - 0.61], [0.30, 0.07, 0.01], [0.10, 0.75, 0.50], [0, 0, 0], true)
      } else if (definition.id === 'ai') {
        // 02 AI 代班员: 浅蓝底色 + 白色完整数据看板 + 彩色趋势折线 (粉/紫/蓝/青)
        addCube(objects, [definition.x, 3.1, definition.z - 0.63], [1.52, 0.88, 0.01], [1.0, 1.0, 1.0], [0, 0, 0], true)
        addCube(objects, [definition.x - 0.65, 3.1, definition.z - 0.61], [0.32, 0.82, 0.01], [0.93, 0.95, 0.98], [0, 0, 0], true)
        addCube(objects, [definition.x + 0.15, 3.47, definition.z - 0.61], [1.02, 0.05, 0.01], [0.85, 0.89, 0.95], [0, 0, 0], true)
        addCube(objects, [definition.x + 0.15, 3.27, definition.z - 0.61], [1.02, 0.03, 0.01], [0.95, 0.35, 0.65], [0, 0, 0], true)
        addCube(objects, [definition.x + 0.15, 3.17, definition.z - 0.61], [1.02, 0.03, 0.01], [0.60, 0.35, 0.95], [0, 0, 0], true)
        addCube(objects, [definition.x + 0.15, 3.07, definition.z - 0.61], [1.02, 0.03, 0.01], [0.20, 0.65, 0.98], [0, 0, 0], true)
        addCube(objects, [definition.x + 0.15, 2.97, definition.z - 0.61], [1.02, 0.03, 0.01], [0.10, 0.85, 0.75], [0, 0, 0], true)
      } else if (definition.id === 'insight') {
        // 03 洞察分析师 (休眠工位): 哑光黑待机屏幕
        // 黑屏底板已由合同 primitive 生成，休眠席不再叠加第二套屏幕尺寸。
      } else {
        // 04 任务技术员: 亮蓝背景 + 3 列移动端卡片预览 / 网页应用
        addCube(objects, [definition.x, 3.1, definition.z - 0.63], [1.52, 0.88, 0.01], [1.0, 1.0, 1.0], [0, 0, 0], true)
        addCube(objects, [definition.x, 3.45, definition.z - 0.61], [1.35, 0.06, 0.01], [0.92, 0.95, 0.98], [0, 0, 0], true)
        addCube(objects, [definition.x - 0.48, 3.07, definition.z - 0.61], [0.38, 0.48, 0.01], [0.98, 0.65, 0.20], [0, 0, 0], true)
        addCube(objects, [definition.x, 3.07, definition.z - 0.61], [0.38, 0.48, 0.01], [0.20, 0.75, 0.95], [0, 0, 0], true)
        addCube(objects, [definition.x + 0.48, 3.07, definition.z - 0.61], [0.38, 0.48, 0.01], [0.65, 0.45, 0.95], [0, 0, 0], true)
      }

      // 玩偶实际中心和半轴也从同一生产 helper 取得，buildObjects 只叠加动画增量。
      const armWave = seat.activity === 'working' && animate ? Math.sin(timeSeconds * 8 + definition.x) * 0.08 : 0
      buildOfficeFallbackDollPrimitives(definition.id, seat.activity).forEach((primitive) => {
        const position: Vec3 = [...primitive.worldPosition]
        const halfExtents: Vec3 = [...primitive.halfExtents]
        const rotation: Vec3 = [...primitive.rotation]
        const isHeadOrHorn = primitive.id === 'doll-head' || primitive.id.startsWith('doll-horn-')
        const isArm = primitive.id.startsWith('doll-arm-')

        position[1] += jumpY * (isHeadOrHorn ? 1 : 0.4)
        if (isHeadOrHorn) {
          position[0] += Math.sin(lookYaw) * 0.12
          position[2] += (Math.cos(lookYaw) - 1) * 0.12
          rotation[0] += lookPitch
          rotation[1] += lookYaw
        }
        if (isArm) rotation[0] += primitive.id.endsWith('-0') ? armWave : -armWave
        if (primitive.id === 'doll-head' || primitive.id === 'doll-torso') {
          halfExtents[0] *= 1 - jumpSquash
          halfExtents[1] *= 1 + jumpSquash
          halfExtents[2] *= 1 - jumpSquash
        }

        const color = resolvePrimitiveColor(primitive, definition.id, scarfColor)
        if (primitive.shape === 'sphere') addSphere(objects, position, halfExtents, color, seat.selected)
        else addCube(objects, position, halfExtents, color, rotation, seat.selected)
      })

      // zZZ 是 fallback 的低成本屏幕粒子；基准位置和纵向行程仍取集中合同。
      if (isSleeping && animate) {
        OFFICE_VISUAL_CONTRACT.doll.sleepSprites.positions.forEach((basePosition, index) => {
          const cycle = (timeSeconds * 0.45 + index * 0.33) % 1
          const size = Math.sin(cycle * Math.PI) * (0.065 + index * 0.02)
          if (size <= 0.008) return
          const world = officeLocalToWorld(OFFICE_VISUAL_CONTRACT.layout.seats[definition.id], basePosition)
          addCube(objects, [
            world[0] + Math.sin(timeSeconds * 2 + index) * 0.06,
            world[1] + cycle * OFFICE_VISUAL_CONTRACT.doll.sleepSprites.verticalTravel,
            world[2]
          ], [size, size * 0.65, size], [0.55, 0.65, 0.78])
        })
      }
    })
    return objects
  }

  return {
    setSeats: (nextSeats) => {
      seats = nextSeats.map((seat) => ({ ...seat }))
    },
    setTheme: (nextTheme) => {
      theme = nextTheme
    },
    resize: resizeViewport,
    setPointer: (x, y) => {
      pointer = x !== null && y !== null ? { x, y } : null
    },
    triggerJump: (seatId) => {
      jumpTimers[seatId] = performance.now()
    },
    render: (timeMs, animate) => {
      if (disposed) return
      const width = viewportWidth
      const height = viewportHeight

      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.enable(gl.DEPTH_TEST)
      gl.enable(gl.CULL_FACE)
      gl.cullFace(gl.BACK)
      const clearRgb = hexToVec3(OFFICE_VISUAL_CONTRACT.themes[theme].wall)
      const clear = [clearRgb[0], clearRgb[1], clearRgb[2], 1.0]
      gl.clearColor(clear[0], clear[1], clear[2], clear[3])
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

      const camera = OFFICE_VISUAL_CONTRACT.camera
      const frustum = calculateOfficeCameraFrustum(width / Math.max(1, height))
      const projectionMatrix = ortho(frustum.left, frustum.right, frustum.bottom, frustum.top, camera.near, camera.far)
      const eye: Vec3 = [camera.position[0], camera.position[1], camera.position[2]]
      const target: Vec3 = [camera.target[0], camera.target[1], camera.target[2]]
      const viewProjection = multiply(projectionMatrix, lookAt(eye, target, [0, 1, 0]))

      // 桌牌锚点和 Three 主场景共用同一局部坐标，fallback 切换时文字不会发生跳位。
      projection = Object.fromEntries(SEATS.map((seat) => [seat.id, projectPoint([
        seat.x + OFFICE_VISUAL_CONTRACT.layout.nameplate.projectionAnchor[0],
        OFFICE_VISUAL_CONTRACT.layout.nameplate.projectionAnchor[1],
        seat.z + OFFICE_VISUAL_CONTRACT.layout.nameplate.projectionAnchor[2]
      ], viewProjection, width, height)])) as OfficeSeatProjection
      options.onProjection(projection)

      const lightDirection = [0.35, 0.92, 0.42] as Vec3
      const objects = buildObjects(timeMs / 1000, animate)

      gl.useProgram(program)
      gl.uniform3fv(locations.lightDirection, new Float32Array(lightDirection))
      gl.uniformMatrix4fv(locations.viewProjection, false, new Float32Array(viewProjection))

      objects.forEach((object) => {
        drawObject(gl, locations, object)
      })
    },
    hitTest: (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect()
      const x = clientX - rect.left
      const y = clientY - rect.top
      let match: OfficeSeatId | null = null
      let shortest = Math.min(84, Math.max(50, Math.min(rect.width, rect.height) * 0.22))
      SEATS.forEach((seat) => {
        const point = projection[seat.id]
        const distance = Math.hypot(point.x - x, point.y - y)
        if (distance < shortest) { shortest = distance; match = seat.id }
      })
      return match
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      disposeResources()
    }
  }
}

/**
 * WebGL 初始化采用“临时所有权 → 成功移交”的事务边界。
 *
 * shader、program、buffer 在 renderer 真正构造成功前都登记在同一资源作用域中；
 * uniform、attribute 或任意 geometry 步骤抛错时，catch 只调用一次 rollback，便会释放
 * 此前已经创建的全部资源。成功时 transfer 把 program 与 buffer 的清理权交给 renderer
 * 的幂等 dispose；已经完成 link 的 shader 会立即释放，不再进入后续 dispose。
 */
function initializeOfficeWebGL(gl: WebGLRenderingContext): {
  program: WebGLProgram
  locations: OfficeShaderLocations
  cube: Geometry
  sphere: Geometry
  disposeResources: () => void
} {
  const resources = new WebGLResourceOwnership(gl)
  try {
    const program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER, resources)
    const locations: OfficeShaderLocations = {
      position: gl.getAttribLocation(program, 'aPosition'),
      normal: gl.getAttribLocation(program, 'aNormal'),
      model: requiredUniform(gl, program, 'uModel'),
      viewProjection: requiredUniform(gl, program, 'uViewProjection'),
      color: requiredUniform(gl, program, 'uColor'),
      lightDirection: requiredUniform(gl, program, 'uLightDirection'),
      selected: requiredUniform(gl, program, 'uSelected')
    }
    if (locations.position < 0 || locations.normal < 0) throw new Error('webgl_attribute_unavailable')

    const cube = createGeometry(gl, createCubeGeometry(), resources)
    const sphere = createGeometry(gl, createSphereGeometry(18, 12), resources)
    return { program, locations, cube, sphere, disposeResources: resources.transfer() }
  } catch (error) {
    resources.rollback()
    throw error
  }
}

/**
 * 集中记录首页 renderer 创建期间产生的 GPU 资源。
 *
 * Set 同时承担身份去重与删除凭证：删除前先从 Set 移除，因此 rollback、context lost
 * 后的组件卸载以及调用方重复 dispose 都不可能对同一对象执行两次 delete。清理 API
 * 本身若异常不会覆盖真正的初始化错误，并会继续尝试释放剩余资源。
 */
class WebGLResourceOwnership {
  private readonly shaders = new Set<WebGLShader>()
  private readonly programs = new Set<WebGLProgram>()
  private readonly buffers = new Set<WebGLBuffer>()
  private state: 'initializing' | 'transferred' | 'disposed' = 'initializing'

  constructor(private readonly gl: WebGLRenderingContext) {}

  trackShader(shader: WebGLShader): WebGLShader {
    this.assertInitializing()
    this.shaders.add(shader)
    return shader
  }

  trackProgram(program: WebGLProgram): WebGLProgram {
    this.assertInitializing()
    this.programs.add(program)
    return program
  }

  trackBuffer(buffer: WebGLBuffer): WebGLBuffer {
    this.assertInitializing()
    this.buffers.add(buffer)
    return buffer
  }

  deleteShader(shader: WebGLShader): void {
    if (!this.shaders.delete(shader)) return
    this.deleteSafely(() => this.gl.deleteShader(shader))
  }

  rollback(): void {
    if (this.state !== 'initializing') return
    this.state = 'disposed'
    this.deleteAll()
  }

  transfer(): () => void {
    this.assertInitializing()
    this.state = 'transferred'
    return () => {
      if (this.state !== 'transferred') return
      this.state = 'disposed'
      this.deleteAll()
    }
  }

  private deleteAll(): void {
    for (const buffer of [...this.buffers]) {
      this.buffers.delete(buffer)
      this.deleteSafely(() => this.gl.deleteBuffer(buffer))
    }
    for (const program of [...this.programs]) {
      this.programs.delete(program)
      this.deleteSafely(() => this.gl.deleteProgram(program))
    }
    for (const shader of [...this.shaders]) this.deleteShader(shader)
  }

  private deleteSafely(remove: () => void): void {
    try {
      remove()
    } catch {
      // GPU 上下文丢失时 delete 可能不可用；资源已从所有权集合移除，避免二次释放。
    }
  }

  private assertInitializing(): void {
    if (this.state !== 'initializing') throw new Error('webgl_resource_ownership_closed')
  }
}

/** 把角色预设的 CSS 十六进制颜色转换成原生 WebGL 使用的归一化 RGB。 */
function hexToVec3(hex: `#${string}`): Vec3 {
  const value = Number.parseInt(hex.slice(1), 16)
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255]
}

function requiredUniform(gl: WebGLRenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name)
  if (!location) throw new Error(`webgl_uniform_unavailable:${name}`)
  return location
}

function createShader(gl: WebGLRenderingContext, type: number, source: string, resources: WebGLResourceOwnership): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('webgl_shader_create_failed')
  resources.trackShader(shader)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'webgl_shader_compile_failed'
    throw new Error(message)
  }
  return shader
}

function createProgram(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string, resources: WebGLResourceOwnership): WebGLProgram {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource, resources)
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource, resources)
  const program = gl.createProgram()
  if (!program) throw new Error('webgl_program_create_failed')
  resources.trackProgram(program)
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'webgl_program_link_failed'
    throw new Error(message)
  }
  // 成功 link 后 program 已拥有可执行代码，shader 可立即释放并从临时所有权中移除。
  resources.deleteShader(vertex)
  resources.deleteShader(fragment)
  return program
}

function createGeometry(gl: WebGLRenderingContext, source: { positions: number[]; normals: number[] }, resources: WebGLResourceOwnership): Geometry {
  const positionBuffer = gl.createBuffer()
  if (!positionBuffer) throw new Error('webgl_buffer_create_failed')
  resources.trackBuffer(positionBuffer)
  const normalBuffer = gl.createBuffer()
  if (!normalBuffer) throw new Error('webgl_buffer_create_failed')
  resources.trackBuffer(normalBuffer)
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(source.positions), gl.STATIC_DRAW)
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(source.normals), gl.STATIC_DRAW)
  return { positionBuffer, normalBuffer, count: source.positions.length / 3 }
}

function drawObject(
  gl: WebGLRenderingContext,
  locations: {
    position: number
    normal: number
    model: WebGLUniformLocation
    color: WebGLUniformLocation
    selected: WebGLUniformLocation
  },
  object: SceneObject
): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, object.geometry.positionBuffer)
  gl.enableVertexAttribArray(locations.position)
  gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0)
  gl.bindBuffer(gl.ARRAY_BUFFER, object.geometry.normalBuffer)
  gl.enableVertexAttribArray(locations.normal)
  gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 0, 0)
  const translation = translate(object.position[0], object.position[1], object.position[2])
  const rotation = multiply(multiply(rotateY(object.rotation[1]), rotateX(object.rotation[0])), rotateZ(object.rotation[2]))
  const model = multiply(multiply(translation, rotation), scale(object.scale[0], object.scale[1], object.scale[2]))
  gl.uniformMatrix4fv(locations.model, false, model)
  gl.uniform3fv(locations.color, new Float32Array(object.color))
  gl.uniform1f(locations.selected, object.selected ? 1 : 0)
  gl.drawArrays(gl.TRIANGLES, 0, object.geometry.count)
}

function createCubeGeometry(): { positions: number[]; normals: number[] } {
  const positions: number[] = []
  const normals: number[] = []
  const faces: Array<[Vec3, Vec3[]]> = [
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
    [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
    [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]]
  ]
  faces.forEach(([normal, vertices]) => {
    ;[0, 1, 2, 0, 2, 3].forEach((index) => {
      positions.push(...vertices[index])
      normals.push(...normal)
    })
  })
  return { positions, normals }
}

function createSphereGeometry(segments: number, rings: number): { positions: number[]; normals: number[] } {
  const positions: number[] = []
  const normals: number[] = []
  for (let y = 0; y < rings; y += 1) {
    const v0 = y / rings
    const v1 = (y + 1) / rings
    for (let x = 0; x < segments; x += 1) {
      const u0 = x / segments
      const u1 = (x + 1) / segments
      const points = [spherePoint(u0, v0), spherePoint(u1, v0), spherePoint(u1, v1), spherePoint(u0, v1)]
      ;[0, 1, 2, 0, 2, 3].forEach((index) => {
        positions.push(...points[index])
        normals.push(...points[index])
      })
    }
  }
  return { positions, normals }
}

function spherePoint(u: number, v: number): Vec3 {
  const theta = u * Math.PI * 2
  const phi = v * Math.PI
  return [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)]
}

function resizeCanvas(canvas: HTMLCanvasElement, gl: WebGLRenderingContext): void {
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const width = Math.max(1, Math.floor((canvas.clientWidth || canvas.width || 1) * ratio))
  const height = Math.max(1, Math.floor((canvas.clientHeight || canvas.height || 1) * ratio))
  if (canvas.width === width && canvas.height === height) return
  canvas.width = width
  canvas.height = height
  gl.viewport(0, 0, width, height)
}

function defaultProjection(canvas: HTMLCanvasElement): OfficeSeatProjection {
  const width = Math.max(1, canvas.clientWidth || canvas.width || 1)
  const height = Math.max(1, canvas.clientHeight || canvas.height || 1)
  return {
    data: { x: width * 0.28, y: height * 0.43 },
    ai: { x: width * 0.64, y: height * 0.43 },
    insight: { x: width * 0.31, y: height * 0.75 },
    tasks: { x: width * 0.67, y: height * 0.75 }
  }
}

function projectPoint(point: Vec3, matrix: Mat4, width: number, height: number): { x: number; y: number } {
  const result = multiplyVector(matrix, [point[0], point[1], point[2], 1])
  const w = result[3] || 1
  return {
    x: (result[0] / w * 0.5 + 0.5) * width,
    y: (1 - (result[1] / w * 0.5 + 0.5)) * height
  }
}

function identity(): Mat4 {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] = a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3]
    }
  }
  return out
}

function multiplyVector(matrix: Mat4, vector: [number, number, number, number]): [number, number, number, number] {
  return [
    matrix[0] * vector[0] + matrix[4] * vector[1] + matrix[8] * vector[2] + matrix[12] * vector[3],
    matrix[1] * vector[0] + matrix[5] * vector[1] + matrix[9] * vector[2] + matrix[13] * vector[3],
    matrix[2] * vector[0] + matrix[6] * vector[1] + matrix[10] * vector[2] + matrix[14] * vector[3],
    matrix[3] * vector[0] + matrix[7] * vector[1] + matrix[11] * vector[2] + matrix[15] * vector[3]
  ]
}

function translate(x: number, y: number, z: number): Mat4 { const matrix = identity(); matrix[12] = x; matrix[13] = y; matrix[14] = z; return matrix }
function scale(x: number, y: number, z: number): Mat4 { const matrix = identity(); matrix[0] = x; matrix[5] = y; matrix[10] = z; return matrix }
function rotateX(value: number): Mat4 { const matrix = identity(); const cosine = Math.cos(value); const sine = Math.sin(value); matrix[5] = cosine; matrix[6] = sine; matrix[9] = -sine; matrix[10] = cosine; return matrix }
function rotateY(value: number): Mat4 { const matrix = identity(); const cosine = Math.cos(value); const sine = Math.sin(value); matrix[0] = cosine; matrix[2] = -sine; matrix[8] = sine; matrix[10] = cosine; return matrix }
function rotateZ(value: number): Mat4 { const matrix = identity(); const cosine = Math.cos(value); const sine = Math.sin(value); matrix[0] = cosine; matrix[1] = sine; matrix[4] = -sine; matrix[5] = cosine; return matrix }

function ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
  const matrix = identity()
  matrix[0] = 2 / (right - left)
  matrix[5] = 2 / (top - bottom)
  matrix[10] = -2 / (far - near)
  matrix[12] = -(right + left) / (right - left)
  matrix[13] = -(top + bottom) / (top - bottom)
  matrix[14] = -(far + near) / (far - near)
  return matrix
}

function lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const z = normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]])
  const x = normalize(cross(up, z))
  const y = cross(z, x)
  const matrix = identity()
  matrix[0] = x[0]; matrix[1] = y[0]; matrix[2] = z[0]
  matrix[4] = x[1]; matrix[5] = y[1]; matrix[6] = z[1]
  matrix[8] = x[2]; matrix[9] = y[2]; matrix[10] = z[2]
  matrix[12] = -dot(x, eye); matrix[13] = -dot(y, eye); matrix[14] = -dot(z, eye)
  return matrix
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
