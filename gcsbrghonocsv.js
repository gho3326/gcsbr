/* ===== REAL MEDIA KEEP ALIVE (YouTube) ===== */

let ytPlayer = null;

function startKeepAliveVideo(videoId="35Ok821_MxE") {
  if (document.getElementById("yt-keepalive")) return;

  const div = document.createElement("div");
  div.id = "yt-keepalive";
  div.style.position = "fixed";
  div.style.width = "10px";
  div.style.height = "10px";
  div.style.bottom = "0";
  div.style.right = "0";
  div.style.opacity = "0.01";
  div.style.pointerEvents = "none";
  document.body.appendChild(div);

  const tag = document.createElement('script');
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);

  window.onYouTubeIframeAPIReady = function () {
    ytPlayer = new YT.Player("yt-keepalive", {
      height: "10",
      width: "10",
      videoId: videoId,
      playerVars: {
        autoplay: 1,
        controls: 0,
        loop: 1,
        playlist: videoId,
        playsinline: 1,
        mute: 0,
        modestbranding: 1,
        rel: 0,
        vq: "tiny"
      },
      events: {
        onReady: e => e.target.playVideo()
      }
    });
  };
}

function stopKeepAliveVideo() {
  const iframe = document.getElementById("yt-keepalive");
  if (!iframe) return;
  iframe.src = "about:blank";
}

async function finishNotification(text) {

  console.log("[BOT] Semua proses selesai");

  // stop youtube keep alive
  if (ytPlayer && ytPlayer.stopVideo) {
    ytPlayer.stopVideo();
    ytPlayer.destroy();
    ytPlayer = null;
  }

  await new Promise(r => setTimeout(r, 1200));

  // pilih voice indonesia terbaik
  let voices = speechSynthesis.getVoices();
  let indoVoice =
    voices.find(v => v.lang === "id-ID" && v.name.toLowerCase().includes("google")) ||
    voices.find(v => v.lang === "id-ID") ||
    voices[0];

  const utter = new SpeechSynthesisUtterance(text);
  utter.voice = indoVoice;
  utter.rate = 0.95;
  utter.pitch = 1;
  utter.volume = 1;

  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}

/* ===== END KEEP ALIVE ===== */

