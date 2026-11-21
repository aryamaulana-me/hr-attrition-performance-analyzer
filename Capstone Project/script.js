/* ============================================================
   script.js — HR Attrition & Performance Analyzer
   Mengambil data dari CSV, memproses filter, menghitung KPI,
   merender chart, dan menghasilkan ringkasan temuan dinamis.
   ============================================================ */

'use strict';

// ----------------------------------------------------------------
// 1. KONSTANTA & STATE GLOBAL
// ----------------------------------------------------------------

/** Path ke file CSV relatif terhadap index.html */
const CSV_PATH = 'WA_Fn-UseC_-HR-Employee-Attrition.csv';

/** Palet warna konsisten di seluruh chart */
const COLORS = {
  blue:    '#3b82f6',
  red:     '#ef4444',
  green:   '#10b981',
  amber:   '#f59e0b',
  purple:  '#8b5cf6',
  teal:    '#14b8a6',
  rose:    '#f43f5e',
  indigo:  '#6366f1',
  blueLight:  'rgba(59,130,246,0.15)',
  redLight:   'rgba(239,68,68,0.15)',
  greenLight: 'rgba(16,185,129,0.15)',
  amberLight: 'rgba(245,158,11,0.15)',
};

/** Dataset lengkap (tidak pernah dimodifikasi setelah load) */
let allData = [];

/** Instance Chart.js — disimpan agar bisa di-destroy saat update */
const charts = {};

// ----------------------------------------------------------------
// 2. UTILITAS
// ----------------------------------------------------------------

/**
 * Menghitung rata-rata numerik dari sebuah array angka.
 * @param {number[]} arr
 * @returns {number}
 */
function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * Memformat angka sebagai mata uang USD tanpa desimal.
 * @param {number} val
 * @returns {string}
 */
function formatUSD(val) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  }).format(val);
}

/**
 * Memformat angka sebagai persentase dengan satu desimal.
 * @param {number} val 0–100
 * @returns {string}
 */
function formatPct(val) {
  return val.toFixed(1) + '%';
}

/**
 * Mengembalikan array nilai unik (sorted) dari sebuah field.
 * @param {Object[]} data
 * @param {string} field
 * @returns {string[]}
 */
function uniqueValues(data, field) {
  return [...new Set(data.map(r => r[field]))].filter(Boolean).sort();
}

/**
 * Mengganti instance Chart.js lama dan membuat yang baru.
 * @param {string} id  id canvas
 * @param {Object} cfg konfigurasi Chart.js
 */
function renderChart(id, cfg) {
  if (charts[id]) {
    charts[id].destroy();
  }
  const ctx = document.getElementById(id);
  if (!ctx) return;
  charts[id] = new Chart(ctx.getContext('2d'), cfg);
}

/** Fade-animate elemen KPI saat update */
function animateKPI(el) {
  el.style.opacity = '0';
  setTimeout(() => { el.style.opacity = '1'; }, 150);
}

// ----------------------------------------------------------------
// 3. LOAD & PARSE CSV
// ----------------------------------------------------------------

/**
 * Memuat dan mem-parsing CSV menggunakan PapaParse.
 * Setelah selesai memanggil init().
 */
function loadCSV() {
  Papa.parse(CSV_PATH, {
    download: true,
    header: true,          // baris pertama sebagai key
    skipEmptyLines: true,
    dynamicTyping: true,   // angka otomatis dikonversi
    // Hapus BOM dan spasi dari nama kolom
    transformHeader: (h) => h.replace(/^\uFEFF/, '').trim(),
    complete: (results) => {
      allData = results.data;
      init();
    },
    error: (err) => {
      console.error('Gagal memuat CSV:', err);
      showError('Tidak dapat memuat file CSV. Pastikan file WA_Fn-UseC_-HR-Employee-Attrition.csv ada di direktori yang sama.');
    }
  });
}

/** Menampilkan pesan error di halaman */
function showError(msg) {
  document.getElementById('loading-indicator').innerHTML =
    `<span class="text-red-300 text-sm">⚠ ${msg}</span>`;
}

// ----------------------------------------------------------------
// 4. INISIALISASI (dipanggil setelah data siap)
// ----------------------------------------------------------------

