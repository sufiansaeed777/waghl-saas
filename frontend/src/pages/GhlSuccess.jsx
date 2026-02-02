export default function GhlSuccess() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-500 to-green-600">
      <div className="bg-white p-12 rounded-2xl shadow-2xl text-center max-w-md mx-4">
        <div className="w-24 h-24 bg-green-500 rounded-full mx-auto mb-6 flex items-center justify-center">
          <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-gray-800 mb-4">Connection Successful!</h1>
        <div className="w-16 h-1 bg-green-500 mx-auto mb-6 rounded"></div>
        <p className="text-gray-600 text-lg mb-2">Your GoHighLevel account has been connected successfully.</p>
        <p className="text-gray-400 text-sm">You can close this window now.</p>
      </div>
    </div>
  )
}
