import { useLang } from '../context/LangContext';
import { useNavigate } from 'react-router-dom';
import { usePairs } from '../context/PairsContext';

export default function NoPairs({ onCreate, onJoin }) {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { pairs } = usePairs();

  const hasPairs = pairs && pairs.length > 0;

  return (
    <div style={{
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      minHeight:'100vh', minHeight:'100dvh',
      padding: 20, paddingTop: 'max(40px, env(safe-area-inset-top))', paddingBottom: 'max(40px, env(safe-area-inset-bottom))',
      textAlign:'center',
      background:'linear-gradient(180deg, #FFF8E1 0%, #FFECB3 50%, #FFE082 100%)',
    }}>
      <div style={{ fontSize:80, marginBottom:20 }}>✨</div>
      <h2 style={{ color:'#1a1a1a', marginBottom:8 }}>{t('noPets')}</h2>
      <p style={{ color:'rgba(0,0,0,0.5)', marginBottom:32 }}>{t('createOrJoin')}</p>
      <div style={{ display:'flex', gap:12, width:'100%', maxWidth:300 }}>
        <button onClick={onCreate} style={{
          flex:1, padding:'14px 20px', borderRadius:16, border:'none',
          background:'rgba(255,140,50,0.2)', color:'#e67e00', fontSize:15,
          fontWeight:600, cursor:'pointer'
        }}>➕ {t('createPair')}</button>
        <button onClick={onJoin} style={{
          flex:1, padding:'14px 20px', borderRadius:16, border:'none',
          background:'rgba(0,0,0,0.05)', color:'#333', fontSize:15,
          fontWeight:600, cursor:'pointer'
        }}>🔗 {t('join')}</button>
      </div>

      {hasPairs && (
        <button onClick={() => navigate(`/pair/${pairs[0].code}`)} style={{
          marginTop: 20, padding: '12px 32px', borderRadius: 14, border: 'none',
          background: 'rgba(0,0,0,0.06)', color: 'rgba(0,0,0,0.45)', fontSize: 14,
          fontWeight: 600, cursor: 'pointer', width: '100%', maxWidth: 300,
        }}>
          ← {lang === 'ru' ? 'Вернуться' : 'Go back'}
        </button>
      )}
    </div>
  );
}
