import { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import toast from 'react-hot-toast'
import { Plus, Trash2, Eye, MapPin, Search, Filter, X, XCircle, PlayCircle, Link2, Link2Off, RotateCcw } from 'lucide-react'

export default function SubAccounts() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.hasUnlimitedAccess
  const [subAccounts, setSubAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newLocationId, setNewLocationId] = useState('')
  const [creating, setCreating] = useState(false)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  // Subscription info
  const [subscriptionInfo, setSubscriptionInfo] = useState(null)
  const [subscribingTo, setSubscribingTo] = useState(null) // Track which sub-account is being subscribed

  // Search and filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')


  // Handle URL params for GHL connection and payment results
  useEffect(() => {
    const ghlError = searchParams.get('ghl_error')
    const subscriptionStatus = searchParams.get('subscription')
    const paymentStatus = searchParams.get('payment')

    if (ghlError) {
      if (ghlError === 'location_mismatch') {
        toast.error('Wrong GHL location selected. Please select the correct location.')
      } else {
        toast.error(decodeURIComponent(ghlError) || 'GHL connection failed')
      }
      navigate('/sub-accounts', { replace: true })
    }

    // Handle subscription status (legacy)
    if (subscriptionStatus === 'success') {
      toast.success('Subscription activated successfully!')
      navigate('/sub-accounts', { replace: true })
    } else if (subscriptionStatus === 'cancelled') {
      toast.error('Subscription checkout was cancelled')
      navigate('/sub-accounts', { replace: true })
    }

    // Handle payment status (per-sub-account)
    if (paymentStatus === 'success') {
      toast.success('Payment successful! Sub-account activated.')
      navigate('/sub-accounts', { replace: true })
    } else if (paymentStatus === 'cancelled') {
      toast.error('Payment was cancelled')
      navigate('/sub-accounts', { replace: true })
    }
  }, [searchParams, navigate])

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

  // Subscribe/Resume subscription for a sub-account
  const handleSubscribe = async (subAccountId) => {
    setSubscribingTo(subAccountId)
    try {
      const { data } = await api.post(`/billing/checkout/${subAccountId}`)

      if (data.autoSubscribed) {
        // Payment method was saved - subscription created automatically
        toast.success(data.message || 'Subscription activated!')
        fetchSubAccounts()
        fetchSubscriptionInfo()
      } else if (data.url) {
        // No saved payment method - open checkout
        window.open(data.url, '_blank')
        toast.success('Stripe checkout opened in new tab')
      } else {
        toast.error('Failed to create subscription')
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to start subscription')
    } finally {
      setSubscribingTo(null)
    }
  }

  // Cancel subscription for a sub-account
  const [cancellingId, setCancellingId] = useState(null)

  const handleCancelSubscription = async (subAccountId, name) => {
    if (!confirm(`Cancel subscription for "${name}"? Access will continue until the end of the billing period.`)) return

    setCancellingId(subAccountId)
    try {
      const { data } = await api.post(`/billing/cancel/${subAccountId}`)
      toast.success(data.message || 'Subscription cancelled')
      fetchSubAccounts()
      fetchSubscriptionInfo()
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to cancel subscription')
    } finally {
      setCancellingId(null)
    }
  }

  // Resubscribe - undo pending cancellation
  const [resubscribingId, setResubscribingId] = useState(null)

  const handleResubscribe = async (subAccountId, name) => {
    setResubscribingId(subAccountId)
    try {
      const { data } = await api.post(`/billing/resubscribe/${subAccountId}`)
      toast.success(data.message || 'Subscription resumed')
      fetchSubAccounts()
      fetchSubscriptionInfo()
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to resubscribe')
    } finally {
      setResubscribingId(null)
    }
  }

  const handleCreateClick = () => {
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

      toast.success('Sub-account created! Complete GHL connection in the new tab.')
      setShowCreateModal(false)
      setNewLocationId('')

      // Automatically start GHL OAuth connection in new tab
      try {
        const { data: authData } = await api.get(`/ghl/auth-url/${subAccountId}`)

        if (!authData?.authUrl) {
          toast.error('Failed to get GHL authorization URL')
        } else {
          // Open in new tab
          window.open(authData.authUrl, '_blank')
        }
      } catch (err) {
        toast.error('Failed to start GHL connection')
      }

      // Refresh list since sub-account was created
      fetchSubAccounts()
      fetchSubscriptionInfo()

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

  const deleteSubAccount = async (id, name, isPaid) => {
    const message = isPaid
      ? `Are you sure you want to delete "${name}"?\n\n⚠️ This will also cancel the subscription for this sub-account.`
      : `Are you sure you want to delete "${name}"?`

    if (!confirm(message)) return

    try {
      await api.delete(`/sub-accounts/${id}`)
      toast.success('Sub-account deleted')
      fetchSubAccounts()
      fetchSubscriptionInfo()
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

      {/* Trial Banner - for users on trial */}
      {!isAdmin && subscriptionInfo?.isTrialing && (
        <div className="mb-6 p-4 rounded-lg border bg-blue-50 border-blue-200">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="font-medium text-blue-900">
                Free Trial - {subscriptionInfo.trialDaysRemaining} day{subscriptionInfo.trialDaysRemaining !== 1 ? 's' : ''} remaining
              </p>
              <p className="text-sm text-blue-700 mt-1">
                All your sub-accounts work for free during trial. Subscribe to individual sub-accounts before trial ends to keep them active.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Subscription Info Banner - for regular users after trial */}
      {!isAdmin && subscriptionInfo && !subscriptionInfo.isTrialing && subscriptionInfo.unpaidSubAccountCount > 0 && (
        <div className="mb-6 p-4 rounded-lg border bg-yellow-50 border-yellow-200">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="font-medium text-yellow-800">
                {subscriptionInfo.unpaidSubAccountCount} sub-account{subscriptionInfo.unpaidSubAccountCount !== 1 ? 's' : ''} need{subscriptionInfo.unpaidSubAccountCount === 1 ? 's' : ''} subscription
              </p>
              <p className="text-sm text-yellow-700 mt-1">
                Subscribe to activate your sub-accounts.
                {subscriptionInfo.isVolumeEligible && (
                  <span className="ml-1 text-green-600 font-medium">Volume discount active: €19/month each!</span>
                )}
                {!subscriptionInfo.isVolumeEligible && (
                  <span className="ml-1">€{subscriptionInfo.nextPrice}/month per sub-account</span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : subAccounts.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500 mb-4">No sub-accounts yet</p>
          <button
            onClick={handleCreateClick}
            className="inline-flex items-center gap-2 bg-primary-500 text-white px-4 py-2 rounded-lg hover:bg-primary-600 transition-colors"
          >
            <Plus size={20} />
            Create your first sub-account
          </button>
          {subscriptionInfo?.isTrialing && (
            <p className="text-sm text-blue-600 mt-3">
              Create unlimited sub-accounts during your free trial!
            </p>
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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payment</th>
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
              ) : filteredSubAccounts.map((account) => {
                // Determine payment status
                const isFree = isAdmin || account.isGifted
                const isTrialing = subscriptionInfo?.isTrialing
                const isPaid = account.isPaid

                return (
                  <tr key={account.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900">{account.name}</p>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {account.phoneNumber || '-'}
                    </td>
                    <td className="px-6 py-4 text-gray-600 text-sm font-mono">
                      <div className="flex items-center gap-2">
                        {account.ghlLocationId || '-'}
                        {account.ghlLocationId && (
                          account.ghlConnected ? (
                            <span title="GHL Connected" className="text-green-500"><Link2 size={14} /></span>
                          ) : (
                            <span title="GHL Disconnected" className="text-red-500"><Link2Off size={14} /></span>
                          )
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {isFree ? (
                        <span className="text-sm px-2 py-1 rounded bg-purple-100 text-purple-700">
                          Free
                        </span>
                      ) : isTrialing ? (
                        <span className="text-sm px-2 py-1 rounded bg-blue-100 text-blue-700">
                          Trial
                        </span>
                      ) : isPaid && account.cancelAtPeriodEnd ? (
                        <span className="text-sm px-2 py-1 rounded bg-orange-100 text-orange-700">
                          Cancelling
                        </span>
                      ) : isPaid ? (
                        <span className="text-sm px-2 py-1 rounded bg-green-100 text-green-700">
                          Active
                        </span>
                      ) : (
                        <span className="text-sm px-2 py-1 rounded bg-red-100 text-red-700">
                          Unpaid
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
                        {/* Play = Subscribe (for unpaid) */}
                        {!isFree && !isPaid && (
                          <button
                            onClick={() => handleSubscribe(account.id)}
                            disabled={subscribingTo === account.id}
                            className="p-2 text-green-500 hover:bg-green-50 rounded disabled:opacity-50"
                            title={isTrialing ? "Subscribe (starts after trial)" : "Subscribe to activate"}
                          >
                            <PlayCircle size={18} />
                          </button>
                        )}
                        {/* Resubscribe (for pending cancellation) */}
                        {!isFree && isPaid && account.cancelAtPeriodEnd && (
                          <button
                            onClick={() => handleResubscribe(account.id, account.name)}
                            disabled={resubscribingId === account.id}
                            className="p-2 text-green-500 hover:bg-green-50 rounded disabled:opacity-50"
                            title="Resubscribe"
                          >
                            <RotateCcw size={18} />
                          </button>
                        )}
                        {/* Cancel subscription (for active paid) */}
                        {!isFree && isPaid && !account.cancelAtPeriodEnd && (
                          <button
                            onClick={() => handleCancelSubscription(account.id, account.name)}
                            disabled={cancellingId === account.id}
                            className="p-2 text-red-500 hover:bg-red-50 rounded disabled:opacity-50"
                            title="Cancel subscription"
                          >
                            <XCircle size={18} />
                          </button>
                        )}
                        {/* Eye = View details */}
                        <Link
                          to={`/sub-accounts/${account.id}`}
                          className="p-2 text-gray-600 hover:text-primary-500 hover:bg-gray-100 rounded"
                          title="View details"
                        >
                          <Eye size={18} />
                        </Link>
                        {/* Delete */}
                        <button
                          onClick={() => deleteSubAccount(account.id, account.name, isPaid)}
                          className="p-2 text-gray-600 hover:text-red-500 hover:bg-gray-100 rounded"
                          title="Delete sub-account"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
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

            {/* Trial/Subscription info */}
            {!isAdmin && subscriptionInfo?.isTrialing && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                <p className="text-blue-800">
                  <strong>Free Trial:</strong> This sub-account will work for free during your trial ({subscriptionInfo.trialDaysRemaining} days left).
                </p>
              </div>
            )}
            {!isAdmin && subscriptionInfo && !subscriptionInfo.isTrialing && (
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm">
                <p className="text-yellow-800">
                  You'll need to subscribe (€{subscriptionInfo.nextPrice}/month) to activate this sub-account after creation.
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

    </div>
  )
}
