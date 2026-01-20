import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useSearchParams } from 'react-router-dom'
import api from '../services/api'
import toast from 'react-hot-toast'
import { Copy, RefreshCw, Link, Unlink } from 'lucide-react'

export default function Settings() {
  const { user, fetchUser } = useAuth()
  const [searchParams] = useSearchParams()
  const [profile, setProfile] = useState({
    name: user?.name || '',
    company: user?.company || ''
  })
  const [passwords, setPasswords] = useState({
    currentPassword: '',
    newPassword: ''
  })
  const [saving, setSaving] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [ghlStatus, setGhlStatus] = useState({ connected: false, loading: true })
  const [connectingGhl, setConnectingGhl] = useState(false)

  // Check for GHL callback results
  useEffect(() => {
    if (searchParams.get('ghl_connected') === 'true') {
      toast.success('GoHighLevel connected successfully!')
      fetchGhlStatus()
    } else if (searchParams.get('ghl_error')) {
      toast.error(`GHL connection failed: ${searchParams.get('ghl_error')}`)
    }
  }, [searchParams])

  // Fetch GHL status
  const fetchGhlStatus = async () => {
    try {
      const { data } = await api.get('/ghl/status')
      setGhlStatus({ ...data, loading: false })
    } catch (error) {
      setGhlStatus({ connected: false, loading: false })
    }
  }

  useEffect(() => {
    fetchGhlStatus()
  }, [])

  const connectGhl = async () => {
    setConnectingGhl(true)
    try {
      const { data } = await api.get('/ghl/auth-url')
      window.location.href = data.authUrl
    } catch (error) {
      toast.error('Failed to start GHL connection')
      setConnectingGhl(false)
    }
  }

  const disconnectGhl = async () => {
    if (!confirm('Are you sure you want to disconnect GoHighLevel?')) return

    try {
      await api.post('/ghl/disconnect')
      toast.success('GoHighLevel disconnected')
      setGhlStatus({ connected: false, loading: false })
    } catch (error) {
      toast.error('Failed to disconnect GHL')
    }
  }

  const updateProfile = async (e) => {
    e.preventDefault()
    setSaving(true)

    try {
      await api.put('/customers/profile', profile)
      toast.success('Profile updated!')
      fetchUser()
    } catch (error) {
      toast.error('Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  const changePassword = async (e) => {
    e.preventDefault()
    setChangingPassword(true)

    try {
      await api.put('/customers/password', passwords)
      toast.success('Password changed!')
      setPasswords({ currentPassword: '', newPassword: '' })
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to change password')
    } finally {
      setChangingPassword(false)
    }
  }

  const refreshApiKey = async () => {
    if (!confirm('Are you sure? This will invalidate your current API key.')) return

    try {
      const { data } = await api.post('/auth/refresh-api-key')
      toast.success('API key refreshed!')
      fetchUser()
    } catch (error) {
      toast.error('Failed to refresh API key')
    }
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard!')
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-1">Manage your account settings</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profile Settings */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Profile</h2>
          <form onSubmit={updateProfile}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <input
                type="email"
                value={user?.email || ''}
                disabled
                className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Name
              </label>
              <input
                type="text"
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Company
              </label>
              <input
                type="text"
                value={profile.company}
                onChange={(e) => setProfile({ ...profile, company: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="bg-primary-500 text-white px-4 py-2 rounded-lg hover:bg-primary-600 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </div>

        {/* Change Password */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Change Password</h2>
          <form onSubmit={changePassword}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Current Password
              </label>
              <input
                type="password"
                value={passwords.currentPassword}
                onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                New Password
              </label>
              <input
                type="password"
                value={passwords.newPassword}
                onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
                required
                minLength={6}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <button
              type="submit"
              disabled={changingPassword}
              className="bg-primary-500 text-white px-4 py-2 rounded-lg hover:bg-primary-600 disabled:opacity-50"
            >
              {changingPassword ? 'Changing...' : 'Change Password'}
            </button>
          </form>
        </div>

        {/* GoHighLevel Integration */}
        <div className="bg-white rounded-lg shadow p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Link size={20} />
            GoHighLevel Integration
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            Connect your GoHighLevel account to sync WhatsApp messages with your CRM contacts.
          </p>

          {ghlStatus.loading ? (
            <div className="text-center py-4">Loading...</div>
          ) : ghlStatus.connected ? (
            <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                  <Link className="text-white" size={20} />
                </div>
                <div>
                  <p className="font-medium text-green-700">Connected to GoHighLevel</p>
                  <p className="text-sm text-green-600">Your messages will sync to GHL contacts</p>
                </div>
              </div>
              <button
                onClick={disconnectGhl}
                className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
              >
                <Unlink size={18} />
                Disconnect
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center">
                  <Unlink className="text-gray-500" size={20} />
                </div>
                <div>
                  <p className="font-medium text-gray-700">Not connected</p>
                  <p className="text-sm text-gray-500">Connect to sync messages with GHL</p>
                </div>
              </div>
              <button
                onClick={connectGhl}
                disabled={connectingGhl}
                className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
              >
                <Link size={18} />
                {connectingGhl ? 'Connecting...' : 'Connect GoHighLevel'}
              </button>
            </div>
          )}
        </div>

        {/* API Key */}
        <div className="bg-white rounded-lg shadow p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold mb-4">API Key</h2>
          <p className="text-sm text-gray-600 mb-4">
            Use this API key to authenticate your requests to the API.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={user?.apiKey || ''}
              readOnly
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 font-mono text-sm"
            />
            <button
              onClick={() => copyToClipboard(user?.apiKey)}
              className="px-4 py-2 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200"
            >
              <Copy size={18} />
            </button>
            <button
              onClick={refreshApiKey}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600"
            >
              <RefreshCw size={18} />
              Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
