// @vitest-environment jsdom
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OmniMindRuntimeState } from '../shared/omnimind/contracts'
import type { DataConnectionReadinessStatus } from '../src/features/account/useDataConnectionReadiness'
import {
  mapDataReadinessToDollActivity,
  mapOmniMindRuntimeToDollActivity,
  mapPlannedRoleToDollActivity
} from '../src/features/home/dolls/dollActivityMapping'
import { createDollModelFactory } from '../src/features/home/dolls/createDollModel'
import type { DollActivity } from '../src/features/home/dolls/dollContracts'
import { DOLL_ROLE_IDS, DOLL_ROLE_PRESETS } from '../src/features/home/dolls/dollRolePresets'
import { ThreeResourceOwnership } from '../src/features/home/dolls/threeResourceOwnership'
import { OFFICE_VISUAL_CONTRACT } from '../src/features/home/officeCamera'

beforeEach(() => {
  // jsdom 不实现 2D canvas；玩偶工厂只需要绘制本地 zZZ 纹理，因此提供最小受控画布接口。
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillText: vi.fn() } as unknown as CanvasRenderingContext2D)
})

afterEach(() => vi.restoreAllMocks())

describe('首页玩偶业务活动映射', () => {
  it.each<[DataConnectionReadinessStatus, DollActivity]>([
    ['checking', 'checking'],
    ['ready', 'standby'],
    ['disconnected', 'warning'],
    ['account-missing', 'warning'],
    ['read-failed', 'warning']
  ])('maps data readiness %s to %s without fake work', (status, expected) => {
    expect(mapDataReadinessToDollActivity(status)).toBe(expected)
  })

  it.each<[OmniMindRuntimeState, DollActivity]>([
    ['stopped', 'standby'],
    ['validating', 'checking'],
    ['starting', 'checking'],
    ['running', 'working'],
    ['paused', 'paused'],
    ['degraded', 'warning'],
    ['stopping', 'checking'],
    ['failed', 'warning']
  ])('maps OmniMind runtime %s to %s', (state, expected) => {
    expect(mapOmniMindRuntimeToDollActivity(state)).toBe(expected)
  })

  it('keeps both planned roles permanently outside the working activity', () => {
    expect(mapPlannedRoleToDollActivity('insight')).toBe('sleeping')
    expect(mapPlannedRoleToDollActivity('tasks')).toBe('standby')
    expect([mapPlannedRoleToDollActivity('insight'), mapPlannedRoleToDollActivity('tasks')]).not.toContain('working')
  })
})

