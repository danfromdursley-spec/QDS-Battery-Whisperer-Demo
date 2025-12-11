// QDS Battery Lab — standalone JS
// Uses Chart.js (loaded from CDN) for plots.

function randn() {
  // Box-Muller Gaussian
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function formatFloat(x, digits) {
  return x.toFixed(digits);
}

// Lifetime simulator ------------------------------------------------------

let healthChart = null;
let histChart = null;

function simulateLifetime() {
  const baseDrain = parseFloat(document.getElementById('baseDrain').value);
  const noiseAmp = parseFloat(document.getElementById('noiseAmp').value);
  const rho = parseFloat(document.getElementById('rho').value);
  const nCells = parseInt(document.getElementById('nCells').value, 10);
  const maxCycles = parseInt(document.getElementById('maxCycles').value, 10);
  const failThresh = parseFloat(document.getElementById('failThresh').value);

  const whiteLifetimes = [];
  const qdsLifetimes = [];
  let whiteSample = [];
  let qdsSample = [];

  function runCell(model) {
    let health = 100.0;
    const path = [health];
    let eps = 0;
    for (let c = 1; c <= maxCycles; c++) {
      let noise;
      if (model === 'white') {
        noise = randn() * noiseAmp;
      } else {
        eps = rho * eps + Math.sqrt(1 - rho * rho) * randn();
        noise = eps * noiseAmp;
      }
      const stepLoss = Math.max(0, baseDrain + noise);
      health = Math.max(0, Math.min(100, health - stepLoss));
      path.push(health);
      if (health <= failThresh) {
        return { lifetime: c, path };
      }
    }
    return { lifetime: maxCycles, path };
  }

  for (let i = 0; i < nCells; i++) {
    const w = runCell('white');
    const q = runCell('qds');
    whiteLifetimes.push(w.lifetime);
    qdsLifetimes.push(q.lifetime);
    if (i === 0) whiteSample = w.path;
    if (i === 0) qdsSample = q.path;
  }

  // Build charts
  const labels = Array.from({ length: whiteSample.length }, (_, i) => i);

  const healthCtx = document.getElementById('healthChart').getContext('2d');
  if (healthChart) healthChart.destroy();
  healthChart = new Chart(healthCtx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'White noise',
          data: whiteSample,
          borderWidth: 2,
          fill: false,
          tension: 0.15
        },
        {
          label: 'QDS-style correlated noise',
          data: qdsSample,
          borderWidth: 2,
          fill: false,
          tension: 0.15
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { boxWidth: 12 }
        }
      },
      scales: {
        x: { title: { display: true, text: 'Cycles' } },
        y: { title: { display: true, text: 'Health (%)' }, min: 0, max: 100 }
      }
    }
  });

  function computeStats(arr) {
    const n = arr.length;
    if (n === 0) return { mean: 0, sd: 0 };
    const mean = arr.reduce((a, b) => a + b, 0) / n;
    const var_ = arr.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / n;
    return { mean, sd: Math.sqrt(var_) };
  }

  // Histogram
  const allTimes = whiteLifetimes.concat(qdsLifetimes);
  const maxLifetime = Math.max(...allTimes);
  const nBins = 12;
  const binWidth = maxLifetime / nBins;
  const labelsBins = [];
  const whiteCounts = Array(nBins).fill(0);
  const qdsCounts = Array(nBins).fill(0);

  for (let i = 0; i < nBins; i++) {
    const edge = Math.round((i + 0.5) * binWidth);
    labelsBins.push(edge);
  }

  function fillCounts(data, counts) {
    for (const t of data) {
      let idx = Math.floor(t / binWidth);
      if (idx < 0) idx = 0;
      if (idx >= nBins) idx = nBins - 1;
      counts[idx] += 1;
    }
  }
  fillCounts(whiteLifetimes, whiteCounts);
  fillCounts(qdsLifetimes, qdsCounts);

  const histCtx = document.getElementById('histChart').getContext('2d');
  if (histChart) histChart.destroy();
  histChart = new Chart(histCtx, {
    type: 'bar',
    data: {
      labels: labelsBins,
      datasets: [
        { label: 'White noise', data: whiteCounts },
        { label: 'QDS-style', data: qdsCounts }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { title: { display: true, text: 'Cycles to failure (binned)' } },
        y: { title: { display: true, text: 'Count' } }
      }
    }
  });

  const whiteStats = computeStats(whiteLifetimes);
  const qdsStats = computeStats(qdsLifetimes);
  const relChange = ((qdsStats.mean - whiteStats.mean) / whiteStats.mean) * 100;

  const statsDiv = document.getElementById('lifetimeStats');
  statsDiv.innerHTML = `
    <h3>Stats</h3>
    <p><span class="label">White noise lifetime:</span><br>
       Mean = <span class="highlight">${formatFloat(whiteStats.mean, 1)}</span> cycles,
       σ = <span class="highlight">${formatFloat(whiteStats.sd, 1)}</span> cycles
    </p>
    <p><span class="label">QDS-style lifetime:</span><br>
       Mean = <span class="highlight">${formatFloat(qdsStats.mean, 1)}</span> cycles,
       σ = <span class="highlight">${formatFloat(qdsStats.sd, 1)}</span> cycles
    </p>
    <p><span class="label">Relative change (QDS vs white):</span><br>
       <span class="${relChange >= 0 ? 'good' : 'bad'}">
       ${relChange >= 0 ? '+' : ''}${formatFloat(relChange, 1)}% in mean lifetime
       </span>
    </p>
    <p><span class="label">Runs simulated:</span><br>
       ${nCells} cells per model
    </p>
  `;
}

