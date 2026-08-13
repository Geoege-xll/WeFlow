import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ElementType,
  type ReactElement,
  type ReactNode
} from 'react'

export interface DetailChromeDeclaration {
  title?: ReactNode
  subtitle?: ReactNode
  icon?: ElementType | ReactElement
  headerFilters?: ReactNode
  headerActions?: ReactNode
}

interface DetailChromeStore {
  getSnapshot: () => DetailChromeDeclaration | undefined
  subscribe: (listener: () => void) => () => void
  register: (owner: symbol, declaration: DetailChromeDeclaration) => () => void
  update: (owner: symbol, declaration: DetailChromeDeclaration) => void
}

const createDetailChromeStore = (): DetailChromeStore => {
  const registrations = new Map<symbol, DetailChromeDeclaration>()
  const order: symbol[] = []
  const listeners = new Set<() => void>()
  let snapshot: DetailChromeDeclaration | undefined

  const publish = () => {
    snapshot = order.length > 0 ? registrations.get(order[order.length - 1]) : undefined
    listeners.forEach((listener) => listener())
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    register: (owner, declaration) => {
      registrations.set(owner, declaration)
      order.push(owner)
      publish()
      return () => {
        const index = order.indexOf(owner)
        if (index < 0) return
        const wasActive = index === order.length - 1
        order.splice(index, 1)
        registrations.delete(owner)
        if (wasActive) publish()
      }
    },
    update: (owner, declaration) => {
      if (!registrations.has(owner)) return
      registrations.set(owner, declaration)
      if (order[order.length - 1] === owner && snapshot !== declaration) publish()
    }
  }
}

const DetailChromeContext = createContext<DetailChromeStore | null>(null)

export function DetailChromeProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<DetailChromeStore | null>(null)
  if (!storeRef.current) storeRef.current = createDetailChromeStore()

  return (
    <DetailChromeContext.Provider value={storeRef.current}>
      {children}
    </DetailChromeContext.Provider>
  )
}

export function useDetailChrome(): DetailChromeDeclaration | undefined {
  const store = useContext(DetailChromeContext)
  return useSyncExternalStore(
    store?.subscribe ?? (() => () => undefined),
    store?.getSnapshot ?? (() => undefined),
    store?.getSnapshot ?? (() => undefined)
  )
}

export function useDetailChromeRegistration(declaration: DetailChromeDeclaration): boolean {
  const store = useContext(DetailChromeContext)
  const ownerRef = useRef<symbol | null>(null)
  const declarationRef = useRef(declaration)
  declarationRef.current = declaration
  if (!ownerRef.current) ownerRef.current = Symbol('detail-chrome-owner')

  useLayoutEffect(() => {
    if (!store || !ownerRef.current) return
    return store.register(ownerRef.current, declarationRef.current)
  }, [store])

  useLayoutEffect(() => {
    if (store && ownerRef.current) store.update(ownerRef.current, declaration)
  })

  return store !== null
}
