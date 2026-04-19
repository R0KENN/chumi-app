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

  const handleJoin = async () => {
    if (!code.trim() || code.length < 6) return;
    setLoading(true);
    setError('');
    try {
      const displayName = window.Telegram?.WebApp?.initDataUnsafe?.user?.first_name || null;
      const res = await fetch(`${API_URL}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: telegramUserId, code: code.trim(), displayName }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else if (data.code) {
        await refreshPairs();
        onJoined(data.code);
      }
    } catch (err) {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-glass" onClick={e => e.stopPropagation()}>
        <h3>🔗 {t('join')}</h3>
        <input
          className="modal-input"
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder={t('enterCode')}
          maxLength={6}
          autoFocus
        />
        {error && <p className="error-text">{error}</p>}
        <div className="modal-btns">
          <button className="btn-cancel" onClick={onClose} disabled={loading}>
            {t('cancel')}
          </button>
          <button className="btn-primary" onClick={handleJoin} disabled={loading || code.length < 6}>
            {loading ? '...' : t('join')}
          </button>
        </div>
      </div>
    </div>
  );
}
