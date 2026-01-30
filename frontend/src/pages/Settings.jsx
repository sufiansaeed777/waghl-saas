import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import toast from 'react-hot-toast'
import { CreditCard, ExternalLink, Link, Copy } from 'lucide-react'

export default function Settings() {
  const { user, fetchUser } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.hasUnlimitedAccess
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

  const openBillingPortal = async () => {
    try {
      const { data } = await api.get('/billing/portal')
      window.open(data.url, '_blank')
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to open billing portal')
    }
  }

  const handleSubscribe = async () => {
    try {
      const { data } = await api.post('/billing/subscribe')
      window.location.href = data.url
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to start subscription checkout')
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
      toast.error(error.response?.data?.error || 'Failed to update profile')
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

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-1">Manage your account settings</p>
      </div>

      {/* Billing Section - only for regular users */}
      {!isAdmin && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Subscription & Billing</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600">
                {user?.subscriptionStatus === 'active' ? (
                  <span className="text-green-600 font-medium">Your subscription is active</span>
                ) : user?.subscriptionStatus === 'canceling' ? (
                  <span className="text-yellow-600 font-medium">Subscription canceling at end of billing period</span>
                ) : user?.subscriptionStatus === 'past_due' ? (
                  <span className="text-red-600 font-medium">Payment past due - please update payment method</span>
                ) : (
                  <span className="text-gray-500">No active subscription</span>
                )}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {user?.subscriptionStatus === 'canceling'
                  ? 'Your access will continue until the end of your current billing period. You can resume anytime.'
                  : 'Manage your subscription, payment methods, and invoices'
                }
              </p>
            </div>
            {user?.subscriptionStatus === 'active' || user?.subscriptionStatus === 'canceling' || user?.subscriptionStatus === 'past_due' ? (
              <button
                onClick={openBillingPortal}
                className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
              >
                <CreditCard size={18} />
                {user?.subscriptionStatus === 'canceling' ? 'Resume or Manage' : 'Manage Billing'}
                <ExternalLink size={14} />
              </button>
            ) : (
              <button
                onClick={handleSubscribe}
                className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
              >
                <CreditCard size={18} />
                Subscribe Now
              </button>
            )}
          </div>
        </div>
      )}

      {/* GHL Custom Menu Link Section */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
          <Link size={20} />
          GHL Custom Menu Link
        </h2>
        <p className="text-sm text-gray-600 mb-4">
          Add this link to your client's GHL Custom Menu Links to enable WhatsApp QR scanning directly from their dashboard.
        </p>
        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-2">Copy this URL and add it to GHL → Settings → Custom Menu Links:</p>
          <div className="flex items-center gap-2">
            <code className="text-sm bg-gray-200 px-3 py-2 rounded flex-1 overflow-x-auto font-mono">
              {'https://whatsapp.bibotcrm.it/whatsapp.html?locationId={{location.id}}'}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText('https://whatsapp.bibotcrm.it/whatsapp.html?locationId={{location.id}}')
                toast.success('Link copied!')
              }}
              className="flex items-center gap-1 px-3 py-2 bg-primary-500 text-white rounded hover:bg-primary-600"
            >
              <Copy size={16} />
              Copy
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Note: <code className="bg-gray-200 px-1 rounded">{'{{location.id}}'}</code> will be automatically replaced with the actual location ID by GHL.
          </p>
        </div>
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
      </div>
    </div>
  )
}
