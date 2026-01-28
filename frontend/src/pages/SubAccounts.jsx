import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import toast from 'react-hot-toast'
import { Plus, Trash2, Eye, CreditCard, MapPin, Search, Filter } from 'lucide-react'

export default function SubAccounts() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.hasUnlimitedAccess
  const [subAccounts, setSubAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [newLocationId, setNewLocationId] = useState('')
  const [creating, setCreating] = useState(false)

  // Search and filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterPayment, setFilterPayment] = useState('all')

  useEffect(() => {
    fetchSubAccounts()
  }, [])

  const fetchSubAccounts = async () => {
    try {
      const { data } = await api.get('/sub-accounts')
      setSubAccounts(data.subAccounts)
    } catch (error) {
      toast.error('Failed to fetch sub-accounts')
    } finally {
      setLoading(false)
    }
  }

  const createSubAccount = async (e) => {
    e.preventDefault()
    setCreating(true)

    try {
      await api.post('/sub-accounts', {
        name: newName,
        ghlLocationId: newLocationId || undefined
      })
      toast.success('Sub-account created!')
      setShowCreateModal(false)
      setNewName('')
      setNewLocationId('')
      fetchSubAccounts()
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to create sub-account')
    } finally {
      setCreating(false)
    }
  }

  const handlePayment = async (subAccountId) => {
    try {
      const { data } = await api.post(`/billing/checkout/${subAccountId}`)
      window.location.href = data.url
    } catch (error) {
      toast.error('Failed to start checkout')
    }
  }

  const deleteSubAccount = async (id, name) => {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return

    try {
      await api.delete(`/sub-accounts/${id}`)
      toast.success('Sub-account deleted')
      fetchSubAccounts()
    } catch (error) {
      toast.error('Failed to delete sub-account')
    }
  }

  // Filtered sub-accounts based on search and filters
  const filteredSubAccounts = useMemo(() => {
    return subAccounts.filter(account => {
      // Search by name or location ID
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        if (!account.name?.toLowerCase().includes(query) &&
            !account.ghlLocationId?.toLowerCase().includes(query) &&
            !account.phoneNumber?.includes(query)) {
          return false
        }
      }

      // Filter by status
      if (filterStatus !== 'all') {
        if (filterStatus === 'connected' && account.status !== 'connected') return false
        if (filterStatus === 'disconnected' && account.status === 'connected') return false
      }

      // Filter by payment
      if (filterPayment !== 'all') {
        if (filterPayment === 'paid' && !account.isPaid) return false
        if (filterPayment === 'unpaid' && account.isPaid) return false
      }

      return true
    })
  }, [subAccounts, searchQuery, filterStatus, filterPayment])

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sub-Accounts</h1>
          <p className="text-gray-600 mt-1">Manage your WhatsApp connections</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 bg-primary-500 text-white px-4 py-2 rounded-lg hover:bg-primary-600 transition-colors"
        >
          <Plus size={20} />
          Create Sub-Account
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : subAccounts.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500 mb-4">No sub-accounts yet</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 bg-primary-500 text-white px-4 py-2 rounded-lg hover:bg-primary-600 transition-colors"
          >
            <Plus size={20} />
            Create your first sub-account
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {/* Search and Filters */}
          <div className="p-4 border-b bg-gray-50">
            <div className="flex flex-wrap gap-4 items-center">
              {/* Search Input */}
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  placeholder="Search by name, phone, or location ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2">
                <Filter size={18} className="text-gray-500" />

                {/* Status Filter */}
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="all">All Status</option>
                  <option value="connected">Connected</option>
                  <option value="disconnected">Disconnected</option>
                </select>

                {/* Payment Filter - only for regular users */}
                {!isAdmin && (
                  <select
                    value={filterPayment}
                    onChange={(e) => setFilterPayment(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="all">All Payment</option>
                    <option value="paid">Paid</option>
                    <option value="unpaid">Unpaid</option>
                  </select>
                )}
              </div>

              {/* Results count */}
              <span className="text-sm text-gray-500">
                {filteredSubAccounts.length} of {subAccounts.length} sub-accounts
              </span>
            </div>
          </div>

          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                {!isAdmin && <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payment</th>}
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredSubAccounts.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 5 : 6} className="px-6 py-12 text-center text-gray-500">
                    No sub-accounts found matching your filters
                  </td>
                </tr>
              ) : filteredSubAccounts.map((account) => (
                <tr key={account.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-900">{account.name}</p>
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {account.phoneNumber || '-'}
                  </td>
                  <td className="px-6 py-4 text-gray-600 text-sm font-mono">
                    {account.ghlLocationId || '-'}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-sm px-2 py-1 rounded ${
                      account.status === 'connected' ? 'bg-green-100 text-green-700' :
                      account.status === 'qr_ready' ? 'bg-yellow-100 text-yellow-700' :
                      account.status === 'connecting' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {account.status}
                    </span>
                  </td>
                  {!isAdmin && (
                    <td className="px-6 py-4">
                      {account.isPaid ? (
                        <span className="text-sm px-2 py-1 rounded bg-green-100 text-green-700">
                          Paid
                        </span>
                      ) : (
                        <button
                          onClick={() => handlePayment(account.id)}
                          className="flex items-center gap-1 text-sm px-2 py-1 rounded bg-primary-100 text-primary-700 hover:bg-primary-200"
                        >
                          <CreditCard size={14} />
                          Pay
                        </button>
                      )}
                    </td>
                  )}
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        to={`/sub-accounts/${account.id}`}
                        className="p-2 text-gray-600 hover:text-primary-500 hover:bg-gray-100 rounded"
                      >
                        <Eye size={18} />
                      </Link>
                      <button
                        onClick={() => deleteSubAccount(account.id, account.name)}
                        className="p-2 text-gray-600 hover:text-red-500 hover:bg-gray-100 rounded"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Create Sub-Account</h2>
            <form onSubmit={createSubAccount}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Name
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="e.g., Marketing Team"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <div className="flex items-center gap-2">
                    <MapPin size={16} />
                    GHL Location ID
                  </div>
                </label>
                <input
                  type="text"
                  value={newLocationId}
                  onChange={(e) => setNewLocationId(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono"
                  placeholder="e.g., ve9EPM428h8vShlRW1KT"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Find this in your GHL sub-account Settings → Business Info
                </p>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false)
                    setNewName('')
                    setNewLocationId('')
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
