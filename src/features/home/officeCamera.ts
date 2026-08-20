import type { DollRoleId } from './dolls/dollContracts'

export type OfficeVector3 = readonly [number, number, number]

export interface OfficeOrthographicFrustum {
  left: number
  right: number
  top: number
  bottom: number
}

export type OfficeThemeMode = 'light' | 'dark'

const CAMERA_PITCH_DEGREES = 22
const CAMERA_DISTANCE_Z = 34
const CAMERA_TARGET: OfficeVector3 = [0, 2.25, 0]
const CAMERA_PITCH_RADIANS = CAMERA_PITCH_DEGREES * Math.PI / 180
const DOLL_HEAD_RADIUS = 0.55
const DOLL_HORN_RADIUS = 0.12
const DOLL_HORN_HEIGHT = 0.38
const DOLL_TORSO_RADIUS = 0.65
const DOLL_TORSO_LENGTH = 0.9
const DOLL_ARM_RADIUS_TOP = 0.08
const DOLL_ARM_RADIUS_BOTTOM = 0.07
const DOLL_ARM_HEIGHT = 0.6

/**
 * OmniMindWeChat 首页 3D 办公室的唯一视觉合同。
 *
 * 数值来源于 OmniMind Web 已确认的固定工作台视角；这里只复用视觉语义，不引入 Web
 * 的页面状态。Three.js 主渲染器与原生 WebGL 降级渲染器都从此处读取相机、2×2 席位
 * 和场景尺寸，避免两套实现再次出现“一个正视、一个陡峭俯拍”的漂移。
 */
