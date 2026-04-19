import { useState } from 'react';
import { usePairs } from '../context/PairsContext';

const API_URL = '/api';

export default function JoinPairModal({ telegramUserId, onClose, onJoined }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { refreshPairs } = usePairs();

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: telegramUserId, code: code.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        await refreshPairs();
        onJoined({ id: data.code });
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>🔗 Join a Pair</h2>
        <form onSubmit={handleJoin}>
          <label>
            Pair code:
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={6}
              autoFocus
            />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="modal-buttons">
            <button type="button" onClick={onClose} disabled={loading}>Cancel</button>
            <button type="submit" disabled={loading || !code.trim()}>
              {loading ? 'Joining...' : 'Join'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