describe('参数化 Three.js 玩偶模型工厂', () => {
  it('creates all four roles from one shared geometry set with role-specific scarves', () => {
    const factory = createDollModelFactory()
    const dolls = DOLL_ROLE_IDS.map((id) => factory.create(id))

    const heads = dolls.map((doll) => doll.root.getObjectByName('Head') as THREE.Mesh)
    const torsos = dolls.map((doll) => doll.root.getObjectByName('Torso') as THREE.Mesh)
    const arms = dolls.map((doll) => doll.root.getObjectByName('ArmLeft') as THREE.Mesh)
    expect(new Set(heads.map((head) => head.geometry)).size).toBe(1)
    expect(new Set(torsos.map((torso) => torso.geometry)).size).toBe(1)
    expect(new Set(arms.map((arm) => arm.geometry)).size).toBe(1)

    // 锁定 Web 已确认的黑色双角玩偶比例，防止后续局部改动让 OmniMindWeChat 再次视觉漂移。
    expect((heads[0].geometry as THREE.SphereGeometry).parameters.radius).toBe(OFFICE_VISUAL_CONTRACT.doll.headRadius)
    const horn = dolls[0].root.getObjectByName('HornLeft') as THREE.Mesh<THREE.ConeGeometry>
    expect(horn.geometry.parameters.radius).toBe(OFFICE_VISUAL_CONTRACT.doll.hornRadius)
    expect(horn.geometry.parameters.height).toBe(OFFICE_VISUAL_CONTRACT.doll.hornHeight)
    const scarf = dolls[0].root.getObjectByName('Scarf') as THREE.Mesh<THREE.TorusGeometry>
    expect(scarf.geometry.parameters.radius).toBe(OFFICE_VISUAL_CONTRACT.doll.scarfRadius)
    expect(scarf.geometry.parameters.tube).toBe(OFFICE_VISUAL_CONTRACT.doll.scarfTube)
    const armGeometry = arms[0].geometry as THREE.CylinderGeometry
    expect(armGeometry.parameters.height).toBe(OFFICE_VISUAL_CONTRACT.doll.armHeight)

    dolls.forEach((doll) => {
      const preset = DOLL_ROLE_PRESETS[doll.roleId]
      expect(doll.root.name).toBe(`Doll_${doll.roleId}`)
      expect(doll.root.getObjectByName('HornLeft')).toBeTruthy()
      expect(doll.root.getObjectByName('HornRight')).toBeTruthy()
      expect(doll.root.getObjectByName('ArmLeft')).toBeInstanceOf(THREE.Mesh)
      expect(doll.root.getObjectByName('ArmRight')).toBeInstanceOf(THREE.Mesh)
      expect((doll.root.getObjectByName('Scarf') as THREE.Mesh).material).toBe(doll.parts.scarfMaterial)
      expect(`#${doll.parts.scarfMaterial.color.getHexString()}`.toUpperCase()).toBe(preset.scarfColor.toUpperCase())
      expect(`#${doll.parts.roleLight.color.getHexString()}`.toUpperCase()).toBe(preset.scarfColor.toUpperCase())
      expect(doll.parts.roleLight.intensity).toBe(OFFICE_VISUAL_CONTRACT.doll.pointLight.intensity)
      expect(doll.parts.roleLight.distance).toBe(OFFICE_VISUAL_CONTRACT.doll.pointLight.distance)
      expect(doll.parts.roleLight.position.toArray()).toEqual(OFFICE_VISUAL_CONTRACT.doll.pointLight.position)
      if (preset.defaultActivity === 'sleeping') {
        expect(doll.parts.roleLight.parent).toBeNull()
        expect(doll.root.getObjectByName('RolePointLight')).toBeUndefined()
      } else {
        expect(doll.parts.roleLight.parent).toBe(doll.parts.character)
        expect(doll.root.getObjectByName('RolePointLight')).toBe(doll.parts.roleLight)
      }
    })
    factory.dispose()
  })

  it('animates typing only for working and freezes every activity when animate is false', () => {
    const factory = createDollModelFactory()
    const doll = factory.create('ai')

    doll.update('working', false, 0, true)
    const workingStart = doll.parts.leftArm.rotation.x
    doll.update('working', false, 0.25, true)
    expect(doll.parts.leftArm.rotation.x).not.toBeCloseTo(workingStart, 6)

    const staticActivities: DollActivity[] = ['standby', 'checking', 'paused', 'warning']
    staticActivities.forEach((activity) => {
      doll.update(activity, false, 1, true)
      const first = doll.parts.leftArm.rotation.x
      doll.update(activity, true, 2, true)
      expect(doll.parts.leftArm.rotation.x).toBeCloseTo(first, 8)
    })

    doll.update('working', false, 1, false)
    const reducedMotionFrame = doll.parts.leftArm.rotation.x
    doll.update('working', false, 9, false)
    expect(doll.parts.leftArm.rotation.x).toBeCloseTo(reducedMotionFrame, 8)
    factory.dispose()
  })

  it('shows a real sleeping pose while keeping arms and fake work hidden', () => {
    const factory = createDollModelFactory()
    const doll = factory.create('insight')

    doll.update('sleeping', true, 2, true)
    expect(doll.parts.character.rotation.z).toBeGreaterThan(0)
    expect(doll.parts.leftArm.visible).toBe(false)
    expect(doll.parts.rightArm.visible).toBe(false)
    expect(doll.parts.sleepSprites.every((sprite) => sprite.visible)).toBe(true)
    expect(doll.parts.roleLight.parent).toBeNull()

    // 岗位灯只随 sleeping 开关，不会把 standby 变成工作动画。
    doll.update('standby', false, 3, true)
    expect(doll.parts.roleLight.parent).toBe(doll.parts.character)
    expect(doll.parts.leftArm.rotation.x).toBe(OFFICE_VISUAL_CONTRACT.doll.armStaticRotationX)
    doll.update('sleeping', false, 4, true)
    expect(doll.parts.roleLight.parent).toBeNull()
    factory.dispose()
  })

  it('removes the role point light from the scene with the doll root lifecycle', () => {
    const factory = createDollModelFactory()
    const doll = factory.create('data')
    const scene = new THREE.Scene()
    scene.add(doll.root)
    expect(scene.getObjectByName('RolePointLight')).toBe(doll.parts.roleLight)

    factory.dispose()
    expect(scene.getObjectByName('RolePointLight')).toBeUndefined()
    expect(doll.root.parent).toBeNull()
  })

  it('disposes shared and per-instance resources exactly once on repeated disposal', () => {
    const factory = createDollModelFactory()
    const data = factory.create('data')
    factory.create('ai')
    factory.create('insight')
    factory.create('tasks')
    const head = data.root.getObjectByName('Head') as THREE.Mesh
    const sharedGeometryDispose = vi.spyOn(head.geometry, 'dispose')
    const scarfDispose = vi.spyOn(data.parts.scarfMaterial, 'dispose')
    const sleepMaterial = data.parts.sleepSprites[0].material as THREE.SpriteMaterial
    const sleepTexture = sleepMaterial.map as THREE.Texture
    const sleepMaterialDispose = vi.spyOn(sleepMaterial, 'dispose')
    const sleepTextureDispose = vi.spyOn(sleepTexture, 'dispose')

    factory.dispose()
    factory.dispose()

    expect(sharedGeometryDispose).toHaveBeenCalledOnce()
    expect(scarfDispose).toHaveBeenCalledOnce()
    expect(sleepMaterialDispose).toHaveBeenCalledOnce()
    expect(sleepTextureDispose).toHaveBeenCalledOnce()
  })

  it('rolls back already-created GPU resources when factory construction is interrupted', () => {
    const originalTrack = ThreeResourceOwnership.prototype.track
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
    let tracked = 0
    vi.spyOn(ThreeResourceOwnership.prototype, 'track').mockImplementation(function (resource) {
      const result = originalTrack.call(this, resource)
      tracked += 1
      if (tracked === 3) throw new Error('injected_factory_failure')
      return result
    })

    expect(() => createDollModelFactory()).toThrow('injected_factory_failure')
    // 第三个资源已经登记后才抛错，事务 rollback 必须释放此前全部三个 geometry。
    expect(geometryDispose).toHaveBeenCalledTimes(3)
  })
})