export const OFFICE_VISUAL_CONTRACT = {
  camera: {
    yawDegrees: 0,
    pitchDegrees: CAMERA_PITCH_DEGREES,
    pitchRadians: CAMERA_PITCH_RADIANS,
    position: [0, CAMERA_TARGET[1] + CAMERA_DISTANCE_Z * Math.tan(CAMERA_PITCH_RADIANS), CAMERA_DISTANCE_Z] as OfficeVector3,
    target: CAMERA_TARGET,
    near: 0.1,
    far: 1000,
    safeFrameRatio: 0.88,
    contentBounds: {
      // 2×2 工位的包围盒包含 3.3 半径选中环、显示器上沿与休眠气泡。
      min: [-8.55, -0.1, -9.9] as OfficeVector3,
      max: [8.55, 4.6, 9.9] as OfficeVector3
    }
  },
  scene: {
    fogDensity: 0.005,
    ambientColor: '#FFFFFF',
    // 亮色材质在 PBR 路径中以环境光为主，降低方向光占比可保留柔和阴影而不把大面积地面压成泥灰。
    ambientIntensity: 1.15,
    directionalColor: '#FFFFFF',
    directionalIntensity: 0.55,
    directionalPosition: [12, 24, 18] as OfficeVector3,
    fallbackLighting: {
      // 原生 WebGL 使用 gamma-aware 光照；最低亮度保证背光面仍保持奶油米白，diffuse 只负责轻微塑形。
      base: 0.92,
      diffuse: 0.08
    },
    materialPolicy: {
      // 亮色家具用极低强度同色自发光抵消 PBR 的整体压暗；暗色关闭补光，保持原有层次。
      softLitEmissiveIntensity: { light: 0.18, dark: 0 },
      // 地面底色由 unlit 材质准确输出；独立 shadow catcher 只叠加轻微软阴影。
      floorShadowOpacity: { light: 0.12, dark: 0.18 }
    },
    floor: {
      position: [0, -0.02, 0] as OfficeVector3,
      // 地面必须覆盖固定正交相机的完整可见射线。远边不进入画面，便不会再出现“墙/地”分割线；
      // scene background 仍作为 GPU 清屏与雾色使用，WebGL 初始化、缩放期间也保持同一暖色工作室。
      fullSize: [120, 0.02, 120] as OfficeVector3,
      shadowOffsetY: 0.006
    }
  },
  themes: {
    light: {
      // 亮色办公室采用无边界暖米白摄影棚：背景、雾与地面属于同一色系，地面远端由雾自然融入清屏色。
      wall: '#F3EEE5',
      fog: '#F3EEE5',
      floor: '#EEE7DC',
      desk: '#FAF7F0',
      deskRim: '#F5F0E8',
      structure: '#E2D9CC',
      cabinet: '#E2D9CC',
      handle: '#C4B9AA',
      chair: '#E0D7CA',
      monitorFrame: '#403A34',
      nameplate: '#FAF7F0',
      shadow: '#D8CEC0'
    },
    dark: {
      // 暗色保持独立配色，不从亮色 token 做透明混合，避免主题互相污染。
      wall: '#0F172A',
      fog: '#0F172A',
      floor: '#0F172A',
      desk: '#293340',
      deskRim: '#3D4759',
      structure: '#8C99A6',
      cabinet: '#293340',
      handle: '#73808F',
      chair: '#242B35',
      monitorFrame: '#383F49',
      nameplate: '#293340',
      shadow: '#080B0D'
    }
  } satisfies Record<OfficeThemeMode, Record<string, `#${string}`>>,
  layout: {
    seats: {
      data: [-5.25, 0, -6.5],
      ai: [5.25, 0, -6.5],
      insight: [-5.25, 0, 6.5],
      tasks: [5.25, 0, 6.5]
    } satisfies Record<DollRoleId, OfficeVector3>,
    nameplate: {
      // 牌底座固定在桌面朝观察者的一侧，DOM 按钮以中心对齐覆盖其表面，不再悬浮于墙面。
      basePosition: [0, 1.62, 1.29] as OfficeVector3,
      baseFullSize: [1.9, 0.4, 0.08] as OfficeVector3,
      accentPosition: [-0.79, 1.62, 1.335] as OfficeVector3,
      accentFullSize: [0.08, 0.18, 0.02] as OfficeVector3,
      projectionAnchor: [0, 1.62, 1.34] as OfficeVector3,
      dom: {
        // 像素层只覆盖 3D 底座的投影面积；编号和名称分栏排列，避免透明按钮重新变成大卡片。
        desktopFullSizePx: [64, 18] as readonly [number, number],
        compactFullSizePx: [56, 16] as readonly [number, number],
        widthPercent: 9,
        heightPercent: 4,
        translateRatio: [-0.5, -0.5] as readonly [number, number],
        viewportSafeMarginPx: 4
      }
    },
    hoverLift: 0.35,
    hoverRingInnerRadius: 3.1,
    hoverRingOuterRadius: 3.3
  },
  workstation: {
    desk: { size: [5.2, 0.16, 2.5] as OfficeVector3, position: [0, 1.8, 0] as OfficeVector3 },
    rim: { size: [5.22, 0.02, 2.52] as OfficeVector3, position: [0, 1.88, 0] as OfficeVector3 },
    leg: {
      fullSize: [0.1, 1.8, 0.1] as OfficeVector3,
      positions: [[-2.3, 0.9, -1], [-2.3, 0.9, 1], [1.2, 0.9, -1], [1.2, 0.9, 1]] as const
    },
    cabinet: { size: [1, 1.4, 1.8] as OfficeVector3, position: [1.9, 0.7, 0.2] as OfficeVector3 },
    handle: {
      fullSize: [0.6, 0.03, 0.04] as OfficeVector3,
      positions: [[1.9, 0.35, 1.11], [1.9, 0.75, 1.11], [1.9, 1.15, 1.11]] as const
    },
    chair: {
      position: [0, 0, 1.2] as OfficeVector3,
      cushionSize: [1.4, 0.15, 1.4] as OfficeVector3,
      cushionPosition: [0, 1.1, 0] as OfficeVector3,
      backSize: [1.3, 1.4, 0.15] as OfficeVector3,
      backPosition: [0, 1.8, 0.6] as OfficeVector3,
      baseFullSize: [0.12, 0.7, 0.12] as OfficeVector3,
      basePosition: [0, 0.35, 0] as OfficeVector3
    },
    monitor: {
      frameSize: [3.4, 2.1, 0.08] as OfficeVector3,
      framePosition: [0, 3.1, -0.7] as OfficeVector3,
      // Three 使用前两维创建 Plane；0.02 深度供 fallback 的立方体屏幕保持稳定可见。
      screenSize: [3.3, 2, 0.02] as OfficeVector3,
      screenPosition: [0, 3.1, -0.65] as OfficeVector3,
      standFullSize: [0.12, 0.8, 0.12] as OfficeVector3,
      standPosition: [0, 2.2, -0.7] as OfficeVector3
    }
  },
  doll: {
    normalPosition: [0, 1.4, 0.9] as OfficeVector3,
    sleepingPosition: [0, 1.85, 0.35] as OfficeVector3,
    sleepingRotation: [0.3, 0, 0.45] as OfficeVector3,
    headRadius: DOLL_HEAD_RADIUS,
    headFullSize: [DOLL_HEAD_RADIUS * 2, DOLL_HEAD_RADIUS * 2, DOLL_HEAD_RADIUS * 2] as OfficeVector3,
    headPosition: [0, 1.4, 0] as OfficeVector3,
    hornRadius: DOLL_HORN_RADIUS,
    hornHeight: DOLL_HORN_HEIGHT,
    hornFullSize: [DOLL_HORN_RADIUS * 2, DOLL_HORN_HEIGHT, DOLL_HORN_RADIUS * 2] as OfficeVector3,
    hornPositions: [[-0.32, 1.85, -0.05], [0.32, 1.85, -0.05]] as const,
    hornRotationsZ: [-0.3, 0.3] as const,
    scarfRadius: 0.58,
    scarfTube: 0.1,
    scarfRadialSegments: 16,
    scarfTubularSegments: 64,
    scarfPosition: [0, 0.9, 0] as OfficeVector3,
    torsoRadius: DOLL_TORSO_RADIUS,
    torsoLength: DOLL_TORSO_LENGTH,
    torsoFullSize: [DOLL_TORSO_RADIUS * 2, DOLL_TORSO_LENGTH + DOLL_TORSO_RADIUS * 2, DOLL_TORSO_RADIUS * 2] as OfficeVector3,
    torsoPosition: [0, 0.3, 0] as OfficeVector3,
    armRadiusTop: DOLL_ARM_RADIUS_TOP,
    armRadiusBottom: DOLL_ARM_RADIUS_BOTTOM,
    armHeight: DOLL_ARM_HEIGHT,
    armFullSize: [DOLL_ARM_RADIUS_TOP * 2, DOLL_ARM_HEIGHT, DOLL_ARM_RADIUS_BOTTOM * 2] as OfficeVector3,
    armPositions: [[-0.35, 0.45, -0.2], [0.35, 0.45, -0.2]] as const,
    armStaticRotationX: 0.35,
    pointLight: {
      intensity: 1.5,
      distance: 3.5,
      position: [0, 1, 0] as OfficeVector3
    },
    sleepSprites: {
      positions: [[-0.2, 2.7, 0.3], [0.2, 3.1, 0.4], [0.5, 3.5, 0.5]] as const,
      verticalTravel: 0.8
    },
    fallbackScarfSegments: [
      { position: [0, 0.9, -0.48] as OfficeVector3, fullSize: [1.16, 0.2, 0.2] as OfficeVector3 },
      { position: [0, 0.9, 0.48] as OfficeVector3, fullSize: [1.16, 0.2, 0.2] as OfficeVector3 },
      { position: [-0.48, 0.9, 0] as OfficeVector3, fullSize: [0.2, 0.2, 1.16] as OfficeVector3 },
      { position: [0.48, 0.9, 0] as OfficeVector3, fullSize: [0.2, 0.2, 1.16] as OfficeVector3 }
    ]
  }
} as const

