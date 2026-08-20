import * as THREE from 'three'
import type { DollActivity } from './dollContracts'
import { OFFICE_VISUAL_CONTRACT } from '../officeCamera'

export interface DollPoseParts {
  root: THREE.Group
  character: THREE.Group
  leftArm: THREE.Object3D
  rightArm: THREE.Object3D
  scarfMaterial: THREE.MeshStandardMaterial
  roleLight: THREE.PointLight
  sleepSprites: readonly THREE.Sprite[]
  motionPhase: number
}

export interface DollPoseInput {
  activity: DollActivity
  hovered: boolean
  timeSeconds: number
  animate: boolean
}

/**
 * 把中立 activity 转换为纯视觉姿态。
 *
 * 该控制器不认识数据库、账号或托管状态。特别重要的是：只有 working 分支会让双手产生
 * 交替打字循环；hover 仅增强围脖亮度，工位整体抬升由场景层统一负责，不能把 standby、warning 或筹备席
 * 伪装成“正在工作”。animate=false 时所有循环都回到确定的静态基准帧，以满足
 * reduced-motion 和页面不可见时的节能要求。
 */
export function applyDollPose(parts: DollPoseParts, input: DollPoseInput): void {
  const { activity, hovered, timeSeconds, animate } = input
  const sleeping = activity === 'sleeping'
  const working = activity === 'working'

  const visual = OFFICE_VISUAL_CONTRACT.doll
  parts.root.position.y = 0
  parts.character.position.set(...(sleeping ? visual.sleepingPosition : visual.normalPosition))
  parts.character.rotation.set(...(sleeping ? visual.sleepingRotation : [0, 0, 0] as const))
  parts.leftArm.visible = !sleeping
  parts.rightArm.visible = !sleeping

  // 岗位灯只区分休眠与非休眠，不读取 working，因此不会成为第二套业务状态或触发动画。
  if (sleeping) {
    parts.roleLight.removeFromParent()
  } else if (parts.roleLight.parent !== parts.character) {
    parts.character.add(parts.roleLight)
  }

  // 打字是唯一循环手臂动作；关闭动画或非 working 时强制恢复同一静态姿态。
  const wave = working && animate ? Math.sin(timeSeconds * 7 + parts.motionPhase) * 0.08 : 0
  parts.leftArm.rotation.x = visual.armStaticRotationX + wave
  parts.rightArm.rotation.x = visual.armStaticRotationX - wave

  const checkingPulse = activity === 'checking' && animate
    ? Math.sin(timeSeconds * 3 + parts.motionPhase) * 0.14
    : 0
  const baseEmissive = sleeping ? 0.15 : activity === 'warning' ? 0.28 : activity === 'paused' ? 0.38 : 0.95
  parts.scarfMaterial.emissiveIntensity = hovered ? 1.5 : baseEmissive + checkingPulse

  parts.sleepSprites.forEach((sprite, index) => {
    sprite.visible = sleeping
    const cycle = animate ? (timeSeconds * 0.45 + index * 0.33) % 1 : index * 0.18
    sprite.position.y = sprite.userData.baseY + cycle * visual.sleepSprites.verticalTravel
    sprite.position.x = sprite.userData.baseX + (animate ? Math.sin(timeSeconds * 2 + index) * 0.05 : 0)
    sprite.scale.set(0.5 + cycle * 0.5, 0.5 + cycle * 0.5, 1)
    const material = sprite.material as THREE.SpriteMaterial
    material.opacity = sleeping ? (animate ? Math.sin(cycle * Math.PI) * 0.9 : 0.65) : 0
  })
}
