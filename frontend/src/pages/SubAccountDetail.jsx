import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import api from '../services/api'
import toast from 'react-hot-toast'
import { ArrowLeft, RefreshCw, Wifi, WifiOff, Link, Unlink, CheckCircle, XCircle, CreditCard } from 'lucide-react'

export default function SubAccountDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [subAccount, setSubAccount] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [ghlStatus, setGhlStatus] = useState({ connected: false, loading: true })
  const [connectingGhl, setConnectingGhl] = useState(false)

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

  const fetchGhlStatus = useCallback(async () => {
    try {
      const { data } = await api.get(`/ghl/status/${id}`)
      setGhlStatus({ ...data, loading: false })
    } catch (error) {
      setGhlStatus({ connected: false, loading: false })
    }
  }, [id])

  // Check for GHL callback results
  useEffect(() => {
    if (searchParams.get('ghl_connected') === 'true') {
      toast.success('GoHighLevel connected successfully!')
      fetchGhlStatus()
      fetchSubAccount()
    } else if (searchParams.get('ghl_error')) {
      toast.error(`GHL connection failed: ${searchParams.get('ghl_error')}`)
    }
  }, [searchParams, fetchGhlStatus, fetchSubAccount])

  useEffect(() => {
    fetchSubAccount()
    fetchStatus()
    fetchGhlStatus()

    // Poll for status updates
    const interval = setInterval(() => {
      fetchStatus()
    }, 3000)
    return () => clearInterval(interval)
  }, [fetchSubAccount, fetchStatus, fetchGhlStatus])

  const connectWhatsApp = async () => {
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

  const disconnectWhatsApp = async () => {
    if (!confirm('Are you sure you want to disconnect WhatsApp?')) return

    try {
      await api.post(`/whatsapp/${id}/disconnect`)
      toast.success('WhatsApp disconnected')
      fetchStatus()
    } catch (error) {
      toast.error('Failed to disconnect')
    }
  }

  const connectGhl = async () => {
    setConnectingGhl(true)
    try {
      const { data } = await api.get(`/ghl/auth-url/${id}`)
      window.location.href = data.authUrl
    } catch (error) {
      toast.error('Failed to start GHL connection')
      setConnectingGhl(false)
    }
  }

  const disconnectGhl = async () => {
    if (!confirm('Are you sure you want to disconnect GoHighLevel?')) return

    try {
      await api.post(`/ghl/disconnect/${id}`)
      toast.success('GoHighLevel disconnected')
      setGhlStatus({ connected: false, loading: false })
      fetchSubAccount()
    } catch (error) {
      toast.error('Failed to disconnect GHL')
    }
  }

  if (loading) {
    return <div className="text-center py-12">Loading...</div>
  }

  const isFullyConnected = status?.status === 'connected' && ghlStatus.connected

  return (
    <div>
      <button
        onClick={() => navigate('/sub-accounts')}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft size={20} />
        Back to Sub-Accounts
      </button>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{subAccount?.name}</h1>
        <p className="text-gray-600 mt-1">Location ID: {subAccount?.ghlLocationId || 'Not set'}</p>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className={`p-4 rounded-lg border-2 ${status?.status === 'connected' ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white'}`}>
          <div className="flex items-center gap-3">
            {status?.status === 'connected' ? (
              <CheckCircle className="text-green-500" size={24} />
            ) : (
              <XCircle className="text-gray-400" size={24} />
            )}
            <div>
              <p className="font-medium">WhatsApp</p>
              <p className="text-sm text-gray-600">
                {status?.status === 'connected' ? status?.phoneNumber || 'Connected' : 'Not connected'}
              </p>
            </div>
          </div>
        </div>

        <div className={`p-4 rounded-lg border-2 ${ghlStatus.connected ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white'}`}>
          <div className="flex items-center gap-3">
            {ghlStatus.connected ? (
              <CheckCircle className="text-green-500" size={24} />
            ) : (
              <XCircle className="text-gray-400" size={24} />
            )}
            <div>
              <p className="font-medium">GoHighLevel</p>
              <p className="text-sm text-gray-600">
                {ghlStatus.connected ? 'Connected' : 'Not connected'}
              </p>
            </div>
          </div>
        </div>

        <div className={`p-4 rounded-lg border-2 ${subAccount?.isPaid ? 'border-green-500 bg-green-50' : 'border-yellow-500 bg-yellow-50'}`}>
          <div className="flex items-center gap-3">
            <CreditCard className={subAccount?.isPaid ? 'text-green-500' : 'text-yellow-500'} size={24} />
            <div>
              <p className="font-medium">Subscription</p>
              <p className="text-sm text-gray-600">
                {subAccount?.isPaid ? 'Active' : 'Not subscribed'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Connection Status Message */}
      {isFullyConnected && (
        <div className="mb-8 p-4 bg-green-100 border border-green-300 rounded-lg">
          <p className="text-green-800 font-medium">
            All connected! Messages sent as "SMS" in GoHighLevel will be delivered via WhatsApp.
          </p>
          <p className="text-green-700 text-sm mt-1">
            Go to GHL → Settings → Phone System → Additional Settings → Change SMS provider to use this connection.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* WhatsApp Connection */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Wifi size={20} />
            WhatsApp Connection
          </h2>

          {status?.status === 'connected' ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Wifi className="text-green-500" size={32} />
              </div>
              <p className="text-green-600 font-medium mb-1">Connected</p>
              <p className="text-gray-600 mb-4">{status.phoneNumber}</p>
              <button
                onClick={disconnectWhatsApp}
                className="px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200"
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
                style={{ maxWidth: '200px' }}
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
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <WifiOff className="text-gray-400" size={32} />
              </div>
              <p className="text-gray-600 mb-4">Connect your WhatsApp number</p>
              <button
                onClick={connectWhatsApp}
                disabled={connecting}
                className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
              >
                {connecting ? 'Connecting...' : 'Connect WhatsApp'}
              </button>
            </div>
          )}
        </div>

        {/* GHL Connection */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Link size={20} />
            GoHighLevel Connection
          </h2>

          {ghlStatus.connected ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Link className="text-green-500" size={32} />
              </div>
              <p className="text-green-600 font-medium mb-1">Connected</p>
              <p className="text-gray-600 mb-4">Location: {subAccount?.ghlLocationId}</p>
              <button
                onClick={disconnectGhl}
                className="px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Unlink className="text-gray-400" size={32} />
              </div>
              <p className="text-gray-600 mb-4">Connect to your GoHighLevel account</p>
              <button
                onClick={connectGhl}
                disabled={connectingGhl}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                {connectingGhl ? 'Connecting...' : 'Connect GoHighLevel'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Instructions */}
      <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="font-semibold text-blue-900 mb-3">Setup Instructions</h3>
        <ol className="list-decimal list-inside space-y-2 text-blue-800">
          <li>Connect your WhatsApp number by scanning the QR code</li>
          <li>Click "Connect GoHighLevel" and authorize in your GHL account</li>
          <li>In GHL, go to Settings → Phone System → Additional Settings</li>
          <li>Change the SMS provider to use this WhatsApp connection</li>
          <li>Send messages as "SMS" in GHL - they'll be delivered via WhatsApp!</li>
        </ol>
      </div>
    </div>
  )
}