function init() {
  // Sembunyikan loading, tampilkan badge sukses
  document.getElementById('loading-indicator').classList.add('hidden');
  const badge = document.getElementById('data-loaded-badge');
  badge.classList.remove('hidden');
  badge.classList.add('flex');

  // Total count
  document.getElementById('total-count').textContent = allData.length;

  // Isi dropdown filter
  populateFilters();

  // Pasang event listener pada setiap filter
  ['filter-department', 'filter-jobrole', 'filter-overtime', 'filter-travel'].forEach(id => {
    document.getElementById(id).addEventListener('change', onFilterChange);
  });

  // Tombol reset
  document.getElementById('reset-filters').addEventListener('click', resetFilters);

  // Render pertama kali dengan semua data
  updateDashboard(allData);
}

// ----------------------------------------------------------------
// 5. FILTER
// ----------------------------------------------------------------

/**
 * Mengisi dropdown filter statis (Department, BusinessTravel).
 * JobRole diisi secara cascading oleh updateJobRoleDropdown().
 */
function populateFilters() {
  fillSelect('filter-department', uniqueValues(allData, 'Department'));
  fillSelect('filter-travel',     uniqueValues(allData, 'BusinessTravel'));
  // Isi JobRole awal dengan semua nilai unik (tidak ada Department yang dipilih)
  updateJobRoleDropdown('all');
}

/**
 * Menambahkan <option> ke elemen <select>.
 * Menghapus semua opsi yang ada (kecuali "Semua") sebelum mengisinya ulang.
 * @param {string} selectId
 * @param {string[]} values
 */
function fillSelect(selectId, values) {
  const sel = document.getElementById(selectId);
  values.forEach(val => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val.replace(/_/g, ' ');
    sel.appendChild(opt);
  });
}

/**
 * Memperbarui opsi dropdown Job Role secara cascading berdasarkan Department.
 * Jika Department === 'all', tampilkan semua Job Role unik dari seluruh dataset.
 * Jika tidak, tampilkan hanya Job Role yang ada pada Department tersebut.
 * Jika nilai yang sebelumnya dipilih tidak lagi tersedia, reset ke 'all'.
 * @param {string} selectedDept  Nilai Department yang sedang aktif ('all' atau nama dept)
 */
function updateJobRoleDropdown(selectedDept) {
  const sel = document.getElementById('filter-jobrole');
  const prevValue = sel.value; // simpan pilihan sebelumnya

  // Tentukan pool data yang relevan
  const pool = selectedDept === 'all'
    ? allData
    : allData.filter(r => r.Department === selectedDept);

  const roles = uniqueValues(pool, 'JobRole');

  // Rebuild opsi: pertahankan "Semua" lalu tambahkan opsi baru
  sel.innerHTML = '<option value="all">Semua</option>';
  roles.forEach(val => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val.replace(/_/g, ' ');
    sel.appendChild(opt);
  });

  // Jika nilai lama masih tersedia di Department baru, pertahankan; jika tidak, reset
  sel.value = roles.includes(prevValue) ? prevValue : 'all';
}

/** Mengambil nilai filter aktif dari semua dropdown */
function getFilters() {
  return {
    department: document.getElementById('filter-department').value,
    jobRole:    document.getElementById('filter-jobrole').value,
    overtime:   document.getElementById('filter-overtime').value,
    travel:     document.getElementById('filter-travel').value,
  };
}

/** Menerapkan filter ke dataset lengkap dan mengembalikan subset */
function applyFilters(filters) {
  return allData.filter(row => {
    if (filters.department !== 'all' && row.Department     !== filters.department) return false;
    if (filters.jobRole    !== 'all' && row.JobRole        !== filters.jobRole)    return false;
    if (filters.overtime   !== 'all' && row.OverTime       !== filters.overtime)   return false;
    if (filters.travel     !== 'all' && row.BusinessTravel !== filters.travel)     return false;
    return true;
  });
}

/** Handler saat salah satu filter berubah */
function onFilterChange(event) {
  // Jika Department berubah, perbarui dulu opsi Job Role secara cascading
  if (event.target.id === 'filter-department') {
    updateJobRoleDropdown(event.target.value);
  }
  const filtered = applyFilters(getFilters());
  updateDashboard(filtered);
}

