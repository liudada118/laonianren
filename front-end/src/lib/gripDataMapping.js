/**
 * Grip sensor data mapping utilities
 * Maps raw 256-value sensor arrays to 32x32 (1024) heatmap arrays
 * for left hand and right hand respectively.
 */

/* ─── Left hand mapping ─── */

function arrX2Y(arr) {
  const len = arr.length;
  const n = Math.sqrt(len);
  if (n % 1 !== 0) return arr;
  const result = new Array(len);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const oldIndex = i * n + j;
      const newIndex = (n - 1 - j) * n + (n - 1 - i);
      result[newIndex] = arr[oldIndex];
    }
  }
  return result;
}

function handL(arr) {
  let newArr = [...arr];
  const after = newArr.splice(0, 8 * 16);
  newArr = newArr.concat(after);
  newArr = arrX2Y(newArr);
  const handArr = [];
  for (let i = 0; i < 10; i++) {
    for (let j = 14; j >= 0; j--) {
      handArr.push(newArr[(j + 1) * 16 + 15 - i]);
    }
  }
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 15; j++) {
      [handArr[i * 15 + j], handArr[(9 - i) * 15 + j]] = [handArr[(9 - i) * 15 + j], handArr[i * 15 + j]];
    }
  }
  handArr.splice(5 * 15 + 12, 3);
  for (let i = 4 * 15; i < 5 * 15; i++) {
    handArr[i] = Math.floor(handArr[i] / 3);
  }
  return handArr;
}

export function handSkinChange(res) {
  const handPointArr = [
    [6,2],[6,3],[6,4],[3,8],[3,9],[3,10],[3,14],[3,15],[3,16],[3,20],[3,21],[3,22],[10,26],[10,27],[10,28],
    [7,2],[7,3],[7,4],[4,8],[4,9],[4,10],[4,14],[4,15],[4,16],[4,20],[4,21],[4,22],[11,26],[11,27],[11,28],
    [8,2],[8,3],[8,4],[5,8],[5,9],[5,10],[5,14],[5,15],[5,16],[5,20],[5,21],[5,22],[12,26],[12,27],[12,28],
    [9,2],[9,3],[9,4],[6,8],[6,9],[6,10],[6,14],[6,15],[6,16],[6,20],[6,21],[6,22],[13,26],[13,27],[13,28],
    [13,2],[13,3],[13,4],[13,8],[13,9],[13,10],[13,14],[13,15],[13,16],[13,20],[13,21],[13,22],[17,25],[17,26],[17,27],
    [17,6],[17,7],[17,8],[17,9],[17,10],[17,11],[17,12],[17,13],[17,14],[17,15],[17,16],[17,17],
    [19,6],[19,7],[19,8],[19,9],[19,10],[19,11],[19,12],[19,13],[19,14],[19,15],[19,16],[19,17],[19,18],[19,19],[19,20],
    [21,6],[21,7],[21,8],[21,9],[21,10],[21,11],[21,12],[21,13],[21,14],[21,15],[21,16],[21,17],[21,18],[21,19],[21,20],
    [23,6],[23,7],[23,8],[23,9],[23,10],[23,11],[23,12],[23,13],[23,14],[23,15],[23,16],[23,17],[23,18],[23,19],[23,20],
    [25,6],[25,7],[25,8],[25,9],[25,10],[25,11],[25,12],[25,13],[25,14],[25,15],[25,16],[25,17],[25,18],[25,19],[25,20]
  ];

  for (let i = 4 * 15; i < 5 * 15; i++) {
    res[i] = res[i] / 3;
  }

  const res1 = [];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 15; j++) {
      res1.push(res[i * 15 + 14 - j]);
    }
  }
  for (let i = 75 + 12 - 1; i >= 75; i--) {
    res1.push(res[i]);
  }
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 15; j++) {
      res1.push(res[75 + 12 + i * 15 + 14 - j]);
    }
  }

  const newZeroArr = new Array(1024).fill(0);
  handPointArr.forEach((a, index) => {
    newZeroArr[(31 - a[0]) * 32 + a[1]] = res1[index];
    if (index >= 75) {
      newZeroArr[(31 - (a[0] + 1)) * 32 + a[1]] = res1[index];
    }
  });
  return newZeroArr;
}

/**
 * Map left hand raw 256-value sensor data to 32x32 heatmap array
 */
