import { useState } from 'react';
import { useLang } from '../context/LangContext';
import { usePairs } from '../context/PairsContext';

export default function CreatePairModal({ userId, onClose, onCreated }) {
  const { t } = useLang();
  const { refreshPairs } = usePairs();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdCode, setCreatedCode] = useState('');

  const handleCreate = async () => {
    console.log('[CreatePairModal] Creating pair for userId:', userId);
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: String(userId) })
      });
      console.log('[CreatePairModal] Response status:', res.status);
      const data = await res.json();
      console.log('[CreatePairModal] Response data:', data);

      if (data.error) {
        setError(data.error);
        return;
      }
      if (data.code) {
        setCreatedCode(data.code);
        await refreshPairs();
        return;
      }
      setError('Unknown error');
    } catch (err) {
      console.error('[CreatePairModal] Fetch error:', err);
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(createdCode).catch(() => {});
  };

  const goToPair = () => {
    if (onCreated) onCreated(createdCode);
  };

  // If pair was created — show the code
  if (createdCode) {
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
          <h3 style={{ marginBottom: '12px' }}>✅ {t('pairCreated') || 'Pair created!'}</h3>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px', marginBottom: '16px' }}>
            {t('shareCode') || 'Share this code with your partner:'}
          </p>
          <div style={{
            fontSize: '28px', fontWeight: 700, letterSpacing: '4px',
            background: 'rgba(138,43,226,0.2)', borderRadius: '12px', padding: '12px', marginBottom: '16px'
          }}>
            {createdCode}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={copyCode} style={{
              flex: 1, padding: '12px', borderRadius: '14px', border: 'none',
              background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: '14px', cursor: 'pointer'
            }}>
              📋 {t('copyCode') || 'Copy'}
            </button>
            <button onClick={goToPair} style={{
              flex: 1, padding: '12px', borderRadius: '14px', border: 'none',
              background: 'rgba(138,43,226,0.5)', color: '#fff', fontSize: '14px', cursor: 'pointer'
            }}>
              ➡️ {t('open') || 'Open'}
            </button>
          </div>
        </div>
      </div>
    );
  }

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
        <h3 style={{ marginBottom: '12px' }}>{t('createPair') || 'Create pair'}</h3>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px', marginBottom: '20px' }}>
          {t('createPairDesc') || 'A unique code will be generated for your partner.'}
        </p>
        
        {error && <p style={{ color: '#ff6b6b', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}
        
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} disabled={loading} style={{
            flex: 1, padding: '12px', borderRadius: '14px', border: 'none',
            background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: '14px', cursor: 'pointer'
          }}>
            {t('cancel') || 'Cancel'}
          </button>
          <button onClick={handleCreate} disabled={loading} style={{
            flex: 1, padding: '12px', borderRadius: '14px', border: 'none',
            background: loading ? 'rgba(138,43,226,0.2)' : 'rgba(138,43,226,0.5)',
            color: '#fff', fontSize: '14px', cursor: 'pointer'
          }}>
            {loading ? '...' : (t('create') || 'Create')}
          </button>
        </div>
      </div>
    </div>
  );
}