/** Reset semua filter ke nilai default */
function resetFilters() {
  document.getElementById('filter-department').value = 'all';
  document.getElementById('filter-overtime').value   = 'all';
  document.getElementById('filter-travel').value     = 'all';
  // Rebuild JobRole dropdown kembali ke semua nilai, lalu reset ke 'all'
  updateJobRoleDropdown('all');
  updateDashboard(allData);
}

// ----------------------------------------------------------------
// 6. UPDATE DASHBOARD (orkestrasi utama)
// ----------------------------------------------------------------

/**
 * Memperbarui seluruh dashboard — KPI, chart, dan findings —
 * berdasarkan dataset yang sudah difilter.
 * @param {Object[]} data
 */
function updateDashboard(data) {
  document.getElementById('filtered-count').textContent = data.length;

  updateKPIs(data);
  renderAttritionByDept(data);
  renderAttritionByOvertime(data);
  renderIncomeByJobRole(data);
  renderIncomeByAttrition(data);
  renderSatisfactionByDept(data);
  renderFindings(data);
}

// ----------------------------------------------------------------
// 7. KPI CARDS
// ----------------------------------------------------------------

function updateKPIs(data) {
  const total      = data.length;
  const attrYes    = data.filter(r => r.Attrition === 'Yes').length;
  const attrPct    = total ? (attrYes / total) * 100 : 0;
  const avgIncome  = avg(data.map(r => Number(r.MonthlyIncome)));
  const otCnt      = data.filter(r => r.OverTime === 'Yes').length;
  const otPct      = total ? (otCnt / total) * 100 : 0;

  const elTotal  = document.getElementById('kpi-total');
  const elAttr   = document.getElementById('kpi-attrition');
  const elIncome = document.getElementById('kpi-income');
  const elOT     = document.getElementById('kpi-overtime');

  [elTotal, elAttr, elIncome, elOT].forEach(animateKPI);

  elTotal.textContent  = total.toLocaleString('id-ID');
  elAttr.textContent   = formatPct(attrPct);
  elIncome.textContent = formatUSD(avgIncome);
  elOT.textContent     = formatPct(otPct);

  document.getElementById('kpi-attrition-sub').textContent = `${attrYes.toLocaleString('id-ID')} karyawan keluar`;
  document.getElementById('kpi-overtime-sub').textContent  = `${otCnt.toLocaleString('id-ID')} bekerja lembur`;
}

// ----------------------------------------------------------------
// 8. CHART 1 — ATTRITION PER DEPARTMENT
// ----------------------------------------------------------------

