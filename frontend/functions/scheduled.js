export async function onScheduled(event, env) {
  const baseUrl = 'https://chumi-app.pages.dev';
  const headers = { 'Content-Type': 'application/json' };

  if (env.CRON_SECRET) {
    headers['Authorization'] = `Bearer ${env.CRON_SECRET}`;
  }

  try {
    const r1 = await fetch(`${baseUrl}/api/update-streaks`, { method: 'POST', headers });
    console.log('Streaks updated:', await r1.json());
  } catch (e) { console.error('Streak update error:', e); }

  try {
    const r2 = await fetch(`${baseUrl}/api/send-reminders`, { method: 'POST', headers });
    console.log('Reminders sent:', await r2.json());
  } catch (e) { console.error('Reminder send error:', e); }

  try {
    const r3 = await fetch(`${baseUrl}/api/cleanup-empty-pairs`, { method: 'POST', headers });
    console.log('Cleanup:', await r3.json());
  } catch (e) { console.error('Cleanup error:', e); }
}
