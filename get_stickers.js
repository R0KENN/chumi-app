const fs = require('fs');
const path = require('path');
const https = require('https');

// === НАСТРОЙКИ ===
const BOT_TOKEN = '8781861319:AAFz--MTw5v0eCktTDu-t72yI9kWmvufV90';
const STICKER_SET = '@ChumiPetBot';

// helper для GET-запросов
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

(async () => {
  const resp = JSON.parse(
    await get(`https://api.telegram.org/bot${BOT_TOKEN}/getStickerSet?name=${STICKER_SET}`)
  );

  if (!resp.ok) {
    console.error('❌ Ошибка:', resp);
    return;
  }

  const stickers = resp.result.stickers;
  console.log(`✅ Найдено стикеров: ${stickers.length}\n`);

  // вывод JS-массива
  console.log('const CHUMI_STICKERS = [');
  stickers.forEach((s, i) => {
    const emoji = s.emoji || '❓';
    console.log(
      `  { id: ${i + 1}, emoji: '${emoji}', file_id: '${s.file_id}', file_unique_id: '${s.file_unique_id}' },`
    );
  });
  console.log('];');

  // сохранить json
  const jsonData = stickers.map((s, i) => ({
    id: i + 1,
    emoji: s.emoji || '',
    file_id: s.file_id,
    file_unique_id: s.file_unique_id,
  }));
  fs.writeFileSync('chumi_stickers.json', JSON.stringify(jsonData, null, 2), 'utf-8');
  console.log('\n💾 Сохранено в chumi_stickers.json');

  // скачать превью
  const dir = path.join(__dirname, 'stickers_png');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  console.log('\n📥 Скачиваю превью...');
  for (let i = 0; i < stickers.length; i++) {
    const fileInfo = JSON.parse(
      await get(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${stickers[i].file_id}`)
    );
    if (!fileInfo.ok) {
      console.log(`  ⚠️  ${i + 1}: не удалось`);
      continue;
    }
    const filePath = fileInfo.result.file_path;
    const ext = path.extname(filePath) || '.webp';
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    await download(url, path.join(dir, `${i + 1}${ext}`));
    console.log(`  ✅ ${i + 1}/${stickers.length}`);
  }

  console.log('\n🎉 Готово! Папка stickers_png/');
})();
