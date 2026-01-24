import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import toast from 'react-hot-toast'
import { Smartphone, Wifi, WifiOff, Plus, CreditCard, ExternalLink } from 'lucide-react'

export default function Dashboard() {
  const { user } = useAuth()
  const [subAccounts, setSubAccounts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchSubAccounts()
  }, [])

  const fetchSubAccounts = async () => {
    try {
      const { data } = await api.get('/sub-accounts')
      setSubAccounts(data.subAccounts)
    } catch (error) {
      console.error('Failed to fetch sub-accounts:', error)
    } finally {
      setLoading(false)
    }
  }

  const connectedCount = subAccounts.filter(s => s.status === 'connected').length
  const paidCount = subAccounts.filter(s => s.isPaid).length

  const openBillingPortal = async () => {
    try {
      const { data } = await api.get('/billing/portal')
      window.open(data.url, '_blank')
    } catch (error) {
      toast.error('Failed to open billing portal')
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-1">Welcome back, {user?.name}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Sub-Accounts</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{subAccounts.length}</p>
            </div>
            <div className="bg-primary-100 p-3 rounded-full">
              <Smartphone className="text-primary-500" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Connected</p>
              <p className="text-3xl font-bold text-green-600 mt-1">{connectedCount}</p>
            </div>
            <div className="bg-green-100 p-3 rounded-full">
              <Wifi className="text-green-500" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Disconnected</p>
              <p className="text-3xl font-bold text-gray-600 mt-1">{subAccounts.length - connectedCount}</p>
            </div>
            <div className="bg-gray-100 p-3 rounded-full">
              <WifiOff className="text-gray-500" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Paid Sub-Accounts</p>
              <p className="text-3xl font-bold text-blue-600 mt-1">{paidCount}</p>
            </div>
            <div className="bg-blue-100 p-3 rounded-full">
              <CreditCard className="text-blue-500" size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Subscription Status */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Subscription Status</h2>
            <p className="text-gray-600 mt-1">
              {user?.subscriptionStatus === 'active' ? (
                <span className="text-green-600">Your subscription is active</span>
              ) : (
                <span className="text-gray-500">No active subscription</span>
              )}
            </p>
          </div>
          <button
            onClick={openBillingPortal}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <CreditCard size={18} />
            Manage Billing
            <ExternalLink size={14} />
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
        <div className="flex gap-4">
          <Link
            to="/sub-accounts"
            className="flex items-center gap-2 bg-primary-500 text-white px-4 py-2 rounded-lg hover:bg-primary-600 transition-colors"
          >
            <Plus size={20} />
            Create Sub-Account
          </Link>
        </div>
      </div>

      {/* Recent Sub-Accounts */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b">
          <h2 className="text-lg font-semibold">Recent Sub-Accounts</h2>
        </div>

        {loading ? (
          <div className="p-6 text-center text-gray-500">Loading...</div>
        ) : subAccounts.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            No sub-accounts yet. Create your first one to get started!
          </div>
        ) : (
          <div className="divide-y">
            {subAccounts.slice(0, 5).map((account) => (
              <Link
                key={account.id}
                to={`/sub-accounts/${account.id}`}
                className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${
                    account.status === 'connected' ? 'bg-green-500' :
                    account.status === 'qr_ready' ? 'bg-yellow-500' : 'bg-gray-400'
                  }`} />
                  <div>
                    <p className="font-medium text-gray-900">{account.name}</p>
                    <p className="text-sm text-gray-500">{account.phoneNumber || 'Not connected'}</p>
                  </div>
                </div>
                <span className={`text-sm px-2 py-1 rounded ${
                  account.status === 'connected' ? 'bg-green-100 text-green-700' :
                  account.status === 'qr_ready' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {account.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
