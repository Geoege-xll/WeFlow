import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import {
  createOfficeWebGLRenderer,
  type OfficeSeatId,
  type OfficeSeatProjection,
  type OfficeSeatTone,
  type OfficeWebGLRenderer
} from './officeWebGLRenderer'
import { createOfficeThreeRenderer } from './officeThreeRenderer'
import type { DollActivity } from './dolls/dollContracts'
import { OFFICE_VISUAL_CONTRACT } from './officeCamera'

export interface DollOfficeRole {
  id: OfficeSeatId
  order: string
  title: string
  responsibility: string
  status: string
  statusTitle: string
  statusDescription: string
  tone: OfficeSeatTone
  activity: DollActivity
}

const DEFAULT_PROJECTION: OfficeSeatProjection = {
  data: { x: 190, y: 75 },
  ai: { x: 430, y: 75 },
  insight: { x: 190, y: 220 },
  tasks: { x: 430, y: 220 }
}

const projectionChanged = (previous: OfficeSeatProjection, next: OfficeSeatProjection): boolean =>
  (Object.keys(next) as OfficeSeatId[]).some((id) => Math.abs(previous[id].x - next[id].x) > 0.5 || Math.abs(previous[id].y - next[id].y) > 0.5)

const readTheme = (): 'light' | 'dark' => document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'light'

/**
 * 固定镜头的 3D 四岗位办公室。
 *
 * WebGL 只负责可视化同一份业务状态，不持有 readiness 或托管状态机。所有可访问操作
 * 都由叠加在场景内的真实按钮承担；GPU 初始化失败时切换到等价的二维按钮网格，
 * 因而画布支持与否不会影响岗位信息、键盘操作或业务真值。
 */
