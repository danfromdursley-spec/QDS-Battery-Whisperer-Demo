// QDS Battery Whisperer Demo
// Synthetic pack simulator – illustrates impact of correlated noise.
// Not a calibrated battery tester.

let lifetimeChart;
let healthChart;

document.addEventListener("DOMContentLoaded", () => {
  attachSlider("nCells");
  attachSlider("maxCycles");
  attachSlider("baseDrain");
  attachSlider("noiseAmp");
  attachSlider("rho", (v) => Number(v).toFixed(2));
  attachSlider("failThresh");

  setupCharts();
  setupControls();
  resetDefaults();
});

function attachSlider(id, formatter) {
  const el = document.getElementById(id);
  const valEl = document.getElementById(id + "Val");
  const fmt =
    formatter ||
    ((v) => {
      const num = Number(v);
      return num % 1 === 0 ? num.toString() : num.toFixed(1);
    });

  const sync = () => {
    valEl.textContent = fmt(el.value);
  };

  el.addEventListener("input", sync);
  sync();
}

function setupControls() {
  document
    .getElementById("runLifetime")
    .addEventListener("click", simulateLifetime);

  document.getElementById("resetLifetime").addEventListener("click", () => {
    resetDefaults();
    simulateLifetime();
  });

  document
    .getElementById("ludicrousLifetime")
    .addEventListener("click", () => {
      const slider = document.getElementById("maxCycles");
      slider.value = 1200;
      slider.dispatchEvent(new Event("input"));
      simulateLifetime();
    });
}

function resetDefaults() {
  setSlider("nCells", 340);
  setSlider("maxCycles", 250);
  setSlider("baseDrain", 1.5);
  setSlider("noiseAmp", 2.0);
  setSlider("rho", 0.8);
  setSlider("failThresh", 0);
}

function setSlider(id, value) {
  const el = document.getElementById(id);
  el.value = value;
  el.dispatchEvent(new Event("input"));
}

function getParams() {
  return {
    nCells: Number(document.getElementById("nCells").value),
    maxCycles: Number(document.getElementById("maxCycles").value),
    baseDrain: Number(document.getElementById("baseDrain").value),
    noiseAmp: Number(document.getElementById("noiseAmp").value),
    rho: Number(document.getElementById("rho").value),
    failThresh: Number(document.getElementById("failThresh").value),
  };
}

function simulateLifetime() {
  const params = getParams();
  const result = runPackSimulation(params);

  updateStats(result);
  updateLifetimeChart(result);
  updateHealthChart(result);
}

// ---------- Simulation core ----------

function runPackSimulation(params) {
  const { nCells, maxCycles, baseDrain, noiseAmp, rho, failThresh } = params;

  const hoursPerCycle = 0.25;
  const lifetimesWhite = [];
  const lifetimesCorr = [];

  let sampleWhite = null;
  let sampleCorr = null;

  for (let i = 0; i < nCells; i++) {
    const record = i === 0;
    const white = simulateCell({
      maxCycles,
      baseDrain,
      noiseAmp,
      rho: 0,
      failThresh,
      recordSeries: record,
      hoursPerCycle,
    });
    const corr = simulateCell({
      maxCycles,
      baseDrain,
      noiseAmp,
      rho,
      failThresh,
      recordSeries: record,
      hoursPerCycle,
    });

    lifetimesWhite.push(white.cycles * hoursPerCycle);
    lifetimesCorr.push(corr.cycles * hoursPerCycle);

    if (record) {
      sampleWhite = white.series;
      sampleCorr = corr.series;
    }
  }

  const stats = computeSeriesStats(sampleCorr);

  const durationMedian =
    median(lifetimesCorr.length ? lifetimesCorr : lifetimesWhite) || 0;

  const earlyFailCount = lifetimesCorr.filter(
    (h) => h < 0.5 * durationMedian
  ).length;

  return {
    params,
    lifetimesWhite,
    lifetimesCorr,
    sampleWhite,
    sampleCorr,
    hoursPerCycle,
    durationMedian,
    earlyFailCount,
    stats,
  };
}

function simulateCell({
  maxCycles,
  baseDrain,
  noiseAmp,
  rho,
  failThresh,
  recordSeries,
  hoursPerCycle,
}) {
  let health = 100;
  let noiseState = 0;
  const series = [];
  let cycles = 0;
  let time = 0;

  for (let i = 0; i < maxCycles; i++) {
    const eps = gaussianRandom();
    noiseState = rho * noiseState + (1 - rho) * eps;
    const drain = Math.max(0, baseDrain + noiseAmp * noiseState);

    health -= drain;
    time += hoursPerCycle;
    cycles = i + 1;

    if (recordSeries) {
      series.push({ t: time, y: health });
    }

    if (health <= failThresh) break;
  }

  return { cycles, series: recordSeries ? series : null };
}

// Box–Muller Gaussian
let _gaussSpare = null;
function gaussianRandom() {
  if (_gaussSpare !== null) {
    const v = _gaussSpare;
    _gaussSpare = null;
    return v;
  }
  let u = 0,
    v = 0,
    s = 0;
  while (s === 0 || s >= 1) {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  }
  const mul = Math.sqrt((-2 * Math.log(s)) / s);
  _gaussSpare = v * mul;
  return u * mul;
}

