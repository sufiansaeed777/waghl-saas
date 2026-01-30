import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import toast from 'react-hot-toast'
import { Plus, Trash2, Eye, CreditCard, MapPin, Search, Filter, Pencil, X, ShoppingCart, XCircle, PlayCircle } from 'lucide-react'

export default function SubAccounts() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.hasUnlimitedAccess
  const [subAccounts, setSubAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newLocationId, setNewLocationId] = useState('')
  const [creating, setCreating] = useState(false)

  // Subscription info
  const [subscriptionInfo, setSubscriptionInfo] = useState(null)
  const [buyingSlot, setBuyingSlot] = useState(false)

  // Search and filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  // Edit modal state
  const [editModal, setEditModal] = useState({ open: false, subAccount: null })
  const [editForm, setEditForm] = useState({ name: '', ghlLocationId: '' })

  useEffect(() => {
    fetchSubAccounts()
    if (!isAdmin) {
      fetchSubscriptionInfo()
    }
  }, [isAdmin])

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

  const fetchSubscriptionInfo = async () => {
    try {
      const { data } = await api.get('/billing/subscription-info')
      setSubscriptionInfo(data)
    } catch (error) {
      console.error('Failed to fetch subscription info:', error)
    }
  }

  const handleBuySlot = async () => {
    setBuyingSlot(true)
    try {
      const { data } = await api.post('/billing/add-slot')
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
      } else {
        toast.success(data.message || 'Slot added successfully')
        fetchSubscriptionInfo()
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to add slot')
    } finally {
      setBuyingSlot(false)
    }
  }

  const handleCreateClick = () => {
    // Check if user has available slots
    if (!isAdmin && subscriptionInfo && subscriptionInfo.availableSlots <= 0) {
      // Show buy slot message
      const price = subscriptionInfo.nextSlotPrice || 29
      const isVolume = subscriptionInfo.isVolumeEligible

      if (subscriptionInfo.subscriptionQuantity === 0) {
        toast.error(`You need to purchase a subscription first. €${price}/month per sub-account.`)
      } else {
        toast.error(`You've used all ${subscriptionInfo.subscriptionQuantity} slot(s). Buy another for €${price}/month.`)
      }
      return
    }
    setShowCreateModal(true)
  }

  const createSubAccount = async (e) => {
    e.preventDefault()
    setCreating(true)

    try {
      const { data } = await api.post('/sub-accounts', {
        ghlLocationId: newLocationId
      })
      const subAccountId = data.subAccount.id

      toast.success('Sub-account created! Connecting to GHL...')
      setShowCreateModal(false)
      setNewLocationId('')
      fetchSubAccounts()
      fetchSubscriptionInfo() // Refresh slot count

      // Automatically start GHL OAuth connection
      setTimeout(async () => {
        try {
          const { data: authData } = await api.get(`/ghl/auth-url/${subAccountId}`)

          // Validate authUrl exists
          if (!authData?.authUrl) {
            toast.error('Failed to get GHL authorization URL')
            return
          }

          // Set up message listener BEFORE opening popup to avoid race condition
          const handleMessage = (event) => {
            if (event.data?.type === 'GHL_OAUTH_RESULT') {
              if (event.data.success) {
                toast.success('GHL connected successfully! Location name updated.')
                fetchSubAccounts() // Refresh to show updated name
              } else {
                toast.error(event.data.message || 'Failed to connect to GHL')
              }
              window.removeEventListener('message', handleMessage)
            }
          }
          window.addEventListener('message', handleMessage)

          // Open OAuth in popup window
          const width = 600
          const height = 700
          const left = (window.screen.width / 2) - (width / 2)
          const top = (window.screen.height / 2) - (height / 2)

          const popup = window.open(
            authData.authUrl,
            'GHL OAuth',
            `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
          )

          // Check if popup was closed
          const checkPopup = setInterval(() => {
            if (popup && popup.closed) {
              clearInterval(checkPopup)
              window.removeEventListener('message', handleMessage)
              fetchSubAccounts() // Refresh anyway
            }
          }, 1000)
        } catch (err) {
          toast.error('Failed to start GHL connection')
        }
      }, 500)

    } catch (error) {
      const errorData = error.response?.data
      if (error.response?.status === 402) {
        // Payment required - show detailed message
        toast.error(errorData.message || 'Please purchase a subscription slot first')
      } else {
        toast.error(errorData?.error || 'Failed to create sub-account')
      }
    } finally {
      setCreating(false)
    }
  }

  const deleteSubAccount = async (id, name) => {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return

    try {
      await api.delete(`/sub-accounts/${id}`)
      toast.success('Sub-account deleted')
      fetchSubAccounts()
      fetchSubscriptionInfo() // Refresh slot count
    } catch (error) {
      toast.error('Failed to delete sub-account')
    }
  }

  const toggleSubAccount = async (id, isActive, name) => {
    const action = isActive ? 'pause' : 'resume'
    if (!confirm(`Are you sure you want to ${action} "${name}"?`)) return

    try {
      await api.put(`/sub-accounts/${id}`, { isActive: !isActive })
      toast.success(`Sub-account ${isActive ? 'paused' : 'resumed'}`)
      fetchSubAccounts()
    } catch (error) {
      toast.error(`Failed to ${action} sub-account`)
    }
  }

  const openEditModal = (subAccount) => {
    setEditForm({
      name: subAccount.name || '',
      ghlLocationId: subAccount.ghlLocationId || ''
    })
    setEditModal({ open: true, subAccount })
  }

  const closeEditModal = () => {
    setEditModal({ open: false, subAccount: null })
    setEditForm({ name: '', ghlLocationId: '' })
  }

  const saveSubAccount = async () => {
    if (!editModal.subAccount) return

    try {
      await api.put(`/sub-accounts/${editModal.subAccount.id}`, {
        name: editForm.name,
        ghlLocationId: editForm.ghlLocationId
      })
      toast.success('Sub-account updated')
      closeEditModal()
      fetchSubAccounts()
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to update sub-account')
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

      return true
    })
  }, [subAccounts, searchQuery, filterStatus])

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sub-Accounts</h1>
          <p className="text-gray-600 mt-1">Manage your WhatsApp connections</p>
        </div>
        <button
          onClick={handleCreateClick}
          className="flex items-center gap-2 bg-primary-500 text-white px-4 py-2 rounded-lg hover:bg-primary-600 transition-colors"
        >
          <Plus size={20} />
          Create Sub-Account
        </button>
      </div>

      {/* Subscription Info Banner - for regular users */}
      {!isAdmin && subscriptionInfo && (
        <div className={`mb-6 p-4 rounded-lg border ${
          subscriptionInfo.availableSlots > 0
            ? 'bg-green-50 border-green-200'
            : 'bg-yellow-50 border-yellow-200'
        }`}>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="font-medium text-gray-900">
                {subscriptionInfo.availableSlots > 0 ? (
                  <>You can create <span className="text-green-600">{subscriptionInfo.availableSlots}</span> more sub-account{subscriptionInfo.availableSlots !== 1 ? 's' : ''}</>
                ) : subscriptionInfo.subscriptionQuantity === 0 ? (
                  <span className="text-yellow-700">No subscription yet - purchase to create sub-accounts</span>
                ) : (
                  <span className="text-yellow-700">All {subscriptionInfo.subscriptionQuantity} slot(s) used</span>
                )}
              </p>
              <p className="text-sm text-gray-600 mt-1">
                {subscriptionInfo.subscriptionQuantity > 0 && (
                  <>{subscriptionInfo.subAccountCount} of {subscriptionInfo.subscriptionQuantity} slot{subscriptionInfo.subscriptionQuantity !== 1 ? 's' : ''} used • </>
                )}
                Next slot: €{subscriptionInfo.nextSlotPrice}/month
                {subscriptionInfo.isVolumeEligible && (
                  <span className="ml-2 text-green-600 font-medium">(Volume discount!)</span>
                )}
              </p>
            </div>
            <button
              onClick={handleBuySlot}
              disabled={buyingSlot}
              className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
            >
              <ShoppingCart size={18} />
              {buyingSlot ? 'Processing...' : `Buy Slot (€${subscriptionInfo.nextSlotPrice}/mo)`}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : subAccounts.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500 mb-4">No sub-accounts yet</p>
          {!isAdmin && subscriptionInfo && subscriptionInfo.availableSlots <= 0 ? (
            <button
              onClick={handleBuySlot}
              disabled={buyingSlot}
              className="inline-flex items-center gap-2 bg-primary-500 text-white px-4 py-2 rounded-lg hover:bg-primary-600 transition-colors"
            >
              <ShoppingCart size={20} />
              {buyingSlot ? 'Processing...' : `Buy Subscription (€${subscriptionInfo?.nextSlotPrice || 29}/mo)`}
            </button>
          ) : (
            <button
              onClick={handleCreateClick}
              className="inline-flex items-center gap-2 bg-primary-500 text-white px-4 py-2 rounded-lg hover:bg-primary-600 transition-colors"
            >
              <Plus size={20} />
              Create your first sub-account
            </button>
          )}
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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Plan</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredSubAccounts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
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
                    {isAdmin || account.isGifted ? (
                      <span className="text-sm px-2 py-1 rounded bg-purple-100 text-purple-700">
                        Free (Unlimited)
                      </span>
                    ) : subscriptionInfo?.subscriptionQuantity >= 11 ? (
                      <span className="text-sm px-2 py-1 rounded bg-blue-100 text-blue-700">
                        €19/mo
                      </span>
                    ) : (
                      <span className="text-sm px-2 py-1 rounded bg-gray-100 text-gray-700">
                        €29/mo
                      </span>
                    )}
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
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEditModal(account)}
                        className="p-2 text-gray-600 hover:text-blue-500 hover:bg-blue-50 rounded"
                        title="Edit sub-account"
                      >
                        <Pencil size={18} />
                      </button>
                      <Link
                        to={`/sub-accounts/${account.id}`}
                        className="p-2 text-gray-600 hover:text-primary-500 hover:bg-gray-100 rounded"
                        title="View details"
                      >
                        <Eye size={18} />
                      </Link>
                      <button
                        onClick={() => toggleSubAccount(account.id, account.isActive, account.name)}
                        className={`p-2 rounded ${account.isActive ? 'text-red-500 hover:bg-red-50' : 'text-green-500 hover:bg-green-50'}`}
                        title={account.isActive ? 'Pause sub-account' : 'Resume sub-account'}
                      >
                        {account.isActive ? <XCircle size={18} /> : <PlayCircle size={18} />}
                      </button>
                      <button
                        onClick={() => deleteSubAccount(account.id, account.name)}
                        className="p-2 text-gray-600 hover:text-red-500 hover:bg-gray-100 rounded"
                        title="Delete sub-account"
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
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Create Sub-Account</h2>
              <button
                onClick={() => {
                  setShowCreateModal(false)
                  setNewLocationId('')
                }}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X size={20} />
              </button>
            </div>

            {/* Slot info */}
            {!isAdmin && subscriptionInfo && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                <p className="text-blue-800">
                  After creating this sub-account, you will have{' '}
                  <strong>{subscriptionInfo.availableSlots - 1}</strong> slot{subscriptionInfo.availableSlots - 1 !== 1 ? 's' : ''} remaining.
                </p>
              </div>
            )}

            <form onSubmit={createSubAccount}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <div className="flex items-center gap-2">
                    <MapPin size={16} />
                    GHL Location ID <span className="text-red-500">*</span>
                  </div>
                </label>
                <input
                  type="text"
                  value={newLocationId}
                  onChange={(e) => setNewLocationId(e.target.value)}
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono"
                  placeholder="e.g., ve9EPM428h8vShlRW1KT"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Find this in your GHL sub-account Settings → Business Info
                </p>
                <p className="text-xs text-blue-600 mt-2 font-medium">
                  The sub-account name will be automatically fetched from GHL after connection.
                </p>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false)
                    setNewLocationId('')
                  }}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !newLocationId.trim()}
                  className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
                >
                  {creating ? 'Creating & Connecting...' : 'Create & Connect to GHL'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editModal.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold">Edit Sub-Account</h3>
              <button
                onClick={closeEditModal}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="Sub-account name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <div className="flex items-center gap-2">
                    <MapPin size={14} />
                    Location ID
                  </div>
                </label>
                <input
                  type="text"
                  value={editForm.ghlLocationId}
                  onChange={(e) => setEditForm({ ...editForm, ghlLocationId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono text-sm"
                  placeholder="GHL Location ID"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-4 border-t">
              <button
                onClick={closeEditModal}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={saveSubAccount}
                className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
