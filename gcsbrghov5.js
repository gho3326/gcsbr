(async () => {

  /* ===================== KONFIGURASI ===================== */

  console.log('[INIT] Script dimulai');

  let csvFileName = '-';
  let statSuccess = 0;
  let statFailed = 0;
  let lastPostedPercent = 0;
  let startTime = Date.now();
  
  const LOG_URL = 'https://debian-resepsionis.tailb8fed0.ts.net/gcsbr/insertgc.php';
  const ERROR_LOG_URL = 'https://debian-resepsionis.tailb8fed0.ts.net/gcsbr/inserterror.php';

  const REQUIRED_HEADERS = ['idsbr', 'latitude', 'longitude', 'hasil'];
  const GC_STORAGE_KEY = 'gc_idsbr_cache';

  const TOTAL_DELAY_MIN = 1500; // 1.5 detik
  const TOTAL_DELAY_MAX = 2200; // 2.2 detik
  const COOLDOWN_MS = 3 * 60 * 1000; // 3 menit
  const MAX_FAILED_ATTEMPT = 5;

  /* ===================== UTIL ===================== */

	function sleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	function randomDelay(min, max) {
		return Math.floor(Math.random() * (max - min + 1) + min);
	}
  
	function getUserInfo() {
	  const userEl = document.getElementById('dropdown-user');
	  if (!userEl) {
		console.warn('[USER] Dropdown user tidak ditemukan');
		return null;
	  }

	  const name =
		userEl.querySelector('.user-name')?.textContent.trim() || '-';

	  const status =
		userEl.querySelector('.user-status span')?.textContent.trim() || '-';

	  const avatar =
		userEl.querySelector('img.round')?.getAttribute('src') || '';

	  return {
		name,
		status,
		avatar
	  };
	}

	async function postLog(data) {
	  const res = await fetch(LOG_URL, {
		method: 'POST',
		headers: {
		  'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams(data)
	  });

	  if (!res.ok) {
		throw new Error('Gagal POST ke server');
	  }

	  return res.text();
	}

	let idSesiGC = null;

	async function logMulaiProses({ user, fileName, total }) {
	  try {
		const response = await postLog({
		  tipe: 'mulai',
		  nama: user.name,
		  status: user.status,
		  foto: user.avatar,
		  file: fileName,
		  sukses: 0,
		  gagal: 0,
		  total: total
		});

		idSesiGC = response.trim();
		console.log('[GC] Session ID:', idSesiGC);

	  } catch (err) {
		console.error('[GC] Gagal log mulai:', err);
	  }
	}

	async function logSelesaiProses({ sukses, gagal, total }) {
	  if (!idSesiGC) {
		console.warn('[GC] idSesi belum ada, skip log selesai');
		return;
	  }

	  try {
		await postLog({
		  tipe: 'selesai',
		  idsesi: idSesiGC,
		  sukses: sukses,
		  gagal: gagal,
		  total: total
		});

		console.log('[GC] Log selesai terkirim');

	  } catch (err) {
		console.error('[GC] Gagal log selesai:', err);
	  }
	}

	async function logErrorGC({ idsesi, tipe = 'csv', errormsg = 'unknown error' }) {
	  try {

		const form = new FormData();
		form.append('idsesi', idsesi);
		form.append('tipe', tipe);
		form.append('errormsg', errormsg.substring(0, 500)); // hindari kepanjangan

		const res = await fetch(ERROR_LOG_URL, {
		  method: 'POST',
		  body: form,
		  credentials: 'include'
		});

		const json = await res.json().catch(() => null);

		console.log('LOG ERROR SENT:', json);

	  } catch (e) {
		// jangan sampai error logging bikin script berhenti
		console.warn('Gagal kirim log error:', e);
	  }
	}

	function isElementShowing(selector_element_buka_tutup, class_buka) {
	  const element_buka_tutup   = document.querySelector(selector_element_buka_tutup);

	  if (!element_buka_tutup) return false;

	  return element_buka_tutup.classList.contains(class_buka);
	}

	async function typeLikeHumanNoSearch(input, text, {
	  minDelay = 500,
	  maxDelay = 1000
	} = {}) {
	  input.focus();
	  input.value = '';
  
	  await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));

	  for (const char of String(text)) {
		input.value += char;

		// ❌ tidak dispatch 'input'
		// ❌ tidak keydown / keyup

		const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
		await sleep(delay);
	  }
	}
	
	function normalizeCoord(val) {
	  if (val == null) return '';
	  return String(val)
		.trim()
		.replace(',', '.');   // ganti koma → titik
	}

	function formatDuration(ms) {
	  ms = Math.max(0, Math.floor(ms));

	  const sec  = Math.floor(ms / 1000);
	  const min  = Math.floor(sec / 60);
	  const hour = Math.floor(min / 60);
	  const day  = Math.floor(hour / 24);

	  const s = sec  % 60;
	  const m = min  % 60;
	  const h = hour % 24;

	  const parts = [];

	  if (day  > 0) parts.push(`${day} hari`);
	  if (h    > 0) parts.push(`${h} jam`);
	  if (m    > 0) parts.push(`${m} menit`);
	  if (s    > 0 && day === 0) parts.push(`${s} detik`);
	  // kalau sudah hari, detik tidak penting → biar tidak panjang

	  return parts.join(' ');
	}

	function updateElapsedTime() {
	  const elapsedMs = Date.now() - startTime;
	  const el = document.getElementById('gc-elapsed');
	  if (!el) return;

	  el.textContent = `Durasi: ${formatDuration(elapsedMs)}`;
	}
	
	function isClickable(el) {
	  if (!el) return false;

	  const style = window.getComputedStyle(el);

	  if (
		style.display === 'none' ||
		style.visibility === 'hidden' ||
		style.opacity === '0' ||
		style.pointerEvents === 'none'
	  ) return false;

	  if (el.disabled) return false;

	  const rect = el.getBoundingClientRect();

	  if (rect.width === 0 || rect.height === 0) return false;

	  // cek ketutup element lain
	  const centerX = rect.left + rect.width / 2;
	  const centerY = rect.top + rect.height / 2;

	  const topEl = document.elementFromPoint(centerX, centerY);

	  if (!topEl || (!el.contains(topEl) && topEl !== el)) return false;

	  return true;
	}
	
	async function waitClickable(selector, timeout=10000) {
	  const start = Date.now();
	  while (Date.now() - start < timeout) {
		const el = document.querySelector(selector);
		if (isClickable(el)) return el;
		await sleep(200);
	  }
	  throw new Error(`Timeout menunggu clickable: ${selector}`);
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
/*
  rows = rows.filter(r => {
    if (gcCache.has(r.idsbr) && (r.edit_gc && r.edit_gc !=1 )) {
      console.log(`[FILTER] Skip cache yang bukan edit ${r.idsbr}`);
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
*/
rows = rows.filter(r => {

  const editGC = Number(r.edit_gc) === 1;
  const hasil  = Number(r.hasil);

  // skip cache kecuali edit ulang
  if (gcCache.has(r.idsbr) && !editGC) {
    console.log(`[FILTER] Skip cache yang bukan edit ${r.idsbr}`);
    return false;
  }

  // skip label GC
  if (Number(r.gc_label) === 1 && !editGC) {
    console.log(`[FILTER] Skip GC label ${r.idsbr}`);
    return false;
  }
  
	if (Number(r.edited) === 1) {
	  console.log(`[FILTER] Skip sudah pernah edit ${r.idsbr}`);
	  return false;
	}

  // validasi hasil
  if (!Number.isFinite(hasil) || ![1,3,4,99].includes(hasil)) {
    console.log(`[FILTER] Skip hasil invalid ${r.idsbr} (${r.hasil})`);
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
		color: white;
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
		  <h5 style="color: red;"><b>GC SBR 3326 by MasGhoz</b></h5>
		  <div><b>Pastikan GC SBR ini tetap terlihat dan layar tetap menyala supaya proses tetap berjalan.</b></div>
		  <div><b>Pastikan juga koneksi Internet Anda stabil dan VPN Forticlient BPS tetap tersambung.</b></div>
		  <div style="color: #4CFCFC;" id="gc-file"></div>
		  <!--
		  <div id="gc-total"></div>
		  <div id="gc-current"></div>
		  -->
		  <div id="gc-stat"></div>
		  <div id="gc-elapsed" style="color: #ff00ff;">Durasi: 00:00</div>
		  <div id="gc-eta" style="color: #00ccff;"></div>
		  <div style="color: #ffcc00;" id="gc-speed">Kecepatan: -</div>
		  <div id="gc-timer"></div>
		  <hr style="border:1px solid #333">
		  <div style="flex:1; overflow-y:auto; padding:6px; color: #0f0;" id="gc-log"></div>
		  <div style="margin-top:6px;">
			  <div style="background:#333; height:10px; border-radius:6px; overflow:hidden;">
				<div id="gc-progress-bar"
					 style="height:100%; width:0%; background:#0f0;"></div>
			  </div>
			  <div id="gc-progress-text" style="margin-top:4px; color: #0f0;"></div>
			</div>
		  <button id="gc-rekap" style="margin-top:6px;">Lihat Rekap Anda</button>
		  <button id="gc-download" style="margin-top:6px;">Download CSV</button>
		`;

	  document.body.appendChild(box);
	  
	  document.getElementById('gc-rekap').onclick = () => {
		  const user = getUserInfo();
		  const namaUser = encodeURIComponent(user.name); // pastikan variabel user sudah ada
		  const url = `https://debian-resepsionis.tailb8fed0.ts.net/gcsbr/rekap.php?nama=${namaUser}`;

		  window.open(
			  url,
			  'gcRekapWindow',
			  'popup=yes,width=1200,height=750,left=100,top=60,resizable=yes'
		  );

	  };

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
	  //const totalEl = document.getElementById('gc-total');
	  //const currentEl = document.getElementById('gc-current');
	  const timerEl = document.getElementById('gc-timer');

	  if (fileEl) fileEl.textContent = `File: ${csvFileName}`;
	  //if (totalEl) totalEl.textContent = `Eligible: ${rows.length}`;
	  //if (currentEl) currentEl.textContent = `Progress: ${current}/${rows.length}`;
	  if (timerEl) timerEl.textContent = timer;
	}

	function updateStat() {//update statistik jumlah sukses dan gagal
	  document.getElementById('gc-stat').innerHTML =
		`<span style="color: #0f0;">Sukses: <strong>${statSuccess}</strong></span> | 
		<span style="color: red;">Gagal: <strong>${statFailed}</strong></span>`;
	}

	async function updateProgress(processed, total) {
	  const percent = Math.floor((processed / total) * 100);

	  document.getElementById('gc-progress-bar').style.width = percent + '%';
	  document.getElementById('gc-progress-text').textContent =
		`Progress: ${processed}/${total} (${percent}%)`;

	  // POST ke server tiap kelipatan 10%, HANYA SEKALI
	  const milestone = Math.floor(percent / 10) * 10;
	  
	  if (milestone > lastPostedPercent) {
		lastPostedPercent = milestone;

		try {
		  await logSelesaiProses({
			sukses: statSuccess,
			gagal: statFailed,
			total: rows.length
		  });
		} catch (e) {
		  console.warn('[GC] Gagal kirim progress:', e.message);
		}
	  }
	}

	function updateETA(processed, total) {//update Estimasi waktu selesai (ETA)
		if (processed === 0 || total === 0) return;

		const now = Date.now();
		const elapsed = now - startTime;
		const avgPerItem = elapsed / processed;
		const remaining = total - processed;
		const etaMs = Math.max(0, avgPerItem * remaining);

		// === PROSES BELUM SELESAI ===
		if (processed < total) {
			const etaText = formatDuration(etaMs);

			const finishTime = new Date(now + etaMs);
			const hh = String(finishTime.getHours()).padStart(2, '0');
			const mm = String(finishTime.getMinutes()).padStart(2, '0');

			document.getElementById('gc-eta').textContent =
			  `Selesai: ± ${etaText} lagi (jam ${hh}:${mm})`;

			return;
		}

		// === PROSES SELESAI ===
		const totalDurationText = formatDuration(elapsed);

		const finishTime = new Date(now);
		const hh = String(finishTime.getHours()).padStart(2, '0');
		const mm = String(finishTime.getMinutes()).padStart(2, '0');

		document.getElementById('gc-eta').textContent =
			`Selesai Jam ${hh}:${mm} · Total: ${totalDurationText}`;
	}

	function updateSpeed(processed) {
	  if (processed === 0) return;

	  const elapsedMs = Date.now() - startTime;
	  const avgMs = elapsedMs / processed;

	  let text;

	  if (avgMs >= 1000 * 60 * 60 * 24) {
		text = `${(avgMs / (1000 * 60 * 60 * 24)).toFixed(2)} hari/IDSBR`;
	  } else if (avgMs >= 1000 * 60 * 60) {
		text = `${(avgMs / (1000 * 60 * 60)).toFixed(2)} jam/IDSBR`;
	  } else if (avgMs >= 1000 * 60) {
		text = `${(avgMs / (1000 * 60)).toFixed(1)} menit/IDSBR`;
	  } else if (avgMs >= 1000) {
		text = `${(avgMs / 1000).toFixed(0)} detik/IDSBR`;
	  } else {
		text = `${Math.round(avgMs)} ms/IDSBR`;
	  }

	  const el = document.getElementById('gc-speed');
	  if (el) el.textContent = `Kecepatan: ${text}`;
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

	window.addEventListener('error', e => {
	  logErrorGC({
		idsesi: idSesiGC,
		//tipe: 'WINDOW',
		errormsg: e.message
	  });
	});

	window.addEventListener('unhandledrejection', e => {
	  logErrorGC({
		idsesi: idSesiGC,
		//tipe: 'PROMISE',
		errormsg: String(e.reason)
	  });
	});
	
  /* ===================== PROCESS ===================== */

  let failedAttempt = 0;

  async function processRow(row, index) {
    console.log(`\n[PROCESS] (${index + 1}) IDSBR ${row.idsbr}`);

    try {
		
	  if(isElementShowing('.usaha-card', 'expanded')){//tutup usaha-card jika terbuka
		document.querySelector('.usaha-card-header').click();
	  }
	  await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
	  
      const searchResult = await cariIDSBR(row.idsbr);

		if (searchResult.status === 'NOT_FOUND') {
		  console.log('[STEP] IDSBR tidak ada → lanjut IDSBR berikutnya');
		  return { status: 'IDSBR tidak ada' };
		}
	  
      var delay = randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX);
      console.log(`[DELAY] Tunggu sebelum klik Tandai ${delay} ms`);
      await sleep(delay);

	  const statusUsahaEl = document.querySelector('.usaha-status');
	  const isDuplikat =
		  statusUsahaEl &&
		  statusUsahaEl.textContent &&
		  statusUsahaEl.textContent.trim().toLowerCase() === 'duplikat';

      if (isDuplikat) {
        console.log('[STEP] Status Duplikat → skip & cache');
        gcCache.add(row.idsbr);
        saveGCCache(gcCache);
        return { status: 'Status Duplikat' };
      }
	  
	  if(!isElementShowing('.usaha-card', 'expanded')){//buka usaha-card jika tertutup
		document.querySelector('.usaha-card-header').click();
	  }
	  await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));

	  const gcBadgeEl = document.querySelector('.gc-badge');
	  const isSudahGC =
		  gcBadgeEl &&
		  gcBadgeEl.textContent &&
		  gcBadgeEl.textContent.trim().toLowerCase() === 'sudah gc';

	  console.log('Sudah GC: ' + isSudahGC +', edit GC: ' + row.edit_gc);
			
      if (isSudahGC && row.edit_gc && row.edit_gc != 1) {//jika sudah gc dan tidak mau edit lagi
        
			console.log('[STEP] Sudah GC → skip & cache');
			gcCache.add(row.idsbr);
			saveGCCache(gcCache);
			return { status: 'Sudah GC' };
		
      }else if(isSudahGC && row.edit_gc && row.edit_gc == 1){//jika sudah gc tapi mau diedit lagi
			console.log('[STEP] Klik Edit GC');
			const btn_edit_gc = document.querySelector('.btn-gc-edit');

			if (btn_edit_gc) {// ada tombol edit GC
				btn_edit_gc.scrollIntoView({ block: 'center' });
				btn_edit_gc.focus();
				await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
				btn_edit_gc.click();
			}else{// tidak ada tombol edit gc, mungkin beda username
				console.log('[STEP] Tidak bisa edit GC → skip');
				return { status: 'Sudah GC' };
			}
	  }else if(!isSudahGC){// jika belum gc
		  console.log('[STEP] Klik tombol Tandai');
		  const btn_tandai = document.querySelector('.btn-tandai');

			if (btn_tandai) {// jika ada tombol tandai dan bisa diklik
			  btn_tandai.scrollIntoView({ block: 'center' });
			  btn_tandai.focus();
			  await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
			  btn_tandai.click();
			}
	  }else if(isSudahGC && (String(row.edit_gc).trim() === '' || row.edit_gc == null)){
			console.log('[STEP] Usaha sudah diGC, mencoba klik edit');
			const btn_edit_gc = document.querySelector('.btn-gc-edit');

			if (btn_edit_gc) {// ada tombol edit GC
				btn_edit_gc.scrollIntoView({ block: 'center' });
				btn_edit_gc.focus();
				await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
				btn_edit_gc.click();
			}else{// tidak ada tombol edit gc, mungkin beda username
				console.log('[STEP] Tidak bisa edit GC → skip');
				return { status: 'Sudah GC' };
			}
	  }

      console.log('[STEP] Isi hasil GC');
      const select = await waitForSelector('#tt_hasil_gc');
	  
		if (![...select.options].some(o => o.value === row.hasil)) {
			throw new Error(`Nilai hasil GC tidak valid: ${row.hasil}`);
		}
		
      select.value = row.hasil;
      select.dispatchEvent(new Event('change', { bubbles: true }));

      console.log('[STEP] Isi koordinat');
      (await waitForSelector('#tt_latitude_cek_user')).value = row.latitude;
      (await waitForSelector('#tt_longitude_cek_user')).value = row.longitude;

		if (row.edit_nama && row.edit_nama.trim()!=''){//jika kolom edit_nama ada isinya
		  (await waitForSelector('#toggle_edit_nama')).checked = true;
		  (await waitForSelector('#tt_nama_usaha_gc')).value = row.edit_nama;
		}

		if (row.edit_alamat && row.edit_alamat.trim()!=''){// jika kolom edit_alamat ada isinya
		  (await waitForSelector('#toggle_edit_alamat')).checked = true;
		  (await waitForSelector('#tt_alamat_usaha_gc')).value = row.edit_alamat;
		}

      delay = randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX);
      console.log(`[DELAY] Tunggu sebelum klik SIMPAN ${delay} ms`);
      await sleep(delay);

	  console.log('[STEP] Simpan data (dengan retry)');
	  await saveWithRetry(row, 3);

	  delay = randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX);
	  console.log(`[DELAY] Tunggu sebelum klik OK ${delay} ms`);
	  await sleep(delay);

	  console.log('[STEP] Klik OK sukses');
	  (await waitForSelector('.swal2-confirm', 60000)).click();

      console.log('[SUCCESS] IDSBR berhasil');
      
	  gcCache.add(row.idsbr);
      saveGCCache(gcCache);
	  
	  if(isSudahGC && row.edit_gc && row.edit_gc == 1){
			row.edited = 1;
			console.log(`[SUCCESS] IDSBR ${row.idsbr} edited`);
	  }
	  
      failedAttempt = 0;
	  statSuccess++;

      delay = randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX);
      console.log(`[DELAY] Tunggu ${delay} ms`);
      await sleep(delay);

	  return { status: 'SUCCESS' };

    } catch (err) {
		
		// 🔽 LOG ERROR KE SERVER
		logErrorGC({
			idsesi: idSesiGC,
			//tipe: 'PROCESS_USAHA',
			errormsg: err?.stack || err?.message || String(err)
		});

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
		
		return { status: 'RETRY_SAME_IDSBR' };
      }

      await sleep(2000);
	  return { status: 'RETRY_SAME_IDSBR' };
	  
    }
  }
  
  //------------ FUNGSI BANTU DETEKSI IDSBR TIDAK ADA ATAU GAGAL DICARI -------------------
  
  function getSearchEmptyState() {
	  const container = document.querySelector('#usaha-cards-container');
	  if (!container) return null;

	  const p = container.querySelector('.empty-state p');
	  if (!p) return null;

	  return p.textContent.trim();
	}