// Compute residual RMS + lag-1 correlation for a series
function computeSeriesStats(series) {
  if (!series || series.length < 4) {
    return { rms: 0, k: 0 };
  }

  const n = series.length;
  const xs = series.map((p) => p.t);
  const ys = series.map((p) => p.y);

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    den += dx * dx;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;

  const residuals = ys.map((y, i) => y - (intercept + slope * xs[i]));

  const rms = Math.sqrt(
    residuals.reduce((s, r) => s + r * r, 0) / residuals.length
  );

  // Lag-1 correlation
  const r0 = residuals.slice(0, -1);
  const r1 = residuals.slice(1);

  const mean0 = r0.reduce((a, b) => a + b, 0) / r0.length;
  const mean1 = r1.reduce((a, b) => a + b, 0) / r1.length;

  let cov = 0,
    var0 = 0,
    var1 = 0;
  for (let i = 0; i < r0.length; i++) {
    const d0 = r0[i] - mean0;
    const d1 = r1[i] - mean1;
    cov += d0 * d1;
    var0 += d0 * d0;
    var1 += d1 * d1;
  }
  const k =
    var0 === 0 || var1 === 0 ? 0 : cov / Math.sqrt(var0 * var1);

  return { rms, k };
}

function median(arr) {
  if (!arr || !arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

// ---------- Charts ----------

function setupCharts() {
  Chart.defaults.color = "#e2e8ff";
  Chart.defaults.font.family =
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  const lifetimeCtx = document
    .getElementById("lifetimeChart")
    .getContext("2d");

  lifetimeChart = new Chart(lifetimeCtx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "White noise",
          data: [],
          borderWidth: 2,
          tension: 0.25,
          pointRadius: 0,
          borderColor: "#40b5ff",
        },
        {
          label: "QDS-style correlated",
          data: [],
          borderWidth: 2,
          tension: 0.25,
          pointRadius: 0,
          borderColor: "#00e6a8",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Cell index",
          },
          grid: { color: "rgba(255,255,255,0.04)" },
        },
        y: {
          title: {
            display: true,
            text: "Lifetime (hours)",
          },
          grid: { color: "rgba(255,255,255,0.04)" },
        },
      },
    },
  });

  const healthCtx = document.getElementById("healthChart").getContext("2d");
  healthChart = new Chart(healthCtx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "White noise",
          data: [],
          borderWidth: 2,
          tension: 0.25,
          pointRadius: 0,
          borderColor: "#40b5ff",
        },
        {
          label: "QDS-style correlated",
          data: [],
          borderWidth: 2,
          tension: 0.25,
          pointRadius: 0,
          borderColor: "#00e6a8",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Time (hours)",
          },
          grid: { color: "rgba(255,255,255,0.04)" },
        },
        y: {
          title: {
            display: true,
            text: "State of health (%)",
          },
          min: 0,
          max: 100,
          grid: { color: "rgba(255,255,255,0.04)" },
        },
      },
    },
  });
}

function updateLifetimeChart(result) {
  const { lifetimesWhite, lifetimesCorr } = result;
  const labels = lifetimesWhite.map((_, i) => i + 1);

  lifetimeChart.data.labels = labels;
  lifetimeChart.data.datasets[0].data = lifetimesWhite;
  lifetimeChart.data.datasets[1].data = lifetimesCorr;
  lifetimeChart.update();
}

function updateHealthChart(result) {
  const { sampleWhite, sampleCorr } = result;
  if (!sampleWhite || !sampleCorr) return;

  const maxLen = Math.max(sampleWhite.length, sampleCorr.length);
  const labels = new Array(maxLen);

  for (let i = 0; i < maxLen; i++) {
    const t =
      (sampleWhite[i]?.t ?? sampleCorr[i]?.t ?? 0);
    labels[i] = Number(t.toFixed(2));
  }

  const whiteData = labels.map((t) => {
    const pt = sampleWhite.find((p) => Number(p.t.toFixed(2)) === t);
    return pt ? pt.y : null;
  });

  const corrData = labels.map((t) => {
    const pt = sampleCorr.find((p) => Number(p.t.toFixed(2)) === t);
    return pt ? pt.y : null;
  });

  healthChart.data.labels = labels;
  healthChart.data.datasets[0].data = whiteData;
  healthChart.data.datasets[1].data = corrData;
  healthChart.update();
}

// ---------- UI stats ----------

function updateStats(result) {
  const { durationMedian, earlyFailCount, params, stats } = result;
  const { nCells } = params;

  const durationText =
    durationMedian > 0 ? durationMedian.toFixed(2) + " h" : "–";

  document.getElementById("statDuration").textContent = durationText;
  document.getElementById("statEarlyFail").textContent =
    earlyFailCount + " / " + nCells;
  document.getElementById("statRms").textContent =
    stats.rms > 0 ? stats.rms.toFixed(2) + " %" : "–";
  document.getElementById("statK").textContent =
    stats.k !== 0 ? stats.k.toFixed(3) : "–";

  let comment;
  if (durationMedian === 0) {
    comment =
      "Run the simulation to generate a pack and see how the correlation changes behaviour.";
  } else if (stats.k > 0.8) {
    comment =
      "Very strong QDS-style structure: large, slow swings in the noise. Failures tend to clump together.";
  } else if (stats.k > 0.4) {
    comment =
      "Moderate correlation: behaviour sits between pure white noise and a fully structured regime.";
  } else {
    comment =
      "Low correlation: pack behaves close to white-noise randomness with a tight lifetime spread.";
  }

  document.getElementById("statComment").textContent = comment;
}
