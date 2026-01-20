import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../services/api'
import toast from 'react-hot-toast'
import { ArrowLeft, RefreshCw, Wifi, WifiOff, Send, Copy, Key, Link, Unlink, MapPin } from 'lucide-react'

export default function SubAccountDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [subAccount, setSubAccount] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [sendForm, setSendForm] = useState({ to: '', message: '' })
  const [sending, setSending] = useState(false)
  const [ghlStatus, setGhlStatus] = useState({ connected: false })
  const [ghlLocations, setGhlLocations] = useState([])
  const [loadingLocations, setLoadingLocations] = useState(false)
  const [selectedLocation, setSelectedLocation] = useState('')
  const [linkingLocation, setLinkingLocation] = useState(false)

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
      const { data } = await api.get('/ghl/status')
      setGhlStatus(data)
      if (data.connected) {
        fetchGhlLocations()
      }
    } catch (error) {
      console.error('Failed to fetch GHL status:', error)
    }
  }, [])

  const fetchGhlLocations = async () => {
    setLoadingLocations(true)
    try {
      const { data } = await api.get('/ghl/locations')
      setGhlLocations(data.locations || [])
    } catch (error) {
      console.error('Failed to fetch GHL locations:', error)
    } finally {
      setLoadingLocations(false)
    }
  }

  const linkGhlLocation = async () => {
    if (!selectedLocation) {
      toast.error('Please select a location')
      return
    }

    setLinkingLocation(true)
    try {
      await api.post(`/ghl/link-location/${id}`, { locationId: selectedLocation })
      toast.success('GHL location linked successfully!')
      fetchSubAccount()
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to link location')
    } finally {
      setLinkingLocation(false)
    }
  }

  const unlinkGhlLocation = async () => {
    if (!confirm('Are you sure you want to unlink this GHL location?')) return

    try {
      await api.post(`/ghl/unlink-location/${id}`)
      toast.success('GHL location unlinked')
      fetchSubAccount()
    } catch (error) {
      toast.error('Failed to unlink location')
    }
  }

  useEffect(() => {
    fetchSubAccount()
    fetchStatus()
    fetchGhlStatus()

    // Poll for status updates
    const interval = setInterval(fetchStatus, 3000)
    return () => clearInterval(interval)
  }, [fetchSubAccount, fetchStatus, fetchGhlStatus])

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

  const sendMessage = async (e) => {
    e.preventDefault()
    setSending(true)

    try {
      await api.post(`/whatsapp/${id}/send`, {
        to: sendForm.to,
        message: sendForm.message
      })
      toast.success('Message sent!')
      setSendForm({ to: '', message: '' })
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard!')
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

        {/* Send Message Panel */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Send Message</h2>

          {status?.status === 'connected' ? (
            <form onSubmit={sendMessage}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number
                </label>
                <input
                  type="text"
                  value={sendForm.to}
                  onChange={(e) => setSendForm({ ...sendForm, to: e.target.value })}
                  required
                  placeholder="e.g., 923001234567"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Message
                </label>
                <textarea
                  value={sendForm.message}
                  onChange={(e) => setSendForm({ ...sendForm, message: e.target.value })}
                  required
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="Type your message..."
                />
              </div>
              <button
                type="submit"
                disabled={sending}
                className="flex items-center gap-2 bg-primary-500 text-white px-4 py-2 rounded-lg hover:bg-primary-600 disabled:opacity-50"
              >
                <Send size={18} />
                {sending ? 'Sending...' : 'Send Message'}
              </button>
            </form>
          ) : (
            <p className="text-gray-500 text-center py-8">
              Connect WhatsApp first to send messages
            </p>
          )}
        </div>

        {/* GHL Location Linking */}
        <div className="bg-white rounded-lg shadow p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <MapPin size={20} />
            GoHighLevel Location
          </h2>

          {!ghlStatus.connected ? (
            <div className="text-center py-6 bg-gray-50 rounded-lg">
              <Unlink className="mx-auto text-gray-400 mb-2" size={32} />
              <p className="text-gray-600 mb-2">GHL not connected</p>
              <p className="text-sm text-gray-500">
                Connect GoHighLevel in <a href="/settings" className="text-primary-500 hover:underline">Settings</a> first
              </p>
            </div>
          ) : subAccount?.ghlLocationId ? (
            <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                  <MapPin className="text-white" size={20} />
                </div>
                <div>
                  <p className="font-medium text-green-700">Linked to GHL Location</p>
                  <p className="text-sm text-green-600">{subAccount.ghlLocationName || subAccount.ghlLocationId}</p>
                </div>
              </div>
              <button
                onClick={unlinkGhlLocation}
                className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
              >
                <Unlink size={18} />
                Unlink
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Link this WhatsApp number to a GHL location to sync messages with contacts.
              </p>
              <div className="flex gap-2">
                <select
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  disabled={loadingLocations}
                >
                  <option value="">
                    {loadingLocations ? 'Loading locations...' : 'Select a GHL location'}
                  </option>
                  {ghlLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name || loc.id}
                    </option>
                  ))}
                </select>
                <button
                  onClick={linkGhlLocation}
                  disabled={linkingLocation || !selectedLocation}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
                >
                  <Link size={18} />
                  {linkingLocation ? 'Linking...' : 'Link Location'}
                </button>
              </div>
              {ghlLocations.length === 0 && !loadingLocations && (
                <p className="text-sm text-yellow-600">
                  No locations found. Make sure your GHL account has locations configured.
                </p>
              )}
            </div>
          )}
        </div>

        {/* API Credentials */}
        <div className="bg-white rounded-lg shadow p-6 lg:col-span-2">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Key size={20} />
            API Credentials
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Sub-Account ID
              </label>
              <div className="flex">
                <input
                  type="text"
                  value={subAccount?.id || ''}
                  readOnly
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-l-lg bg-gray-50"
                />
                <button
                  onClick={() => copyToClipboard(subAccount?.id)}
                  className="px-4 py-2 bg-gray-100 border border-l-0 border-gray-300 rounded-r-lg hover:bg-gray-200"
                >
                  <Copy size={18} />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                API Key
              </label>
              <div className="flex">
                <input
                  type="text"
                  value={subAccount?.apiKey || ''}
                  readOnly
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-l-lg bg-gray-50 font-mono text-sm"
                />
                <button
                  onClick={() => copyToClipboard(subAccount?.apiKey)}
                  className="px-4 py-2 bg-gray-100 border border-l-0 border-gray-300 rounded-r-lg hover:bg-gray-200"
                >
                  <Copy size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <p className="text-sm font-medium text-gray-700 mb-2">Example API Request:</p>
            <pre className="text-xs bg-gray-900 text-green-400 p-4 rounded overflow-x-auto">
{`curl -X POST ${window.location.origin}/api/whatsapp/send \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${subAccount?.apiKey}" \\
  -d '{"to": "923001234567", "message": "Hello!"}'`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
