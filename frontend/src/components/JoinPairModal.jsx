import { useState } from 'react';
import { useLang } from '../context/LangContext';
import { usePairs } from '../context/PairsContext';

export default function JoinPairModal({ userId, onClose, onJoined }) {
  const { t } = useLang();
  const { refreshPairs } = usePairs();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    console.log('[JoinPairModal] Joining pair:', trimmed, 'userId:', userId);
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: String(userId), code: trimmed })
      });
      console.log('[JoinPairModal] Response status:', res.status);
      const data = await res.json();
      console.log('[JoinPairModal] Response data:', data);

      if (data.error) {
        setError(data.error);
        return;
      }
      if (data.code || data.pair) {
        await refreshPairs();
        if (onJoined) onJoined(data.code || trimmed);
        return;
      }
      // If no error and no code — assume success
      await refreshPairs();
      if (onJoined) onJoined(trimmed);
    } catch (err) {
      console.error('[JoinPairModal] Fetch error:', err);
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'rgba(30,30,50,0.85)', backdropFilter: 'blur(24px)',
        borderRadius: '24px', padding: '28px', width: '85%', maxWidth: '320px',
        textAlign: 'center', color: '#fff'
      }}>
        <h3 style={{ marginBottom: '12px' }}>{t('join') || 'Join pair'}</h3>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px', marginBottom: '16px' }}>
          {t('enterCode') || 'Enter the pair code from your partner:'}
        </p>

        <input
          type="text"
          maxLength={6}
          autoFocus
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder="XXXXXX"
          style={{
            width: '100%', textAlign: 'center', fontSize: '22px', fontWeight: 700,
            letterSpacing: '6px', padding: '12px', borderRadius: '14px', border: 'none',
            background: 'rgba(255,255,255,0.06)', color: '#fff', outline: 'none',
            marginBottom: '16px', boxSizing: 'border-box'
          }}
        />

        {error && <p style={{ color: '#ff6b6b', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} disabled={loading} style={{
            flex: 1, padding: '12px', borderRadius: '14px', border: 'none',
            background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: '14px', cursor: 'pointer'
          }}>
            {t('cancel') || 'Cancel'}
          </button>
          <button onClick={handleJoin} disabled={loading || code.trim().length < 6} style={{
            flex: 1, padding: '12px', borderRadius: '14px', border: 'none',
            background: (loading || code.trim().length < 6) ? 'rgba(138,43,226,0.2)' : 'rgba(138,43,226,0.5)',
            color: '#fff', fontSize: '14px', cursor: 'pointer'
          }}>
            {loading ? '...' : (t('join') || 'Join')}
          </button>
        </div>
      </div>
    </div>
  );
}