/** 把合同记录的完整尺寸转换为原生 WebGL 立方体/球体使用的半轴缩放。 */
export function fullSizeToHalfExtents(fullSize: OfficeVector3): [number, number, number] {
  return [fullSize[0] / 2, fullSize[1] / 2, fullSize[2] / 2]
}

/** 把工位局部中心转换为世界中心；不接受渲染器状态，因此 Three/fallback 可安全复用。 */
export function officeLocalToWorld(seatPosition: OfficeVector3, localPosition: OfficeVector3): [number, number, number] {
  return [
    seatPosition[0] + localPosition[0],
    seatPosition[1] + localPosition[1],
    seatPosition[2] + localPosition[2]
  ]
}

/**
 * 复刻岗位牌 CSS clamp 规则，测试和运行时都从同一合同得到像素尺寸。
 * 这里按场景容器而非窗口宽度计算，保证默认与紧凑三区布局得到稳定结果。
 */
export function calculateOfficeNameplatePixelSize(width: number, height: number): readonly [number, number] {
  const dom = OFFICE_VISUAL_CONTRACT.layout.nameplate.dom
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 1
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1
  const plateWidth = Math.min(dom.desktopFullSizePx[0], Math.max(dom.compactFullSizePx[0], safeWidth * dom.widthPercent / 100))
  const plateHeight = Math.min(dom.desktopFullSizePx[1], Math.max(dom.compactFullSizePx[1], safeHeight * dom.heightPercent / 100))
  return [plateWidth, plateHeight]
}

/**
 * 按内容包围盒计算正交相机画框。算法和 Web 版本一致：先把八个角投影到相机的
 * 水平/竖直轴，再留出 12% 安全边距。这样 764×420 和 560×360 都能完整展示四席，
 * resize 只改变画框，不会改变固定机位。
 */
export function calculateOfficeCameraFrustum(aspectInput: number): OfficeOrthographicFrustum {
  const { camera } = OFFICE_VISUAL_CONTRACT
  const aspect = Number.isFinite(aspectInput) && aspectInput > 0 ? aspectInput : 1
  const verticalAxis: OfficeVector3 = [0, Math.cos(camera.pitchRadians), -Math.sin(camera.pitchRadians)]
  let horizontalExtent = 0
  let verticalExtent = 0

  for (const x of [camera.contentBounds.min[0], camera.contentBounds.max[0]]) {
    for (const y of [camera.contentBounds.min[1], camera.contentBounds.max[1]]) {
      for (const z of [camera.contentBounds.min[2], camera.contentBounds.max[2]]) {
        const relativeY = y - camera.target[1]
        const relativeZ = z - camera.target[2]
        horizontalExtent = Math.max(horizontalExtent, Math.abs(x - camera.target[0]))
        verticalExtent = Math.max(verticalExtent, Math.abs(relativeY * verticalAxis[1] + relativeZ * verticalAxis[2]))
      }
    }
  }

  const requiredHalfWidth = horizontalExtent / camera.safeFrameRatio
  const requiredHalfHeight = verticalExtent / camera.safeFrameRatio
  const halfHeight = Math.max(requiredHalfHeight, requiredHalfWidth / aspect)
  const halfWidth = halfHeight * aspect
  return { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight }
}
