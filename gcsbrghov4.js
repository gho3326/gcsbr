(async () => {

  /* ===================== KONFIGURASI ===================== */

  console.log('[INIT] Script dimulai');

  const REQUIRED_HEADERS = ['idsbr', 'latitude', 'longitude', 'hasil'];
  const GC_STORAGE_KEY = 'gc_idsbr_cache';

  const TOTAL_DELAY_MIN = 2000; // 2 detik
  const TOTAL_DELAY_MAX = 3000; // 3 detik
  const COOLDOWN_MS = 3 * 60 * 1000; // 3 menit
  const MAX_FAILED_ATTEMPT = 5;

  /* ===================== UTIL ===================== */

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
  }

  /* ===================== CSV ===================== */

  console.log('[CSV] Menunggu file CSV dipilih');
/*
  function parseCSV(csv) {
    console.log('[CSV] Parsing CSV');
    const [headerLine, ...lines] = csv.trim().split('\n');
    const headers = headerLine.split(';').map(h => h.trim().toLowerCase());

    return lines.map((line, i) => {
      const values = line.split(';').map(v => v.trim());
      return Object.fromEntries(headers.map((h, idx) => [h, values[idx]]));
    });
  }
*/

	function parseCSV(csv) {
	  console.log('[CSV] Mulai parsing & trimming data');

	  const [headerLine, ...lines] = csv.trim().split('\n');
	  const headers = headerLine
		.split(';')
		.map(h => h.trim().toLowerCase());

	  return lines
		.filter(line => line.trim() !== '')
		.map((line, idx) => {
		  const values = line.split(';');

		  const row = {};
		  headers.forEach((h, i) => {
			let val = values[i] ?? '';

			// TRIM semua kolom
			val = String(val).trim();

			// Trim khusus kolom penting (lebih eksplisit)
			if (['idsbr', 'latitude', 'longitude', 'hasil'].includes(h)) {
			  val = val.trim();
			}

			row[h] = val;
		  });

		  return row;
		});
	}

  async function loadCSVFromFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,text/csv';

      input.onchange = () => {
        const file = input.files[0];
        if (!file) {
          console.error('[CSV] Tidak ada file dipilih');
          return reject('No file selected');
        }

        const reader = new FileReader();
        reader.onload = () => {
          const text = reader.result;
          const headers = text
            .split('\n')[0]
            .split(';')
            .map(h => h.trim().toLowerCase());

          const missing = REQUIRED_HEADERS.filter(h => !headers.includes(h));
          if (missing.length) {
            console.error('[CSV] Header kurang:', missing);
            return reject(`Missing column: ${missing.join(', ')}`);
          }

          console.log('[CSV] File CSV valid');
          resolve(text);
        };

        reader.onerror = reject;
        reader.readAsText(file);
      };

      input.click();
    });
  }

  /* ===================== CACHE ===================== */

  function loadGCCache() {
    console.log('[CACHE] Load cache dari localStorage');
    try {
      return new Set(JSON.parse(localStorage.getItem(GC_STORAGE_KEY) || '[]'));
    } catch {
      console.warn('[CACHE] Cache rusak, reset');
      return new Set();
    }
  }

  function saveGCCache(set) {
    localStorage.setItem(GC_STORAGE_KEY, JSON.stringify([...set]));
    console.log(`[CACHE] Cache disimpan (${set.size} IDSBR)`);
  }

  const gcCache = loadGCCache();

  /* ===================== WAIT HELPERS ===================== */

  function waitForSelector(selector, timeout = 20000, interval = 200) {
    console.log(`[WAIT] Menunggu selector ${selector}`);
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const el = document.querySelector(selector);
        if (el) {
          clearInterval(timer);
          console.log(`[WAIT] Ditemukan ${selector}`);
          resolve(el);
        }
        if (Date.now() - start > timeout) {
          clearInterval(timer);
          console.error(`[WAIT] Timeout ${selector}`);
          reject(new Error(`Timeout ${selector}`));
        }
      }, interval);
    });
  }

  async function waitForSearchResultMatch(idsbr, timeout = 20000) {
    console.log(`[SEARCH] Menunggu hasil IDSBR ${idsbr}`);
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = document
        .querySelector('.usaha-card-details')
        ?.querySelector('.detail-row .detail-value');

      if (el && el.innerText.trim() === idsbr) {
        console.log(`[SEARCH] IDSBR ${idsbr} ditemukan`);
        return el;
      }
      await sleep(200);
    }
    throw new Error(`IDSBR ${idsbr} tidak ditemukan`);
  }

  /* ===================== LOAD DATA ===================== */

  const csvData = await loadCSVFromFile();
  let rows = parseCSV(csvData);
  const ori_rows = [...rows];

  console.log(`[DATA] Total baris CSV: ${rows.length}`);

  rows = rows.filter(r => {
    if (gcCache.has(r.idsbr)) {
      console.log(`[FILTER] Skip cache ${r.idsbr}`);
      return false;
    }
    if (String(r.gc_label).trim() === '1') {
      console.log(`[FILTER] Skip GC label ${r.idsbr}`);
      return false;
    }
    if (![1, 3, 4, 99].includes(Number(r.hasil))) {
      console.log(`[FILTER] Skip hasil invalid ${r.idsbr}`);
      return false;
    }
    return true;
  });

  console.log(`[DATA] Eligible IDSBR: ${rows.length}`);

  /* ===================== DASHBOARD ===================== */

  function createDashboard() {
    console.log('[UI] Membuat dashboard');
    const box = document.createElement('div');
    box.id = 'gc-dashboard';
    box.style.cssText = `
      position: fixed;
      top: 40px;
      right: 20px;
      z-index: 99999;
      background: #111;
      color: #0f0;
      padding: 12px;
      font-family: monospace;
      font-size: 14px;
      border-radius: 8px;
      min-width: 240px;
    `;
    box.innerHTML = `
      <div><b>GC Progress</b></div>
      <div id="gc-total"></div>
      <div id="gc-current"></div>
      <div id="gc-timer"></div>
      <hr>
      <button id="gc-download">Download CSV</button>
    `;
    document.body.appendChild(box);
    document.getElementById('gc-download').onclick = exportRekapCSV;
  }

  function updateDashboard(current = 0, timer = '') {
    document.getElementById('gc-total').textContent =
      `Eligible: ${rows.length}`;
    document.getElementById('gc-current').textContent =
      `Progress: ${current}/${rows.length}`;
    document.getElementById('gc-timer').textContent = timer;
  }

  function exportRekapCSV() {
    console.log('[EXPORT] Export CSV');
    ori_rows.forEach(r => {
      if (gcCache.has(r.idsbr)) r.gc_label = '1';
    });

    const headers = Object.keys(ori_rows[0]);
    const lines = [
      headers.join(';'),
      ...ori_rows.map(r => headers.map(h => r[h] ?? '').join(';'))
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'RekapGC.csv';
    a.click();
  }

  createDashboard();
  updateDashboard(0);

  /* ===================== PROCESS ===================== */

  let failedAttempt = 0;

  async function processRow(row, index) {
    console.log(`\n[PROCESS] (${index + 1}) IDSBR ${row.idsbr}`);

    try {
      console.log('[STEP] Isi pencarian IDSBR');
      document.querySelector('#search-idsbr').value = row.idsbr;
      document.querySelector('#apply-filter-btn').click();

      await waitForSearchResultMatch(row.idsbr);
	  
	  const gcBadgeEl = document.querySelector('.gc-badge');
	  const isSudahGC =
		  gcBadgeEl &&
		  gcBadgeEl.textContent &&
		  gcBadgeEl.textContent.trim() === 'Sudah GC';

      if (isSudahGC || document.querySelector('.tidak-aktif')) {
        console.log('[STEP] Sudah GC / Tidak Aktif → skip & cache');
        gcCache.add(row.idsbr);
        saveGCCache(gcCache);
        return;
      }

      console.log('[STEP] Klik tombol Tandai');
      (await waitForSelector('.btn-tandai')).click();

      console.log('[STEP] Isi hasil GC');
      const select = await waitForSelector('#tt_hasil_gc');
      select.value = row.hasil;
      select.dispatchEvent(new Event('change', { bubbles: true }));

      console.log('[STEP] Isi koordinat');
      (await waitForSelector('#tt_latitude_cek_user')).value = row.latitude;
      (await waitForSelector('#tt_longitude_cek_user')).value = row.longitude;

      console.log('[STEP] Menunggu SweetAlert sukses aktif');

		await waitForSelector('.swal2-popup.swal2-show .swal2-icon-success', {
		  timeout: 20000
		});

		console.log('[STEP] Klik OK pada SweetAlert aktif');

		const okBtn = document.querySelector(
		  '.swal2-popup.swal2-show .swal2-confirm'
		);

		if (okBtn) {
		  okBtn.click();
		} else {
		  console.warn('[WARN] Tombol OK tidak ditemukan');
		}

      console.log('[SUCCESS] IDSBR berhasil');
      gcCache.add(row.idsbr);
      saveGCCache(gcCache);
      failedAttempt = 0;

      const delay = randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX);
      console.log(`[DELAY] Tunggu ${delay} ms`);
      await sleep(delay);

    } catch (err) {
      failedAttempt++;
      console.error(`[ERROR] ${err.message}`);

      if (failedAttempt >= MAX_FAILED_ATTEMPT) {
        console.warn('[COOLDOWN] Gagal berulang, cooldown 3 menit');
        for (let i = 180; i > 0; i--) {
          updateDashboard(index + 1, `Cooldown ${i}s`);
          await sleep(1000);
        }
        failedAttempt = 0;
      }

      await sleep(2000);
    }
  }

  /* ===================== LOOP ===================== */

  console.log('[LOOP] Mulai processing');

  for (let i = 0; i < rows.length; i++) {
    updateDashboard(i + 1);
    await processRow(rows[i], i);

    const delay = randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX);
    console.log(`[LOOP] Delay antar IDSBR ${delay} ms`);
    await sleep(delay);
  }

  console.log('[DONE] Semua proses selesai');

})();