//----------------- TUNGGU DIALOG SUKSES ATAU GAGAL MUNCUL -----------------------------

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

//----------------------- PERCOBAAN KLIK SUBMIT GC ---------------------------

	async function saveWithRetry(row, maxRetry = 3) {
	  for (let attempt = 1; attempt <= maxRetry; attempt++) {
		console.log(`[SAVE] Percobaan simpan ke-${attempt}`);

		// Klik SIMPAN
		(await waitForSelector('#save-tandai-usaha-btn')).click();
		
		console.log('[STEP] Cek dialog konfirmasi');
		try {
		  await waitForSelector('.swal2-icon-warning', 2000);

		  await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
			
		  console.log('[STEP] Dialog konfirmasi muncul → klik Ya');
		  (await waitForSelector('.swal2-confirm')).click();

		} catch {
		  console.log('[STEP] Dialog konfirmasi tidak muncul → lanjut');
		}
		
		try {
		  const result = await waitForSwalResult(120000);

		  if (result === 'success') {
			console.log('[SAVE] Berhasil (success dialog)');
			return; // keluar dari fungsi → sukses
		  }

		  if (result === 'error') {
			console.warn('[SAVE] Dialog error muncul');

			await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
			
			// Klik OK error
			(await waitForSelector('.swal2-confirm')).click();

			// Delay kecil sebelum retry
			await sleep(5000);

			console.log('[STEP] Ganti koordinat dengan titik');
			const latInput = await waitForSelector('#tt_latitude_cek_user');
			const lngInput = await waitForSelector('#tt_longitude_cek_user');

			latInput.value = normalizeCoord(row.latitude);
			lngInput.value = normalizeCoord(row.longitude);
			
			latInput.dispatchEvent(new Event('input', { bubbles: true }));
			lngInput.dispatchEvent(new Event('input', { bubbles: true }));

			continue; // ulangi loop
		  }

		} catch (err) {
		  console.warn(`[SAVE] Tidak ada dialog (${err.message})`);
		}
	  }

		console.warn('[ERROR] Retry habis, batalkan proses simpan');

		const cancelBtn = Array.from(document.querySelectorAll('button'))
		.find(btn => btn.textContent.trim() === 'Batal');

		if (cancelBtn) {
			cancelBtn.click();
			await sleep(500);
		}

		throw new Error(`Gagal simpan setelah ${maxRetry} percobaan`);
		
	}

	function getIDSBRFromResult() {
	  const rows = document.querySelectorAll(
		'.usaha-card-details .detail-row'
	  );

	  for (const row of rows) {
		const label = row.querySelector('.detail-label');
		const value = row.querySelector('.detail-value');

		if (
		  label &&
		  value &&
		  label.textContent.trim() === '#IDSBR'
		) {
		  return value.textContent.trim();
		}
	  }

	  return null;
	}

  /* ===================== cari IDSBR ===================== */

	async function cariIDSBR(idsbr, {
	  maxRetry = 3,
	  timeout = 120000,
	  retryDelay = 15000
	} = {}) {

	  console.log(`[SEARCH] Mulai cari IDSBR ${idsbr}`);

	  for (let attempt = 1; attempt <= maxRetry; attempt++) {
		console.log(`[SEARCH] Percobaan ${attempt}/${maxRetry}`);

		try {
			
		  const toggle_filter = document.querySelector('#toggle-filter');

			if (toggle_filter && !isElementShowing('#filter-body', 'show')) {//buka filter cari sbr
			  toggle_filter.scrollIntoView({ block: 'center' });
			  toggle_filter.focus();
			  await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
			  toggle_filter.click();
			}
			
		  // reset input
		  const input = document.querySelector('#search-idsbr');
		  if (!input) throw new Error('Input IDSBR tidak ditemukan');

		  await typeLikeHumanNoSearch(input, idsbr);

		  const btn_filter = document.querySelector('#apply-filter-btn');

			if (btn_filter) {
			  btn_filter.scrollIntoView({ block: 'center' });
			  btn_filter.focus();
			  await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
			  btn_filter.click();
			}

		  const start = Date.now();

		  while (Date.now() - start < timeout) {

			/* 1️⃣ Cek hasil IDSBR */
			const foundIDSBR = getIDSBRFromResult();

			if (foundIDSBR === idsbr) {
			  console.log('[SEARCH] IDSBR ditemukan');
			  
				if (toggle_filter && isElementShowing('#filter-body', 'show')) {//tutup filter cari sbr
				  toggle_filter.scrollIntoView({ block: 'center' });
				  toggle_filter.focus();
				  await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
				  toggle_filter.click();
				}

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

			await sleep(500);
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

  /* ===================== POST DATA SAAT MULAI ===================== */

	const user = getUserInfo();
	await logMulaiProses({
	  user,
	  fileName: csvFileName,
	  total: rows.length
	});

	/* ===================== LOOP tiap IDSBR ===================== */

	console.log('[LOOP] Mulai processing');

	let i = 0;

	while (i < rows.length) {
		//updateDashboard(i + 1);
		//updateProgress(i + 1, rows.length);
		//updateStat();
		//updateETA(i + 1, rows.length);
		//updateSpeed(i + 1);
		//updateElapsedTime();

		const result = await processRow(rows[i], i);

		if (result?.status === 'RETRY_SAME_IDSBR') {
			console.warn(`[LOOP] Retry IDSBR ${rows[i].idsbr}`);
			// i TIDAK bertambah → retry IDSBR yang sama
		}else{

			i++; // lanjut ke IDSBR berikutnya
			
			updateDashboard(i);
			updateProgress(i, rows.length);
			updateStat();
			updateETA(i, rows.length);
			updateSpeed(i);
			updateElapsedTime();
		} 

		const delay = randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX);
		console.log(`[LOOP] Delay ${delay} ms`);
		await sleep(delay);
	}

	/* ===================== POST DATA SAAT SELESAI ===================== */

	await logSelesaiProses({
	  sukses: statSuccess,
	  gagal: statFailed,
	  total: rows.length
	});

	console.log('[DONE] Semua proses selesai');

	const totalMs = Date.now() - startTime;

	document.getElementById('gc-elapsed').textContent =
	  `Total durasi: ${formatDuration(totalMs)}`;

})();
