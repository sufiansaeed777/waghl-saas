import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../services/api'
import toast from 'react-hot-toast'
import { Plus, Trash2, Eye } from 'lucide-react'

export default function SubAccounts() {
  const [subAccounts, setSubAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

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
      await api.post('/sub-accounts', { name: newName })
      toast.success('Sub-account created!')
      setShowCreateModal(false)
      setNewName('')
      fetchSubAccounts()
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to create sub-account')
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
    } catch (error) {
      toast.error('Failed to delete sub-account')
    }
  }

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
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {subAccounts.map((account) => (
                <tr key={account.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-900">{account.name}</p>
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {account.phoneNumber || '-'}
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
                  <td className="px-6 py-4 text-gray-600 text-sm">
                    {new Date(account.createdAt).toLocaleDateString()}
                  </td>
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
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
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
