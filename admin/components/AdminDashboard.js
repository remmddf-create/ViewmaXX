export default function AdminDashboard() {
  return (
    <section style={{ padding: '2rem' }}>
      <h2>Welcome, Admin!</h2>
      <div style={{ marginTop: '2rem', display: 'flex', gap: '2rem' }}>
        <div style={{ background: '#eee', padding: '1rem', borderRadius: 8, minWidth: 200 }}>
          <h3>Analytics</h3>
          <p>Views: 1234</p>
          <p>Uploads: 56</p>
        </div>
        <div style={{ background: '#eee', padding: '1rem', borderRadius: 8, minWidth: 200 }}>
          <h3>Moderation</h3>
          <p>Pending Reports: 3</p>
        </div>
        <div style={{ background: '#eee', padding: '1rem', borderRadius: 8, minWidth: 200 }}>
          <h3>Monetization</h3>
          <p>Pending Approvals: 2</p>
        </div>
      </div>
    </section>
  );
}
