/** Three.js 中所有需要显式释放的 GPU 资源都符合这一最小合同。 */
export interface ThreeDisposableResource {
  dispose: () => void
}

/**
 * Three.js 资源的事务式所有权容器。
 *
 * Set 负责按对象身份去重；释放前先从集合删除，保证正常卸载、WebGL context lost、
 * 初始化 rollback 以及调用方重复 dispose 时都不会对同一资源执行两次释放。单个资源的
 * dispose 即使抛错，也不会阻断其余资源清理，更不会覆盖真正的初始化异常。
 */
export class ThreeResourceOwnership {
  private readonly resources = new Set<ThreeDisposableResource>()
  private state: 'active' | 'transferred' | 'disposed' = 'active'

  track<T extends ThreeDisposableResource>(resource: T): T {
    if (this.state !== 'active') throw new Error('three_resource_ownership_closed')
    this.resources.add(resource)
    return resource
  }

  owns(resource: unknown): boolean {
    return this.resources.has(resource as ThreeDisposableResource)
  }

  /** 初始化失败时回滚仍由当前作用域持有的全部资源。 */
  rollback(): void {
    if (this.state !== 'active') return
    this.disposeAll()
  }

  /**
   * 初始化成功后把唯一清理凭证移交给长期存活的 renderer/factory。
   * 返回函数自身幂等；移交后 rollback 不再拥有释放权，避免失败路径和卸载路径竞争。
   */
  transfer(): () => void {
    if (this.state !== 'active') throw new Error('three_resource_ownership_closed')
    this.state = 'transferred'
    return () => {
      if (this.state !== 'transferred') return
      this.disposeAll()
    }
  }

  /** 未使用 transfer 的独立所有者（如 DollModelFactory）可直接幂等释放。 */
  dispose(): void {
    if (this.state === 'disposed') return
    this.disposeAll()
  }

  private disposeAll(): void {
    this.state = 'disposed'
    // 复制集合后再逐个删除，确保每个对象最多拥有一次释放凭证。
    for (const resource of [...this.resources]) {
      this.resources.delete(resource)
      try {
        resource.dispose()
      } catch {
        // GPU 上下文丢失时底层释放可能失败；所有权已经撤销，禁止下一次重复释放。
      }
    }
  }
}
