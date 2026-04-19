import { useLang } from '../context/LangContext';

export default function NoPairs({ onCreate, onJoin }) {
  const { t } = useLang();

  return (
    <div className="no-pairs">
      <div className="no-pairs-egg">🥚</div>
      <h2>{t.noPets}</h2>
      <p>{t.noPetsDesc}</p>
      <div className="no-pairs-buttons">
        <button onClick={onCreate} className="glass-btn primary">➕ {t.createPair}</button>
        <button onClick={onJoin} className="glass-btn">🔗 {t.join}</button>
      </div>
    </div>
  );
}
