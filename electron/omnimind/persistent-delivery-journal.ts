import type {
  OpenRecoveryDeliveryClaim,
  OpenRecoveryDeliveryItem
} from '../../shared/omnimind/contracts'

export type DeliveryJournalState =
  | 'claim_pending'
  | 'claimed'
  | 'sending'
  | 'confirmed_sent'
  | 'ack_pending'
  | 'acked'
  | 'not_sent_pending'
  | 'not_sent'
  | 'result_unknown_pending'
  | 'result_unknown'
  | 'reconcile_pending'
  /** 旧版本曾把未知服务端状态误记为 settled；保留解析能力，并由恢复循环升级为待对账。 */
  | 'settled'

export interface PersistedRoute {
  sessionReference: string
  accountId: string
  sessionId: string
  updatedAt: number
}

export interface PersistedDeliveryEntry {
  deliveryId: string
  fulfillmentId: string
  attemptNumber: number
  parentDeliveryId?: string
  routeReference: string
  accountId: string
  sessionId: string
  /** 已通过坐席审核的最终正文；只存在于 safeStorage 加密后的本地主进程文件中。 */
  content: string
  /** 同一实例的稳定认领者；claim 响应丢失时必须使用同一值恢复认领结果。 */
  leaseOwner?: string
  /** claim_pending 尚未取得租约；其余需要终态上报的状态必须携带完整租约事实。 */
  leaseToken?: string
  leaseExpiresAt?: string
  fencingToken?: number
  state: DeliveryJournalState
  providerMessageId?: string
  failureCode?: string
  updatedAt: number
}

interface JournalState {
  routes: Record<string, PersistedRoute>
  deliveries: Record<string, PersistedDeliveryEntry>
}

interface SafeStoragePort {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

interface JournalDependencies {
  safeStorage: SafeStoragePort
  read: () => Promise<string | undefined>
  writeAtomic: (value: string) => Promise<void>
  quarantine?: (raw: string) => Promise<void>
  now?: () => number
}

const STATES: readonly DeliveryJournalState[] = [
  'claim_pending', 'claimed', 'sending', 'confirmed_sent', 'ack_pending', 'acked',
  'not_sent_pending', 'not_sent', 'result_unknown_pending', 'result_unknown',
  'reconcile_pending', 'settled'
]
// 只有服务端已经确认的三个业务结果才可归档。pending/claimed、404/409 和旧 settled 都不是成功事实。
const TERMINAL_STATES = new Set<DeliveryJournalState>(['acked', 'not_sent', 'result_unknown'])
const emptyState = (): JournalState => ({ routes: {}, deliveries: {} })

const strictString = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim())

/**
 * Delivery journal 是发送副作用的本地 write-ahead log。
 *
 * 外层文件只有版本和 safeStorage 密文；微信 sessionId、租约、审核正文、渠道确认摘要全部
 * 在密文内。每次状态迁移都通过调用方提供的 0600 临时文件 + rename 原子落盘，确保崩溃后
 * 最坏只回到上一个完整事实，而不会读到半截 JSON 后盲目重发。
 */
export class PersistentDeliveryJournal {
  private cached?: JournalState
  private mutationTail: Promise<void> = Promise.resolve()

  constructor(private readonly dependencies: JournalDependencies) {}

  recordRoute(sessionReference: string, accountId: string, sessionId: string): Promise<void> {
    return this.mutate((state) => {
      if (!strictString(sessionReference) || !strictString(accountId) || !strictString(sessionId)) throw new Error('delivery_route_invalid')
      state.routes[sessionReference] = { sessionReference, accountId, sessionId, updatedAt: this.now() }
      // 路由只为未来恢复投递服务；限制数量可避免长期运行无限膨胀。优先淘汰最旧记录，
      // 活跃 Delivery 已复制 account/session，不会因路由淘汰丢失在途恢复能力。
      this.pruneOldest(state.routes, 2_000)
    })
  }

