import { useState, useEffect } from 'react'
import api from '../services/api'
import toast from 'react-hot-toast'
import { Users, Smartphone, MessageSquare, ToggleLeft, ToggleRight, ChevronDown, ChevronRight, Phone, MapPin, Crown, Gift } from 'lucide-react'

export default function AdminDashboard() {
  const [stats, setStats] = useState(null)
  const [customers, setCustomers] = useState([])
  const [subAccounts, setSubAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('customers')
  const [expandedCustomers, setExpandedCustomers] = useState({})

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
      toast.error(`Failed to ${action} free access`)
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
              onClick={() => setActiveTab('customers')}
              className={`px-6 py-3 text-sm font-medium ${
                activeTab === 'customers'
                  ? 'border-b-2 border-primary-500 text-primary-500'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Customers ({customers.length})
            </button>
            <button
              onClick={() => setActiveTab('subaccounts')}
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
                {customers.map((customer) => {
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
                            {customer.hasUnlimitedAccess ? (
                              <span className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-700">
                                <Crown size={12} />
                                Free (Unlimited)
                              </span>
                            ) : customer.planType === 'volume' ? (
                              <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700">
                                Volume ($19)
                              </span>
                            ) : (
                              <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">
                                Standard ($29)
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
                            <button
                              onClick={() => toggleCustomer(customer.id)}
                              className="p-2 hover:bg-gray-100 rounded"
                            >
                              {customer.isActive ? (
                                <ToggleRight className="text-green-500" size={24} />
                              ) : (
                                <ToggleLeft className="text-gray-400" size={24} />
                              )}
                            </button>
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
                                  <span className={`text-xs px-2 py-1 rounded ${
                                    subAccount.isPaid ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                                  }`}>
                                    {subAccount.isPaid ? 'Paid' : 'Unpaid'}
                                  </span>
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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Payment</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {subAccounts.map((account) => (
                <tr key={account.id}>
                  <td className="px-6 py-4 font-medium">{account.name}</td>
                  <td className="px-6 py-4 text-gray-600">{account.customer?.email}</td>
                  <td className="px-6 py-4 text-gray-600">{account.phoneNumber || '-'}</td>
                  <td className="px-6 py-4 text-gray-600 font-mono text-sm">{account.ghlLocationId || '-'}</td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-1 rounded ${
                      account.status === 'connected' ? 'bg-green-100 text-green-700' :
                      account.status === 'qr_ready' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {account.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-1 rounded ${
                      account.isPaid ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                    }`}>
                      {account.isPaid ? 'Paid' : 'Unpaid'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
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
