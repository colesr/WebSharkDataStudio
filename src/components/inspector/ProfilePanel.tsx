import { useEffect, useState } from 'react'
import { profileTable, type TableProfile } from '../../engine/profile'
import { ProfileView } from '../ProfileView'

export function ProfilePanel({ table }: { table: string }) {
  const [profile, setProfile] = useState<TableProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErr(null)
    setProfile(null)
    profileTable(table)
      .then((p) => {
        if (!cancelled) setProfile(p)
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e.message || e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [table])

  if (loading)
    return (
      <div className="empty">
        <span className="spinner" /> Profiling {table}…
      </div>
    )
  if (err) return <div className="out-error">{err}</div>
  if (!profile) return <div className="empty">No profile.</div>
  return <ProfileView profile={profile} />
}