// Battery curve simulator --------------------------------------------------

let curveChart = null;

function simulateCurve(extreme = false) {
  let duration = parseFloat(document.getElementById('simDuration').value);
  let drainRate = parseFloat(document.getElementById('simDrainRate').value);
  let noiseLevel = parseFloat(document.getElementById('simNoise').value);
  let tauMinutes = parseFloat(document.getElementById('simTau').value);
  let resolutionMin = parseFloat(document.getElementById('simResolution').value);

  if (extreme) {
    // push parameters into more chaotic regime
    noiseLevel *= 1.8;
  }

  const steps = Math.max(2, Math.round((duration * 60) / resolutionMin));
  const dtHours = resolutionMin / 60.0;
  const baseLossPerStep = drainRate * dtHours;

  const times = [];
  const health = [];

  let h = 100.0;
  let eps = 0;
  const a = Math.exp(-resolutionMin / tauMinutes);
  const sigma = Math.sqrt(1 - a * a);

  for (let i = 0; i < steps; i++) {
    const t = i * dtHours;
    times.push(t);
    health.push(h);

    eps = a * eps + sigma * randn();
    const noise = noiseLevel * eps; // in % per step
    const loss = Math.max(0, baseLossPerStep + noise);
    h = Math.max(0, h - loss);
    if (h <= 0 && i < steps - 1) {
      // stay at zero for remaining steps
      for (let j = i + 1; j < steps; j++) {
        times.push(j * dtHours);
        health.push(0);
      }
      break;
    }
  }

  // Trim trailing zeros to last non-zero + little tail
  let lastIdx = health.length - 1;
  for (let i = health.length - 1; i >= 0; i--) {
    if (health[i] > 0 || i === 0) {
      lastIdx = i;
      break;
    }
  }
  const trimTail = Math.min(10, health.length - lastIdx - 1);
  const finalLen = lastIdx + 1 + trimTail;
  const timesTrim = times.slice(0, finalLen);
  const healthTrim = health.slice(0, finalLen);

  const curveCtx = document.getElementById('curveChart').getContext('2d');
  if (curveChart) curveChart.destroy();
  curveChart = new Chart(curveCtx, {
    type: 'line',
    data: {
      labels: timesTrim,
      datasets: [{
        label: 'Battery %',
        data: healthTrim,
        borderWidth: 2,
        fill: false,
        tension: 0.15
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { title: { display: true, text: 'Time (hours)' } },
        y: { title: { display: true, text: 'Battery (%)' }, min: 0, max: 100 }
      }
    }
  });

  // Stats: duration until empty, average drain, residual RMS and lag-1 corr
  const n = healthTrim.length;
  const tEnd = timesTrim[n - 1];
  const start = healthTrim[0];
  const end = healthTrim[n - 1];

  const used = Math.max(0, start - end);
  const avgDrain = tEnd > 0 ? used / tEnd : 0;

  // Residuals against straight line trend
  const residuals = [];
  for (let i = 0; i < n; i++) {
    const t = timesTrim[i];
    const trend = start + (end - start) * (t / tEnd);
    residuals.push(healthTrim[i] - trend);
  }

  let meanRes = residuals.reduce((a, b) => a + b, 0) / n;
  const rms = Math.sqrt(
    residuals.reduce((acc, r) => acc + (r - meanRes) * (r - meanRes), 0) / n
  );

  // Lag-1 correlation
  let num = 0, den = 0;
  for (let i = 0; i < n - 1; i++) {
    const x = residuals[i] - meanRes;
    const y = residuals[i + 1] - meanRes;
    num += x * y;
    den += x * x;
  }
  const lag1 = den !== 0 ? num / den : 0;

  const statsDiv = document.getElementById('curveStats');
  const quality = (Math.abs(lag1) > 0.5 && rms > 5) ? 'bad' : 'good';
  const text = (quality === 'bad')
    ? 'Noticeable structure: high noise in residuals; strong correlation in noise (structured behaviour).'
    : 'Residuals look mostly uncorrelated; behaviour close to simple noise around a trend.';

  statsDiv.innerHTML = `
    <h3>Stats</h3>
    <p><span class="label">Duration:</span>
       <span class="highlight">${formatFloat(tEnd, 2)} h</span></p>
    <p><span class="label">Start → End:</span>
       <span class="highlight">${formatFloat(start, 1)}%</span> → 
       <span class="highlight">${formatFloat(end, 1)}%</span> (Δ ${formatFloat(used, 1)}%)</p>
    <p><span class="label">Average drain:</span>
       <span class="highlight">${formatFloat(avgDrain, 2)} %/h</span></p>
    <p><span class="label">Residual RMS:</span>
       <span class="highlight">${formatFloat(rms, 2)} %</span></p>
    <p><span class="label">QDS-style K (lag-1 corr):</span>
       <span class="highlight">${formatFloat(lag1, 3)}</span></p>
    <p class="${quality}">${text}</p>
  `;
}

// Hook up UI ---------------------------------------------------------------

function attachSlider(id, labelId, fmt) {
  const el = document.getElementById(id);
  const lbl = document.getElementById(labelId);
  const update = () => {
    const v = parseFloat(el.value);
    lbl.textContent = fmt ? fmt(v) : v;
  };
  el.addEventListener('input', update);
  update();
}

window.addEventListener('DOMContentLoaded', () => {
  attachSlider('baseDrain', 'baseDrainVal', v => v.toFixed(1));
  attachSlider('noiseAmp', 'noiseAmpVal', v => v.toFixed(1));
  attachSlider('rho', 'rhoVal', v => v.toFixed(2));
  attachSlider('nCells', 'nCellsVal', v => v.toString());
  attachSlider('maxCycles', 'maxCyclesVal', v => v.toString());
  attachSlider('failThresh', 'failThreshVal', v => v.toString());

  attachSlider('simDuration', 'simDurationVal', v => v.toString());
  attachSlider('simDrainRate', 'simDrainRateVal', v => v.toString());
  attachSlider('simNoise', 'simNoiseVal', v => v.toFixed(1));
  attachSlider('simTau', 'simTauVal', v => v.toString());
  attachSlider('simResolution', 'simResolutionVal', v => v.toString());

  document.getElementById('runLifetime').addEventListener('click', simulateLifetime);
  document.getElementById('resetLifetime').addEventListener('click', () => {
    document.getElementById('baseDrain').value = 1.5;
    document.getElementById('noiseAmp').value = 2;
    document.getElementById('rho').value = 0.8;
    document.getElementById('nCells').value = 340;
    document.getElementById('maxCycles').value = 1200;
    document.getElementById('failThresh').value = 0;
    ['baseDrain','noiseAmp','rho','nCells','maxCycles','failThresh'].forEach(id => {
      document.getElementById(id).dispatchEvent(new Event('input'));
    });
    simulateLifetime();
  });

  document.getElementById('runCurve').addEventListener('click', () => simulateCurve(false));
  document.getElementById('runCurveChaos').addEventListener('click', () => simulateCurve(true));

  // Initial runs
  simulateLifetime();
  simulateCurve(false);
});
