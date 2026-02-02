export default function GhlSuccess() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <div style={{
        background: 'white',
        padding: '60px 50px',
        borderRadius: '20px',
        textAlign: 'center',
        boxShadow: '0 25px 80px rgba(0,0,0,0.25)',
        maxWidth: '420px',
        margin: '20px'
      }}>
        <div style={{
          width: '100px',
          height: '100px',
          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          borderRadius: '50%',
          margin: '0 auto 30px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 10px 40px rgba(16,185,129,0.4)'
        }}>
          <svg fill="none" stroke="white" strokeWidth="3" viewBox="0 0 24 24" style={{ width: '50px', height: '50px' }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 style={{
          color: '#1f2937',
          fontSize: '32px',
          fontWeight: '700',
          marginBottom: '15px'
        }}>
          Connection Successful!
        </h1>
        <div style={{
          width: '60px',
          height: '4px',
          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          borderRadius: '2px',
          margin: '25px auto'
        }} />
        <p style={{
          color: '#6b7280',
          fontSize: '18px',
          lineHeight: '1.6',
          margin: 0
        }}>
          Your GoHighLevel account has been connected successfully.
        </p>
        <p style={{
          color: '#9ca3af',
          fontSize: '14px',
          marginTop: '20px'
        }}>
          You can close this window now.
        </p>
      </div>
    </div>
  )
}
