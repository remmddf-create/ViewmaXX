function VideoCard({ title }: { title: string }) {
  return (
    <div style={{ border: '1px solid #ccc', borderRadius: 8, padding: 16, margin: 8, width: 240 }}>
      <div style={{ background: '#ddd', height: 120, borderRadius: 4, marginBottom: 8 }} />
      <h3>{title}</h3>
    </div>
  );
}

export default function VideoGrid() {
  // Placeholder data
  const videos = [
    { title: 'Sample Video 1' },
    { title: 'Sample Video 2' },
    { title: 'Sample Video 3' },
    { title: 'Sample Video 4' },
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
      {videos.map((video, idx) => (
        <VideoCard key={idx} title={video.title} />
      ))}
    </div>
  );
}
