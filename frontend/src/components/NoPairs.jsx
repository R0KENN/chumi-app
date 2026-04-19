export default function NoPairs({ onCreate, onJoin }) {
  return (
    <div className="no-pairs">
      <div style={{ fontSize: 64 }}>🥚</div>
      <h2>No pets yet</h2>
      <p>Create a pair or join with a code!</p>
      <div className="no-pairs-buttons">
        <button onClick={onCreate} className="primary">➕ Create pair</button>
        <button onClick={onJoin} className="secondary">🔗 Join</button>
      </div>
    </div>
  );
}