  async getRoute(sessionReference: string, accountId: string): Promise<PersistedRoute | undefined> {
    const route = (await this.load()).routes[sessionReference]
    return route?.accountId === accountId ? { ...route } : undefined
  }

  async getDelivery(deliveryId: string): Promise<PersistedDeliveryEntry | undefined> {
    const entry = (await this.load()).deliveries[deliveryId]
    return entry ? { ...entry } : undefined
  }

  async listRecoverable(accountId: string): Promise<PersistedDeliveryEntry[]> {
    return Object.values((await this.load()).deliveries)
      .filter((entry) => entry.accountId === accountId && !TERMINAL_STATES.has(entry.state))
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .map((entry) => ({ ...entry }))
  }

  /**
   * 在发起 claim 网络请求之前持久化最小可恢复意图。
   *
   * 该条目位于 safeStorage 密文内，保存服务端 Delivery identity、已审核正文和本地路由，
   * 但不保存 API Key。这样即使 claim 响应在网络中丢失，重启后仍能以同一个 leaseOwner
   * 恢复认领，而不会把同一 Delivery 当作新消息再次发送。
   */
  recordClaimIntent(item: OpenRecoveryDeliveryItem, route: PersistedRoute, leaseOwner: string): Promise<void> {
    return this.mutate((state) => {
      const existing = state.deliveries[item.deliveryId]
      if (existing) return
      if (route.sessionReference !== item.sessionReference || !strictString(leaseOwner)) throw new Error('delivery_claim_intent_mismatch')
      state.deliveries[item.deliveryId] = {
        deliveryId: item.deliveryId,
        fulfillmentId: item.fulfillmentId,
        attemptNumber: item.attemptNumber,
        ...(item.parentDeliveryId ? { parentDeliveryId: item.parentDeliveryId } : {}),
        routeReference: item.routeReference,
        accountId: route.accountId,
        sessionId: route.sessionId,
        content: item.content,
        leaseOwner,
        state: 'claim_pending',
        updatedAt: this.now()
      }
    })
  }

  /** claim 成功后只补写租约；必须已有落盘的 claim_pending，杜绝响应与 journal 之间的空窗。 */
  recordClaimed(deliveryId: string, claim: OpenRecoveryDeliveryClaim): Promise<PersistedDeliveryEntry> {
    if (claim.deliveryId !== deliveryId) return Promise.reject(new Error('delivery_claim_mismatch'))
    return this.transition(deliveryId, ['claim_pending'], 'claimed', (entry) => {
      entry.leaseToken = claim.leaseToken
      entry.leaseExpiresAt = claim.leaseExpiresAt
      entry.fencingToken = claim.fencingToken
    })
  }

  markSending(deliveryId: string): Promise<PersistedDeliveryEntry> {
    return this.transition(deliveryId, ['claimed'], 'sending')
  }

  async markConfirmedSent(deliveryId: string, providerMessageId: string): Promise<PersistedDeliveryEntry> {
    if (!strictString(providerMessageId)) throw new Error('delivery_provider_message_id_invalid')
    return this.transition(deliveryId, ['sending'], 'confirmed_sent', (entry) => { entry.providerMessageId = providerMessageId })
  }

  markAckPending(deliveryId: string): Promise<PersistedDeliveryEntry> {
    return this.transition(deliveryId, ['confirmed_sent', 'ack_pending'], 'ack_pending')
  }

  markNotSentPending(deliveryId: string, failureCode: string): Promise<PersistedDeliveryEntry> {
    return this.transition(deliveryId, ['sending', 'not_sent_pending'], 'not_sent_pending', (entry) => {
      entry.failureCode = this.safeFailureCode(failureCode, 'connector_not_sent')
    })
  }

  markResultUnknownPending(deliveryId: string, failureCode: string): Promise<PersistedDeliveryEntry> {
    return this.transition(deliveryId, ['sending', 'result_unknown_pending'], 'result_unknown_pending', (entry) => {
      entry.failureCode = this.safeFailureCode(failureCode, 'connector_result_unknown')
    })
  }

