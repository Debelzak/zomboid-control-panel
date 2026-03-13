import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Archive,
  Download,
  Trash2,
  RotateCcw,
  Loader2,
  Clock,
  HardDrive,
  FolderOpen,
  RefreshCw,
  Settings,
  AlertTriangle,
  Check,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/components/ui/use-toast'
import { useSocket } from '@/contexts/SocketContext'
import { backupApi, BackupStatus, BackupFile } from '@/lib/api'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'

interface BackupProgress {
  phase: 'preparing' | 'archiving' | 'finalizing' | 'complete' | 'error'
  percent: number
  message: string
  filesProcessed?: number
  totalFiles?: number
  currentFile?: string
}

export default function Backups() {
  const { toast } = useToast()
  const socket = useSocket()

  // Refs for cleanup
  const progressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // State
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null)
  const [backups, setBackups] = useState<BackupFile[]>([])
  const [loading, setLoading] = useState(true)
  const [creatingBackup, setCreatingBackup] = useState(false)
  const [restoringBackup, setRestoringBackup] = useState<string | null>(null)
  const [deletingBackups, setDeletingBackups] = useState(false)
  const [backupProgress, setBackupProgress] = useState<BackupProgress | null>(null)

  // Selection state
  const [selectedBackups, setSelectedBackups] = useState<Set<string>>(new Set())

  // Settings state
  const [showSettings, setShowSettings] = useState(false)
  const [backupSchedule, setBackupSchedule] = useState('0 */6 * * *')
  const [backupMaxCount, setBackupMaxCount] = useState(10)
  const [savingSettings, setSavingSettings] = useState(false)

  // Dialog state
  const [restoreDialog, setRestoreDialog] = useState<{ open: boolean; backupName: string | null }>({
    open: false,
    backupName: null,
  })
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; names: string[] }>({
    open: false,
    names: [],
  })
  const [deleteOlderDialog, setDeleteOlderDialog] = useState(false)
  const [deleteOlderDays, setDeleteOlderDays] = useState(7)
  const [deletingOlder, setDeletingOlder] = useState(false)

  // Fetch functions
  const fetchBackupStatus = useCallback(async () => {
    try {
      const status = await backupApi.getStatus()
      setBackupStatus(status)
      setBackupSchedule(status.schedule)
      setBackupMaxCount(status.maxBackups)
    } catch (error) {
      console.error('Failed to fetch backup status:', error)
    }
  }, [])

  const fetchBackups = useCallback(async () => {
    try {
      const data = await backupApi.listBackups()
      setBackups(data.backups || [])
      // Clear selection for backups that no longer exist
      setSelectedBackups(prev => {
        const backupNames = new Set((data.backups || []).map(b => b.name))
        const newSelection = new Set<string>()
        prev.forEach(name => {
          if (backupNames.has(name)) {
            newSelection.add(name)
          }
        })
        return newSelection
      })
    } catch (error) {
      console.error('Failed to fetch backups:', error)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([fetchBackupStatus(), fetchBackups()])
    } finally {
      setLoading(false)
    }
  }, [fetchBackupStatus, fetchBackups])

  // Initial load
  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  // Socket.IO for progress updates
  useEffect(() => {
    if (!socket) return

    const handleBackupProgress = (data: BackupProgress) => {
      setBackupProgress(data)
      
      // Clear any existing timeout
      if (progressTimeoutRef.current) {
        clearTimeout(progressTimeoutRef.current)
        progressTimeoutRef.current = null
      }
      
      if (data.phase === 'complete') {
        setCreatingBackup(false)
        fetchBackups()
        fetchBackupStatus()
        progressTimeoutRef.current = setTimeout(() => setBackupProgress(null), 2000)
      } else if (data.phase === 'error') {
        setCreatingBackup(false)
        progressTimeoutRef.current = setTimeout(() => setBackupProgress(null), 3000)
      }
    }

    socket.on('backup:progress', handleBackupProgress)

    return () => {
      socket.off('backup:progress', handleBackupProgress)
      // Clear timeout on unmount
      if (progressTimeoutRef.current) {
        clearTimeout(progressTimeoutRef.current)
      }
    }
  }, [socket, fetchBackups, fetchBackupStatus])

  // Actions
  const handleCreateBackup = async () => {
    setCreatingBackup(true)
    setBackupProgress({ phase: 'preparing', percent: 0, message: 'Starting backup...' })
    try {
      const result = await backupApi.createBackup()
      if (result.success && result.backup) {
        toast({
          title: 'Safehouse Snapshot Created',
          description: `Stored ${result.backup.name} in ${result.duration?.toFixed(1)}s`,
          variant: 'success' as const,
        })
        await fetchBackups()
        await fetchBackupStatus()
      } else {
        throw new Error(result.message || 'Failed to create backup')
      }
    } catch (error) {
      toast({
        title: 'Backup Failed',
        description: error instanceof Error ? error.message : 'Failed to create backup',
        variant: 'destructive',
      })
      setBackupProgress({ phase: 'error', percent: 0, message: 'Backup failed' })
    } finally {
      setCreatingBackup(false)
    }
  }

  const handleRestoreBackup = async (name: string) => {
    setRestoreDialog({ open: false, backupName: null })
    setRestoringBackup(name)
    try {
      const result = await backupApi.restoreBackup(name, { createPreRestoreBackup: true })
      if (result.success) {
        toast({
          title: 'Recovery Point Restored',
          description: `Rolled back to ${name} in ${(result.duration || 0).toFixed(1)}s`,
          variant: 'success' as const,
        })
        await fetchBackups()
      } else {
        throw new Error(result.message || 'Failed to restore backup')
      }
    } catch (error) {
      toast({
        title: 'Restore Failed',
        description: error instanceof Error ? error.message : 'Failed to restore backup',
        variant: 'destructive',
      })
    } finally {
      setRestoringBackup(null)
    }
  }

  const handleDeleteBackups = async (names: string[]) => {
    setDeleteDialog({ open: false, names: [] })
    setDeletingBackups(true)
    try {
      let successCount = 0
      let failCount = 0
      for (const name of names) {
        try {
          const result = await backupApi.deleteBackup(name)
          if (result.success) {
            successCount++
          } else {
            failCount++
          }
        } catch {
          failCount++
        }
      }

      if (successCount > 0) {
        toast({
          title: 'Old Snapshots Cleared',
          description: `Removed ${successCount} backup${successCount !== 1 ? 's' : ''}${failCount > 0 ? ` (${failCount} failed)` : ''}`,
          variant: 'success' as const,
        })
      }
      if (failCount > 0 && successCount === 0) {
        toast({
          title: 'Delete Failed',
          description: `Failed to delete ${failCount} backup${failCount !== 1 ? 's' : ''}`,
          variant: 'destructive',
        })
      }

      setSelectedBackups(new Set())
      await fetchBackups()
    } catch (error) {
      toast({
        title: 'Delete Failed',
        description: error instanceof Error ? error.message : 'Failed to delete backups',
        variant: 'destructive',
      })
    } finally {
      setDeletingBackups(false)
    }
  }

  const handleDeleteOlderThan = async () => {
    setDeleteOlderDialog(false)
    setDeletingOlder(true)
    try {
      const result = await backupApi.deleteOlderThan(deleteOlderDays)
      if (result.success) {
        toast({
          title: 'Rotation Complete',
          description: result.message || `Removed ${result.deleted || 0} aging backups`,
          variant: 'success' as const,
        })
        await fetchBackups()
      } else {
        toast({
          title: 'Delete Failed',
          description: result.message || 'Failed to delete old backups',
          variant: 'destructive',
        })
      }
    } catch (error) {
      toast({
        title: 'Delete Failed',
        description: error instanceof Error ? error.message : 'Failed to delete old backups',
        variant: 'destructive',
      })
    } finally {
      setDeletingOlder(false)
    }
  }

  const handleSaveSettings = async () => {
    setSavingSettings(true)
    try {
      await backupApi.updateSettings({
        enabled: backupStatus?.enabled || false,
        schedule: backupSchedule,
        maxBackups: backupMaxCount,
      })
      await fetchBackupStatus()
      toast({
        title: 'Backup Plan Updated',
        description: 'The panel saved your current backup schedule and limits.',
        variant: 'success' as const,
      })
    } catch (error) {
      toast({
        title: 'Backup Plan Update Failed',
        description: error instanceof Error ? error.message : 'Failed to save settings',
        variant: 'destructive',
      })
    } finally {
      setSavingSettings(false)
    }
  }

  const toggleBackupEnabled = async (enabled: boolean) => {
    try {
      await backupApi.updateSettings({ enabled })
      await fetchBackupStatus()
      toast({
        title: enabled ? 'Automatic Snapshots Armed' : 'Automatic Snapshots Stood Down',
        description: enabled ? 'Recurring backup jobs are now active.' : 'Recurring backup jobs are currently paused.',
        variant: 'success' as const,
      })
    } catch (error) {
      toast({
        title: 'Automatic Backup Update Failed',
        description: error instanceof Error ? error.message : 'Failed to update backup settings',
        variant: 'destructive',
      })
    }
  }

  // Selection handlers
  const toggleBackupSelection = (name: string) => {
    setSelectedBackups(prev => {
      const newSet = new Set(prev)
      if (newSet.has(name)) {
        newSet.delete(name)
      } else {
        newSet.add(name)
      }
      return newSet
    })
  }

  const toggleSelectAll = () => {
    if (selectedBackups.size === backups.length) {
      setSelectedBackups(new Set())
    } else {
      setSelectedBackups(new Set(backups.map(b => b.name)))
    }
  }

  // Helpers
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
  }

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr)
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const totalSize = useMemo(() => {
    return backups.reduce((sum, b) => sum + b.size, 0)
  }, [backups])

  const isAnySelected = selectedBackups.size > 0
  const allSelected = backups.length > 0 && selectedBackups.size === backups.length

  return (
    <div className="space-y-6 page-transition">
      {/* Header */}
      <PageHeader
        title="World Backups"
        description="Create, restore, and manage your server world backups"
        icon={<Archive className="w-5 h-5 text-primary" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={handleCreateBackup}
              disabled={creatingBackup || restoringBackup !== null || !backupStatus?.savesExists}
              className="gap-2"
            >
              {creatingBackup ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Archive className="w-4 h-4" />
              )}
              {creatingBackup ? 'Creating...' : 'Create Backup'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSettings(!showSettings)}
              className="gap-2"
            >
              <Settings className="w-4 h-4" />
              Settings
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              disabled={loading}
              aria-label="Refresh backup status"
              title="Refresh backup status"
            >
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </Button>
          </div>
        }
      />

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 stagger-in">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Archive className="w-5 h-5 text-primary shrink-0" />
              <div>
                <p className="text-2xl font-bold">{backups.length}</p>
                <p className="text-sm text-muted-foreground">Total Backups</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <HardDrive className="w-5 h-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-2xl font-bold">{formatBytes(totalSize)}</p>
                <p className="text-sm text-muted-foreground">Total Size</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-primary shrink-0" />
              <div>
                <p className="text-sm font-medium truncate">
                  {backupStatus?.lastBackup
                    ? formatDate(backupStatus.lastBackup.created)
                    : 'Never'}
                </p>
                <p className="text-sm text-muted-foreground">Last Backup</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Clock className={cn('w-5 h-5 shrink-0', backupStatus?.enabled ? 'text-primary' : 'text-muted-foreground')} />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {backupStatus?.enabled ? 'Auto-backup On' : 'Auto-backup Off'}
                </p>
                <p className="text-xs text-muted-foreground">Scheduled backups</p>
              </div>
              <Switch
                checked={backupStatus?.enabled || false}
                onCheckedChange={toggleBackupEnabled}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Settings Panel (collapsible) */}
      {showSettings && (
        <Card className="border-primary/15">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Backup Settings
            </CardTitle>
            <CardDescription>Configure scheduled backup settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="backup-schedule">Backup Frequency</Label>
                <Select value={backupSchedule} onValueChange={setBackupSchedule}>
                  <SelectTrigger id="backup-schedule" className="w-full">
                    <SelectValue placeholder="Select frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="*/15 * * * *">Every 15 minutes</SelectItem>
                    <SelectItem value="*/30 * * * *">Every 30 minutes</SelectItem>
                    <SelectItem value="0 * * * *">Every hour</SelectItem>
                    <SelectItem value="0 */2 * * *">Every 2 hours</SelectItem>
                    <SelectItem value="0 */4 * * *">Every 4 hours</SelectItem>
                    <SelectItem value="0 */6 * * *">Every 6 hours</SelectItem>
                    <SelectItem value="0 */8 * * *">Every 8 hours</SelectItem>
                    <SelectItem value="0 */12 * * *">Every 12 hours</SelectItem>
                    <SelectItem value="0 0 * * *">Daily at midnight</SelectItem>
                    <SelectItem value="0 6 * * *">Daily at 6 AM</SelectItem>
                    <SelectItem value="0 12 * * *">Daily at noon</SelectItem>
                    <SelectItem value="0 18 * * *">Daily at 6 PM</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  How often to automatically create backups
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="backup-max">Maximum Backups to Keep</Label>
                <Input
                  id="backup-max"
                  type="number"
                  min={1}
                  max={100}
                  value={backupMaxCount}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value, 10)
                    // Only update if valid number in range
                    if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
                      setBackupMaxCount(parsed)
                    } else if (e.target.value === '') {
                      setBackupMaxCount(10) // Reset to default if cleared
                    }
                  }}
                  className="max-w-24"
                />
                <p className="text-xs text-muted-foreground">
                  Oldest backups will be auto-deleted when limit is reached
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-xs text-muted-foreground">
                {backupStatus?.savesPath && (
                  <span className="flex flex-wrap items-center gap-1 break-all">
                    <FolderOpen className="w-3 h-3" />
                    Saves: {backupStatus.savesPath}
                  </span>
                )}
              </div>
              <Button onClick={handleSaveSettings} disabled={savingSettings} size="sm" className="h-10 gap-2 self-start sm:self-auto">
                {savingSettings && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save Settings
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Progress Bar */}
      {(creatingBackup || backupProgress) && (
        <Card className="border-primary/15 bg-primary/5">
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {backupProgress?.phase === 'complete' ? (
                    <Check className="w-5 h-5 text-primary" />
                  ) : backupProgress?.phase === 'error' ? (
                    <AlertTriangle className="w-5 h-5 text-destructive" />
                  ) : (
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  )}
                  <span className="font-medium">
                    {backupProgress?.message || 'Creating backup...'}
                  </span>
                </div>
                <span className="text-sm text-muted-foreground">
                  {backupProgress?.percent || 0}%
                </span>
              </div>
              <Progress value={backupProgress?.percent || 0} className="h-2" />
              {backupProgress?.currentFile && (
                <p className="text-xs text-muted-foreground truncate">
                  {backupProgress.currentFile}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Backup Card */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-lg">Backup Files</CardTitle>
              {!backupStatus?.savesExists && (
                <span className="flex items-center gap-1 text-xs text-warning">
                  <AlertTriangle className="w-3 h-3" />
                  Saves folder not found
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isAnySelected && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteDialog({ open: true, names: Array.from(selectedBackups) })}
                  disabled={deletingBackups}
                  className="h-10 gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete ({selectedBackups.size})
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteOlderDialog(true)}
                disabled={deletingOlder || backups.length === 0}
                className="h-10 gap-2"
              >
                {deletingOlder ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Clock className="w-4 h-4" />
                )}
                Delete Older
              </Button>
              <Button
                onClick={handleCreateBackup}
                disabled={creatingBackup || restoringBackup !== null || !backupStatus?.savesExists}
                className="h-10 gap-2"
              >
                {creatingBackup ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Archive className="w-4 h-4" />
                )}
                {creatingBackup ? 'Creating backup...' : 'Create backup'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : backups.length === 0 ? (
            <EmptyState type="noData" title="No backups yet" description="Create a manual backup before you change saves, mods, or server settings." />
          ) : (
            <div className="space-y-2">
              {/* Select All Header */}
              <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleSelectAll}
                  id="select-all"
                />
                <Label htmlFor="select-all" className="text-sm font-medium cursor-pointer flex-1">
                  {allSelected ? 'Clear backup selection' : 'Select all backups'} ({backups.length})
                </Label>
              </div>

              {/* Backup List */}
              <ScrollArea className="h-[300px] sm:h-[400px]">
                <div className="space-y-2 pr-4">
                  {backups.map((backup) => {
                    const isSelected = selectedBackups.has(backup.name)
                    const isRestoring = restoringBackup === backup.name

                    return (
                      <div
                        key={backup.name}
                        className={cn(
                          'flex items-center gap-3 p-4 rounded-lg border transition-all',
                          isSelected
                            ? 'border-primary/25 bg-primary/8'
                            : 'bg-muted/30 border-transparent hover:bg-muted/50'
                        )}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleBackupSelection(backup.name)}
                          disabled={isRestoring}
                        />

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Archive className="w-4 h-4 text-primary flex-shrink-0" />
                            <p className="font-medium truncate">{backup.name}</p>
                          </div>
                          <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <HardDrive className="w-3 h-3" />
                              {formatBytes(backup.size)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatDate(backup.created)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setRestoreDialog({ open: true, backupName: backup.name })}
                            disabled={isRestoring || restoringBackup !== null || creatingBackup}
                            className="h-9 w-9 text-warning hover:text-warning hover:bg-warning/10"
                            aria-label={`Restore ${backup.name}`}
                            title="Restore this backup"
                          >
                            {isRestoring ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RotateCcw className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => backupApi.downloadBackup(backup.name)}
                            className="h-9 w-9"
                            aria-label={`Download ${backup.name}`}
                            title="Download backup"
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteDialog({ open: true, names: [backup.name] })}
                            disabled={deletingBackups}
                            className="h-9 w-9 text-destructive hover:text-destructive hover:bg-destructive/10"
                            aria-label={`Delete ${backup.name}`}
                            title="Delete backup"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Restore Confirmation Dialog */}
      <AlertDialog open={restoreDialog.open} onOpenChange={(open) => setRestoreDialog({ open, backupName: null })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-warning">
              <AlertTriangle className="w-5 h-5" />
              Restore Backup
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Restore <strong>{restoreDialog.backupName}</strong>. This will <span className="font-medium text-destructive">replace</span> the current world data.
              </p>
              <ul className="list-disc list-inside text-sm space-y-1 mt-2">
                <li>Stop the server first.</li>
                <li>The panel will create a safety backup before restoring.</li>
                <li>This action cannot be undone.</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => restoreDialog.backupName && handleRestoreBackup(restoreDialog.backupName)}
              className="bg-warning text-warning-foreground hover:bg-warning/90"
            >
              Restore this backup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ open, names: [] })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" />
              Delete Backup{deleteDialog.names.length > 1 ? 's' : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteDialog.names.length === 1 ? (
                <p>
                  Delete <strong>{deleteDialog.names[0]}</strong>? This permanently removes the backup file.
                </p>
              ) : (
                <p>
                  Delete <strong>{deleteDialog.names.length} backups</strong>? This permanently removes those files.
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleDeleteBackups(deleteDialog.names)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete backup{deleteDialog.names.length > 1 ? 's' : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Older Than Dialog */}
      <AlertDialog open={deleteOlderDialog} onOpenChange={setDeleteOlderDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-warning">
              <Clock className="w-5 h-5" />
              Delete Old Backups
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p>Delete every backup older than the number of days you choose here.</p>
                <div className="flex items-center gap-3">
                  <Label htmlFor="delete-days" className="text-foreground whitespace-nowrap">Delete backups older than</Label>
                  <Input
                    id="delete-days"
                    type="number"
                    min={1}
                    max={365}
                    value={deleteOlderDays}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10)
                      if (!isNaN(val) && val >= 1 && val <= 365) {
                        setDeleteOlderDays(val)
                      }
                    }}
                    className="w-20"
                  />
                  <span className="text-foreground">days</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  This permanently deletes backups created more than {deleteOlderDays} days ago.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteOlderThan}
              className="bg-warning text-warning-foreground hover:bg-warning/90"
            >
              Delete older backups
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
