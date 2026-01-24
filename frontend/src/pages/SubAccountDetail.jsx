import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../services/api'
import toast from 'react-hot-toast'
import { ArrowLeft, RefreshCw, Wifi, WifiOff, MapPin } from 'lucide-react'

export default function SubAccountDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [subAccount, setSubAccount] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)

  const fetchSubAccount = useCallback(async () => {
    try {
      const { data } = await api.get(`/sub-accounts/${id}`)
      setSubAccount(data.subAccount)
    } catch (error) {
      toast.error('Sub-account not found')
      navigate('/sub-accounts')
    } finally {
      setLoading(false)
    }
  }, [id, navigate])

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await api.get(`/whatsapp/${id}/status`)
      setStatus(data)
    } catch (error) {
      console.error('Failed to fetch status:', error)
    }
  }, [id])

  useEffect(() => {
    fetchSubAccount()
    fetchStatus()

    // Poll for status updates
    const interval = setInterval(fetchStatus, 3000)
    return () => clearInterval(interval)
  }, [fetchSubAccount, fetchStatus])

  const connect = async () => {
    setConnecting(true)
    try {
      await api.post(`/whatsapp/${id}/connect`)
      toast.success('Connecting... Please scan the QR code')
      fetchStatus()
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to connect')
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = async () => {
    if (!confirm('Are you sure you want to disconnect?')) return

    try {
      await api.post(`/whatsapp/${id}/disconnect`)
      toast.success('Disconnected')
      fetchStatus()
    } catch (error) {
      toast.error('Failed to disconnect')
    }
  }

  if (loading) {
    return <div className="text-center py-12">Loading...</div>
  }

  return (
    <div>
      <button
        onClick={() => navigate('/sub-accounts')}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft size={20} />
        Back to Sub-Accounts
      </button>

      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{subAccount?.name}</h1>
          <p className="text-gray-600 mt-1">
            {subAccount?.phoneNumber || 'Not connected'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            status?.status === 'connected' ? 'bg-green-100 text-green-700' :
            status?.status === 'qr_ready' ? 'bg-yellow-100 text-yellow-700' :
            status?.status === 'connecting' ? 'bg-blue-100 text-blue-700' :
            'bg-gray-100 text-gray-700'
          }`}>
            {status?.status || 'disconnected'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Connection Panel */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">WhatsApp Connection</h2>

          {status?.status === 'connected' ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Wifi className="text-green-500" size={32} />
              </div>
              <p className="text-green-600 font-medium mb-2">Connected</p>
              <p className="text-gray-600 mb-4">{status.phoneNumber}</p>
              <button
                onClick={disconnect}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
              >
                Disconnect
              </button>
            </div>
          ) : status?.qrCode ? (
            <div className="text-center py-4">
              <p className="text-gray-600 mb-4">Scan this QR code with WhatsApp</p>
              <img
                src={status.qrCode}
                alt="QR Code"
                className="mx-auto mb-4 border rounded-lg"
                style={{ maxWidth: '256px' }}
              />
              <button
                onClick={fetchStatus}
                className="flex items-center gap-2 mx-auto text-gray-600 hover:text-gray-900"
              >
                <RefreshCw size={18} />
                Refresh
              </button>
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <WifiOff className="text-gray-400" size={32} />
              </div>
              <p className="text-gray-600 mb-4">Not connected</p>
              <button
                onClick={connect}
                disabled={connecting}
                className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
              >
                {connecting ? 'Connecting...' : 'Connect WhatsApp'}
              </button>
            </div>
          )}
        </div>

        {/* Location Info */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <MapPin size={20} />
            Location Details
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">Location ID</label>
              <p className="text-gray-900 font-mono bg-gray-50 px-3 py-2 rounded">
                {subAccount?.ghlLocationId || 'Not set'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">Phone Number</label>
              <p className="text-gray-900 bg-gray-50 px-3 py-2 rounded">
                {subAccount?.phoneNumber || 'Not connected'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">Status</label>
              <p className={`inline-block px-3 py-1 rounded text-sm font-medium ${
                status?.status === 'connected' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
              }`}>
                {status?.status === 'connected' ? 'Active' : 'Inactive'}
              </p>
            </div>
          </div>

          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-700">
              <strong>Next steps:</strong> After connecting WhatsApp, go to your GoHighLevel account and change the SMS provider in Settings → Phone System → Additional Settings to use this WhatsApp connection.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
