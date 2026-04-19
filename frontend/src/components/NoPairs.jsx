import React from 'react';
import { useLang } from '../context/LangContext';

export default function NoPairs({ onCreate, onJoin }) {
  const { t } = useLang();
  return (
    <div className="no-pairs">
      <div className="no-pairs-egg">🥚</div>
      <h2>{t('noPets')}</h2>
      <p>{t('noPetsDesc')}</p>
      <div className="no-pairs-btns">
        <button className="btn-primary" onClick={onCreate}>➕ {t('createPair')}</button>
        <button className="btn-secondary" onClick={onJoin}>🔗 {t('join')}</button>
      </div>
    </div>
  );
}