(async () => {

  /* ===================== KONFIGURASI ===================== */

  console.log('[INIT] Script dimulai');

  let csvFileName = '-';
  let NAMA_KECAMATAN = '';
  let statSuccess = 0;
  let statFailed = 0;
  //let lastPostedPercent = 0;
  let startTime = Date.now();
  
  const MAX_TOTAL_PROCESS = 10000;
  
  const LOG_URL = 'https://debian-resepsionis.tailb8fed0.ts.net/gcsbr/insertgc.php';
  const ERROR_LOG_URL = 'https://debian-resepsionis.tailb8fed0.ts.net/gcsbr/inserterror.php';

  const GC_STORAGE_KEY = 'gcsbr_nocsv_cache';

  const TOTAL_DELAY_MIN = 1500; // 1.5 detik
  const TOTAL_DELAY_MAX = 2200; // 2.2 detik
  //const COOLDOWN_MS = 3 * 60 * 1000; // 3 menit
  const MAX_FAILED_ATTEMPT = 5;

  /* ===================== UTIL ===================== */

	function sleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	function randomDelay(min, max) {
		return Math.floor(Math.random() * (max - min + 1) + min);
	}
	
	function buildFinishSpeech(user, kecamatan, sukses) {
		return `Halo saudara ${user}, proses GC anda di kecamatan ${kecamatan} telah selesai dengan jumlah sukses GC sebanyak ${sukses} data usaha. Terima kasih`;
	}
	
	const coordCache = new Map();   // alamat -> koordinat final
	const globalPoints = [];        // semua titik yg pernah dipakai

	async function geocodeBase(alamat){
	  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(alamat)}&countrycodes=id&limit=1`;

	  const r = await fetch(url,{headers:{'Accept':'application/json'}});
	  const j = await r.json();

	  if(!j.length) return null;

	  return {
		lat: parseFloat(j[0].lat),
		lon: parseFloat(j[0].lon)
	  };
	}
	
	function dist(a,b){
	  const R=6371000;
	  const t=x=>x*Math.PI/180;

	  const dLat=t(b.lat-a.lat);
	  const dLon=t(b.lon-a.lon);

	  const x=Math.sin(dLat/2)**2+
		Math.cos(t(a.lat))*Math.cos(t(b.lat))*Math.sin(dLon/2)**2;

	  return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
	}
	
	function placeInRing(center,min=20,max=100){

	  for(let i=0;i<80;i++){

		const r=Math.sqrt(Math.random()*(max*max-min*min)+min*min);
		const ang=Math.random()*Math.PI*2;

		const lat=center.lat + (r*Math.sin(ang))/111320;
		const lon=center.lon + (r*Math.cos(ang))/(111320*Math.cos(center.lat*Math.PI/180));

		const candidate={lat,lon};

		let ok=true;
		for(const p of globalPoints){
		  if(dist(candidate,p)<min){ ok=false; break; }
		}

		if(ok){
		  globalPoints.push(candidate);
		  return candidate;
		}
	  }

	  globalPoints.push(center);
	  return center;
	}
	
	async function resolveCoord(alamat){

	  if(coordCache.has(alamat))
		return coordCache.get(alamat);

	  const base=await geocodeBase(alamat);
	  if(!base) return null;

	  const final=placeInRing(base,20,100);

	  coordCache.set(alamat,final);
	  return final;
	}
	
	async function getLatitudeLongitude(alamat){

	  const c = await resolveCoord(alamat);
	  if(!c) return null;

	  return {
		latitude: c.lat.toFixed(7),
		longitude: c.lon.toFixed(7)
	  };
	}
	
	function getWilayahGC(){

		const provSelect = document.querySelector('#f_provinsi');
		const kabSelect  = document.querySelector('#f_kabupaten');

		const provText = provSelect?.selectedOptions[0]?.text || "";
		const kabText  = kabSelect?.selectedOptions[0]?.text || "";

		// hapus kode [xx]
		const provinsi  = provText.replace(/\[\d+\]\s*/,'').trim();
		const kabupaten = kabText.replace(/\[\d+\]\s*/,'').trim();

		return {provinsi, kabupaten};
	}
	
	function normalizeAlamat(alamat){
		if(!alamat) return "";

		return alamat
			.replace(/\b(rt|rw)\s*\d+/gi,"")
			.replace(/\bblok\s*\w+/gi,"")
			.replace(/\bno\.?\s*\d+/gi,"")
			.replace(/\bperum(ahan)?\b/gi,"")
			.replace(/\bkomplek\b/gi,"")
			.replace(/\bgang\b/gi,"")
			.replace(/\s{2,}/g," ")
			.trim();
	}
	
	const usedCoordinates = new Set();

	function keyCoord(lat, lon){
		return lat.toFixed(6)+","+lon.toFixed(6);
	}
	
	function offsetCoordinate(lat, lon, minMeters=20, maxMeters=100){

		const R = 6378137; // radius bumi (meter)

		const distance = Math.random() * (maxMeters - minMeters) + minMeters;
		const bearing  = Math.random() * 2 * Math.PI;

		const latRad = lat * Math.PI/180;
		const lonRad = lon * Math.PI/180;

		const newLat = Math.asin(
			Math.sin(latRad) * Math.cos(distance/R) +
			Math.cos(latRad) * Math.sin(distance/R) * Math.cos(bearing)
		);

		const newLon = lonRad + Math.atan2(
			Math.sin(bearing) * Math.sin(distance/R) * Math.cos(latRad),
			Math.cos(distance/R) - Math.sin(latRad) * Math.sin(newLat)
		);

		return {
			latitude:  (newLat * 180/Math.PI).toFixed(7),
			longitude: (newLon * 180/Math.PI).toFixed(7)
		};
	}
	
	function distanceMeters(lat1, lon1, lat2, lon2){
		const R = 6378137;

		const dLat = (lat2-lat1) * Math.PI/180;
		const dLon = (lon2-lon1) * Math.PI/180;

		const a =
			Math.sin(dLat/2)**2 +
			Math.cos(lat1*Math.PI/180) *
			Math.cos(lat2*Math.PI/180) *
			Math.sin(dLon/2)**2;

		return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
	}
	
	const usedPoints = [];
	
	function findFreeCoordinate(lat, lon){

		let attempt = 0;

		while(attempt < 30){ // batas safety

			const candidate =
				attempt === 0
				? {latitude:lat, longitude:lon}
				: offsetCoordinate(lat, lon, 20, 100);

			let collide = false;

			for(const p of usedPoints){
				const d = distanceMeters(
					candidate.latitude, candidate.longitude,
					p.latitude, p.longitude
				);

				if(d < 20){ // minimal jarak antar titik
					collide = true;
					break;
				}
			}

			if(!collide){
				usedPoints.push(candidate);
				return candidate;
			}

			attempt++;
		}

		console.log("WARNING: tidak dapat posisi unik");
		return candidate;
	}

	let BOT_TERMINATED = false;

	async function terminateBot(reason, isError=false) {
	  if (BOT_TERMINATED) return;
	  BOT_TERMINATED = true;

	  console.warn('[BOT TERMINATE]', reason);

	  try { stopKeepAliveVideo(); } catch {}

	  try {
		const pesan = buildFinishSpeech(
		  user?.name || 'User',
		  NAMA_KECAMATAN || '-',
		  statSuccess || 0
		);

		await finishNotification(pesan);

	  } catch(e) {
		console.warn('TTS gagal:', e);
	  }

	  await sleep(1200);

	  if (isError) throw new Error(reason);
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
	
	async function logErrorGC({ idsesi, tipe = 'no csv', errormsg = 'unknown error' }) {
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

	function formatDuration(ms) {
	  const totalSec = Math.floor(ms / 1000);

	  const h = Math.floor(totalSec / 3600);
	  const m = Math.floor((totalSec % 3600) / 60);
	  const s = totalSec % 60;

	  if (h > 0) {
		return `${h}j ${m}m ${s}d`;
	  }
	  return `${m}m ${s}d`;
	}

	function updateElapsedTime() {
	  const elapsedMs = Date.now() - startTime;
	  const el = document.getElementById('gc-elapsed');
	  if (!el) return;

	  el.textContent = `Durasi: ${formatDuration(elapsedMs)}`;
	}
	
	function promptKodeKecamatan() {
	  while (true) {
		const input = prompt('Masukkan 3 digit kode kecamatan (misal: 010):');

		if (input === null) {
		  throw new Error('Proses dibatalkan oleh user');
		}

		const kode = input.trim();

		if (/^\d{3}$/.test(kode)) {
		  return kode;
		}

		alert('Kode kecamatan harus 3 digit angka!');
	  }
	}

	const KODE_KECAMATAN = promptKodeKecamatan();
	console.log('[INIT] Kode kecamatan:', KODE_KECAMATAN);

	function setKecamatanByKode(select, kode) {
	  const target = [...select.options].find(opt =>
		opt.textContent.includes(`[${kode}]`)
	  );

	  if (!target) {
		console.log('Kode kecamatan tidak ditemukan:', kode);
		return false;
	  }

	  select.value = target.value;

	  console.log(
		'Kecamatan dipilih:',
		kode,
		'| value:',
		target.value,
		'| text:',
		target.textContent.trim()
	  );

	  return true;
	}
	
	function getNamaKecamatan(selectEl) {
	  if (!selectEl) return '';

	  const opt = selectEl.options[selectEl.selectedIndex];
	  if (!opt) return '';

	  const text = opt.textContent || '';

	  // format: [010] KANDANGSERANG
	  const match = text.match(/\[\d{3}\]\s*(.+)/);

	  return match ? match[1].trim() : text.trim();
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
		  <h5 style="color: red;"><b>GC SBR by MasGho</b></h5>
		  <div><b>Pastikan GC SBR ini tetap terlihat dan layar tetap menyala supaya proses tetap berjalan.</b></div>
		  <div><b>Pastikan juga koneksi Internet Anda stabil dan VPN Forticlient BPS tetap tersambung.</b></div>
		  <div style="color: #4CFCFC;" id="gc-kec"></div>
		  <!--
		  <div id="gc-total"></div>
		  <div id="gc-current"></div>
		  -->
		  <div id="gc-stat"></div>
		  <div id="gc-elapsed" style="color: #ff00ff;">Durasi: 00:00</div>
		  <!--
		  <div id="gc-eta"></div>
		  -->
		  <div style="color: #ffcc00;" id="gc-speed">Kecepatan: -</div>
		  <div id="gc-timer"></div>
		  <hr style="border:1px solid #333">
		  <div style="flex:1; overflow-y:auto; padding:6px; color: #0f0;" id="gc-log"></div>
		  <!--
		  <div style="margin-top:6px;">
			  <div style="background:#333; height:10px; border-radius:6px; overflow:hidden;">
				<div id="gc-progress-bar"
					 style="height:100%; width:0%; background:#0f0;"></div>
			  </div>
			  <div id="gc-progress-text" style="margin-top:4px; color: #0f0;"></div>
		  </div>
		  <button id="gc-download" style="margin-top:6px;">Download CSV</button>
		  -->
		  <button id="gc-rekap" style="margin-top:6px;">Lihat Rekap Anda</button>
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

	  //document.getElementById('gc-download').onclick = exportRekapCSV;
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

		if (type !== 'error') {
		  logBox.innerHTML = '';
		}
		
	  logBox.appendChild(line);
	}

  function updateDashboard(current = 0, timer = '') {
	  const kecEl = document.getElementById('gc-kec');
	  //const totalEl = document.getElementById('gc-total');
	  //const currentEl = document.getElementById('gc-current');
	  const timerEl = document.getElementById('gc-timer');

	  if (kecEl) kecEl.textContent = `Kecamatan: ${KODE_KECAMATAN}`;
	  //if (totalEl) totalEl.textContent = `Eligible: ${rows.length}`;
	  //if (currentEl) currentEl.textContent = `Progress: ${current}/${rows.length}`;
	  if (timerEl) timerEl.textContent = timer;
	}

	function updateStat() {//update statistik jumlah sukses dan gagal
	  document.getElementById('gc-stat').innerHTML =
		`<span style="color: #0f0;">Sukses: <strong>${statSuccess}</strong></span> | 
		<span style="color: red;">Gagal: <strong>${statFailed}</strong></span>`;
	}

	function updateSpeed(processed) {
	  if (processed === 0) return;

	  const elapsedMs = Date.now() - startTime;
	  const avgMs = elapsedMs / processed;

	  let text;
	  if (avgMs >= 1000 * 60 * 60) {
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

  async function processUsahaCard() {
    
    try {
		
		  const toggle_filter = document.querySelector('#toggle-filter');

			if (toggle_filter && !isElementShowing('#filter-body', 'show')) {//buka filter cari sbr
			  toggle_filter.scrollIntoView({ block: 'center' });
			  toggle_filter.focus();
			  await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
			  toggle_filter.click();
			}
			await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));

		  const f_kecamatan = document.querySelector('#f_kecamatan');
		  if (f_kecamatan) {//pilih kecamatan
			  f_kecamatan.scrollIntoView({ block: 'center' });
			  f_kecamatan.focus();
			  await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
			  setKecamatanByKode(f_kecamatan, KODE_KECAMATAN);
			  NAMA_KECAMATAN = getNamaKecamatan(f_kecamatan);
			  console.log("Nama kecamatan:", NAMA_KECAMATAN);
			  //console.log('Kode Kec selected: ' + f_kecamatan.value);
			  //f_latlong.dispatchEvent(new Event('change', { bubbles: true }));
		  }

		  /*
		  const f_latlong = document.querySelector('#f_latlong');
		  if (f_latlong) {//hanya usaha yang sudah ada latitude dan longitudenya
			  f_latlong.scrollIntoView({ block: 'center' });
			  f_latlong.focus();
			  await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
			  f_latlong.value = "ADA";
			  //f_latlong.dispatchEvent(new Event('change', { bubbles: true }));
		  }
		  */
		  //await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
	  
		  const f_gc = document.querySelector('#f_gc');
		  if (f_gc) {//hanya usaha yang belum di gc
			  f_gc.scrollIntoView({ block: 'center' });
			  f_gc.focus();
			  await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
			  f_gc.value = "BELUM";
			  //f_gc.dispatchEvent(new Event('change', { bubbles: true }));
		  }	  
		  //await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
		
		  const btn_filter = document.querySelector('#apply-filter-btn');
		
			if (btn_filter) {//klik button filter
			  btn_filter.scrollIntoView({ block: 'center' });
			  btn_filter.focus();
			  await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
			  btn_filter.click();
			}
			await sleep(50);

			// tunggu sampai spinner HILANG
			await waitForBlockUIFinishMO();
			
			if (toggle_filter && isElementShowing('#filter-body', 'show')) {//tutup filter cari sbr
			  toggle_filter.scrollIntoView({ block: 'center' });
			  toggle_filter.focus();
			  await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
			  toggle_filter.click();
			}
			await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
			
			const card = await cariUsahaValidDenganLoadMore();//usaha-card terpilih
			
			if (card) {
				
			  card.scrollIntoView({ block: 'center' });
			  card.focus();
			  await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
			  
			  const header = card.querySelector('.usaha-card-header');

			  if (header && !card.classList.contains('expanded')) {
				  header.click();
				  await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
			  }
  
			  const btn_tandai = card.querySelector('.btn-tandai');
			  
				if (btn_tandai) {//klik tandai di usaha-card terpilih
				  btn_tandai.scrollIntoView({ block: 'center' });
				  btn_tandai.focus();
				  await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));
				  btn_tandai.click();
				}
				await sleep(randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX));

				  console.log('[STEP] Isi hasil GC');
				  const select = await waitForSelector('#tt_hasil_gc');
				  
				  const statusCode = getUsahaStatus(card);
					if (![1,3,4,99].includes(statusCode)) {
					  throw new Error('Status tidak dikenal: ' + statusCode);
					}

					select.value = String(statusCode);
					select.dispatchEvent(new Event('change', { bubbles: true }));
					
					// ambil element sekali saja
					const latEl = await waitForSelector('#tt_latitude_cek_user');
					const lonEl = await waitForSelector('#tt_longitude_cek_user');

					const latitude = latEl.value?.trim();
					const longitude = lonEl.value?.trim();
					
					if(!latitude || !longitude){

						const alamat_usaha_raw = (await waitForSelector('#tt_alamat_usaha_gc')).value?.trim();
						const alamat_usaha = normalizeAlamat(alamat_usaha_raw);

						const {provinsi, kabupaten} = getWilayahGC();

						const queries = [
							`${alamat_usaha}, ${NAMA_KECAMATAN}, ${kabupaten}, ${provinsi}, Indonesia`,
							`${NAMA_KECAMATAN}, ${kabupaten}, ${provinsi}, Indonesia`
						];

						let coord = null;

						for(const q of queries){
							console.log("Geocode:", q);

							coord = await getLatitudeLongitude(q);

							if(coord && coord.latitude && coord.longitude){
								console.log("SUCCESS:", coord.latitude, coord.longitude);
								break;
							}
						}

						if(coord){
							
							let lat = parseFloat(coord.latitude);
							let lon = parseFloat(coord.longitude);

							const finalCoord = findFreeCoordinate(lat, lon);

							const finalLatitude = finalCoord.latitude.toFixed(7);
							const finalLongitude = finalCoord.longitude.toFixed(7);
							
							latEl.value = finalLatitude;
							lonEl.value = finalLongitude;
							
							console.log("NEW KOORDINAT:", finalLatitude, finalLongitude);
							
						}else{
							console.log('[WARN] Semua level geocode gagal');
						}
					}
					/*
					if(!latitude || !longitude){
						
						const nama_usaha   = (await waitForSelector('#tt_nama_usaha_gc')).value?.trim();
						const alamat_usaha = (await waitForSelector('#tt_alamat_usaha_gc')).value?.trim();
						
						const {provinsi, kabupaten} = getWilayahGC();

						let alamatLengkap =
							nama_usaha + ", "+
							alamat_usaha + ", "+
							NAMA_KECAMATAN + ", " +
							kabupaten + ", " +
							provinsi + ", Indonesia";
						
						console.log('Alamat lengkap: ' + alamatLengkap);
						
						let coord = await getLatitudeLongitude(alamatLengkap);
						if(coord){
							console.log('Lat: ' + coord.latitude + ' Long: ' + coord.longitude);
							
							console.log('[STEP] Isi koordinat');
							// isi value
							latEl.value = coord.latitude;
							lonEl.value = coord.longitude;
						}else{
							alamatLengkap =
								alamat_usaha + ", "+
								NAMA_KECAMATAN + ", " +
								kabupaten + ", " +
								provinsi + ", Indonesia";
							
							coord = await getLatitudeLongitude(alamatLengkap);
							if(coord){
								console.log('Lat: ' + coord.latitude + ' Long: ' + coord.longitude);
								
								console.log('[STEP] Isi koordinat');
								// isi value
								latEl.value = coord.latitude;
								lonEl.value = coord.longitude;
							}else{
								alamatLengkap =
									NAMA_KECAMATAN + ", " +
									kabupaten + ", " +
									provinsi + ", Indonesia";
								
								coord = await getLatitudeLongitude(alamatLengkap);
								if(coord){
									console.log('Lat: ' + coord.latitude + ' Long: ' + coord.longitude);
									
									console.log('[STEP] Isi koordinat');
									// isi value
									latEl.value = coord.latitude;
									lonEl.value = coord.longitude;
								}else{
									console.log('[WARN] Geocode gagal, koordinat null');
								}
							}
						}
						
					}
					*/
				  delay = randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX);
				  console.log(`[DELAY] Tunggu sebelum klik SIMPAN ${delay} ms`);
				  await sleep(delay);

				  console.log('[STEP] Simpan data (dengan retry)');
				  await saveWithRetry(3);

				  delay = randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX);
				  console.log(`[DELAY] Tunggu sebelum klik OK ${delay} ms`);
				  await sleep(delay);

				  console.log('[STEP] Klik OK sukses');
				  (await waitForSelector('.swal2-confirm', 60000)).click();

				  console.log('[SUCCESS] IDSBR berhasil');
				  
				  const idsbr = getIDSBR(card);
					if (!idsbr) {
					  throw new Error('IDSBR kosong, gagal disimpan ke cache');
					}

					gcCache.add(idsbr);
					saveGCCache(gcCache);

				  failedAttempt = 0;
				  statSuccess++;

				  delay = randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX);
				  console.log(`[DELAY] Tunggu ${delay} ms`);
				  await sleep(delay);

				  return { status: 'SUCCESS' };
			}

		throw new Error('Usaha-card valid tidak ditemukan');

    } catch (err) {

		if (err.message === 'Usaha-card valid tidak ditemukan') {
		  console.warn('[LOOP] Tidak ada usaha valid tersisa');
		  failedAttempt = 0;
		  return { status: 'NO_MORE_CARD' };
		}
	  
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
		  await terminateBot(
			'Terlalu banyak kegagalan berturut-turut, hentikan bot',
			true
		  );
		}

		return { status: 'RETRY_SAME_IDSBR' };
    }
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

	async function saveWithRetry(maxRetry = 3) {
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
			await sleep(10000);

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

	function getIDSBR(card) {
	  if (!card) return '';

	  const rows = card.querySelectorAll('.detail-row');

	  for (const row of rows) {
		const label = row.querySelector('.detail-label')?.textContent?.trim();
		if (label === '#IDSBR') {
		  return row.querySelector('.detail-value')?.textContent?.trim() || '';
		}
	  }

	  return '';
	}

	function getUsahaStatus(card) {
	  const el = card.querySelector('.usaha-status');
	  if (!el) return 99;

	  const text = el.textContent.trim().toLowerCase();

	  if (text.includes('duplikat')) return 4;
	  if (text.includes('tutup')) return 3;
	  if (text.includes('aktif pindah')) return 1;
	  if (text.includes('aktif')) return 1;

	  return 99;
	}

	function isDuplikat(card) {
	  const text = card.querySelector('.usaha-status')
		?.textContent
		?.trim()
		.toLowerCase();

	  return text === 'duplikat';
	}

	function getUsahaCardValidPertama() {
	  const cards = document.querySelectorAll('.usaha-card');

	  for (const card of cards) {
		if (!isDuplikat(card)) return card;
	  }

	  return null;
	}

	function waitForBlockUIFinishMO(timeout = 30000) {
	  return new Promise((resolve, reject) => {
		const start = Date.now();

		if (!document.querySelector('.blockUI.blockPage')) {
		  return resolve(true);
		}

		const observer = new MutationObserver(() => {
		  if (!document.querySelector('.blockUI.blockPage')) {
			observer.disconnect();
			resolve(true);
		  }

		  if (Date.now() - start > timeout) {
			observer.disconnect();
			reject(new Error('Timeout menunggu BlockUI'));
		  }
		});

		observer.observe(document.body, {
		  childList: true,
		  subtree: true
		});
	  });
	}

	async function cariUsahaValidDenganLoadMore(maxLoad = 10) {
	  for (let i = 0; i < maxLoad; i++) {
		const card = getUsahaCardValidPertama();
		if (card) return card;

		const btnLoad = document.querySelector('#load-more-btn');
		if (!btnLoad || btnLoad.disabled) return null;

		const prevCount = document.querySelectorAll('.usaha-card').length;

		btnLoad.click();
		await waitForNewCard(prevCount);
		await sleep(500);
	  }

	  return null;
	}
	
	function waitForNewCard(prevCount, timeout = 20000) {
	  return new Promise((resolve, reject) => {
		const start = Date.now();

		const timer = setInterval(() => {
		  const nowCount = document.querySelectorAll('.usaha-card').length;

		  if (nowCount > prevCount) {
			clearInterval(timer);
			resolve(true);
		  }

		  if (Date.now() - start > timeout) {
			clearInterval(timer);
			reject(new Error('Load more tidak menambah card'));
		  }
		}, 150);
	  });
	}

  /* ===================== POST DATA SAAT MULAI ===================== */

	const user = getUserInfo();
	await logMulaiProses({
	  user,
	  fileName: csvFileName,
	  total: MAX_TOTAL_PROCESS
	});

	/* ===================== LOOP tiap IDSBR ===================== */

	console.log('[LOOP] Mulai processing');
	
	startKeepAliveVideo();//play video youtube supaya layar tetap on

	let processed = 0;

	while (true) {
	  updateDashboard(processed + 1);
	  updateStat();
	  updateSpeed(processed + 1);
	  updateElapsedTime();

	  const result = await processUsahaCard();

	  if (!result) {
		console.warn('[LOOP] processUsahaCard tidak mengembalikan status');
		break;
	  }

	  if (result.status === 'NO_MORE_CARD') {
		console.log('[LOOP] Semua usaha valid telah diproses');
			
		break; // ⛔ STOP LOOP
	  }

	  if (result.status === 'RETRY_SAME_IDSBR') {
		console.warn('[LOOP] Retry usaha yang sama');
		continue; // 🔁 ulangi tanpa increment
	  }

	  if (result.status === 'SUCCESS') {
		  processed++;

		  // 🔁 Kirim log setiap 20 IDSBR sukses
		  if (processed % 20 === 0) {
			console.log(`[GC] Auto-log progress: ${processed} IDSBR`);
			try {
			  await logSelesaiProses({
				sukses: statSuccess,
				gagal: statFailed,
				total: MAX_TOTAL_PROCESS
			  });
			} catch (e) {
			  console.warn('[GC] Gagal kirim progress:', e.message);
			}
		  }
		}

		if (processed >= MAX_TOTAL_PROCESS) {
		  console.warn('[SAFEGUARD] Maksimum proses tercapai, stop');
		  break;
		}

	  const delay = randomDelay(TOTAL_DELAY_MIN, TOTAL_DELAY_MAX);
	  console.log(`[LOOP] Delay ${delay} ms`);
	  await sleep(delay);
	}

	/* ===================== POST DATA SAAT SELESAI ===================== */

	await logSelesaiProses({
	  sukses: statSuccess,
	  gagal: statFailed,
	  total: MAX_TOTAL_PROCESS
	});

	console.log('[DONE] Semua proses selesai');

	const totalMs = Date.now() - startTime;

	document.getElementById('gc-elapsed').textContent =
	  `Total durasi: ${formatDuration(totalMs)}`;
	
	await terminateBot('Semua proses selesai');

})();