export function mapLeftHand(arr) {
  return handSkinChange(handL(arr));
}

/* ─── Right hand mapping ─── */

function handRBase(arr) {
  let adcArr = [
    240,239,238,256,255,254,16,15,14,32,31,30,237,236,235,253,252,251,13,12,11,29,28,27,
    234,233,232,250,249,248,10,9,8,26,25,24,231,230,229,247,246,245,7,6,5,23,22,21,
    228,227,226,244,243,242,4,3,2,20,19,18,47,44,41,38,35,61,60,59,58,57,56,55,54,53,
    52,51,50,80,79,78,77,76,75,74,73,72,71,70,69,68,67,66,96,95,94,93,92,91,90,89,88,
    87,86,85,84,83,82,112,111,110,109,108,107,106,105,104,103,102,101,100,99,98,128,127,
    126,125,124,123,122,121,120,119,118,117,116,115,114
  ];
  adcArr = adcArr.map((a) => a - 1);

  const finger1 = adcArr.splice(0, 12);
  const finger2 = adcArr.splice(0, 12);
  const finger3 = adcArr.splice(0, 12);
  const finger4 = adcArr.splice(0, 12);
  const finger5 = adcArr.splice(0, 12);
  const fingerArr = [finger1, finger2, finger3, finger4, finger5];

  const res = new Array(147).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 5; k++) {
      for (let j = 0; j < 3; j++) {
        res[i * 15 + k * 3 + j] = arr[fingerArr[k][i * 3 + j]];
      }
    }
  }

  const fingerMiddleHand = adcArr.splice(0, 5);
  const handArr = adcArr.splice(0, 72);

  for (let i = 0; i < 5; i++) {
    res[15 * 4 + 1 + i * 3] = arr[fingerMiddleHand[i]];
  }
  for (let i = 0; i < handArr.length; i++) {
    res[15 * 5 + i] = arr[handArr[i]];
  }
  return res;
}

/**
 * Map right hand raw 256-value sensor data to 32x32 heatmap array
 *
 * Uses handRBase() to extract sensor values using right-hand ADC indices,
 * then handSkinChange() to map them onto the same 32x32 grid layout as the left hand.
 * This is correct because the 3D hand model is mirrored via scaleX=-1 for the right hand,
 * so the heatmap texture UV mapping remains identical to the left hand.
 *
 * Previously used handRVideo1470506() which had a different grid layout,
 * causing the thumb to be placed at row 8-11 instead of row 14-21,
 * falling outside the 3D model's thumb UV region.
 */
export function mapRightHand(arr) {
  return handSkinChange(handRBase(arr));
}

/**
 * Generate simulated 256-value sensor data for demo/testing
 * Creates a realistic-looking pressure distribution
 */
export function generateSimulatedSensorData(isLeftHand, frame = 0) {
  const arr = new Array(256).fill(0);
  const t = frame * 0.05;

  // Simulate finger pressure patterns
  for (let i = 0; i < 256; i++) {
    const row = Math.floor(i / 16);
    const col = i % 16;

    // Base pressure with some spatial variation
    let pressure = 0;

    // Finger regions (top rows)
    if (row < 8) {
      const fingerIndex = Math.floor(col / 3);
      const fingerCenter = fingerIndex * 3 + 1;
      const distFromCenter = Math.abs(col - fingerCenter);
      const fingerPressure = Math.max(0, 80 - distFromCenter * 30);

      // Add time-varying component
      const phase = fingerIndex * 0.5 + t;
      pressure = fingerPressure * (0.5 + 0.5 * Math.sin(phase));
    }

    // Palm region (middle rows)
    if (row >= 4 && row < 12) {
      const palmCenter = 8;
      const dist = Math.sqrt((col - palmCenter) ** 2 + (row - 8) ** 2);
      const palmPressure = Math.max(0, 120 - dist * 15);
      pressure = Math.max(pressure, palmPressure * (0.6 + 0.4 * Math.sin(t * 0.8)));
    }

    // Thumb region
    if (row >= 6 && row < 10 && col >= 12) {
      const thumbPressure = 100 * (0.5 + 0.5 * Math.sin(t * 1.2));
      pressure = Math.max(pressure, thumbPressure);
    }

    // Add some noise
    pressure += Math.random() * 10;

    arr[i] = Math.max(0, Math.min(255, Math.round(pressure)));
  }

  return arr;
}
