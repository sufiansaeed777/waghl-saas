export default function GhlSuccess() {
  return (
    <div style={{ backgroundColor: '#10b981', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ backgroundColor: 'white', padding: '50px', borderRadius: '20px', textAlign: 'center' }}>
        <h1 style={{ color: '#333', marginBottom: '20px' }}>Connection Successful!</h1>
        <p style={{ color: '#666' }}>Your GoHighLevel account has been connected.</p>
        <p style={{ color: '#999', marginTop: '20px' }}>You can close this window now.</p>
      </div>
    </div>
  )
}
