import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../services/api'
import toast from 'react-hot-toast'
import { ArrowLeft, RefreshCw, Wifi, WifiOff, MapPin, MessageSquare, Send, ArrowDownLeft, ArrowUpRight, Image, FileText } from 'lucide-react'

export default function SubAccountDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [subAccount, setSubAccount] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [conversations, setConversations] = useState([])
  const [selectedContact, setSelectedContact] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sendForm, setSendForm] = useState({ to: '', message: '' })
  const [sending, setSending] = useState(false)

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

  const fetchConversations = useCallback(async () => {
    try {
      const { data } = await api.get(`/whatsapp/${id}/conversations`)
      setConversations(data.conversations || [])
    } catch (error) {
      console.error('Failed to fetch conversations:', error)
    }
  }, [id])

  const fetchMessages = async (contactNumber) => {
    setLoadingMessages(true)
    try {
      const { data } = await api.get(`/whatsapp/${id}/messages`, {
        params: { contact: contactNumber, limit: 100 }
      })
      setMessages(data.messages || [])
    } catch (error) {
      console.error('Failed to fetch messages:', error)
    } finally {
      setLoadingMessages(false)
    }
  }

  useEffect(() => {
    fetchSubAccount()
    fetchStatus()
    fetchConversations()

    // Poll for status and conversations updates
    const interval = setInterval(() => {
      fetchStatus()
      fetchConversations()
      if (selectedContact) {
        fetchMessages(selectedContact)
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [fetchSubAccount, fetchStatus, fetchConversations, selectedContact])

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

  const selectConversation = (contactNumber) => {
    setSelectedContact(contactNumber)
    setSendForm({ ...sendForm, to: contactNumber })
    fetchMessages(contactNumber)
  }

  const sendMessage = async (e) => {
    e.preventDefault()
    if (!sendForm.to || !sendForm.message) return

    setSending(true)
    try {
      await api.post(`/whatsapp/${id}/send`, {
        to: sendForm.to,
        message: sendForm.message
      })
      toast.success('Message sent!')
      setSendForm({ ...sendForm, message: '' })
      // Refresh messages
      if (selectedContact) {
        fetchMessages(selectedContact)
      }
      fetchConversations()
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const formatTime = (date) => {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const formatDate = (date) => {
    const d = new Date(date)
    const today = new Date()
    if (d.toDateString() === today.toDateString()) return 'Today'
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return d.toLocaleDateString()
  }

  if (loading) {
    return <div className="text-center py-12">Loading...</div>
  }

  return (
    <div className="h-[calc(100vh-120px)]">
      <button
        onClick={() => navigate('/sub-accounts')}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
      >
        <ArrowLeft size={20} />
        Back to Sub-Accounts
      </button>

      <div className="flex justify-between items-start mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{subAccount?.name}</h1>
          <p className="text-gray-600">
            {subAccount?.phoneNumber || 'Not connected'} | Location: {subAccount?.ghlLocationId || 'Not set'}
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

      {status?.status !== 'connected' ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <h2 className="text-lg font-semibold mb-4">WhatsApp Connection</h2>

          {status?.qrCode ? (
            <div>
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
            <div>
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <WifiOff className="text-gray-400" size={32} />
              </div>
              <p className="text-gray-600 mb-4">Not connected</p>
              <button
                onClick={connect}
                disabled={connecting}
                className="px-6 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
              >
                {connecting ? 'Connecting...' : 'Connect WhatsApp'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow flex h-[calc(100%-100px)]">
          {/* Conversations List */}
          <div className="w-80 border-r flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="font-semibold">Conversations</h3>
              <button
                onClick={disconnect}
                className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200"
              >
                Disconnect
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {conversations.length === 0 ? (
                <div className="p-4 text-center text-gray-500">
                  <MessageSquare className="mx-auto mb-2 text-gray-300" size={32} />
                  <p>No conversations yet</p>
                </div>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.contactNumber}
                    onClick={() => selectConversation(conv.contactNumber)}
                    className={`p-4 border-b cursor-pointer hover:bg-gray-50 ${
                      selectedContact === conv.contactNumber ? 'bg-primary-50' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <p className="font-medium text-gray-900">{conv.contactNumber}</p>
                      <span className="text-xs text-gray-500">{formatTime(conv.lastMessageAt)}</span>
                    </div>
                    <p className="text-sm text-gray-600 truncate mt-1">
                      {conv.direction === 'outbound' && <ArrowUpRight size={12} className="inline mr-1" />}
                      {conv.direction === 'inbound' && <ArrowDownLeft size={12} className="inline mr-1" />}
                      {conv.lastMessage || 'Media message'}
                    </p>
                  </div>
                ))
              )}
            </div>
            {/* New message input */}
            <div className="p-3 border-t">
              <input
                type="text"
                value={sendForm.to}
                onChange={(e) => setSendForm({ ...sendForm, to: e.target.value })}
                placeholder="New chat: Enter phone number"
                className="w-full px-3 py-2 border rounded text-sm"
              />
            </div>
          </div>

          {/* Messages Panel */}
          <div className="flex-1 flex flex-col">
            {selectedContact ? (
              <>
                <div className="p-4 border-b bg-gray-50">
                  <h3 className="font-semibold">{selectedContact}</h3>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {loadingMessages ? (
                    <div className="text-center py-8 text-gray-500">Loading messages...</div>
                  ) : messages.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">No messages</div>
                  ) : (
                    [...messages].reverse().map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[70%] rounded-lg px-4 py-2 ${
                            msg.direction === 'outbound'
                              ? 'bg-primary-500 text-white'
                              : 'bg-gray-100 text-gray-900'
                          }`}
                        >
                          {msg.messageType === 'image' && (
                            <div className="flex items-center gap-1 text-sm opacity-80 mb-1">
                              <Image size={14} /> Image
                            </div>
                          )}
                          {msg.messageType === 'document' && (
                            <div className="flex items-center gap-1 text-sm opacity-80 mb-1">
                              <FileText size={14} /> Document
                            </div>
                          )}
                          <p className="whitespace-pre-wrap">{msg.content || `[${msg.messageType}]`}</p>
                          <p className={`text-xs mt-1 ${
                            msg.direction === 'outbound' ? 'text-primary-200' : 'text-gray-500'
                          }`}>
                            {formatTime(msg.createdAt)}
                            {msg.status === 'failed' && ' • Failed'}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <form onSubmit={sendMessage} className="p-4 border-t flex gap-2">
                  <input
                    type="text"
                    value={sendForm.message}
                    onChange={(e) => setSendForm({ ...sendForm, message: e.target.value })}
                    placeholder="Type a message..."
                    className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                  <button
                    type="submit"
                    disabled={sending || !sendForm.message}
                    className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-50"
                  >
                    <Send size={20} />
                  </button>
                </form>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <MessageSquare className="mx-auto mb-2 text-gray-300" size={48} />
                  <p>Select a conversation or enter a phone number</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
