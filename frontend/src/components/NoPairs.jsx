import { useLang } from '../context/LangContext';

export default function NoPairs({ onCreate, onJoin }) {
  const { t } = useLang();

  const handleCreate = () => {
    console.log('[NoPairs] Create button clicked');
    if (onCreate) onCreate();
  };

  const handleJoin = () => {
    console.log('[NoPairs] Join button clicked');
    if (onJoin) onJoin();
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '80vh',
      padding: '20px',
      textAlign: 'center'
    }}>
      <div style={{ fontSize: '80px', marginBottom: '20px' }}>🥚</div>
      <h2 style={{ color: '#fff', marginBottom: '8px' }}>{t('noPets')}</h2>
      <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: '32px' }}>{t('createOrJoin')}</p>
      
      <div style={{ display: 'flex', gap: '12px', width: '100%', maxWidth: '300px' }}>
        <button
          onClick={handleCreate}
          style={{
            flex: 1,
            padding: '14px 20px',
            borderRadius: '16px',
            border: 'none',
            background: 'rgba(138,43,226,0.4)',
            backdropFilter: 'blur(20px)',
            color: '#fff',
            fontSize: '15px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          ➕ {t('createPair')}
        </button>
        <button
          onClick={handleJoin}
          style={{
            flex: 1,
            padding: '14px 20px',
            borderRadius: '16px',
            border: 'none',
            background: 'rgba(255,255,255,0.08)',
            backdropFilter: 'blur(20px)',
            color: '#fff',
            fontSize: '15px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          🔗 {t('join')}
        </button>
      </div>
    </div>
  );
}
