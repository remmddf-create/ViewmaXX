export default function AdminSidebar() {
  return (
    <aside style={{ width: 220, background: '#222', color: '#fff', minHeight: '100vh', padding: '1rem' }}>
      <nav>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          <li style={{ margin: '1rem 0' }}>Dashboard</li>
          <li style={{ margin: '1rem 0' }}>Analytics</li>
          <li style={{ margin: '1rem 0' }}>Moderation</li>
          <li style={{ margin: '1rem 0' }}>Monetization</li>
        </ul>
      </nav>
    </aside>
  );
}
