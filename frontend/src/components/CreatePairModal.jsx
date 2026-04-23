import { useState } from 'react';
import { useLang } from '../context/LangContext';
import { usePairs, getInitData } from '../context/PairsContext';

export default function CreatePairModal({ userId, onClose, onCreated }) {
  const { t, lang } = useLang();
  const { refreshPairs } = usePairs();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdCode, setCreatedCode] = useState('');
  const [copied, setCopied] = useState(false);

  const tg = window.Telegram?.WebApp;
  const username = tg?.initDataUnsafe?.user?.username || null;
  const displayName = tg?.initDataUnsafe?.user?.first_name || null;

  const authHeaders = () => {
    const headers = { 'Content-Type': 'application/json' };
    const initData = getInitData();
    if (initData) headers['X-Telegram-Init-Data'] = initData;
    return headers;
  };

  const handleCreate = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/create', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ userId: String(userId), displayName, username }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      if (data.code) { setCreatedCode(data.code); await refreshPairs(); return; }
      setError('Unknown error');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleInvite = async () => {
    try {
      const res = await fetch('/api/send-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairCode: createdCode }),
      });
      const data = await res.json();
      const inviteLink = data.inviteLink || `https://t.me/chumi_pet_bot?start=join_${createdCode}`;
      const shareText = lang === 'ru'
        ? `Присоединяйся к моей паре в Chumi! 🔥\nКод: ${createdCode}`
        : `Join my pair in Chumi! 🔥\nCode: ${createdCode}`;
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(shareText)}`;

      if (tg?.openTelegramLink) {
        tg.openTelegramLink(shareUrl);
      } else {
        window.open(shareUrl, '_blank');
      }
    } catch (e) { console.error('invite error:', e); }
  };

  if (createdCode) {
    return (
      <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,backdropFilter:'blur(4px)',WebkitBackdropFilter:'blur(4px)' }}>
        <div onClick={e=>e.stopPropagation()} style={{ background:'rgba(255,255,255,0.85)',backdropFilter:'blur(20px)',WebkitBackdropFilter:'blur(20px)',borderRadius:24,padding:28,width:'85%',maxWidth:320,textAlign:'center',border:'1px solid rgba(255,255,255,0.5)',boxShadow:'0 4px 24px rgba(0,0,0,0.08)' }}>
          <h3 style={{ marginBottom:12,color:'#1a1a1a' }}>✅ {t('pairCreated') || 'Пара создана!'}</h3>
          <p style={{ color:'#888',fontSize:14,marginBottom:16 }}>{t('shareCode') || 'Отправь код партнёру:'}</p>
          <div style={{ fontSize:28,fontWeight:700,letterSpacing:4,background:'rgba(255,140,50,0.1)',borderRadius:12,padding:12,marginBottom:16,color:'#e67e00' }}>{createdCode}</div>
          <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
            <button onClick={handleInvite} style={{
              width:'100%', padding:14, borderRadius:14, border:'none',
              background:'#F5A623', color:'#fff', fontSize:15, fontWeight:700,
              cursor:'pointer', boxShadow:'0 4px 12px rgba(245,166,35,0.3)'
            }}>
              📨 {lang === 'ru' ? 'Пригласить партнёра' : 'Invite partner'}
            </button>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => {
                navigator.clipboard.writeText(createdCode);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }} style={{ flex:1,padding:12,borderRadius:14,border:'none',background:'rgba(0,0,0,0.05)',fontSize:14,cursor:'pointer',color:'#333' }}>
                {copied ? '✅' : '📋'} {copied ? (lang === 'ru' ? 'Скопировано' : 'Copied') : (t('copyCode')||'Копировать')}
              </button>
              <button onClick={()=>onCreated&&onCreated(createdCode)} style={{ flex:1,padding:12,borderRadius:14,border:'none',background:'rgba(255,140,50,0.2)',fontSize:14,cursor:'pointer',color:'#e67e00',fontWeight:600 }}>➡️ {t('open')||'Открыть'}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,backdropFilter:'blur(4px)',WebkitBackdropFilter:'blur(4px)' }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'rgba(255,255,255,0.85)',backdropFilter:'blur(20px)',WebkitBackdropFilter:'blur(20px)',borderRadius:24,padding:28,width:'85%',maxWidth:320,textAlign:'center',border:'1px solid rgba(255,255,255,0.5)' }}>
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