  /**
   * 本地不能证明服务端终态时，冻结为“只对账”。该状态禁止再次 claim、禁止再次渠道发送，
   * 仅允许后续 GET 服务端权威状态，直到出现 confirmed_sent/not_sent/result_unknown。
   */
  markReconcilePending(deliveryId: string): Promise<PersistedDeliveryEntry> {
    return this.transition(deliveryId, STATES, 'reconcile_pending')
  }

  settle(deliveryId: string, state: Extract<DeliveryJournalState, 'acked' | 'not_sent' | 'result_unknown'>): Promise<PersistedDeliveryEntry> {
    return this.transition(deliveryId, STATES, state)
  }

  private transition(
    deliveryId: string,
    allowed: readonly DeliveryJournalState[],
    target: DeliveryJournalState,
    update?: (entry: PersistedDeliveryEntry) => void
  ): Promise<PersistedDeliveryEntry> {
    let projected: PersistedDeliveryEntry | undefined
    return this.mutate((state) => {
      const entry = state.deliveries[deliveryId]
      if (!entry || !allowed.includes(entry.state)) throw new Error('delivery_journal_state_conflict')
      entry.state = target
      entry.updatedAt = this.now()
      update?.(entry)
      projected = { ...entry }
      this.pruneTerminal(state)
    }).then(() => projected!)
  }

