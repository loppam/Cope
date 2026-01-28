import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { auth } from '@/lib/firebase';

export function AdminPush() {
  const { userProfile } = useAuth();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [deepLink, setDeepLink] = useState('/app/alerts');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!title || !body) {
      setError('Title and body required');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        throw new Error('Authentication required');
      }
      const response = await fetch('/api/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ title, body, deepLink }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to send push');
      }
      setSuccess('Push sent successfully');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (userProfile?.xHandle?.toLowerCase() !== '@lopam.eth') {
    return (
      <div className="p-6">
        <Card className="text-center py-10">
          <p>Admin access only</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] p-6">
      <div className="max-w-[600px] mx-auto">
        <h1 className="text-3xl font-bold mb-4">Lopam Push Console</h1>
        <Card className="space-y-4 p-6">
          <div>
            <label className="block text-sm text-white/70">Title</label>
            <input
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm text-white/70">Body</label>
            <textarea
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
            />
          </div>
          <div>
            <label className="block text-sm text-white/70">Deep link (optional)</label>
            <input
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white"
              value={deepLink}
              onChange={(e) => setDeepLink(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-[#FF4757]">{error}</p>}
          {success && <p className="text-sm text-[#12d585]">{success}</p>}
          <Button onClick={handleSubmit} disabled={loading} className="w-full">
            {loading ? 'Sending...' : 'Send Push'}
          </Button>
        </Card>
      </div>
    </div>
  );
}
