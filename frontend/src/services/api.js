import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json'
  }
})

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const currentPath = window.location.pathname
    const isAuthPage = currentPath === '/login' || currentPath === '/register'

    // Handle 401 (Unauthorized) - invalid/expired token
    if (error.response?.status === 401 && !isAuthPage) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }

    // Handle 403 (Forbidden) - account deactivated, insufficient permissions
    // Don't redirect, just let the error propagate to show the message

    return Promise.reject(error)
  }
)

export default api
