import { useCallback, useRef, useState } from 'react'

export function useOmniMindComposerAccountReadiness() {
  const [accountId, setAccountId] = useState<string>()
  const requestGenerationRef = useRef(0)

  const beginConnect = useCallback((): number => {
    setAccountId(undefined)
    requestGenerationRef.current += 1
    return requestGenerationRef.current
  }, [])

  const invalidate = useCallback((): void => {
    setAccountId(undefined)
    requestGenerationRef.current += 1
  }, [])

  const completeConnect = useCallback((request: number, value: unknown): boolean => {
    if (request !== requestGenerationRef.current) return false
    const nextAccountId = typeof value === 'string' ? value.trim() : ''
    setAccountId(nextAccountId || undefined)
    return Boolean(nextAccountId)
  }, [])

  const failConnect = useCallback((request: number): boolean => {
    if (request !== requestGenerationRef.current) return false
    setAccountId(undefined)
    return true
  }, [])

  return { accountId, beginConnect, invalidate, completeConnect, failConnect }
}
