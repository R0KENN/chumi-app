import { useState } from 'react';
import { usePairs } from '../context/PairsContext';

const API_URL = '/api';

export default function CreatePairModal({ telegramUserId, onClose, onCreated }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const { refreshPairs } = usePairs();

  const handleCreate = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: telegramUserId }),
      });
      const data = await res.json();
      if (data.success) {
        setCode(data.code);
        await refreshPairs();
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard?.writeText(code);
  };

  if (code) {
    return (
      <div className="modal-overlay">
        <div className="modal">
          <h2>✅ Pair Created!</h2>
          <p>Share this code with your friend:</p>
          <div className="code-display" onClick={handleCopy}>
            <span className="code-text">{code}</span>
            <span>📋</span>
          </div>
          <p style={{ fontSize: 12, opacity: 0.5 }}>Tap to copy</p>
          <div className="modal-buttons">
            <button onClick={() => onCreated({ id: code })}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>🥚 Create New Pair</h2>
        <p>An egg will appear. Feed it together for 3 days to hatch!</p>
        {error && <p className="error">{error}</p>}
        <div className="modal-buttons">
          <button type="button" onClick={onClose} disabled={loading}>Cancel</button>
          <button onClick={handleCreate} disabled={loading}>
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
