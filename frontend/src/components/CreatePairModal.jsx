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
      setError(t.connectionError);
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
        <div className="modal-glass">
          <h2>✅ {t.pairCreated}</h2>
          <p>{t.shareCode}</p>
          <div className="code-display" onClick={handleCopy}>
            <span className="code-text">{code}</span>
            <span>📋</span>
          </div>
          <p className="hint">{t.tapToCopy}</p>
          <div className="modal-buttons">
            <button className="glass-btn primary" onClick={() => onCreated({ id: code })}>{t.done}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal-glass">
        <h2>🥚 {t.createNewPair}</h2>
        <p>{t.createDesc}</p>
        {error && <p className="error">{error}</p>}
        <div className="modal-buttons">
          <button className="glass-btn" onClick={onClose} disabled={loading}>{t.cancel}</button>
          <button className="glass-btn primary" onClick={handleCreate} disabled={loading}>
            {loading ? t.creating : t.create}
          </button>
        </div>
      </div>
    </div>
  );
}
