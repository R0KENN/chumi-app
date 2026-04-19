import { useState } from 'react';
import { usePairs } from '../context/PairsContext';
import { useLang } from '../context/LangContext';

const API_URL = '/api';

export default function JoinPairModal({ telegramUserId, onClose, onJoined }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { refreshPairs } = usePairs();
  const { t } = useLang();

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
      setError(t.connectionError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-glass">
        <h2>🔗 {t.joinPair}</h2>
        <form onSubmit={handleJoin}>
          <label>
            {t.pairCodeLabel}
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
            <button type="button" className="glass-btn" onClick={onClose} disabled={loading}>{t.cancel}</button>
            <button type="submit" className="glass-btn primary" disabled={loading || !code.trim()}>
              {loading ? t.joining : t.join}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
