/**
 * Python backend API helpers.
 * Prefer the Vite proxy in dev, but fall back to direct local URLs when the
 * proxy cannot reach the Python service.
 */

const DIRECT_PYTHON_API_BASE = 'http://127.0.0.1:8765';
const PYTHON_API_BASE_CANDIDATES = [
  '/pyapi',
  DIRECT_PYTHON_API_BASE,
];

let preferredPythonApiBase = PYTHON_API_BASE_CANDIDATES[0];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPythonApiBases() {
  return [...new Set([preferredPythonApiBase, ...PYTHON_API_BASE_CANDIDATES])];
}

async function fetchPythonApi(path, buildInit, options = {}) {
  const {
    maxAttempts = 2,
    retryDelayMs = 500,
  } = options;

  let lastError = null;
  let lastResponse = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let sawRetryableFailure = false;

    for (const base of getPythonApiBases()) {
      try {
        const res = await fetch(`${base}${path}`, buildInit());

        if (res.ok) {
          preferredPythonApiBase = base;
          return res;
        }

        // Retry when the Vite proxy returns 5xx because 8765 is unreachable.
        if (base === '/pyapi' && res.status >= 500) {
          lastResponse = res;
          sawRetryableFailure = true;
          continue;
        }

        preferredPythonApiBase = base;
        return res;
      } catch (err) {
        lastError = err;
        sawRetryableFailure = true;
      }
    }

    if (!sawRetryableFailure || attempt === maxAttempts) {
      break;
    }

    await sleep(retryDelayMs);
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw lastError || new Error('Python backend is unavailable');
}

export async function checkPythonBackend() {
  try {
    const res = await fetchPythonApi('/health', () => ({
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    }));
    const data = await res.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

export async function analyzeGripCSV(csvContent, handType) {
  const payload = JSON.stringify({
    csv_content: csvContent,
    hand_type: handType,
  });

  const res = await fetchPythonApi('/analyze-grip', () => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  }));

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }

  return res.json();
}

export async function analyzeSitStandCSV(standCsv, sitCsv, username) {
  const res = await fetchPythonApi('/analyze-sitstand', () => {
    const form = new FormData();
    form.append('stand_file', new Blob([standCsv], { type: 'text/csv' }), 'stand.csv');
    form.append('sit_file', new Blob([sitCsv], { type: 'text/csv' }), 'sit.csv');
    form.append('username', username || 'User');
    return {
      method: 'POST',
      body: form,
    };
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }

  return res.json();
}

export async function analyzeStandingCSV(csvContent, fps = 42, thresholdRatio = 0.8) {
  const res = await fetchPythonApi('/analyze-standing', () => {
    const form = new FormData();
    form.append('csv_file', new Blob([csvContent], { type: 'text/csv' }), 'standing.csv');
    form.append('fps', String(fps));
    form.append('threshold_ratio', String(thresholdRatio));
    return {
      method: 'POST',
      body: form,
    };
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }

  return res.json();
}

export async function analyzeGaitCSV(csvContents) {
  const res = await fetchPythonApi('/analyze-gait', () => {
    const form = new FormData();
    csvContents.forEach((csv, i) => {
      form.append(`file${i + 1}`, new Blob([csv], { type: 'text/csv' }), `${i + 1}.csv`);
    });
    return {
      method: 'POST',
      body: form,
    };
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }

  return res.json();
}
