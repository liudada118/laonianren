const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('/home/ubuntu/laonianren/back-end/code/db/foot.db');

db.all('SELECT COUNT(*) as count, date, name, assessment_id, sample_type FROM matrix GROUP BY date, assessment_id', (err, rows) => {
  if (err) { console.error(err); return; }
  console.log('=== Database Records Summary ===');
  rows.forEach(r => console.log(JSON.stringify(r)));
  
  db.get('SELECT * FROM matrix ORDER BY id DESC LIMIT 1', (err, row) => {
    if (err) { console.error(err); return; }
    if (row) {
      const data = JSON.parse(row.data);
      console.log('\n=== Latest Record ===');
      console.log('ID:', row.id);
      console.log('Date:', row.date);
      console.log('Name:', row.name);
      console.log('Assessment ID:', row.assessment_id);
      console.log('Sample Type:', row.sample_type);
      console.log('Data types:', Object.keys(data));
      Object.entries(data).forEach(function(entry) {
        var type = entry[0];
        var info = entry[1];
        console.log('  ' + type + ': status=' + (info.status || 'n/a') + 
          ' arrLen=' + (info.arr ? info.arr.length : 0) +
          ' stamp=' + (info.stamp || 'n/a') +
          ' HZ=' + (info.HZ || 'n/a'));
      });
    }
    db.close();
  });
});
