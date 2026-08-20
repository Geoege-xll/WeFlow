import * as THREE from 'three'
import type { DollActivity, DollRoleId } from './dollContracts'
import { applyDollPose, type DollPoseParts } from './dollPoseController'
import { getDollRolePreset } from './dollRolePresets'
import { ThreeResourceOwnership } from './threeResourceOwnership'
import { OFFICE_VISUAL_CONTRACT } from '../officeCamera'

export interface DollModelInstance {
  roleId: DollRoleId
  root: THREE.Group
  parts: DollPoseParts
  update: (activity: DollActivity, hovered: boolean, timeSeconds: number, animate: boolean) => void
}

export interface DollModelFactory {
  create: (roleId: DollRoleId) => DollModelInstance
  ownsResource: (resource: unknown) => boolean
  dispose: () => void
}

function createSleepSprite(text: string, resources: ThreeResourceOwnership): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (context) {
    context.font = 'bold 72px "Fira Code", monospace'
    context.fillStyle = '#FFFFFF'
    context.shadowColor = '#64748B'
    context.shadowBlur = 12
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, 64, 64)
  }
  const texture = resources.track(new THREE.CanvasTexture(canvas))
  const material = resources.track(new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0 }))
  const sprite = new THREE.Sprite(material)
  sprite.name = `Sleep_${text}`
  sprite.scale.set(0.9, 0.9, 1)
  sprite.visible = false
  return sprite
}

/**
 * 创建可复用的玩偶模型工厂。
 *
 * 头部、双角、躯干和手臂 geometry/material 在工厂级只创建一次，四个角色实例只创建
 * 自己的围脖与睡眠 sprite 材质。这既保证四席来自同一套参数化模型，也显著减少 GPU
 * 资源数量。所有构造过程包在事务边界内：任意一步抛错都会释放此前登记的资源。
 */
export function createDollModelFactory(): DollModelFactory {
  const resources = new ThreeResourceOwnership()
  const instances = new Map<DollRoleId, DollModelInstance>()
  let disposed = false

  try {
    const visual = OFFICE_VISUAL_CONTRACT.doll
    const headGeometry = resources.track(new THREE.SphereGeometry(visual.headRadius, 32, 32))
    const hornGeometry = resources.track(new THREE.ConeGeometry(visual.hornRadius, visual.hornHeight, 16))
    const scarfGeometry = resources.track(new THREE.TorusGeometry(
      visual.scarfRadius,
      visual.scarfTube,
      visual.scarfRadialSegments,
      visual.scarfTubularSegments
    ))
    const torsoGeometry = resources.track(new THREE.CapsuleGeometry(visual.torsoRadius, visual.torsoLength, 16, 16))
    const armGeometry = resources.track(new THREE.CylinderGeometry(
      visual.armRadiusTop,
      visual.armRadiusBottom,
      visual.armHeight,
      16
    ))
    const silhouetteMaterial = resources.track(new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 }))

    const create = (roleId: DollRoleId): DollModelInstance => {
      if (disposed) throw new Error('doll_model_factory_disposed')
      const existing = instances.get(roleId)
      if (existing) throw new Error(`doll_model_already_created:${roleId}`)
      const preset = getDollRolePreset(roleId)

      const root = new THREE.Group()
      root.name = `Doll_${roleId}`
      root.userData.dollRoleId = roleId
      const character = new THREE.Group()
      character.name = `Char_${roleId}`
      root.add(character)

      const head = new THREE.Mesh(headGeometry, silhouetteMaterial)
      head.name = 'Head'
      head.position.set(...visual.headPosition)
      head.castShadow = true
      character.add(head)

      const leftHorn = new THREE.Mesh(hornGeometry, silhouetteMaterial)
      leftHorn.name = 'HornLeft'
      leftHorn.position.set(...visual.hornPositions[0])
      leftHorn.rotation.z = visual.hornRotationsZ[0]
      const rightHorn = new THREE.Mesh(hornGeometry, silhouetteMaterial)
      rightHorn.name = 'HornRight'
      rightHorn.position.set(...visual.hornPositions[1])
      rightHorn.rotation.z = visual.hornRotationsZ[1]
      character.add(leftHorn, rightHorn)

      const scarfMaterial = resources.track(new THREE.MeshStandardMaterial({
        color: preset.scarfColor,
        emissive: preset.scarfColor,
        emissiveIntensity: 0.95,
        roughness: 0.2
      }))
      const scarf = new THREE.Mesh(scarfGeometry, scarfMaterial)
      scarf.name = 'Scarf'
      scarf.rotation.x = Math.PI / 2
      scarf.position.set(...visual.scarfPosition)
      character.add(scarf)

      // Web 的岗位色灯只承担身份照明，不表达“正在工作”。sleeping 会在姿态控制器中移除它。
      const roleLight = new THREE.PointLight(
        preset.scarfColor,
        visual.pointLight.intensity,
        visual.pointLight.distance
      )
      roleLight.name = 'RolePointLight'
      roleLight.position.set(...visual.pointLight.position)
      character.add(roleLight)

      const torso = new THREE.Mesh(torsoGeometry, silhouetteMaterial)
      torso.name = 'Torso'
      torso.position.set(...visual.torsoPosition)
      torso.castShadow = true
      character.add(torso)

      const createArm = (side: 'Left' | 'Right', index: 0 | 1): THREE.Mesh => {
        // Web 已确认的背面工位造型使用单段圆柱手臂；打字时只绕 X 轴做轻微交替摆动。
        const arm = new THREE.Mesh(armGeometry, silhouetteMaterial)
        arm.name = `Arm${side}`
        const [armX, armY, armZ] = visual.armPositions[index]
        arm.position.set(armX, armY, armZ)
        arm.rotation.x = visual.armStaticRotationX
        arm.castShadow = true
        return arm
      }
      const leftArm = createArm('Left', 0)
      const rightArm = createArm('Right', 1)
      character.add(leftArm, rightArm)

      // 四个实例都具备休眠表现能力，但默认仅洞察分析师显示；统一对象树避免状态切换时重建 Mesh。
      const sleepSprites = [createSleepSprite('z', resources), createSleepSprite('Z', resources), createSleepSprite('ZZ', resources)]
      sleepSprites.forEach((sprite, index) => {
        const [baseX, baseY, baseZ] = visual.sleepSprites.positions[index]
        sprite.userData = { baseX, baseY }
        sprite.position.set(baseX, baseY, baseZ)
        root.add(sprite)
      })

      const parts: DollPoseParts = {
        root,
        character,
        leftArm,
        rightArm,
        scarfMaterial,
        roleLight,
        sleepSprites,
        motionPhase: preset.motionPhase
      }
      const instance: DollModelInstance = {
        roleId,
        root,
        parts,
        update: (activity, hovered, timeSeconds, animate) => applyDollPose(parts, { activity, hovered, timeSeconds, animate })
      }
      instance.update(preset.defaultActivity, false, 0, false)
      instances.set(roleId, instance)
      return instance
    }

    return {
      create,
      ownsResource: (resource) => resources.owns(resource),
      dispose: () => {
        if (disposed) return
        disposed = true
        instances.forEach((instance) => instance.root.removeFromParent())
        instances.clear()
        resources.dispose()
      }
    }
  } catch (error) {
    // 工厂构造未完成时没有调用方会拿到 dispose；因此必须在这里回滚全部已登记资源。
    resources.dispose()
    throw error
  }
}
