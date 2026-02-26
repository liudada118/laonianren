const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('/home/ubuntu/laonianren/back-end/code/db/foot.db');

db.all('SELECT COUNT(*) as count FROM matrix', (err, rows) => {
  console.log('Total records:', rows[0].count);
  
  // 查看最新5条记录的详细数据
  db.all('SELECT id, date, name, assessment_id, sample_type, data FROM matrix ORDER BY id DESC LIMIT 5', (err, rows) => {
    if (err) { console.error(err); db.close(); return; }
    
    rows.forEach(function(row) {
      console.log('\n--- Record ID:', row.id, '---');
      console.log('Date:', row.date, 'Name:', row.name, 'Assessment:', row.assessment_id, 'Sample:', row.sample_type);
      
      var data = JSON.parse(row.data);
      var types = Object.keys(data);
      console.log('Data types:', types);
      
      types.forEach(function(type) {
        var info = data[type];
        var arrLen = 0;
        if (info.arr) {
          if (Array.isArray(info.arr)) arrLen = info.arr.length;
          else arrLen = 'non-array: ' + typeof info.arr;
        }
        var nonZero = 0;
        if (Array.isArray(info.arr)) {
          info.arr.forEach(function(v) { if (v > 0) nonZero++; });
        }
        console.log('  ' + type + ': status=' + (info.status || 'n/a') + 
          ' arrLen=' + arrLen +
          ' nonZero=' + nonZero +
          ' stamp=' + (info.stamp || 'n/a') +
          ' HZ=' + (info.HZ || 'n/a') +
          ' hasRotate=' + !!info.rotate +
          ' hasCop=' + !!info.cop);
      });
    });
    
    db.close();
  });
});
