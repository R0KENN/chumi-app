import { useState } from 'react';
import { useLang } from '../context/LangContext';
import { usePairs, getInitData } from '../context/PairsContext';

export default function JoinPairModal({ userId, onClose, onJoined }) {
  const { t } = useLang();
  const { refreshPairs } = usePairs();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const tg = window.Telegram?.WebApp;
  const username = tg?.initDataUnsafe?.user?.username || null;
  const displayName = tg?.initDataUnsafe?.user?.first_name || null;

  const authHeaders = () => {
    const headers = { 'Content-Type': 'application/json' };
    const initData = getInitData();
    if (initData) headers['X-Telegram-Init-Data'] = initData;
    return headers;
  };

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 6) return;
    setLoading(true);
    setError('');
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ userId: String(userId), code: trimmed, displayName, username, timezone }),
      });
      const data = await res.json();
      if (data.error) {
        const map = {
          'Pair not found': t('pairNotFound') || 'Pair not found',
          'Already in pair': t('alreadyInPair') || 'Already in pair',
          'Pair full': t('pairFull') || 'Pair is full',
          'Unauthorized': t('unauthorized') || 'Unauthorized',
        };
        setError(map[data.error] || data.error);
        return;
      }
      await refreshPairs();
      if (onJoined) onJoined(data.code || trimmed);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'#fff',borderRadius:24,padding:28,width:'85%',maxWidth:320,textAlign:'center' }}>
        <h3 style={{ marginBottom:12,color:'#1a1a1a' }}>{t('join')}</h3>
        <p style={{ color:'#888',fontSize:14,marginBottom:16 }}>{t('enterCode')}</p>
        <input type="text" maxLength={6} autoFocus value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="XXXXXX"
          style={{ width:'100%',textAlign:'center',fontSize:22,fontWeight:700,letterSpacing:6,padding:12,borderRadius:14,border:'2px solid rgba(0,0,0,0.08)',background:'rgba(0,0,0,0.02)',color:'#1a1a1a',outline:'none',marginBottom:16,boxSizing:'border-box' }} />
        {error && <p style={{ color:'#e53e3e',fontSize:13,marginBottom:12 }}>{error}</p>}
        <div style={{ display:'flex',gap:10 }}>
          <button onClick={onClose} disabled={loading} style={{ flex:1,padding:12,borderRadius:14,border:'none',background:'rgba(0,0,0,0.05)',fontSize:14,cursor:'pointer',color:'#333' }}>{t('cancel')}</button>
          <button onClick={handleJoin} disabled={loading||code.trim().length<6} style={{ flex:1,padding:12,borderRadius:14,border:'none',background:(loading||code.length<6)?'rgba(255,140,50,0.1)':'rgba(255,140,50,0.2)',fontSize:14,cursor:'pointer',color:'#e67e00',fontWeight:600 }}>{loading?'...':t('join')}</button>
        </div>
      </div>
    </div>
  );
}
