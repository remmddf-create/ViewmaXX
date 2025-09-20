import { useEffect, useState } from 'react';

function VideoCard({ title }: { title: string }) {
  return (
    <div style={{ border: '1px solid #ccc', borderRadius: 8, padding: 16, margin: 8, width: 240 }}>
      <div style={{ background: '#ddd', height: 120, borderRadius: 4, marginBottom: 8 }} />
      <h3>{title}</h3>
    </div>
  );
}

export default function VideoGrid() {
  const [videos, setVideos] = useState<{ title: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/videos`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch videos');
        return res.json();
      })
      .then(data => {
        setVideos(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Loading videos...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
      {videos.length === 0 ? (
        <div>No videos found.</div>
      ) : (
        videos.map((video, idx) => (
          <VideoCard key={idx} title={video.title} />
        ))
      )}
    </div>
  );
}
