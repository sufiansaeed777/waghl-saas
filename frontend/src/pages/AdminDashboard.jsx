import { useState, useEffect, useMemo } from 'react'
import api from '../services/api'
import toast from 'react-hot-toast'
import { Users, Smartphone, MessageSquare, ToggleLeft, ToggleRight, ChevronDown, ChevronRight, Phone, MapPin, Crown, Gift, Search, Filter, Trash2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function AdminDashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [customers, setCustomers] = useState([])
  const [subAccounts, setSubAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('customers')
  const [expandedCustomers, setExpandedCustomers] = useState({})

  // Search and filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [filterPlan, setFilterPlan] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterCustomer, setFilterCustomer] = useState('all')

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const [statsRes, customersRes, subAccountsRes] = await Promise.all([
        api.get('/admin/stats'),
        api.get('/admin/customers'),
        api.get('/admin/sub-accounts')
      ])
      setStats(statsRes.data)
      setCustomers(customersRes.data.customers)
      setSubAccounts(subAccountsRes.data.subAccounts)
    } catch (error) {
      toast.error('Failed to fetch admin data')
    } finally {
      setLoading(false)
    }
  }

  const toggleCustomer = async (id) => {
    try {
      await api.put(`/admin/customers/${id}/toggle`)
      toast.success('Customer status updated')
      fetchData()
    } catch (error) {
      toast.error('Failed to update customer')
    }
  }

  const toggleSubAccount = async (id) => {
    try {
      await api.put(`/admin/sub-accounts/${id}/toggle`)
      toast.success('Sub-account status updated')
      fetchData()
    } catch (error) {
      toast.error('Failed to update sub-account')
    }
  }

  const grantFreeAccess = async (customerId, currentAccess) => {
    // Prevent admin from gifting itself
    if (customerId === user?.id) {
      toast.error('Cannot modify your own access')
      return
    }

    const action = currentAccess ? 'revoke' : 'grant'
    if (!confirm(`Are you sure you want to ${action} free unlimited access for this customer?`)) return

    try {
      await api.put(`/admin/customers/${customerId}/access`, {
        hasUnlimitedAccess: !currentAccess,
        planType: !currentAccess ? 'free' : 'standard'
      })
      toast.success(`Free access ${action}ed successfully`)
      fetchData()
    } catch (error) {
      toast.error(error.response?.data?.error || `Failed to ${action} free access`)
    }
  }

  const deleteCustomer = async (customerId, customerName) => {
    // Prevent admin from deleting itself
    if (customerId === user?.id) {
      toast.error('Cannot delete your own account')
      return
    }

    if (!confirm(`Are you sure you want to delete "${customerName}" and ALL their sub-accounts? This cannot be undone.`)) return

    try {
      await api.delete(`/admin/customers/${customerId}`)
      toast.success('Customer and sub-accounts deleted')
      fetchData()
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to delete customer')
    }
  }

  const deleteSubAccount = async (subAccountId, subAccountName) => {
    if (!confirm(`Are you sure you want to delete "${subAccountName}"? This cannot be undone.`)) return

    try {
      await api.delete(`/admin/sub-accounts/${subAccountId}`)
      toast.success('Sub-account deleted')
      fetchData()
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to delete sub-account')
    }
  }

  const giftSubAccount = async (subAccountId, currentPaid) => {
    const action = currentPaid ? 'revoke' : 'grant'
    if (!confirm(`Are you sure you want to ${action} paid status for this sub-account?`)) return

    try {
      await api.put(`/admin/sub-accounts/${subAccountId}/payment`, {
        isPaid: !currentPaid
      })
      toast.success(`Sub-account ${!currentPaid ? 'marked as paid' : 'marked as unpaid'}`)
      fetchData()
    } catch (error) {
      toast.error(error.response?.data?.error || `Failed to ${action} paid status`)
    }
  }

  const toggleExpanded = (customerId) => {
    setExpandedCustomers(prev => ({
      ...prev,
      [customerId]: !prev[customerId]
    }))
  }

  const getCustomerSubAccounts = (customerId) => {
    return subAccounts.filter(sa => sa.customer?.id === customerId)
  }

  // Filtered customers based on search and filters
  const filteredCustomers = useMemo(() => {
    return customers.filter(customer => {
      // Search by name or email
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        if (!customer.name?.toLowerCase().includes(query) &&
            !customer.email?.toLowerCase().includes(query)) {
          return false
        }
      }

      // Filter by plan
      if (filterPlan !== 'all') {
        if (filterPlan === 'free' && !customer.hasUnlimitedAccess) return false
        if (filterPlan === 'standard' && (customer.hasUnlimitedAccess || customer.planType === 'volume')) return false
        if (filterPlan === 'volume' && (customer.hasUnlimitedAccess || customer.planType !== 'volume')) return false
      }

      // Filter by status
      if (filterStatus !== 'all') {
        if (filterStatus === 'active' && !customer.isActive) return false
        if (filterStatus === 'inactive' && customer.isActive) return false
      }

      return true
    })
  }, [customers, searchQuery, filterPlan, filterStatus])

  // Filtered sub-accounts based on filters
  const filteredSubAccounts = useMemo(() => {
    return subAccounts.filter(account => {
      // Search by: sub-account name, customer name, customer email, location ID, phone
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const matchesName = account.name?.toLowerCase().includes(query)
        const matchesCustomerName = account.customer?.name?.toLowerCase().includes(query)
        const matchesCustomerEmail = account.customer?.email?.toLowerCase().includes(query)
        const matchesLocationId = account.ghlLocationId?.toLowerCase().includes(query)
        const matchesPhone = account.phoneNumber?.includes(query)

        if (!matchesName && !matchesCustomerName && !matchesCustomerEmail && !matchesLocationId && !matchesPhone) {
          return false
        }
      }

      // Filter by status (WhatsApp connection status)
      if (filterStatus !== 'all') {
        if (filterStatus === 'connected' && account.status !== 'connected') return false
        if (filterStatus === 'disconnected' && account.status === 'connected') return false
        if (filterStatus === 'active' && !account.isActive) return false
        if (filterStatus === 'inactive' && account.isActive) return false
      }

      // Filter by customer
      if (filterCustomer !== 'all') {
        if (account.customer?.id !== filterCustomer) return false
      }

      return true
    })
  }, [subAccounts, searchQuery, filterStatus, filterCustomer])

  // Reset filters when switching tabs
  const handleTabChange = (tab) => {
    setActiveTab(tab)
    setSearchQuery('')
    setFilterPlan('all')
    setFilterStatus('all')
    setFilterCustomer('all')
  }

  if (loading) {
    return <div className="text-center py-12">Loading...</div>
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-600 mt-1">Manage customers and sub-accounts</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Customers</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{stats?.customers?.total || 0}</p>
            </div>
            <div className="bg-blue-100 p-3 rounded-full">
              <Users className="text-blue-500" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Active Customers</p>
              <p className="text-3xl font-bold text-green-600 mt-1">{stats?.customers?.active || 0}</p>
            </div>
            <div className="bg-green-100 p-3 rounded-full">
              <Users className="text-green-500" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Sub-Accounts</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{stats?.subAccounts?.total || 0}</p>
            </div>
            <div className="bg-purple-100 p-3 rounded-full">
              <Smartphone className="text-purple-500" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Connected</p>
              <p className="text-3xl font-bold text-primary-500 mt-1">{stats?.subAccounts?.connected || 0}</p>
            </div>
            <div className="bg-primary-100 p-3 rounded-full">
              <MessageSquare className="text-primary-500" size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b">
          <div className="flex">
            <button
              onClick={() => handleTabChange('customers')}
              className={`px-6 py-3 text-sm font-medium ${
                activeTab === 'customers'
                  ? 'border-b-2 border-primary-500 text-primary-500'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Customers ({customers.length})
            </button>
            <button
              onClick={() => handleTabChange('subaccounts')}
              className={`px-6 py-3 text-sm font-medium ${
                activeTab === 'subaccounts'
                  ? 'border-b-2 border-primary-500 text-primary-500'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Sub-Accounts ({subAccounts.length})
            </button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="p-4 border-b bg-gray-50">
          <div className="flex flex-wrap gap-4 items-center">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder={activeTab === 'customers' ? 'Search by customer name or email...' : 'Search by name, customer, location ID, phone...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2">
              <Filter size={18} className="text-gray-500" />

              {/* Plan Filter - only for customers tab */}
              {activeTab === 'customers' && (
                <select
                  value={filterPlan}
                  onChange={(e) => setFilterPlan(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="all">All Plans</option>
                  <option value="free">Free (Unlimited)</option>
                  <option value="standard">Standard</option>
                  <option value="volume">Volume</option>
                </select>
              )}

              {/* Status Filter */}
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                {activeTab === 'customers' ? (
                  <>
                    <option value="all">All Status</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </>
                ) : (
                  <>
                    <option value="all">All Status</option>
                    <option value="connected">Connected</option>
                    <option value="disconnected">Disconnected</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </>
                )}
              </select>

              {/* Customer Filter (only for sub-accounts tab) */}
              {activeTab === 'subaccounts' && (
                <select
                  value={filterCustomer}
                  onChange={(e) => setFilterCustomer(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 max-w-[200px]"
                >
                  <option value="all">All Customers</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Results count */}
            <span className="text-sm text-gray-500">
              {activeTab === 'customers'
                ? `${filteredCustomers.length} of ${customers.length} customers`
                : `${filteredSubAccounts.length} of ${subAccounts.length} sub-accounts`
              }
            </span>
          </div>
        </div>

        {activeTab === 'customers' ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase w-10"></th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sub-Accounts</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Plan</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-6 py-12 text-center text-gray-500">
                      No customers found matching your filters
                    </td>
                  </tr>
                ) : filteredCustomers.map((customer) => {
                  const customerSubAccounts = getCustomerSubAccounts(customer.id)
                  const isExpanded = expandedCustomers[customer.id]

                  return (
                    <>
                      <tr key={customer.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          {customerSubAccounts.length > 0 && (
                            <button
                              onClick={() => toggleExpanded(customer.id)}
                              className="p-1 hover:bg-gray-200 rounded"
                            >
                              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <p className="font-medium text-gray-900">{customer.name}</p>
                          <p className="text-sm text-gray-500">{customer.email}</p>
                          {customer.role === 'admin' && (
                            <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700">Admin</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm font-medium">{customerSubAccounts.length}</span>
                          <span className="text-sm text-gray-500 ml-1">sub-accounts</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            {customer.role === 'admin' || customer.hasUnlimitedAccess ? (
                              <span className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-700">
                                <Crown size={12} />
                                Free (Unlimited)
                              </span>
                            ) : customer.planType === 'volume' ? (
                              <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700">
                                Volume (€19)
                              </span>
                            ) : (
                              <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
                                Standard (€29)
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-xs px-2 py-1 rounded ${
                            customer.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {customer.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {/* Gift button - hidden for admin's own account */}
                            {customer.id !== user?.id && (
                              <button
                                onClick={() => grantFreeAccess(customer.id, customer.hasUnlimitedAccess)}
                                className={`p-2 rounded ${
                                  customer.hasUnlimitedAccess
                                    ? 'bg-yellow-100 text-yellow-600 hover:bg-yellow-200'
                                    : 'hover:bg-gray-100 text-gray-500'
                                }`}
                                title={customer.hasUnlimitedAccess ? 'Revoke free access' : 'Grant free access'}
                              >
                                <Gift size={20} />
                              </button>
                            )}
                            {/* Active/Inactive toggle - hidden for admin's own account */}
                            {customer.id !== user?.id && (
                              <button
                                onClick={() => toggleCustomer(customer.id)}
                                className="p-2 hover:bg-gray-100 rounded"
                                title={customer.isActive ? 'Deactivate customer' : 'Activate customer'}
                              >
                                {customer.isActive ? (
                                  <ToggleRight className="text-green-500" size={24} />
                                ) : (
                                  <ToggleLeft className="text-gray-400" size={24} />
                                )}
                              </button>
                            )}
                            {/* Delete button - hidden for admin's own account */}
                            {customer.id !== user?.id && (
                              <button
                                onClick={() => deleteCustomer(customer.id, customer.name)}
                                className="p-2 hover:bg-red-100 text-gray-500 hover:text-red-500 rounded"
                                title="Delete customer"
                              >
                                <Trash2 size={20} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Sub-Accounts */}
                      {isExpanded && customerSubAccounts.map((subAccount) => (
                        <tr key={subAccount.id} className="bg-gray-50">
                          <td className="px-6 py-3"></td>
                          <td className="px-6 py-3" colSpan="5">
                            <div className="ml-4 p-3 bg-white rounded-lg border border-gray-200">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                  <div>
                                    <p className="font-medium text-gray-800">{subAccount.name}</p>
                                    <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                                      <span className="flex items-center gap-1">
                                        <Phone size={14} />
                                        {subAccount.phoneNumber || 'No phone'}
                                      </span>
                                      <span className="flex items-center gap-1">
                                        <MapPin size={14} />
                                        {subAccount.ghlLocationId || 'No location ID'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className={`text-xs px-2 py-1 rounded ${
                                    subAccount.status === 'connected' ? 'bg-green-100 text-green-700' :
                                    subAccount.status === 'qr_ready' ? 'bg-yellow-100 text-yellow-700' :
                                    'bg-gray-100 text-gray-700'
                                  }`}>
                                    {subAccount.status}
                                  </span>
                                  {subAccount.isPaid ? (
                                    <button
                                      onClick={() => giftSubAccount(subAccount.id, subAccount.isPaid)}
                                      className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                                    >
                                      Cancel Sub
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => giftSubAccount(subAccount.id, subAccount.isPaid)}
                                      className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200"
                                    >
                                      Resume Sub
                                    </button>
                                  )}
                                  <button
                                    onClick={() => toggleSubAccount(subAccount.id)}
                                    className="p-1 hover:bg-gray-100 rounded"
                                  >
                                    {subAccount.isActive ? (
                                      <ToggleRight className="text-green-500" size={20} />
                                    ) : (
                                      <ToggleLeft className="text-gray-400" size={20} />
                                    )}
                                  </button>
                                  <button
                                    onClick={() => deleteSubAccount(subAccount.id, subAccount.name)}
                                    className="p-1 hover:bg-red-100 text-gray-500 hover:text-red-500 rounded"
                                    title="Delete sub-account"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredSubAccounts.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-6 py-12 text-center text-gray-500">
                    No sub-accounts found matching your filters
                  </td>
                </tr>
              ) : filteredSubAccounts.map((account) => (
                <tr key={account.id}>
                  <td className="px-6 py-4 font-medium">{account.name}</td>
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-900">{account.customer?.name || '-'}</p>
                    <p className="text-sm text-gray-500">{account.customer?.email}</p>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{account.phoneNumber || '-'}</td>
                  <td className="px-6 py-4 text-gray-600 font-mono text-sm">{account.ghlLocationId || '-'}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded ${
                        account.status === 'connected' ? 'bg-green-100 text-green-700' :
                        account.status === 'qr_ready' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {account.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {account.isPaid ? (
                        <button
                          onClick={() => giftSubAccount(account.id, account.isPaid)}
                          className="text-xs px-3 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                        >
                          Cancel Sub
                        </button>
                      ) : (
                        <button
                          onClick={() => giftSubAccount(account.id, account.isPaid)}
                          className="text-xs px-3 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200"
                        >
                          Resume Sub
                        </button>
                      )}
                      <button
                        onClick={() => toggleSubAccount(account.id)}
                        className="p-2 hover:bg-gray-100 rounded"
                      >
                        {account.isActive ? (
                          <ToggleRight className="text-green-500" size={24} />
                        ) : (
                          <ToggleLeft className="text-gray-400" size={24} />
                        )}
                      </button>
                      <button
                        onClick={() => deleteSubAccount(account.id, account.name)}
                        className="p-2 hover:bg-red-100 text-gray-500 hover:text-red-500 rounded"
                        title="Delete sub-account"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
