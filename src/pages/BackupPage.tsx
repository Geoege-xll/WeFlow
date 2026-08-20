import { useEffect, useMemo, useState } from 'react'
import { ArchiveRestore, Database, Download, File, FileArchive, Hash, Image, Table, Upload, Video } from 'lucide-react'
import { AppCard, AppPageContainer } from '../components/common'
import './BackupPage.scss'

type BackupManifest = NonNullable<Awaited<ReturnType<typeof window.electronAPI.backup.inspect>>['manifest']>
type BackupProgress = Parameters<Parameters<typeof window.electronAPI.backup.onProgress>[0]>[0]

function formatDate(value?: string): string {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

function summarizeManifest(manifest?: BackupManifest | null) {
  if (!manifest) return { dbCount: 0, tableCount: 0, rowCount: 0, resourceCount: 0 }
  let tableCount = 0
  let rowCount = 0
  for (const db of manifest.databases || []) {
    tableCount += db.tables?.length || 0
    rowCount += (db.tables || []).reduce((sum, table) => sum + (table.rows || 0), 0)
  }
  const resourceCount =
    (manifest.resources?.images?.length || 0) +
    (manifest.resources?.videos?.length || 0) +
    (manifest.resources?.files?.length || 0)
  return { dbCount: manifest.databases?.length || 0, tableCount, rowCount, resourceCount }
}

function BackupPage() {
  const [progress, setProgress] = useState<BackupProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [selectedArchive, setSelectedArchive] = useState('')
  const [manifest, setManifest] = useState<BackupManifest | null>(null)
  const [restoreSummary, setRestoreSummary] = useState<{ inserted: number; ignored: number; skipped: number } | null>(null)
  const [resourceOptions, setResourceOptions] = useState({
    includeImages: false,
    includeVideos: false,
    includeFiles: false
  })

  useEffect(() => {
    return window.electronAPI.backup.onProgress(setProgress)
  }, [])

  const summary = useMemo(() => summarizeManifest(manifest), [manifest])
  const percent = progress?.total && progress.total > 0
    ? Math.min(100, Math.round(((progress.current || 0) / progress.total) * 100))
    : (busy ? 8 : 0)

  const handleCreateBackup = async () => {
    if (busy) return
    setBusy(true)
    setProgress(null)
    setMessage('')
    setRestoreSummary(null)
    try {
      const hasResources = resourceOptions.includeImages || resourceOptions.includeVideos || resourceOptions.includeFiles
      const extension = hasResources ? 'tar' : 'tar.gz'
      const defaultPath = `omnimind-wechat-db-backup-${new Date().toISOString().slice(0, 10)}.${extension}`
      const result = await window.electronAPI.dialog.saveFile({
        title: '保存数据库备份',
        defaultPath,
        filters: [{ name: 'OmniMindWeChat 数据库备份', extensions: hasResources ? ['tar'] : ['gz'] }]
      })
      if (result.canceled || !result.filePath) {
        setMessage('已取消')
        return
      }
      const created = await window.electronAPI.backup.create({
        outputPath: result.filePath,
        options: resourceOptions
      })
      if (!created.success) {
        setProgress(null)
        setMessage(created.error || '备份失败')
        return
      }
      setSelectedArchive(created.filePath || result.filePath)
      setManifest(created.manifest || null)
      setMessage('备份完成')
    } catch (error) {
      setProgress(null)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const handlePickArchive = async () => {
    if (busy) return
    setBusy(true)
    setProgress(null)
    setMessage('')
    setRestoreSummary(null)
    try {
      const result = await window.electronAPI.dialog.openFile({
        title: '选择数据库备份',
        properties: ['openFile'],
        filters: [
          { name: 'OmniMindWeChat 数据库备份', extensions: ['tar', 'gz', 'tgz'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      if (result.canceled || !result.filePaths?.[0]) {
        setMessage('已取消')
        return
      }
      const archivePath = result.filePaths[0]
      const inspected = await window.electronAPI.backup.inspect({ archivePath })
      if (!inspected.success) {
        setProgress(null)
        setMessage(inspected.error || '读取备份失败')
        return
      }
      setSelectedArchive(archivePath)
      setManifest(inspected.manifest || null)
      setMessage('备份包已读取')
    } catch (error) {
      setProgress(null)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const handleRestore = async () => {
    if (busy || !selectedArchive) return
    setBusy(true)
    setProgress(null)
    setMessage('')
    setRestoreSummary(null)
    try {
      const restored = await window.electronAPI.backup.restore({ archivePath: selectedArchive })
      if (!restored.success) {
        setProgress(null)
        setMessage(restored.error || '载入失败')
        return
      }
      setRestoreSummary({
        inserted: restored.inserted || 0,
        ignored: restored.ignored || 0,
        skipped: restored.skipped || 0
      })
      setMessage('载入完成')
    } catch (error) {
      setProgress(null)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppPageContainer
      title="数据库备份"
      className="backup-page-container"
      headerActions={
        <div className="backup-actions">
          <button className="mac-pill-btn primary-btn" onClick={handleCreateBackup} disabled={busy}>
            <Download size={15} />
            <span>创建备份</span>
          </button>
          <button className="mac-pill-btn secondary-btn" onClick={handlePickArchive} disabled={busy}>
            <FileArchive size={15} />
            <span>选择备份</span>
          </button>
          <button className="mac-pill-btn secondary-btn" onClick={handleRestore} disabled={busy || !selectedArchive}>
            <Upload size={15} />
            <span>载入</span>
          </button>
        </div>
      }
    >
      <div className="backup-page-content">
        <AppCard className="resource-options-group" aria-label="资源备份选项">
          <div className="group-label">资源备份选项</div>
          <div className="capsule-checkbox-group">
            <label className={`capsule-checkbox ${resourceOptions.includeImages ? 'is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={resourceOptions.includeImages}
                disabled={busy}
                onChange={(event) => setResourceOptions(prev => ({ ...prev, includeImages: event.target.checked }))}
              />
              <Image size={16} className="capsule-icon" />
              <span>图片</span>
            </label>
            <label className={`capsule-checkbox ${resourceOptions.includeVideos ? 'is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={resourceOptions.includeVideos}
                disabled={busy}
                onChange={(event) => setResourceOptions(prev => ({ ...prev, includeVideos: event.target.checked }))}
              />
              <Video size={16} className="capsule-icon" />
              <span>视频</span>
            </label>
            <label className={`capsule-checkbox ${resourceOptions.includeFiles ? 'is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={resourceOptions.includeFiles}
                disabled={busy}
                onChange={(event) => setResourceOptions(prev => ({ ...prev, includeFiles: event.target.checked }))}
              />
              <File size={16} className="capsule-icon" />
              <span>文件</span>
            </label>
          </div>
        </AppCard>

        <AppCard className="backup-status-card">
          <div className="status-badge">
            <ArchiveRestore size={20} />
          </div>
          <div className="status-content">
            <div className="status-title">{progress?.message || message || '等待操作'}</div>
            <div className="status-subtitle">{progress?.detail || selectedArchive || '未选择备份包'}</div>
            {busy && (
              <div className="status-progress-track">
                <div className="status-progress-fill" style={{ width: `${percent}%` }} />
              </div>
            )}
          </div>
        </AppCard>

        <div className="backup-summary-grid">
          <AppCard hoverElastic className="stat-card">
            <div className="stat-header">
              <div className="stat-icon-badge">
                <Database size={18} />
              </div>
              <span className="stat-label">数据库</span>
            </div>
            <div className="stat-value">{summary.dbCount}</div>
          </AppCard>

          <AppCard hoverElastic className="stat-card">
            <div className="stat-header">
              <div className="stat-icon-badge">
                <Table size={18} />
              </div>
              <span className="stat-label">表</span>
            </div>
            <div className="stat-value">{summary.tableCount}</div>
          </AppCard>

          <AppCard hoverElastic className="stat-card">
            <div className="stat-header">
              <div className="stat-icon-badge">
                <Hash size={18} />
              </div>
              <span className="stat-label">增量行</span>
            </div>
            <div className="stat-value">{summary.rowCount.toLocaleString()}</div>
          </AppCard>

          <AppCard hoverElastic className="stat-card">
            <div className="stat-header">
              <div className="stat-icon-badge">
                <FileArchive size={18} />
              </div>
              <span className="stat-label">资源文件</span>
            </div>
            <div className="stat-value">{summary.resourceCount.toLocaleString()}</div>
          </AppCard>
        </div>

        {manifest && (
          <AppCard className="backup-manifest-card">
            <div className="manifest-header">
              <h2 className="manifest-title">备份清册明细</h2>
              <span className="manifest-date">{formatDate(manifest.createdAt)}</span>
            </div>
            <div className="manifest-subcards-grid">
              <div className="subcard">
                <span className="subcard-label">来源账号</span>
                <strong className="subcard-value">{manifest.source.wxid || '-'}</strong>
              </div>
              <div className="subcard">
                <span className="subcard-label">版本</span>
                <strong className="subcard-value">{manifest.appVersion || '-'}</strong>
              </div>
              <div className="subcard full-width">
                <span className="subcard-label">资源</span>
                <strong className="subcard-value">
                  图片 {manifest.resources?.images?.length || 0} / 视频 {manifest.resources?.videos?.length || 0} / 文件 {manifest.resources?.files?.length || 0}
                </strong>
              </div>
            </div>
            <div className="db-list">
              {manifest.databases.map(db => (
                <div className="db-row-item" key={db.id}>
                  <span className="db-kind-badge">{db.kind}</span>
                  <strong className="db-table-count">{db.tables.length} 表</strong>
                  <span className="db-rel-path">{db.relativePath}</span>
                </div>
              ))}
            </div>
          </AppCard>
        )}

        {restoreSummary && (
          <div className="restore-result-grid">
            <AppCard hoverElastic className="stat-card">
              <span className="stat-label">新增</span>
              <strong className="stat-value">{restoreSummary.inserted.toLocaleString()}</strong>
            </AppCard>
            <AppCard hoverElastic className="stat-card">
              <span className="stat-label">已存在</span>
              <strong className="stat-value">{restoreSummary.ignored.toLocaleString()}</strong>
            </AppCard>
            <AppCard hoverElastic className="stat-card">
              <span className="stat-label">跳过</span>
              <strong className="stat-value">{restoreSummary.skipped.toLocaleString()}</strong>
            </AppCard>
          </div>
        )}
      </div>
    </AppPageContainer>
  )
}

export default BackupPage
