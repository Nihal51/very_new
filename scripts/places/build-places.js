// Builds india-places.json: every Indian place in GeoNames (via all-the-cities), with its state,
// a plain search name, and the nearest railway station (datameet, CC0) for the train home.
//
// The site serves the result as public/data/india-places.json (lib/places.ts reads it). To rebuild,
// in an empty folder of your own (nothing here is a dependency of the site):
//   npm install --prefix atc all-the-cities        (GeoNames data, CC BY 4.0 — keep the credit)
//   curl -LO https://raw.githubusercontent.com/datameet/railways/master/stations.json   (CC0)
//   cp <repo>/scripts/places/build-places.js <repo>/scripts/places/aliases.js . && node build-places.js
//   cp india-places.json <repo>/public/data/india-places.json
// aliases.js: today's names for renamed cities (Prayagraj, Kochi, Gurugram …) and the names people type.
const fs = require('fs');
const cities = require('./atc/node_modules/all-the-cities');
const STATES = {
  '01': 'Andaman and Nicobar Islands', '02': 'Andhra Pradesh', '03': 'Assam', '05': 'Chandigarh',
  '06': 'Dadra and Nagar Haveli and Daman and Diu', '07': 'Delhi', '09': 'Gujarat', '10': 'Haryana',
  '11': 'Himachal Pradesh', '12': 'Jammu and Kashmir', '13': 'Kerala', '14': 'Lakshadweep',
  '16': 'Maharashtra', '17': 'Manipur', '18': 'Meghalaya', '19': 'Karnataka', '20': 'Nagaland',
  '21': 'Odisha', '22': 'Puducherry', '23': 'Punjab', '24': 'Rajasthan', '25': 'Tamil Nadu',
  '26': 'Tripura', '28': 'West Bengal', '29': 'Sikkim', '30': 'Arunachal Pradesh', '31': 'Mizoram',
  '32': 'Dadra and Nagar Haveli and Daman and Diu', '33': 'Goa', '34': 'Bihar', '35': 'Madhya Pradesh',
  '36': 'Uttar Pradesh', '37': 'Chhattisgarh', '38': 'Jharkhand', '39': 'Uttarakhand', '40': 'Telangana',
  '41': 'Ladakh',
};
const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .'-]/g, '').trim();
const st = JSON.parse(fs.readFileSync('stations.json', 'utf8')).features
  .filter((f) => f.geometry && f.properties && /^[A-Z]{1,5}$/.test(f.properties.code || ''))
  .map((f) => ({ code: f.properties.code, name: f.properties.name || '', state: f.properties.state || '', lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
const R = 6371, rad = (d) => (d * Math.PI) / 180;
const km = (a, b) => { const dl = rad(b.lat - a.lat), dg = rad(b.lng - a.lng); const h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const ind = cities.filter((c) => c.country === 'IN' && STATES[c.adminCode]);
// Check the state codes against the stations' own states (nearest station that has one).
const agree = {}, total = {};
const out = ind.map((c) => {
  const p = { lat: c.loc.coordinates[1], lng: c.loc.coordinates[0] };
  let best = null, bestKm = 1e9, named = null, namedKm = 1e9, stated = null, statedKm = 1e9;
  const n = plain(c.name).toLowerCase();
  for (const s of st) {
    const d = km(p, s);
    if (d < bestKm) { best = s; bestKm = d; }
    if (d < 30 && plain(s.name).toLowerCase().startsWith(n.slice(0, Math.max(4, n.length - 2))) && d < namedKm) { named = s; namedKm = d; }
    if (s.state && d < statedKm) { stated = s; statedKm = d; }
  }
  const state = STATES[c.adminCode];
  if (stated && statedKm < 15) { total[state] = (total[state] || 0) + 1; if (stated.state.replace('Orissa', 'Odisha').replace('Delhi NCT', 'Delhi') === state) agree[state] = (agree[state] || 0) + 1; }
  const station = named || (bestKm < 25 ? best : null);
  return [plain(c.name), state, +p.lat.toFixed(4), +p.lng.toFixed(4), c.population, station ? station.code : '', plain(c.altName || '')];
});
const ALIASES = require('./aliases');
for (const row of out) {
  const a = ALIASES.find(([data]) => data.toLowerCase() === row[0].toLowerCase());
  if (a) { row[6] = [a[2], row[6]].filter(Boolean).join(', '); row[0] = a[1]; }
}
out.sort((a, b) => b[4] - a[4]);
fs.writeFileSync('india-places.json', JSON.stringify({ source: 'GeoNames (CC BY 4.0) via all-the-cities; stations: datameet/railways (CC0)', fields: ['name', 'state', 'lat', 'lng', 'population', 'station', 'altName'], places: out }));
const low = Object.keys(total).map((s) => [s, agree[s] || 0, total[s]]).filter(([, a, t]) => t >= 5 && a / t < 0.8);
console.log('places', out.length, 'with station', out.filter((r) => r[5]).length, 'states', new Set(out.map((r) => r[1])).size);
console.log('state check below 80% agreement:', JSON.stringify(low));
for (const q of ['Ambikapur', 'Allahabad', 'Prayagraj', 'Bhubaneshwar', 'Bhubaneswar', 'Ranchi', 'Leh', 'Kochi', 'Cochin', 'Varanasi', 'Gurgaon', 'Gurugram', 'Bengaluru', 'Bangalore', 'Mysore', 'Jagdalpur']) {
  const m = out.filter((r) => r[0].toLowerCase() === q.toLowerCase() || r[6].toLowerCase().split(/,\s*/).includes(q.toLowerCase()));
  console.log(q.padEnd(13), m.slice(0, 2).map((r) => r[0] + ' / ' + r[1] + ' / stn ' + r[5]).join(' | ') || 'MISSING');
}
console.log('size KB', Math.round(fs.statSync('india-places.json').size / 1024));
