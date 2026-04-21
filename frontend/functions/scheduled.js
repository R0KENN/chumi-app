export async function onScheduled(event, env) {
  // Вызываем наш API для отправки напоминаний
  const res = await fetch('https://chumi-app.pages.dev/api/send-reminders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  console.log('Reminders sent:', await res.json());
}
