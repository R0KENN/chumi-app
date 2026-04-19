// src/components/NoPairs.jsx
export default function NoPairs({ onCreate }) {
  return (
    <div className="no-pairs">
      <h2>🐣 У вас пока нет питомцев</h2>
      <p>Создайте первую пару, чтобы начать!</p>
      <button onClick={onCreate} className="create-button">
        ➕ Создать пару
      </button>
    </div>
  );
}