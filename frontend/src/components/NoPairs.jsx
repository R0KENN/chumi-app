export default function NoPairs({ onCreate, onJoin }) {
  return (
    <div className="no-pairs">
      <h2>🐣 У вас пока нет питомцев</h2>
      <p>Создайте первую пару или присоединитесь по коду!</p>
      <div className="no-pairs-buttons">
        <button onClick={onCreate} className="primary">
          ➕ Создать пару
        </button>
        <button onClick={onJoin} className="secondary">
          🔗 Присоединиться
        </button>
      </div>
    </div>
  );
}