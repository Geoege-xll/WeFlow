export class AccountSwitchCoordinator {
  private chain: Promise<void> = Promise.resolve()

  constructor(private readonly dependencies: {
    stopIngress: () => Promise<void> | void
    cancelAndWait: () => Promise<void>
    resetAndRefresh: (accountId: string) => Promise<void>
    setIdentity: (accountId: string) => Promise<void> | void
    fail: () => void
  }) {}

  switch<T>(accountId: string, commit: () => T | Promise<T>, isNoOp: () => boolean = () => false): Promise<T | undefined> {
    const operation = this.chain.then(async () => {
      if (isNoOp()) return undefined
      await this.dependencies.stopIngress()
      await this.dependencies.cancelAndWait()
      const result = await commit()
      await this.dependencies.resetAndRefresh(accountId)
      await this.dependencies.setIdentity(accountId)
      return result
    }).catch((error) => { this.dependencies.fail(); throw error })
    this.chain = operation.then(() => undefined, () => undefined)
    return operation
  }


  switchResolved<T>(resolve: () => { accountId: string; commit: () => T | Promise<T>; noOp?: boolean }): Promise<T | undefined> {
    const operation = this.chain.then(async () => {
      const plan = resolve()
      if (plan.noOp) return undefined
      await this.dependencies.stopIngress()
      await this.dependencies.cancelAndWait()
      const result = await plan.commit()
      await this.dependencies.resetAndRefresh(plan.accountId)
      await this.dependencies.setIdentity(plan.accountId)
      return result
    }).catch((error) => { this.dependencies.fail(); throw error })
    this.chain = operation.then(() => undefined, () => undefined)
    return operation
  }
}
