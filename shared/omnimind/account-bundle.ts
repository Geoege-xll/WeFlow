export interface AccountConfigBundle {
  myWxid: string
  dbPath: string
  decryptKey: string
  imageXorKey: number
  imageAesKey: string
  cachePath: string
  lastOpenedDb: string
}

export type AccountConfigPatch = Partial<AccountConfigBundle>
export type AccountConfigPatchPayload = AccountConfigPatch & { expectedAccountId?: string }
const accountBundleKeys = ['myWxid', 'dbPath', 'decryptKey', 'imageXorKey', 'imageAesKey', 'cachePath', 'lastOpenedDb'] as const

export const isValidImageXorKey = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xff

export const isValidImageAesKey = (value: unknown): value is string =>
  typeof value === 'string' && (value === '' || /^[\x20-\x7e]{16}$/.test(value) || /^[0-9a-fA-F]{32}$/.test(value))

export const parseAccountConfigBundle = (value: unknown): AccountConfigBundle => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid account bundle')
  const record = value as Record<string, unknown>
  const keys = accountBundleKeys
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record))) throw new Error('Invalid account bundle')
  for (const key of keys.filter((key) => key !== 'imageXorKey')) if (typeof record[key] !== 'string') throw new Error('Invalid account bundle')
  if (!isValidImageXorKey(record.imageXorKey) || !isValidImageAesKey(record.imageAesKey)) throw new Error('Invalid account bundle')
  return record as unknown as AccountConfigBundle
}

export const parseAccountConfigPatch = (value: unknown): { patch: AccountConfigPatch; expectedAccountId?: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid account patch')
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  const patchKeys = keys.filter((key) => key !== 'expectedAccountId')
  if (patchKeys.length === 0 || keys.some((key) => key !== 'expectedAccountId' && !accountBundleKeys.includes(key as typeof accountBundleKeys[number]))) throw new Error('Invalid account patch')
  if (record.expectedAccountId !== undefined && typeof record.expectedAccountId !== 'string') throw new Error('Invalid account patch')
  for (const key of patchKeys) {
    const item = record[key]
    if (key === 'imageXorKey') {
      if (!isValidImageXorKey(item)) throw new Error('Invalid account patch')
    } else if (key === 'imageAesKey') {
      if (!isValidImageAesKey(item)) throw new Error('Invalid account patch')
    } else if (typeof item !== 'string') throw new Error('Invalid account patch')
  }
  const patch = Object.fromEntries(patchKeys.map((key) => [key, record[key]])) as AccountConfigPatch
  return { patch, ...(record.expectedAccountId !== undefined ? { expectedAccountId: String(record.expectedAccountId) } : {}) }
}
