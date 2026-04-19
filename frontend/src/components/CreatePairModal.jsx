import { useState } from 'react';
import { useLang } from '../context/LangContext';
import { usePairs } from '../context/PairsContext';

export default function CreatePairModal({ userId, onClose, onCreated }) {
  const { t } = useLang();
  const { refreshPairs } = usePairs();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdCode, setCreatedCode] = useState('');

  const tg = window.Telegram?.WebApp;
  const username = tg?.initDataUnsafe?.user?.username || null;
  const displayName = tg?.initDataUnsafe?.user?.first_name || null;

  const handleCreate = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: String(userId), displayName, username }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      if (data.code) { setCreatedCode(data.code); await refreshPairs(); return; }
      setError('Unknown error');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  if (createdCode) {
    return (
      <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000 }}>
        <div onClick={e=>e.stopPropagation()} style={{ background:'#fff',borderRadius:24,padding:28,width:'85%',maxWidth:320,textAlign:'center' }}>
          <h3 style={{ marginBottom:12,color:'#1a1a1a' }}>✅ {t('pairCreated') || 'Пара создана!'}</h3>
          <p style={{ color:'#888',fontSize:14,marginBottom:16 }}>{t('shareCode') || 'Отправь код партнёру:'}</p>
          <div style={{ fontSize:28,fontWeight:700,letterSpacing:4,background:'rgba(255,140,50,0.1)',borderRadius:12,padding:12,marginBottom:16,color:'#e67e00' }}>{createdCode}</div>
          <div style={{ display:'flex',gap:10 }}>
            <button onClick={()=>navigator.clipboard.writeText(createdCode)} style={{ flex:1,padding:12,borderRadius:14,border:'none',background:'rgba(0,0,0,0.05)',fontSize:14,cursor:'pointer',color:'#333' }}>📋 {t('copyCode')||'Копировать'}</button>
            <button onClick={()=>onCreated&&onCreated(createdCode)} style={{ flex:1,padding:12,borderRadius:14,border:'none',background:'rgba(255,140,50,0.2)',fontSize:14,cursor:'pointer',color:'#e67e00',fontWeight:600 }}>➡️ {t('open')||'Открыть'}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'#fff',borderRadius:24,padding:28,width:'85%',maxWidth:320,textAlign:'center' }}>
        <h3 style={{ marginBottom:12,color:'#1a1a1a' }}>{t('createPair')}</h3>
        <p style={{ color:'#888',fontSize:14,marginBottom:20 }}>{t('createPairDesc')||'Будет сгенерирован код для партнёра.'}</p>
        {error && <p style={{ color:'#e53e3e',fontSize:13,marginBottom:12 }}>{error}</p>}
        <div style={{ display:'flex',gap:10 }}>
          <button onClick={onClose} disabled={loading} style={{ flex:1,padding:12,borderRadius:14,border:'none',background:'rgba(0,0,0,0.05)',fontSize:14,cursor:'pointer',color:'#333' }}>{t('cancel')}</button>
          <button onClick={handleCreate} disabled={loading} style={{ flex:1,padding:12,borderRadius:14,border:'none',background:loading?'rgba(255,140,50,0.1)':'rgba(255,140,50,0.2)',fontSize:14,cursor:'pointer',color:'#e67e00',fontWeight:600 }}>{loading?'...':t('create')}</button>
        </div>
      </div>
    </div>
  );
}