function renderAttritionByDept(data) {
  // Hitung jumlah Yes/No per departemen
  const depts = uniqueValues(data, 'Department');
  const yesArr = depts.map(d => data.filter(r => r.Department === d && r.Attrition === 'Yes').length);
  const noArr  = depts.map(d => data.filter(r => r.Department === d && r.Attrition === 'No').length);

  renderChart('chart-attrition-dept', {
    type: 'bar',
    data: {
      labels: depts,
      datasets: [
        {
          label: 'Keluar (Attrition)',
          data: yesArr,
          backgroundColor: COLORS.red,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Tetap',
          data: noArr,
          backgroundColor: COLORS.blue,
          borderRadius: 6,
          borderSkipped: false,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y} orang`
          }
        }
      },
      scales: {
        x: { stacked: false, grid: { display: false } },
        y: { beginAtZero: true, grid: { color: '#f1f5f9' } }
      }
    }
  });
}

// ----------------------------------------------------------------
// 9. CHART 2 — ATTRITION RATE BERDASARKAN OVERTIME
// ----------------------------------------------------------------

function renderAttritionByOvertime(data) {
  const container = document.getElementById('overtime-chart-container');
  const canvasId  = 'chart-attrition-overtime';

  // Hitung statistik per grup OverTime
  const otGroups = ['Yes', 'No'];
  const labels   = ['OverTime: Ya', 'OverTime: Tidak'];

  const stats = otGroups.map(ot => {
    const group  = data.filter(r => r.OverTime === ot);
    const attrCnt = group.filter(r => r.Attrition === 'Yes').length;
    const rate    = group.length ? parseFloat(((attrCnt / group.length) * 100).toFixed(1)) : 0;
    return { ot, label: ot === 'Yes' ? 'OverTime: Ya' : 'OverTime: Tidak', group: group.length, attrCnt, rate };
  });

  const totalAttrition = stats.reduce((s, st) => s + st.attrCnt, 0);

  // Destroy instance lama agar tidak ada duplikasi
  if (charts[canvasId]) {
    charts[canvasId].destroy();
    delete charts[canvasId];
  }

  // ── KONDISI ZERO-ATTRITION: tampilkan pesan info, sembunyikan canvas ──
  if (totalAttrition === 0) {
    // Susun detail sampel per kategori
    const detailRows = stats
      .map(st => `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
          <span class="w-2 h-2 rounded-full inline-block" style="background:${st.ot === 'Yes' ? '#f43f5e' : '#14b8a6'}"></span>
          ${st.label}: <strong>${st.group} karyawan</strong> · 0 keluar (0.0%)
        </span>`)
      .join('');

    container.innerHTML = `
      <div class="flex flex-col items-center justify-center h-full gap-3 py-6 text-center">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-3-3v6m9-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <p class="text-sm font-semibold text-slate-500">Tidak ada kasus attrition pada filter ini</p>
        <p class="text-xs text-slate-400 max-w-xs leading-relaxed">
          Attrition Rate: <strong>0.0%</strong> pada OverTime Ya maupun Tidak.<br>
          Grafik tidak ditampilkan karena tidak ada karyawan yang keluar.
        </p>
        <div class="flex flex-wrap justify-center gap-2 mt-1">${detailRows}</div>
      </div>`;
    return;
  }

  // ── DATA TERSEDIA: rebuild canvas (jika sebelumnya diisi pesan info) & render chart ──
  // Pastikan canvas ada di dalam container; jika diganti innerHTML sebelumnya, buat ulang
  if (!container.querySelector('canvas')) {
    container.innerHTML = `<canvas id="${canvasId}"></canvas>`;
  }

  charts[canvasId] = new Chart(
    document.getElementById(canvasId).getContext('2d'),
    {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: stats.map(st => st.rate),
          backgroundColor: [COLORS.rose, COLORS.teal],
          hoverOffset: 10,
          borderWidth: 2,
          borderColor: '#ffffff',
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const st = stats[ctx.dataIndex];
                return ` ${ctx.label}: ${st.rate}% (${st.attrCnt} dari ${st.group} karyawan)`;
              }
            }
          }
        }
      }
    }
  );
}

// ----------------------------------------------------------------
// 10. CHART 3 — RATA-RATA INCOME PER JOB ROLE
// ----------------------------------------------------------------

function renderIncomeByJobRole(data) {
  const roles   = uniqueValues(data, 'JobRole');
  const incomes = roles.map(role => {
    const incArr = data.filter(r => r.JobRole === role).map(r => Number(r.MonthlyIncome));
    return Math.round(avg(incArr));
  });

  // Urutkan dari tertinggi ke terendah untuk kemudahan baca
  const sorted = roles
    .map((r, i) => ({ role: r, income: incomes[i] }))
    .sort((a, b) => b.income - a.income);

  renderChart('chart-income-jobrole', {
    type: 'bar',
    data: {
      labels: sorted.map(s => s.role),
      datasets: [{
        label: 'Rata-Rata MonthlyIncome (USD)',
        data: sorted.map(s => s.income),
        backgroundColor: sorted.map((_, i) =>
          `hsl(${220 + i * 15}, 75%, ${55 + i * 2}%)`
        ),
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      indexAxis: 'y',  // horizontal bar
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${formatUSD(ctx.parsed.x)}`
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: '#f1f5f9' },
          ticks: {
            callback: val => '$' + (val / 1000).toFixed(0) + 'K'
          }
        },
        y: { grid: { display: false } }
      }
    }
  });
}

// ----------------------------------------------------------------
// 11. CHART 4 — SEBARAN INCOME BERDASARKAN STATUS ATTRITION
// ----------------------------------------------------------------

