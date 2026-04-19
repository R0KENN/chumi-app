import { useState } from 'react';
import { usePairs } from '../context/PairsContext';
import { useLang } from '../context/LangContext';

const API_URL = '/api';

export default function CreatePairModal({ telegramUserId, onClose, onCreated }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const { refreshPairs } = usePairs();
  const { t } = useLang();

  const handleCreate = async () => {
    setLoading(true);
    setError('');
    try {
      const displayName = window.Telegram?.WebApp?.initDataUnsafe?.user?.first_name || null;
      const res = await fetch(`${API_URL}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: telegramUserId, displayName }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else if (data.code) {
        setCode(data.code);
        await refreshPairs();
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
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-glass" onClick={e => e.stopPropagation()}>
          <h3>✅ {t('copied') ? 'Пара создана!' : 'Pair created!'}</h3>
          <div className="code-display" onClick={handleCopy}>
            {code}
          </div>
          <p style={{fontSize:'13px',opacity:0.6,marginBottom:'12px'}}>
            {t('copyCode')}
          </p>
          <div className="modal-btns">
            <button className="btn-primary" onClick={() => onCreated(code)}>OK</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-glass" onClick={e => e.stopPropagation()}>
        <h3>🥚 {t('createPair')}</h3>
        <p style={{fontSize:'14px',opacity:0.7,marginBottom:'14px'}}>
          {t('noPetsDesc')}
        </p>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-btns">
          <button className="btn-cancel" onClick={onClose} disabled={loading}>
            {t('cancel')}
          </button>
          <button className="btn-primary" onClick={handleCreate} disabled={loading}>
            {loading ? '...' : t('create')}
          </button>
        </div>
      </div>
    </div>
  );
}
