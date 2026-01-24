(async () => {

  /* ===================== KONFIGURASI ===================== */

  console.log('[INIT] Script dimulai');

  let csvFileName = '-';
  let statSuccess = 0;
  let statFailed = 0;
  let startTime = Date.now();
  const REQUIRED_HEADERS = ['idsbr', 'latitude', 'longitude', 'hasil'];
  const GC_STORAGE_KEY = 'gc_idsbr_cache';

  const TOTAL_DELAY_MIN = 1000; // 1 detik
  const TOTAL_DELAY_MAX = 2000; // 2 detik
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
        csvFileName = file.name;
		console.log('[CSV] Nama file:', csvFileName);
		
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

  function waitForSelector(selector, timeout = 60000, interval = 100) {
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

  async function waitForSearchResultMatch(idsbr, timeout = 60000) {
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
	  const box = document.createElement('div');
	  box.id = 'gc-dashboard';
	  box.style.cssText = `
		position: fixed;
		top: 40px;
		right: 20px;
		z-index: 99999;
		background: rgba(0, 0, 0, 0.75); /* transparan 75% */
		color: #0f0;
		padding: 12px;
		font-family: monospace;
		font-size: 13px;
		border-radius: 8px;
		box-shadow: 0 0 10px rgba(0,0,0,.5);
		width: 360px;
		max-height: 70vh;
		display: flex;
		flex-direction: column;
	  `;

	  box.innerHTML = `
		  <div><b>GC SBR 3326 by MasGhoz</b></div>
		  <div id="gc-file"></div>
		  <div id="gc-total"></div>
		  <div id="gc-current"></div>
		  <div id="gc-stat"></div>
		  <div id="gc-eta"></div>
		  <div id="gc-timer"></div>
		  <hr style="border:1px solid #333">
		  <div style="flex:1; overflow-y:auto; padding:6px;" id="gc-log"></div>
		  <div style="margin-top:6px;">
			  <div style="background:#333; height:10px; border-radius:6px; overflow:hidden;">
				<div id="gc-progress-bar"
					 style="height:100%; width:0%; background:#0f0;"></div>
			  </div>
			  <div id="gc-progress-text" style="margin-top:4px;"></div>
			</div>
		  <button id="gc-download" style="margin-top:6px;">Download CSV</button>
		`;

	  document.body.appendChild(box);
	  document.getElementById('gc-download').onclick = exportRekapCSV;
	}

	function appendDashboardLog(type, args) {
	  const logBox = document.getElementById('gc-log');
	  if (!logBox) return;

	  const time = new Date().toLocaleTimeString();
	  const msg = args.map(a =>
		typeof a === 'object' ? JSON.stringify(a) : String(a)
	  ).join(' ');

	  const line = document.createElement('div');
	  line.textContent = `[${time}] ${msg}`;

	  if (type === 'error') line.style.color = '#f55';
	  if (type === 'warn') line.style.color = '#ff0';

	  logBox.innerHTML = '';
	  logBox.appendChild(line);
	}

  function updateDashboard(current = 0, timer = '') {
	  const fileEl = document.getElementById('gc-file');
	  const totalEl = document.getElementById('gc-total');
	  const currentEl = document.getElementById('gc-current');
	  const timerEl = document.getElementById('gc-timer');

	  if (fileEl) fileEl.textContent = `File: ${csvFileName}`;
	  if (totalEl) totalEl.textContent = `Eligible: ${rows.length}`;
	  if (currentEl) currentEl.textContent = `Progress: ${current}/${rows.length}`;
	  if (timerEl) timerEl.textContent = timer;
	}

	function updateStat() {//update statistik jumlah sukses dan gagal
	  document.getElementById('gc-stat').textContent =
		`Sukses: ${statSuccess} | Gagal: ${statFailed}`;
	}

	function updateProgress(processed, total) {//update progress bar
	  const percent = Math.floor((processed / total) * 100);
	  document.getElementById('gc-progress-bar').style.width = percent + '%';
	  document.getElementById('gc-progress-text').textContent =
		`Progress: ${processed}/${total} (${percent}%)`;
	}

	function updateETA(processed, total) {//update Estimasi waktu selesai (ETA)
	  if (processed === 0) return;

	  const elapsed = Date.now() - startTime;
	  const avgPerItem = elapsed / processed;
	  const remaining = total - processed;
	  const etaMs = avgPerItem * remaining;

	  const etaMin = Math.ceil(etaMs / 60000);

	  document.getElementById('gc-eta').textContent =
		`Estimasi selesai: ~${etaMin} menit`;
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
  
	(function hookConsole() {
	  const origLog = console.log;
	  const origWarn = console.warn;
	  const origError = console.error;

	  console.log = (...args) => {
		origLog(...args);
		appendDashboardLog('log', args);
	  };

	  console.warn = (...args) => {
		origWarn(...args);
		appendDashboardLog('warn', args);
	  };

	  console.error = (...args) => {
		origError(...args);
		appendDashboardLog('error', args);
	  };
	})();

  /* ===================== PROCESS ===================== */

  let failedAttempt = 0;

  async function processRow(row, index) {
    console.log(`\n[PROCESS] (${index + 1}) IDSBR ${row.idsbr}`);

    try {
		
      const searchResult = await cariIDSBR(row.idsbr);

		if (searchResult.status === 'NOT_FOUND') {
		  console.log('[STEP] IDSBR tidak ada → lanjut IDSBR berikutnya');
		  return;
		}
	  
      var delay = randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX);
      console.log(`[DELAY] Tunggu sebelum klik Tandai ${delay} ms`);
      await sleep(delay);

	  const gcBadgeEl = document.querySelector('.gc-badge');
	  const isSudahGC =
		  gcBadgeEl &&
		  gcBadgeEl.textContent &&
		  gcBadgeEl.textContent.trim() === 'Sudah GC';

      if (isSudahGC) {
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

      delay = randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX);
      console.log(`[DELAY] Tunggu sebelum klik SIMPAN ${delay} ms`);
      await sleep(delay);

		(await waitForSelector('#save-tandai-usaha-btn')).click();
		console.log('[STEP] Cek dialog konfirmasi');

		try {
		  await waitForSelector('.swal2-icon-warning', 1000);

		  console.log('[STEP] Dialog konfirmasi muncul → klik Ya');
		  (await waitForSelector('.swal2-confirm')).click();

		} catch {
		  console.log('[STEP] Dialog konfirmasi tidak muncul → lanjut');
		}

		console.log('[STEP] Simpan data (dengan retry)');
		await saveWithRetry(3);

		  delay = randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX);
		  console.log(`[DELAY] Tunggu sebelum klik OK ${delay} ms`);
		  await sleep(delay);

		console.log('[STEP] Klik OK sukses');
		(await waitForSelector('.swal2-confirm')).click();

      console.log('[SUCCESS] IDSBR berhasil');
      gcCache.add(row.idsbr);
      saveGCCache(gcCache);
      failedAttempt = 0;
	  statSuccess++;

      delay = randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX);
      console.log(`[DELAY] Tunggu ${delay} ms`);
      await sleep(delay);

    } catch (err) {
      failedAttempt++;
      statFailed++;
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
  
  function getSearchEmptyState() {
	  const container = document.querySelector('#usaha-cards-container');
	  if (!container) return null;

	  const p = container.querySelector('.empty-state p');
	  if (!p) return null;

	  return p.textContent.trim();
	}

	async function waitForSwalResult(timeout = 120000) {
	  const start = Date.now();

	  while (Date.now() - start < timeout) {
		if (document.querySelector('.swal2-icon-success')) {
		  return 'success';
		}

		if (document.querySelector('.swal2-icon-error')) {
		  return 'error';
		}

		await sleep(200);
	  }

	  throw new Error('Tidak muncul dialog success maupun error');
	}

	async function saveWithRetry(maxRetry = 3) {
	  for (let attempt = 1; attempt <= maxRetry; attempt++) {
		console.log(`[SAVE] Percobaan simpan ke-${attempt}`);

		// Klik SIMPAN
		(await waitForSelector('#save-tandai-usaha-btn')).click();

		try {
		  const result = await waitForSwalResult(120000);

		  if (result === 'success') {
			console.log('[SAVE] Berhasil (success dialog)');
			return; // keluar dari fungsi → sukses
		  }

		  if (result === 'error') {
			console.warn('[SAVE] Dialog error muncul');

			await sleep(1000);
			
			// Klik OK error
			(await waitForSelector('.swal2-confirm')).click();

			// Delay kecil sebelum retry
			await sleep(1000);

			continue; // ulangi loop
		  }

		} catch (err) {
		  console.warn(`[SAVE] Tidak ada dialog (${err.message})`);
		}
	  }

	  throw new Error(`Gagal simpan setelah ${maxRetry} percobaan`);
	}

  /* ===================== cari IDSBR ===================== */

	async function cariIDSBR(idsbr, {
	  maxRetry = 3,
	  timeout = 120000,
	  retryDelay = 3000
	} = {}) {

	  console.log(`[SEARCH] Mulai cari IDSBR ${idsbr}`);

	  for (let attempt = 1; attempt <= maxRetry; attempt++) {
		console.log(`[SEARCH] Percobaan ${attempt}/${maxRetry}`);

		try {
		  // reset input
		  const input = document.querySelector('#search-idsbr');
		  if (!input) throw new Error('Input IDSBR tidak ditemukan');

		  input.value = '';
		  await sleep(300);
		  input.value = idsbr;

		  document.querySelector('#apply-filter-btn').click();

		  const start = Date.now();

		  while (Date.now() - start < timeout) {

			/* 1️⃣ Cek hasil IDSBR */
			const resultEl = document
			  .querySelector('.usaha-card-details')
			  ?.querySelector('.detail-row .detail-value');

			if (resultEl && resultEl.innerText.trim() === idsbr) {
			  console.log('[SEARCH] IDSBR ditemukan');
			  return { status: 'FOUND' };
			}

			/* 2️⃣ Cek empty-state */
			const emptyText = getSearchEmptyState();

			if (emptyText === 'Tidak ada data ditemukan') {
			  console.warn('[SEARCH] Tidak ada data ditemukan → skip');
			  return { status: 'NOT_FOUND' };
			}

			if (emptyText === 'Gagal memuat data') {
			  throw new Error('Gagal memuat data');
			}

			await sleep(300);
		  }

		  throw new Error('Timeout menunggu hasil pencarian');

		} catch (err) {
		  console.warn(`[SEARCH] Error: ${err.message}`);

		  if (attempt >= maxRetry) {
			throw new Error(
			  `IDSBR ${idsbr} gagal dicari setelah ${maxRetry} percobaan`
			);
		  }

		  console.log(`[SEARCH] Retry setelah ${retryDelay} ms`);
		  await sleep(retryDelay);
		}
	  }
	}

  /* ===================== LOOP tiap IDSBR ===================== */

  console.log('[LOOP] Mulai processing');

  for (let i = 0; i < rows.length; i++) {
    
	updateDashboard(i + 1);
	updateProgress(i + 1, rows.length);
	updateStat();
	updateETA(i + 1, rows.length);

    await processRow(rows[i], i);
	
    const delay = randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX);
    console.log(`[LOOP] Delay antar IDSBR ${delay} ms`);
    await sleep(delay);
  }

  console.log('[DONE] Semua proses selesai');

})();
