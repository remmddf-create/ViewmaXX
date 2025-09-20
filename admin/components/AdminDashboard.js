import { useEffect, useState } from 'react';

export default function AdminDashboard() {
  const [stats, setStats] = useState({ views: 0, uploads: 0, reports: 0, approvals: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/stats`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch stats');
        return res.json();
      })
      .then(data => {
        setStats(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Loading admin stats...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <section style={{ padding: '2rem' }}>
      <h2>Welcome, Admin!</h2>
      <div style={{ marginTop: '2rem', display: 'flex', gap: '2rem' }}>
        <div style={{ background: '#eee', padding: '1rem', borderRadius: 8, minWidth: 200 }}>
          <h3>Analytics</h3>
          <p>Views: {stats.views}</p>
          <p>Uploads: {stats.uploads}</p>
        </div>
        <div style={{ background: '#eee', padding: '1rem', borderRadius: 8, minWidth: 200 }}>
          <h3>Moderation</h3>
          <p>Pending Reports: {stats.reports}</p>
        </div>
        <div style={{ background: '#eee', padding: '1rem', borderRadius: 8, minWidth: 200 }}>
          <h3>Monetization</h3>
          <p>Pending Approvals: {stats.approvals}</p>
        </div>
      </div>
    </section>
  );
}