function renderIncomeByAttrition(data) {
  // Hitung rata-rata income untuk tiap department × attrition status
  const depts   = uniqueValues(data, 'Department');
  const yesInc  = depts.map(d => {
    const vals = data.filter(r => r.Department === d && r.Attrition === 'Yes').map(r => Number(r.MonthlyIncome));
    return vals.length ? Math.round(avg(vals)) : 0;
  });
  const noInc   = depts.map(d => {
    const vals = data.filter(r => r.Department === d && r.Attrition === 'No').map(r => Number(r.MonthlyIncome));
    return vals.length ? Math.round(avg(vals)) : 0;
  });

  renderChart('chart-income-attrition', {
    type: 'bar',
    data: {
      labels: depts,
      datasets: [
        {
          label: 'Keluar (Attrition)',
          data: yesInc,
          backgroundColor: COLORS.red,
          borderRadius: 6,
          borderSkipped: false,
        },
        {
          label: 'Tetap',
          data: noInc,
          backgroundColor: COLORS.green,
          borderRadius: 6,
          borderSkipped: false,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${formatUSD(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          beginAtZero: true,
          grid: { color: '#f1f5f9' },
          ticks: { callback: val => '$' + (val / 1000).toFixed(0) + 'K' }
        }
      }
    }
  });
}

// ----------------------------------------------------------------
// 12. CHART 5 — JOB SATISFACTION & WORK-LIFE BALANCE PER DEPT
// ----------------------------------------------------------------

function renderSatisfactionByDept(data) {
  const depts  = uniqueValues(data, 'Department');
  const jsArr  = depts.map(d => {
    const vals = data.filter(r => r.Department === d).map(r => Number(r.JobSatisfaction));
    return parseFloat(avg(vals).toFixed(2));
  });
  const wlbArr = depts.map(d => {
    const vals = data.filter(r => r.Department === d).map(r => Number(r.WorkLifeBalance));
    return parseFloat(avg(vals).toFixed(2));
  });

  renderChart('chart-satisfaction-dept', {
    type: 'radar',
    data: {
      labels: depts,
      datasets: [
        {
          label: 'JobSatisfaction (avg)',
          data: jsArr,
          backgroundColor: 'rgba(59,130,246,0.15)',
          borderColor: COLORS.blue,
          pointBackgroundColor: COLORS.blue,
          borderWidth: 2,
          pointRadius: 4,
        },
        {
          label: 'WorkLifeBalance (avg)',
          data: wlbArr,
          backgroundColor: 'rgba(16,185,129,0.15)',
          borderColor: COLORS.green,
          pointBackgroundColor: COLORS.green,
          borderWidth: 2,
          pointRadius: 4,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.r}`
          }
        }
      },
      scales: {
        r: {
          beginAtZero: true,
          min: 0,
          max: 4,
          ticks: { stepSize: 1, font: { size: 10 }, backdropColor: 'transparent' },
          grid: { color: '#e2e8f0' },
          pointLabels: { font: { size: 11 } }
        }
      }
    }
  });
}

// ----------------------------------------------------------------
// 13. RINGKASAN TEMUAN & REKOMENDASI (DINAMIS)
// ----------------------------------------------------------------

/**
 * Membangun panel "Ringkasan Temuan & Rekomendasi" berdasarkan
 * metrik yang dihitung dari data yang sedang aktif.
 * @param {Object[]} data
 */
function renderFindings(data) {
  const container = document.getElementById('findings-container');
  container.innerHTML = '';

  if (!data.length) {
    container.innerHTML = '<p class="text-slate-400 text-sm col-span-2">Tidak ada data untuk filter yang dipilih.</p>';
    return;
  }

  const findings = computeFindings(data);
  findings.forEach(f => {
    container.insertAdjacentHTML('beforeend', buildFindingCard(f));
  });
}

/**
 * Menghitung temuan dan rekomendasi dari data.
 * @param {Object[]} data
 * @returns {Array<{type,title,body,rec}>}
 */
function computeFindings(data) {
  const total     = data.length;
  const attrYes   = data.filter(r => r.Attrition === 'Yes').length;
  const attrRate  = total ? (attrYes / total) * 100 : 0;

  // Overtime attrition rate
  const otYesGroup = data.filter(r => r.OverTime === 'Yes');
  const otYesAttr  = otYesGroup.filter(r => r.Attrition === 'Yes').length;
  const otAttrRate = otYesGroup.length ? (otYesAttr / otYesGroup.length) * 100 : 0;

  // Department dengan attrition tertinggi
  const depts = uniqueValues(data, 'Department');
  const deptRates = depts.map(d => {
    const grp = data.filter(r => r.Department === d);
    const yes = grp.filter(r => r.Attrition === 'Yes').length;
    return { dept: d, rate: grp.length ? (yes / grp.length) * 100 : 0, total: grp.length };
  });
  const topDept = deptRates.sort((a, b) => b.rate - a.rate)[0];

  // Rata-rata income karyawan keluar vs tetap
  const incAttrYes = avg(data.filter(r => r.Attrition === 'Yes').map(r => Number(r.MonthlyIncome)));
  const incAttrNo  = avg(data.filter(r => r.Attrition === 'No').map(r => Number(r.MonthlyIncome)));
  const incomeDiff = incAttrNo - incAttrYes;
  const incomeDiffPct = incAttrNo > 0 ? (incomeDiff / incAttrNo) * 100 : 0;

  // Rata-rata JobSatisfaction seluruh data terfilter
  const avgJS  = avg(data.map(r => Number(r.JobSatisfaction)));
  const avgWLB = avg(data.map(r => Number(r.WorkLifeBalance)));

  // Role dengan income terendah
  const roles = uniqueValues(data, 'JobRole');
  const roleIncs = roles.map(role => {
    const incs = data.filter(r => r.JobRole === role).map(r => Number(r.MonthlyIncome));
    return { role, income: avg(incs) };
  }).sort((a, b) => a.income - b.income);
  const lowestRole = roleIncs[0];

  // Pct OverTime di seluruh data terfilter
  const otPct = total ? (data.filter(r => r.OverTime === 'Yes').length / total) * 100 : 0;

  // ---- Susun findings ----
  const findings = [];

  // Finding 1: Overall attrition
  findings.push({
    type: attrRate > 20 ? 'danger' : attrRate > 10 ? 'warning' : 'success',
    title: 'Tingkat Attrition Keseluruhan',
    body: `Dari <strong>${total.toLocaleString('id-ID')}</strong> karyawan dalam seleksi aktif, sebanyak <strong>${attrYes}</strong> orang telah meninggalkan perusahaan, menghasilkan tingkat attrition <strong>${formatPct(attrRate)}</strong>.${
      attrRate > 20
        ? ' Angka ini <strong>di atas ambang kritis 20%</strong>, memerlukan perhatian segera.'
        : attrRate > 10
        ? ' Angka ini di atas rata-rata industri (10%) dan perlu diwaspadai.'
        : ' Angka ini masih dalam batas sehat (<10%).'
    }`,
    rec: attrRate > 15
      ? '💡 Rekomendasi: Lakukan stay interview pada karyawan berpotensi tinggi dan tinjau program retensi secara berkala.'
      : '💡 Rekomendasi: Pertahankan program keterlibatan karyawan dan lakukan pulse survey berkala.'
  });

  // Finding 2: OverTime & Attrition
  if (otYesGroup.length > 0) {
    findings.push({
      type: otAttrRate > 25 ? 'danger' : otAttrRate > 15 ? 'warning' : 'info',
      title: 'Dampak OverTime terhadap Attrition',
      body: `Karyawan yang bekerja lembur (OverTime) memiliki tingkat attrition <strong>${formatPct(otAttrRate)}</strong>. ${
        otAttrRate > 25
          ? 'Ini menunjukkan tekanan kerja berlebih yang signifikan.'
          : otAttrRate > 15
          ? 'OverTime menjadi faktor risiko attrition yang perlu dikelola.'
          : 'OverTime tidak menunjukkan dampak attrition yang mengkhawatirkan saat ini.'
      } Saat ini <strong>${formatPct(otPct)}</strong> karyawan dalam filter aktif mengerjakan lembur.`,
      rec: otAttrRate > 20
        ? '💡 Rekomendasi: Tinjau beban kerja, pertimbangkan penambahan headcount atau redistribusi tugas di area dengan lembur tinggi.'
        : '💡 Rekomendasi: Pantau tren lembur bulanan dan pastikan kompensasi lembur kompetitif.'
    });
  }

  // Finding 3: Departemen dengan attrition tertinggi
  if (topDept && depts.length > 0) {
    findings.push({
      type: topDept.rate > 25 ? 'danger' : topDept.rate > 12 ? 'warning' : 'info',
      title: `Departemen Risiko Tinggi: ${topDept.dept}`,
      body: `Departemen <strong>${topDept.dept}</strong> mencatat tingkat attrition tertinggi sebesar <strong>${formatPct(topDept.rate)}</strong> dari ${topDept.total} karyawan. ${
        topDept.rate > 25
          ? 'Ini merupakan sinyal darurat yang memerlukan intervensi segera.'
          : 'Perlu penyelidikan lebih lanjut terkait penyebab turnover di departemen ini.'
      }`,
      rec: `💡 Rekomendasi: Lakukan focus group discussion (FGD) dengan manajer dan karyawan di ${topDept.dept} untuk mengidentifikasi akar masalah attrition.`
    });
  }

  // Finding 4: Kesenjangan income
  if (attrYes > 0) {
    findings.push({
      type: incomeDiff > 2000 ? 'warning' : 'info',
      title: 'Kesenjangan Pendapatan: Keluar vs. Tetap',
      body: `Rata-rata MonthlyIncome karyawan yang keluar adalah <strong>${formatUSD(incAttrYes)}</strong>, sementara yang tetap adalah <strong>${formatUSD(incAttrNo)}</strong>. Selisih sebesar <strong>${formatUSD(incomeDiff)}</strong> (${formatPct(incomeDiffPct)}) mengindikasikan ${
        incomeDiff > 2000
          ? 'kompensasi menjadi faktor pendorong attrition yang signifikan.'
          : 'kompensasi bukan satu-satunya faktor penentu attrition.'
      }`,
      rec: incomeDiff > 2000
        ? '💡 Rekomendasi: Lakukan benchmarking gaji terhadap pasar dan pertimbangkan penyesuaian paket kompensasi untuk posisi berisiko tinggi.'
        : '💡 Rekomendasi: Eksplorasi faktor non-finansial seperti budaya kerja, pertumbuhan karir, dan fleksibilitas kerja.'
    });
  }

  // Finding 5: Job Satisfaction & Work-Life Balance
  findings.push({
    type: avgJS < 2.5 || avgWLB < 2.5 ? 'danger' : avgJS < 3 || avgWLB < 3 ? 'warning' : 'success',
    title: 'Kepuasan Kerja & Keseimbangan Hidup',
    body: `Rata-rata <strong>JobSatisfaction</strong> dalam filter aktif adalah <strong>${avgJS.toFixed(2)}/4</strong> dan <strong>WorkLifeBalance</strong> adalah <strong>${avgWLB.toFixed(2)}/4</strong>. ${
      avgJS < 2.5
        ? 'Tingkat kepuasan kerja rendah — ini berkorelasi kuat dengan peningkatan attrition.'
        : avgJS >= 3
        ? 'Tingkat kepuasan kerja cukup baik.'
        : 'Kepuasan kerja berada di level moderat, ada ruang perbaikan.'
    }`,
    rec: avgJS < 3 || avgWLB < 3
      ? '💡 Rekomendasi: Tingkatkan program employee well-being, fleksibilitas jadwal kerja, dan pengakuan prestasi karyawan.'
      : '💡 Rekomendasi: Pertahankan program keterlibatan karyawan dan lakukan review berkala terhadap beban kerja.'
  });

  // Finding 6: Job Role dengan income terendah
  if (lowestRole && roles.length > 1) {
    findings.push({
      type: lowestRole.income < 3000 ? 'warning' : 'info',
      title: `Perhatian: Income Terendah — ${lowestRole.role}`,
      body: `Posisi <strong>${lowestRole.role}</strong> memiliki rata-rata MonthlyIncome terendah yaitu <strong>${formatUSD(lowestRole.income)}</strong>. Posisi dengan kompensasi rendah cenderung memiliki risiko attrition lebih tinggi, terutama jika tidak disertai benefit non-finansial yang kompetitif.`,
      rec: `💡 Rekomendasi: Tinjau struktur kompensasi untuk ${lowestRole.role} dan pastikan ada jalur karir yang jelas serta insentif berbasis kinerja.`
    });
  }

  return findings;
}

/**
 * Membangun HTML string untuk satu finding card.
 * @param {{type, title, body, rec}} f
 * @returns {string}
 */
function buildFindingCard(f) {
  return `
    <div class="finding-card ${f.type}">
      <div class="fc-title">${f.title}</div>
      <div class="fc-body">${f.body}</div>
      <div class="fc-rec">${f.rec}</div>
    </div>
  `;
}

// ----------------------------------------------------------------
// 14. TITIK MASUK APLIKASI
// ----------------------------------------------------------------

// Mulai aplikasi saat DOM sudah siap
document.addEventListener('DOMContentLoaded', loadCSV);