  private mutate(update: (state: JournalState) => void): Promise<void> {
    const operation = this.mutationTail.then(async () => {
      // copy-on-write 很关键：若 writeAtomic 失败，内存缓存必须仍指向上一个已持久化事实。
      // 否则“磁盘是 claim_pending、内存却是 claimed”会掩盖 claim→journal 崩溃窗口。
      const state = this.cloneState(await this.load())
      update(state)
      await this.persist(state)
    })
    // 当前调用仍获得真实失败；tail 自身收敛，避免一次磁盘错误永久毒化后续对账。
    this.mutationTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async load(): Promise<JournalState> {
    if (this.cached) return this.cached
    if (!this.dependencies.safeStorage.isEncryptionAvailable()) throw new Error('delivery_secure_storage_unavailable')
    const raw = await this.dependencies.read()
    if (!raw) return this.cached = emptyState()
    try {
      const envelope = JSON.parse(raw) as { schemaVersion?: unknown; ciphertext?: unknown }
      if (!envelope || envelope.schemaVersion !== 1 || typeof envelope.ciphertext !== 'string' || Object.keys(envelope).some((key) => !['schemaVersion', 'ciphertext'].includes(key))) {
        throw new Error('delivery_journal_corrupt')
      }
      const decrypted = this.dependencies.safeStorage.decryptString(Buffer.from(envelope.ciphertext, 'base64'))
      const parsed = JSON.parse(decrypted) as unknown
      this.cached = this.parseState(parsed)
      return this.cached
    } catch {
      // 损坏文件先隔离再使用空状态。无法证明旧 sending 是否发生时，空 journal 不会触发发送；
      // 服务端既有 claimed 行也不会重新出现在 queued list 中，因此这是 fail closed 恢复。
      await this.dependencies.quarantine?.(raw)
      return this.cached = emptyState()
    }
  }

  private parseState(value: unknown): JournalState {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('delivery_journal_corrupt')
    const root = value as Record<string, unknown>
    if (Object.keys(root).some((key) => !['routes', 'deliveries'].includes(key)) || !root.routes || !root.deliveries) throw new Error('delivery_journal_corrupt')
    if (typeof root.routes !== 'object' || Array.isArray(root.routes) || typeof root.deliveries !== 'object' || Array.isArray(root.deliveries)) throw new Error('delivery_journal_corrupt')
    const routes: Record<string, PersistedRoute> = {}
    for (const [key, raw] of Object.entries(root.routes as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('delivery_journal_corrupt')
      const item = raw as Record<string, unknown>
      if (Object.keys(item).some((field) => !['sessionReference', 'accountId', 'sessionId', 'updatedAt'].includes(field))
        || item.sessionReference !== key || !strictString(item.accountId) || !strictString(item.sessionId) || !Number.isFinite(item.updatedAt)) throw new Error('delivery_journal_corrupt')
      routes[key] = item as unknown as PersistedRoute
    }
    const deliveries: Record<string, PersistedDeliveryEntry> = {}
    for (const [key, raw] of Object.entries(root.deliveries as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('delivery_journal_corrupt')
      const item = raw as Record<string, unknown>
      const allowed = [
        'deliveryId', 'fulfillmentId', 'attemptNumber', 'parentDeliveryId', 'routeReference', 'accountId',
        'sessionId', 'content', 'leaseOwner', 'leaseToken', 'leaseExpiresAt', 'fencingToken', 'state',
        'providerMessageId', 'failureCode', 'updatedAt'
      ]
      const state = item.state as DeliveryJournalState
      const hasCommonFields = ['fulfillmentId', 'routeReference', 'accountId', 'sessionId', 'content']
        .every((field) => strictString(item[field]))
      const hasLease = strictString(item.leaseToken)
        && strictString(item.leaseExpiresAt)
        && Number.isInteger(item.fencingToken)
        && Number(item.fencingToken) > 0
      if (Object.keys(item).some((field) => !allowed.includes(field))
        || item.deliveryId !== key
        || !hasCommonFields
        || !Number.isInteger(item.attemptNumber) || Number(item.attemptNumber) <= 0
        || !STATES.includes(state)
        || (state === 'claim_pending' && !strictString(item.leaseOwner))
        // claim 请求可能已被服务端接受但客户端只看到 409/404，此时 reconcile_pending
        // 合法地没有租约响应；它只能 GET，不需要伪造 lease/fence。
        || (!['claim_pending', 'reconcile_pending'].includes(state) && !hasLease)
        || !Number.isFinite(item.updatedAt)) throw new Error('delivery_journal_corrupt')
      deliveries[key] = item as unknown as PersistedDeliveryEntry
    }
    return { routes, deliveries }
  }

  private async persist(state: JournalState): Promise<void> {
    if (!this.dependencies.safeStorage.isEncryptionAvailable()) throw new Error('delivery_secure_storage_unavailable')
    let ciphertext: string
    try { ciphertext = this.dependencies.safeStorage.encryptString(JSON.stringify(state)).toString('base64') } catch {
      throw new Error('delivery_secure_storage_encrypt_failed')
    }
    await this.dependencies.writeAtomic(JSON.stringify({ schemaVersion: 1, ciphertext }))
    this.cached = state
  }

  private cloneState(state: JournalState): JournalState {
    return {
      routes: Object.fromEntries(Object.entries(state.routes).map(([key, value]) => [key, { ...value }])),
      deliveries: Object.fromEntries(Object.entries(state.deliveries).map(([key, value]) => [key, { ...value }]))
    }
  }

  private pruneTerminal(state: JournalState): void {
    const terminal = Object.fromEntries(Object.entries(state.deliveries).filter(([, entry]) => TERMINAL_STATES.has(entry.state)))
    this.pruneOldest(terminal, 500, (key) => { delete state.deliveries[key] })
  }

  private pruneOldest<T extends { updatedAt: number }>(record: Record<string, T>, limit: number, remove?: (key: string) => void): void {
    const excess = Object.keys(record).length - limit
    if (excess <= 0) return
    const oldest = Object.entries(record).sort(([, left], [, right]) => left.updatedAt - right.updatedAt).slice(0, excess)
    for (const [key] of oldest) remove ? remove(key) : delete record[key]
  }

  private safeFailureCode(value: string, fallback: string): string {
    const normalized = String(value || '').trim().toLowerCase()
    return /^[a-z0-9_]{1,64}$/.test(normalized) ? normalized : fallback
  }

  private now(): number { return this.dependencies.now?.() ?? Date.now() }
}
