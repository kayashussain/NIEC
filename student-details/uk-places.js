// UK places for the Universities search (the owner, 28 Nov 2026: search by location, region, country and how far a student can
// travel, with a map). No outside service: a town or a postcode is placed from the tables below (a postcode by its area, such as
// CV for Coventry, so a distance is good to a few miles). Used by fact-file.js in the browser; the tables can be required in tests.
(function (root) {
  // Town: latitude, longitude, country, region (England only). Aliases point at a town.
  const TOWNS = {
    Aberdeen: [57.150, -2.094, 'Scotland'], Aberystwyth: [52.415, -4.083, 'Wales'], Ayr: [55.458, -4.629, 'Scotland'], Bangor: [53.228, -4.129, 'Wales'],
    Bath: [51.381, -2.359, 'England', 'South West'], Bedford: [52.136, -0.467, 'England', 'East of England'], Belfast: [54.597, -5.930, 'Northern Ireland'],
    Birmingham: [52.486, -1.890, 'England', 'West Midlands'], Bournemouth: [50.720, -1.880, 'England', 'South West'], Bradford: [53.795, -1.759, 'England', 'Yorkshire and the Humber'],
    Brighton: [50.822, -0.137, 'England', 'South East'], Falmer: [50.867, -0.088, 'England', 'South East'], Bristol: [51.454, -2.588, 'England', 'South West'],
    Buckingham: [51.999, -0.988, 'England', 'South East'], Cambridge: [52.205, 0.122, 'England', 'East of England'], Canterbury: [51.280, 1.079, 'England', 'South East'],
    Cardiff: [51.481, -3.179, 'Wales'], Carlisle: [54.892, -2.933, 'England', 'North West'], Carmarthen: [51.857, -4.312, 'Wales'], Chelmsford: [51.736, 0.469, 'England', 'East of England'],
    Cheltenham: [51.899, -2.078, 'England', 'South West'], Chester: [53.193, -2.893, 'England', 'North West'], Chichester: [50.837, -0.780, 'England', 'South East'],
    Colchester: [51.896, 0.892, 'England', 'East of England'], Coventry: [52.407, -1.512, 'England', 'West Midlands'], Crewe: [53.099, -2.440, 'England', 'North West'],
    Croydon: [51.376, -0.098, 'England', 'London'], Derby: [52.922, -1.476, 'England', 'East Midlands'], Dundee: [56.462, -2.971, 'Scotland'], Durham: [54.776, -1.575, 'England', 'North East'],
    Edinburgh: [55.953, -3.189, 'Scotland'], Egham: [51.431, -0.551, 'England', 'South East'], Epsom: [51.333, -0.267, 'England', 'South East'], Exeter: [50.718, -3.534, 'England', 'South West'],
    Falmouth: [50.152, -5.066, 'England', 'South West'], Glasgow: [55.864, -4.252, 'Scotland'], Gloucester: [51.864, -2.244, 'England', 'South West'], Guildford: [51.236, -0.570, 'England', 'South East'],
    Hamilton: [55.777, -4.039, 'Scotland'], Hatfield: [51.763, -0.223, 'England', 'East of England'], Huddersfield: [53.645, -1.785, 'England', 'Yorkshire and the Humber'],
    Hull: [53.745, -0.336, 'England', 'Yorkshire and the Humber'], Inverness: [57.478, -4.224, 'Scotland'], Ipswich: [52.057, 1.148, 'England', 'East of England'],
    Keele: [53.003, -2.272, 'England', 'West Midlands'], 'Stoke-on-Trent': [53.003, -2.180, 'England', 'West Midlands'], 'Kingston upon Thames': [51.412, -0.300, 'England', 'London'],
    Lampeter: [52.112, -4.080, 'Wales'], Lancaster: [54.047, -2.801, 'England', 'North West'], Leeds: [53.801, -1.549, 'England', 'Yorkshire and the Humber'],
    Leicester: [52.637, -1.140, 'England', 'East Midlands'], Lincoln: [53.234, -0.538, 'England', 'East Midlands'], Liverpool: [53.408, -2.991, 'England', 'North West'],
    London: [51.507, -0.128, 'England', 'London'], Loughborough: [52.772, -1.206, 'England', 'East Midlands'], Luton: [51.879, -0.418, 'England', 'East of England'],
    Manchester: [53.481, -2.242, 'England', 'North West'], Middlesbrough: [54.574, -1.235, 'England', 'North East'], 'Milton Keynes': [52.041, -0.759, 'England', 'South East'],
    Newcastle: [54.978, -1.618, 'England', 'North East'], Northampton: [52.237, -0.894, 'England', 'East Midlands'], Norwich: [52.630, 1.297, 'England', 'East of England'],
    Nottingham: [52.954, -1.158, 'England', 'East Midlands'], Southwell: [53.077, -0.955, 'England', 'East Midlands'], Ormskirk: [53.569, -2.885, 'England', 'North West'],
    Oxford: [51.752, -1.258, 'England', 'South East'], Paisley: [55.846, -4.423, 'Scotland'], Peterborough: [52.573, -0.241, 'England', 'East of England'],
    Plymouth: [50.376, -4.143, 'England', 'South West'], Pontypridd: [51.602, -3.342, 'Wales'], Portsmouth: [50.820, -1.088, 'England', 'South East'],
    Preston: [53.763, -2.703, 'England', 'North West'], Reading: [51.455, -0.978, 'England', 'South East'], Salford: [53.488, -2.290, 'England', 'North West'],
    Scarborough: [54.283, -0.400, 'England', 'Yorkshire and the Humber'], Sheffield: [53.381, -1.470, 'England', 'Yorkshire and the Humber'], Southampton: [50.910, -1.404, 'England', 'South East'],
    Stirling: [56.117, -3.936, 'Scotland'], 'Stockton-on-Tees': [54.570, -1.318, 'England', 'North East'], Sunderland: [54.906, -1.383, 'England', 'North East'],
    Swansea: [51.622, -3.944, 'Wales'], Telford: [52.678, -2.445, 'England', 'West Midlands'], Edgmond: [52.778, -2.408, 'England', 'West Midlands'],
    Uxbridge: [51.546, -0.479, 'England', 'London'], Winchester: [51.063, -1.308, 'England', 'South East'], Wolverhampton: [52.587, -2.129, 'England', 'West Midlands'],
    Worcester: [52.193, -2.220, 'England', 'West Midlands'], Wrexham: [53.046, -2.993, 'Wales'], York: [53.960, -1.087, 'England', 'Yorkshire and the Humber'],
    Newport: [51.588, -2.998, 'Wales'], Dumfries: [55.070, -3.605, 'Scotland'], Perth: [56.396, -3.437, 'Scotland']
  };
  const ALIASES = { staffordshire: 'Stoke-on-Trent', stoke: 'Stoke-on-Trent', stroke: 'Stoke-on-Trent', cumbria: 'Carlisle', kent: 'Canterbury', garthdee: 'Aberdeen', 'exton park': 'Chester', moorgate: 'London', ealing: 'London', brentford: 'London', greenwich: 'London', 'newcastle upon tyne': 'Newcastle', 'harper adams': 'Edgmond' };
  // Postcode areas: the town each is named after, for a distance (a postcode such as CV1 2AB, or its first half CV1).
  const AREAS = {
    AB: 'Aberdeen', AL: [51.752, -0.336], B: 'Birmingham', BA: 'Bath', BB: [53.748, -2.482], BD: 'Bradford', BH: 'Bournemouth', BL: [53.578, -2.429], BN: 'Brighton', BR: [51.406, 0.015],
    BS: 'Bristol', BT: 'Belfast', CA: 'Carlisle', CB: 'Cambridge', CF: 'Cardiff', CH: 'Chester', CM: 'Chelmsford', CO: 'Colchester', CR: 'Croydon', CT: 'Canterbury', CV: 'Coventry',
    CW: 'Crewe', DA: [51.446, 0.218], DD: 'Dundee', DE: 'Derby', DG: 'Dumfries', DH: 'Durham', DL: [54.523, -1.559], DN: [53.523, -1.133], DT: [50.715, -2.437], DY: [52.512, -2.081],
    E: 'London', EC: 'London', EH: 'Edinburgh', EN: [51.652, -0.081], EX: 'Exeter', FK: [56.002, -3.784], FY: [53.817, -3.036], G: 'Glasgow', GL: 'Gloucester', GU: 'Guildford',
    HA: [51.580, -0.336], HD: 'Huddersfield', HG: [53.992, -1.541], HP: [51.753, -0.449], HR: [52.056, -2.716], HS: [58.209, -6.387], HU: 'Hull', HX: [53.727, -1.857], IG: [51.558, 0.068],
    IP: 'Ipswich', IV: 'Inverness', KA: [55.611, -4.496], KT: 'Kingston upon Thames', KW: [58.981, -2.960], KY: [56.111, -3.158], L: 'Liverpool', LA: 'Lancaster', LD: [52.242, -3.378],
    LE: 'Leicester', LL: [53.324, -3.827], LN: 'Lincoln', LS: 'Leeds', LU: 'Luton', M: 'Manchester', ME: [51.388, 0.507], MK: 'Milton Keynes', ML: [55.789, -3.991], N: 'London',
    NE: 'Newcastle', NG: 'Nottingham', NN: 'Northampton', NP: 'Newport', NR: 'Norwich', NW: 'London', OL: [53.541, -2.111], OX: 'Oxford', PA: 'Paisley', PE: 'Peterborough', PH: 'Perth',
    PL: 'Plymouth', PO: 'Portsmouth', PR: 'Preston', RG: 'Reading', RH: [51.240, -0.170], RM: [51.575, 0.183], S: 'Sheffield', SA: 'Swansea', SE: 'London', SG: [51.903, -0.196],
    SK: [53.408, -2.149], SL: [51.510, -0.595], SM: [51.362, -0.193], SN: [51.558, -1.782], SO: 'Southampton', SP: [51.069, -1.795], SR: 'Sunderland', SS: [51.538, 0.714],
    ST: 'Stoke-on-Trent', SW: 'London', SY: [52.707, -2.754], TA: [51.015, -3.106], TD: [55.617, -2.807], TF: 'Telford', TN: [51.195, 0.276], TQ: [50.462, -3.525], TR: [50.263, -5.051],
    TS: 'Middlesbrough', TW: [51.447, -0.330], UB: 'Uxbridge', W: 'London', WA: [53.390, -2.597], WC: 'London', WD: [51.656, -0.390], WF: [53.683, -1.497], WN: [53.545, -2.632],
    WR: 'Worcester', WS: [52.586, -1.982], WV: 'Wolverhampton', YO: 'York', ZE: [60.155, -1.145]
  };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const NAMES = Object.keys(TOWNS).concat(Object.keys(ALIASES)).sort((a, b) => b.length - a.length);
  const WORDS = new RegExp('\\b(' + NAMES.map(esc).join('|') + ')\\b', 'gi');
  const town = (name) => { const t = TOWNS[name]; return t ? { name, lat: t[0], lon: t[1], country: t[2], region: t[3] || '' } : null; };
  const canonical = (w) => { const k = w.toLowerCase(); if (ALIASES[k]) return ALIASES[k]; return Object.keys(TOWNS).find((n) => n.toLowerCase() === k) || null; };
  // Every town a university's city line names, in order ("London / Manchester" is two campuses), without repeats.
  function campuses(text) {
    const out = [];
    String(text || '').replace(WORDS, (m) => { const n = canonical(m); if (n && !out.some((c) => c.name === n)) out.push(town(n)); return m; });
    return out;
  }
  // What a person typed in "Where": a town, or a postcode (whole or its first half).
  function find(text) {
    const v = String(text || '').trim();
    if (!v) return null;
    const n = canonical(v.replace(/\s+/g, ' '));
    if (n) return town(n);
    const m = /^([A-Za-z]{1,2})[0-9][0-9A-Za-z]?(\s*[0-9][A-Za-z]{2})?$/.exec(v);
    if (m) { const a = AREAS[m[1].toUpperCase()]; const at = Array.isArray(a) ? a : a && TOWNS[a]; if (at) return { name: v.toUpperCase().replace(/\s+/g, ' '), lat: at[0], lon: at[1], postcode: true }; }
    return null;
  }
  function miles(a, b) { const r = Math.PI / 180; const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2; return 3958.8 * 2 * Math.asin(Math.sqrt(h)); }
  const suggestions = () => ['London', 'Birmingham', 'Manchester', 'Leeds', 'Liverpool', 'Bristol', 'Sheffield', 'Newcastle', 'Nottingham', 'Leicester', 'Coventry', 'Cardiff', 'Swansea', 'Glasgow', 'Edinburgh', 'Aberdeen', 'Belfast', 'Brighton', 'Oxford', 'Cambridge', 'Reading', 'Southampton', 'Portsmouth', 'Luton', 'York', 'Hull', 'Plymouth', 'Exeter', 'Norwich', 'Derby'];

  // The map: the UK outline (longitude, latitude rings, hand-traced and simplified), Ireland beyond the border drawn faintly, and big cities.
  const OUTLINE = {
    land: [
      [[-4.99, 58.63], [-4.6, 58.57], [-4.2, 58.54], [-3.65, 58.6], [-3.37, 58.67], [-3.03, 58.64], [-3.1, 58.45], [-3.08, 58.3], [-3.5, 58.12], [-3.9, 57.93], [-4.02, 57.87], [-3.78, 57.85], [-4.1, 57.65], [-4.25, 57.5], [-3.98, 57.58], [-3.57, 57.65], [-3.2, 57.71], [-2.75, 57.68], [-2.0, 57.69], [-1.82, 57.6], [-1.77, 57.48], [-2.05, 57.25], [-2.08, 57.13], [-2.2, 56.92], [-2.45, 56.75], [-2.53, 56.6], [-2.75, 56.47], [-2.95, 56.45], [-2.81, 56.37], [-2.58, 56.27], [-2.82, 56.19], [-3.17, 56.06], [-3.6, 56.03], [-3.1, 55.95], [-2.85, 56.0], [-2.55, 56.0], [-2.12, 55.88], [-2.0, 55.77], [-1.82, 55.65], [-1.6, 55.5], [-1.55, 55.25], [-1.45, 55.05], [-1.37, 54.9], [-1.2, 54.65], [-1.05, 54.6], [-0.78, 54.56], [-0.4, 54.3], [-0.2, 54.15], [-0.08, 54.11], [-0.2, 54.0], [0.13, 53.63], [0.0, 53.53], [0.3, 53.3], [0.35, 53.1], [0.05, 52.9], [0.2, 52.82], [0.55, 52.97], [1.0, 52.96], [1.43, 52.82], [1.74, 52.62], [1.75, 52.45], [1.6, 52.1], [1.3, 51.95], [1.15, 51.8], [0.9, 51.75], [0.95, 51.6], [0.6, 51.52], [0.75, 51.45], [1.42, 51.38], [1.38, 51.15], [1.0, 50.95], [0.75, 50.93], [0.25, 50.74], [-0.25, 50.82], [-0.79, 50.73], [-1.1, 50.78], [-1.4, 50.85], [-1.7, 50.73], [-1.95, 50.6], [-2.45, 50.58], [-2.95, 50.7], [-3.25, 50.68], [-3.45, 50.6], [-3.52, 50.4], [-3.64, 50.22], [-3.95, 50.3], [-4.2, 50.35], [-4.45, 50.33], [-4.7, 50.32], [-5.05, 50.04], [-5.2, 49.96], [-5.5, 50.03], [-5.72, 50.06], [-5.6, 50.18], [-5.2, 50.35], [-5.03, 50.54], [-4.75, 50.6], [-4.55, 50.93], [-4.25, 51.05], [-4.2, 51.2], [-3.6, 51.22], [-3.1, 51.21], [-2.98, 51.35], [-2.68, 51.52], [-2.65, 51.62], [-3.0, 51.53], [-3.18, 51.43], [-3.55, 51.4], [-3.85, 51.55], [-4.05, 51.58], [-4.3, 51.55], [-4.3, 51.68], [-4.75, 51.65], [-5.05, 51.6], [-5.3, 51.76], [-5.1, 51.85], [-5.1, 52.0], [-4.7, 52.11], [-4.3, 52.25], [-4.08, 52.42], [-4.05, 52.55], [-4.12, 52.75], [-4.15, 52.9], [-4.5, 52.85], [-4.75, 52.8], [-4.6, 52.93], [-4.35, 53.12], [-4.2, 53.2], [-3.85, 53.3], [-3.5, 53.33], [-3.1, 53.35], [-3.0, 53.42], [-3.05, 53.65], [-2.9, 53.8], [-3.05, 53.95], [-2.85, 54.15], [-3.22, 54.12], [-3.4, 54.3], [-3.62, 54.5], [-3.45, 54.75], [-3.25, 54.95], [-3.6, 54.88], [-3.95, 54.78], [-4.4, 54.68], [-4.85, 54.62], [-4.95, 54.65], [-5.15, 54.85], [-5.05, 55.0], [-4.88, 55.2], [-4.65, 55.47], [-4.88, 55.75], [-4.88, 55.92], [-5.2, 55.9], [-5.35, 55.75], [-5.45, 55.45], [-5.6, 55.3], [-5.75, 55.5], [-5.6, 55.75], [-5.5, 56.0], [-5.65, 56.2], [-5.5, 56.4], [-5.6, 56.5], [-6.0, 56.65], [-6.2, 56.72], [-5.85, 56.78], [-5.7, 57.0], [-5.55, 57.25], [-5.75, 57.35], [-5.65, 57.55], [-5.82, 57.82], [-5.25, 57.9], [-5.35, 58.08], [-5.1, 58.25], [-5.15, 58.42], [-4.99, 58.63]],
      [[-5.98, 55.24], [-6.2, 55.21], [-6.5, 55.25], [-6.85, 55.17], [-7.05, 55.15], [-7.25, 55.06], [-7.4, 54.95], [-7.55, 54.75], [-7.9, 54.7], [-8.15, 54.45], [-7.75, 54.2], [-7.25, 54.2], [-6.95, 54.22], [-6.65, 54.05], [-6.3, 54.1], [-6.05, 54.03], [-5.85, 54.2], [-5.55, 54.3], [-5.6, 54.5], [-5.45, 54.65], [-5.65, 54.8], [-5.75, 54.86], [-5.85, 55.0], [-5.98, 55.24]],
      [[-4.65, 53.2], [-4.55, 53.42], [-4.3, 53.42], [-4.05, 53.3], [-4.2, 53.17]], [[-1.58, 50.67], [-1.3, 50.77], [-1.07, 50.68], [-1.3, 50.58]], [[-4.8, 54.06], [-4.6, 54.4], [-4.35, 54.4], [-4.55, 54.06]],
      [[-6.6, 57.5], [-6.3, 57.7], [-6.1, 57.6], [-5.7, 57.25], [-5.95, 57.15], [-6.3, 57.25]], [[-7.1, 58.0], [-6.6, 58.5], [-6.2, 58.35], [-6.6, 57.9], [-7.05, 57.75]], [[-7.5, 57.7], [-7.2, 57.6], [-7.25, 57.1], [-7.45, 57.1]],
      [[-6.35, 56.3], [-6.0, 56.65], [-5.65, 56.45], [-5.9, 56.3]], [[-6.45, 55.65], [-6.1, 55.9], [-6.0, 55.65], [-6.2, 55.6]], [[-5.35, 55.45], [-5.1, 55.7], [-5.05, 55.55], [-5.2, 55.43]], [[-3.4, 58.9], [-3.0, 59.15], [-2.7, 59.0], [-3.0, 58.8]]
    ],
    ireland: [[-8.15, 54.45], [-7.9, 54.7], [-7.55, 54.75], [-7.4, 54.95], [-7.25, 55.06], [-7.6, 55.25], [-8.3, 55.15], [-8.5, 54.85], [-8.6, 54.6], [-8.6, 54.2], [-8.4, 54.0], [-8.3, 53.8], [-8.2, 53.6], [-7.9, 53.4], [-7.6, 53.2], [-6.9, 53.1], [-6.25, 53.35], [-6.1, 53.6], [-6.25, 53.95], [-6.65, 54.05], [-6.95, 54.22], [-7.25, 54.2], [-7.75, 54.2], [-8.15, 54.45]],
    cities: ['London', 'Birmingham', 'Manchester', 'Leeds', 'Newcastle', 'Glasgow', 'Edinburgh', 'Cardiff', 'Belfast', 'Bristol', 'Aberdeen', 'Nottingham', 'Southampton', 'Liverpool', 'Oxford', 'Cambridge'].map(town)
  };
  const REGIONS = ['London', 'South East', 'South West', 'East of England', 'East Midlands', 'West Midlands', 'North West', 'North East', 'Yorkshire and the Humber'];
  const COUNTRIES = ['England', 'Scotland', 'Wales', 'Northern Ireland'];
  const api = { campuses, find, miles, suggestions, OUTLINE, REGIONS, COUNTRIES, TOWNS, AREAS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UkPlaces = api;
})(typeof window !== 'undefined' ? window : globalThis);