export function DollOfficeScene({ roles }: { roles: DollOfficeRole[] }) {
  const sceneRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<OfficeWebGLRenderer | null>(null)
  const animationFrameRef = useRef(0)
  const resizeFrameRef = useRef(0)
  const openerRef = useRef<HTMLElement | null>(null)
  const popoverRef = useRef<HTMLElement>(null)
  const projectionRef = useRef<OfficeSeatProjection>(DEFAULT_PROJECTION)
  const [projection, setProjection] = useState(DEFAULT_PROJECTION)
  const [activeRoleId, setActiveRoleId] = useState<OfficeSeatId | null>(null)
  const [renderMode, setRenderMode] = useState<'loading' | 'webgl' | 'fallback'>('loading')
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden')
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const [theme, setTheme] = useState<'light' | 'dark'>(readTheme)

  const activeRole = roles.find((role) => role.id === activeRoleId) ?? null
  const seats = useMemo(() => roles.map((role) => ({
    id: role.id,
    tone: role.tone,
    activity: role.activity,
    selected: role.id === activeRoleId
  })), [activeRoleId, roles])
  const sceneVisualStyle = useMemo(() => {
    const palette = OFFICE_VISUAL_CONTRACT.themes[theme]
    const dom = OFFICE_VISUAL_CONTRACT.layout.nameplate.dom
    // GPU 场景、加载态、二维安全模式和可访问文字层共享同一主题与尺寸合同；CSS 不再保留第二套牌子魔法数。
    return {
      '--office-studio-background': palette.wall,
      '--office-nameplate-background': palette.nameplate,
      '--office-nameplate-compact-width': `${dom.compactFullSizePx[0]}px`,
      '--office-nameplate-desktop-width': `${dom.desktopFullSizePx[0]}px`,
      '--office-nameplate-width-percent': `${dom.widthPercent}%`,
      '--office-nameplate-compact-height': `${dom.compactFullSizePx[1]}px`,
      '--office-nameplate-desktop-height': `${dom.desktopFullSizePx[1]}px`,
      '--office-nameplate-height-percent': `${dom.heightPercent}%`,
      '--office-nameplate-translate-x': `${dom.translateRatio[0] * 100}%`,
      '--office-nameplate-translate-y': `${dom.translateRatio[1] * 100}%`
    } as CSSProperties
  }, [theme])

  const closePopover = useCallback((restoreFocus: boolean): void => {
    setActiveRoleId(null)
    if (!restoreFocus) {
      openerRef.current = null
      return
    }
    const opener = openerRef.current
    openerRef.current = null
    window.requestAnimationFrame(() => {
      if (opener?.isConnected && typeof opener.focus === 'function') opener.focus()
    })
  }, [])

  const toggleRole = useCallback((id: OfficeSeatId, opener: HTMLElement): void => {
    if (activeRoleId === id) {
      closePopover(true)
      return
    }
    rendererRef.current?.triggerJump?.(id)
    openerRef.current = opener
    setActiveRoleId(id)
  }, [activeRoleId, closePopover])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false
    try {
      try {
        rendererRef.current = createOfficeThreeRenderer(canvas, {
          onProjection: (next: OfficeSeatProjection) => {
            if (disposed || !projectionChanged(projectionRef.current, next)) return
            projectionRef.current = next
            setProjection(next)
          }
        })
      } catch {
        rendererRef.current = createOfficeWebGLRenderer(canvas, {
          onProjection: (next: OfficeSeatProjection) => {
            if (disposed || !projectionChanged(projectionRef.current, next)) return
            projectionRef.current = next
            setProjection(next)
          }
        })
      }
      setRenderMode('webgl')
    } catch {
      // WebGL 缺失、着色器失败或上下文受限都视为能力不可用；不记录底层驱动文本，
      // 避免无意义 console error，并立即保留完整的二维岗位操作路径。
      rendererRef.current = null
      setRenderMode('fallback')
    }

    const handleContextLost = (event: Event): void => {
      event.preventDefault()
      window.cancelAnimationFrame(animationFrameRef.current)
      rendererRef.current?.dispose()
      rendererRef.current = null
      setRenderMode('fallback')
    }
    canvas.addEventListener('webglcontextlost', handleContextLost)
    return () => {
      disposed = true
      window.cancelAnimationFrame(animationFrameRef.current)
      canvas.removeEventListener('webglcontextlost', handleContextLost)
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const handleMotion = (event: MediaQueryListEvent): void => setReducedMotion(event.matches)
    media?.addEventListener?.('change', handleMotion)
    return () => media?.removeEventListener?.('change', handleMotion)
  }, [])

  useEffect(() => {
    const handleVisibility = (): void => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  useEffect(() => {
    // 应用主题由根节点 data-mode 统一管理；MutationObserver 只同步渲染配色，
    // 不读取或改变任何业务状态。
    const observer = new MutationObserver(() => setTheme(readTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    let stopped = false
    let latestSize: { width: number; height: number } | null = null

    const scheduleResize = (width: number, height: number): void => {
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
      latestSize = { width, height }
      if (resizeFrameRef.current) return
      // ResizeObserver 在连续拖拽时可能一帧触发多次；只提交最后一个 contentRect，避免反复重建投影矩阵。
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = 0
        if (stopped || !latestSize) return
        const size = latestSize
        latestSize = null
        const renderer = rendererRef.current
        if (!renderer) return
        renderer.resize(size.width, size.height, Math.min(window.devicePixelRatio || 1, 2))
        if (document.visibilityState !== 'hidden') renderer.render(performance.now(), false)
      })
    }
    const measureScene = (): void => {
      const rect = scene.getBoundingClientRect()
      scheduleResize(rect.width, rect.height)
    }

    measureScene()
    if (typeof ResizeObserver === 'undefined') {
      // 旧环境只把 window resize 当作触发器，尺寸真值仍来自 scene content rect。
      window.addEventListener('resize', measureScene)
      return () => {
        stopped = true
        window.removeEventListener('resize', measureScene)
        window.cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = 0
      }
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === scene) ?? entries[0]
      if (entry) scheduleResize(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(scene)
    return () => {
      stopped = true
      observer.disconnect()
      window.cancelAnimationFrame(resizeFrameRef.current)
      resizeFrameRef.current = 0
    }
  }, [])

  useEffect(() => {
    const renderer = rendererRef.current
    window.cancelAnimationFrame(animationFrameRef.current)
    if (!renderer || renderMode !== 'webgl') return
    renderer.setSeats(seats)
    renderer.setTheme(theme)
    if (!visible) return

    if (reducedMotion) {
      // reduced-motion 仍绘制一帧完整 3D 场景，只停止玩偶循环动作。
      renderer.render(performance.now(), false)
      return
    }
    const draw = (time: number): void => {
      renderer.render(time, true)
      animationFrameRef.current = window.requestAnimationFrame(draw)
    }
    animationFrameRef.current = window.requestAnimationFrame(draw)
    return () => window.cancelAnimationFrame(animationFrameRef.current)
  }, [reducedMotion, renderMode, seats, theme, visible])

  useEffect(() => {
    if (!activeRole) return
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closePopover(true)
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [activeRole, closePopover])

  useEffect(() => {
    const scene = sceneRef.current
    const popover = popoverRef.current
    if (!scene || !popover || !activeRoleId) return
    const frame = window.requestAnimationFrame(() => {
      const point = projection[activeRoleId]
      const width = popover.offsetWidth
      const height = popover.offsetHeight
      const sceneWidth = scene.clientWidth
      const sceneHeight = scene.clientHeight
      let left = point.x < sceneWidth / 2 ? point.x + 18 : point.x - width - 18
      let top = point.y < sceneHeight / 2 ? point.y + 8 : point.y - height - 8
      left = Math.max(8, Math.min(sceneWidth - width - 8, left))
      top = Math.max(8, Math.min(sceneHeight - height - 8, top))
      popover.style.left = `${left}px`
      popover.style.top = `${top}px`
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeRoleId, projection])

  const handleCanvasClick = (event: ReactMouseEvent<HTMLCanvasElement>): void => {
    const hit = rendererRef.current?.hitTest(event.clientX, event.clientY)
    if (hit) toggleRole(hit, event.currentTarget)
    else closePopover(true)
  }

  const handleMouseMove = (event: ReactMouseEvent<HTMLElement>): void => {
    const scene = sceneRef.current
    if (!scene) return
    const rect = scene.getBoundingClientRect()
    rendererRef.current?.setPointer?.(event.clientX - rect.left, event.clientY - rect.top)
  }

  const handleMouseLeave = (): void => {
    rendererRef.current?.setPointer?.(null, null)
  }

  return (
    <section
      ref={sceneRef}
      className="home-zone home-scene-zone"
      style={sceneVisualStyle}
      aria-label="固定视角 3D 四玩偶办公室"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onMouseDown={(event) => {
        // 只把 scene 自身视为空白；点击岗位按钮或只读卡不会被冒泡误关。
        if (event.target === event.currentTarget) closePopover(true)
      }}
    >
      <canvas
        ref={canvasRef}
        className="home-office-canvas"
        aria-label="固定正交视角的 WebGL 四工位办公室；请使用场景中的中文岗位牌进行键盘操作"
        tabIndex={-1}
        hidden={renderMode === 'fallback'}
        onClick={handleCanvasClick}
      />

      {renderMode === 'loading' && <div className="home-office-loading" role="status">3D 办公室准备中</div>}

      {renderMode === 'fallback' && (
        <div className="home-office-fallback" aria-label="二维安全模式岗位列表">
          <div role="status">
            <strong>二维安全模式</strong>
            <span>3D 加速不可用，岗位状态与操作保持完整。</span>
          </div>
          <div className="home-office-fallback-grid">
            {roles.map((role) => (
              <button key={role.id} type="button" className={`tone-${role.tone}`} aria-label={`${role.order} ${role.title}`} aria-expanded={activeRoleId === role.id} onClick={(event) => toggleRole(role.id, event.currentTarget)}>
                <span aria-hidden="true">{role.order}</span><strong>{role.title}</strong>
              </button>
            ))}
          </div>
        </div>
      )}

      {renderMode === 'webgl' && roles.map((role) => (
        <button
          key={role.id}
          type="button"
          className={`home-office-label tone-${role.tone}`}
          style={{ left: projection[role.id].x, top: projection[role.id].y }}
          aria-label={`${role.order} ${role.title}`}
          aria-expanded={activeRoleId === role.id}
          aria-controls="home-office-role-popover"
          onClick={(event) => toggleRole(role.id, event.currentTarget)}
        >
          <span aria-hidden="true">{role.order}</span><strong>{role.title}</strong>
        </button>
      ))}

      {activeRole && (
        <aside
          ref={popoverRef}
          id="home-office-role-popover"
          className="home-office-popover"
          role="status"
          aria-live="polite"
          aria-labelledby="home-office-popover-title"
        >
          <h2 id="home-office-popover-title">{activeRole.title}</h2>
          <p className="home-office-responsibility">职责：{activeRole.responsibility}</p>
          <div className="home-office-popover-status">
            <strong>{activeRole.statusTitle}</strong>
            <p>{activeRole.statusDescription}</p>
          </div>
        </aside>
      )}
    </section>
  )
}
