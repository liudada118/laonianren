const sqlite3 = require("sqlite3").verbose();
const csv = require("csv-parser");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { timeStampTo_Date } = require("./time");
const constantObj = require("./config");
// const { sitYToX, backYToX } = require("./line"); // 旧设备类型已移除

function getWritableBaseDir(isPackaged) {
  if (!isPackaged) {
    return path.join(__dirname, '..');
  }

  if (typeof process.env.userData === 'string' && process.env.userData.trim()) {
    return process.env.userData.trim();
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', '肌少症评估系统');
  }

  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '肌少症评估系统');
  }

  return path.join(os.homedir(), '.肌少症评估系统');
}

function getWritableDataDir(isPackaged) {
  return path.join(getWritableBaseDir(isPackaged), 'data');
}

/**
 * 输入当前系统名  返回可执行数据库
 * @param {*string} fileStr 输入当前选择系统名
 * @returns 数据库
 */
const initDb = (fileStr, filePath) => {
  const file = fileStr;
  let db, db1
  // if (isCar(file)) {
  //   db = genDb(`${filePath}/${file}sit.db` , filePath)
  //   db1 = genDb(`${filePath}/${file}back.db` , filePath)
  // } else 
  {
    // console.log(first)
    console.log(`${filePath}/${file}.db`)
    db = genDb(`${filePath}/${file}.db`, filePath)
  }
  return { db, db1 }
}

/**
 * 输入当前选择系统名
 * @param {*string} file 当前选择系统名
 * @returns 数据库
 */
function genDb(file, filePath) {
  let db
  fs.mkdirSync(filePath, { recursive: true })
  if (fs.existsSync(file)) {
    db = new sqlite3.Database(file);
  } else {
    const templatePath = `${filePath}/init.db`
    console.log(file, filePath, 'err')
    if (fs.existsSync(templatePath)) {
      let data = fs.readFileSync(templatePath);
      fs.writeFileSync(file, data);
    }
    db = new sqlite3.Database(file);
  }
  // 启用 WAL 模式：提升并发写入性能，减少采集时卡顿
  db.run('PRAGMA journal_mode=WAL')
  db.run('PRAGMA synchronous=NORMAL')
  return db
}

function isAllDigits(str) {
  return /^\d+$/.test(str) && str.includes('.') && str.length == 15;
}


function dbload(db, param, file, isPackaged, byAssessmentId = false) {
  const selectQuery = byAssessmentId
    ? "select * from matrix WHERE assessment_id=?"
    : "select * from matrix WHERE date=?";
  return new Promise((resolve, reject) => {
    const params = Array.isArray(param) ? param : [param];
    db.all(selectQuery, params, (err, rows) => {
      if (err) {
        console.error(err);
      } else {
        // console.log(rows)
        //把时间 压力面积 平均压力数据push进csvWriter进行汇总
        if (!rows.length) return;
        const csvWriteBackData = [];
        console.log(selectQuery, param, rows)
        const parsedRows = rows.map((row) => {
          try {
            return JSON.parse(row[`data`] || '{}')
          } catch {
            return {}
          }
        })
        const keySet = new Set()
        parsedRows.forEach((obj) => {
          Object.keys(obj || {}).forEach((k) => keySet.add(k))
        })
        let keyArr = Array.from(keySet)

        // 定义数据
        for (var i = 0, j = 0; i < rows.length; i++, j++) {

          const newData = {}

          for (let j = 0; j < keyArr.length; j++) {
            const key = keyArr[j]

            const rowObj = parsedRows[i] || {}
            if (!rowObj[key]) continue
            const data = Array.isArray(rowObj[key]) ? rowObj[key] : rowObj[key].arr
            if (!data) continue

            if (j == 0) {
              newData.time = timeStampTo_Date(rows[i][`timestamp`])
            }

            const press = data.reduce((a, b) => a + b, 0);
            const area = data.filter((a) => a > 0).length;
            const max = Math.max(...data);
            const min = Math.min(...data.filter((a) => a > 0));
            const aver = (press / area).toFixed(1)

            newData[`${key}pressureArea`] = area
            // newData[`${key}pressure`] = press
            newData[`${key}max`] = max
            newData[`${key}min`] = min
            newData[`${key}aver`] = aver
            newData[`${key}realData`] = JSON.stringify(data)
          }


          csvWriteBackData.push(newData);
        }
        // 将汇总的压力数据写入 CSV 文件

        // let str = nowGetTime.replace(/[/:]/g, "-");
        let str = param;
        console.log(str, 'str')
        if (!isAllDigits(str)) {
          // str = str.split(" ")[0];
        } else {
          str = timeStampTo_Date(Number(str));
        }


        // 定义表头
        let handArr = []
        for (let j = 0; j < keyArr.length; j++) {
          const key = keyArr[j]
          if (j == 0) {
            handArr.push({ id: "time", title: "time" })
          }
          handArr.push(
            { id: `${key}max`, title: `${key}max` },
            { id: `${key}min`, title: `${key}min` },
            { id: `${key}aver`, title: `${key}aver` },
            { id: `${key}pressureArea`, title: `${key}area` },
            // { id: `${key}pressure`, title: `${key}pressure` },
            { id: `${key}realData`, title: `${key}data` },
            
          )
        }

        const csvPath = getWritableDataDir(isPackaged);
        fs.mkdirSync(csvPath, { recursive: true })

        const csvWriter1 = createCsvWriter({
          path: `${csvPath}/${file}${str}.csv`,
          // path: `./data/back${str}.csv`, // 指定输出文件的路径和名称
          header: handArr,
        });

        csvWriter1
          .writeRecords(csvWriteBackData)
          .then(() => {
            console.log("导出csv成功！");
            let obj = {}
            obj[param] = 'sussess'
            resolve(obj)
          })
          .catch((err) => {
            console.error("导出csv失败：", err);
            let obj = {}
            obj[param] = err
            reject(obj)
          });

      }
    });
  })
}

async function dbLoadCsv({ db, params, file, isPackaged, byAssessmentId = false }) {
  const selectQuery = "select * from matrix WHERE date=?";
  // params.forEach((param) => {
  //   db.all(selectQuery, param, (err, rows) => {
  //     if (err) {
  //       console.error(err);
  //     } else {
  //       // console.log(rows)
  //       //把时间 压力面积 平均压力数据push进csvWriter进行汇总
  //       if (!rows.length) return;
  //       const csvWriteBackData = [];

  //       let keyArr = Object.keys(JSON.parse(rows[0][`data`]))

  //       for (var i = 0, j = 0; i < rows.length; i++, j++) {

  //         const newData = {}

  //         for (let j = 0; j < keyArr.length; j++) {
  //           const key = keyArr[j]
  //           const data = JSON.parse(rows[i][`data`])[key].arr

  //           if (j == 0) {
  //             newData.time = timeStampTo_Date(rows[i][`timestamp`])
  //           }

  //           const press = data.reduce((a, b) => a + b, 0);
  //           const area = data.filter((a) => a > 10).length;
  //           const max = Math.max(...data);

  //           newData[`${key}pressureArea`] = area
  //           newData[`${key}pressure`] = press
  //           newData[`${key}max`] = max
  //           newData[`${key}realData`] = JSON.stringify(data)
  //         }


  //         csvWriteBackData.push(newData);
  //       }
  //       // 将汇总的压力数据写入 CSV 文件

  //       // let str = nowGetTime.replace(/[/:]/g, "-");
  //       let str = param;
  //       if (str.includes(" ")) {
  //         str = str.split(" ")[0];
  //       } else {
  //         str = timeStampTo_Date(Number(str));
  //       }

  //       let handArr = []
  //       for (let j = 0; j < keyArr.length; j++) {
  //         const key = keyArr[j]
  //         if (j == 0) {
  //           handArr.push({ id: "time", title: "time" })
  //         }
  //         handArr.push(
  //           { id: `${key}max`, title: `${key}max` },
  //           { id: `${key}pressureArea`, title: `${key}area` },
  //           { id: `${key}pressure`, title: `${key}pressure` },
  //           { id: `${key}realData`, title: `${key}data` },)
  //       }


  //       const csvWriter1 = createCsvWriter({
  //         path: `${csvPath}/${file}${str}.csv`,
  //         // path: `./data/back${str}.csv`, // 指定输出文件的路径和名称
  //         header: handArr,
  //       });

  //       csvWriter1
  //         .writeRecords(csvWriteBackData)
  //         .then(() => {
  //           console.log("导出csv成功！");

  //         })
  //         .catch((err) => {
  //           console.error("导出csv失败：", err);
  //         });

  //     }
  //   });
  // })
  const promises = params.map((param) => dbload(db, param, file, isPackaged, byAssessmentId))
  const results = await Promise.all(promises);
  console.log(results, promises, 'result')
  return results
}

function dbDelete(db, param) {
  const createTableQuery = `delete from matrix  where date = ?`;
  return new Promise((resolve, reject) => {
    db.run(createTableQuery, [param], function (err) {
      if (err) {
        console.error(err);
        let obj = {}
        obj[param] = err
        reject(obj)
        return;
      } else {
        // console.log('删除')
        let obj = {}
        obj[param] = 'success'
        resolve(obj)
      }
    });
  })
}

async function deleteDbData({ db, params }) {
  const createTableQuery = `delete from matrix  where date = ?`;
  console.log(createTableQuery)
  const promises = params.map((param) => dbDelete(db, param))
  const results = await Promise.all(promises);
  console.log(results, promises, 'result')
  return results
}

async function changeDbName({ db, params }) {
  const changeQuery = `UPDATE matrix SET "date" = ? WHERE "date" = ?`;
  db.run(changeQuery, params, function (err) {
    if (err) {
      console.error('更新失败:', err.message);
    } else {
      console.log(`更新成功，修改了 ${this.changes} 行`);
    }
  });
}

async function dbGetData({ db, params, byAssessmentId = false }) {
  const selectQuery = byAssessmentId
    ? "select * from matrix WHERE assessment_id=?"
    : "select * from matrix WHERE date=?";

  // const params = [time];
  return new Promise((resolve, reject) => {
    db.all(selectQuery, params, (err, rows) => {
      if (err) {
        console.error(err);
        reject(err)
      } else {
        if (!rows || rows.length === 0) {
          resolve({
            length: 0,
            pressArr: {},
            areaArr: {},
            dataArr: {},
            rows: []
          })
          return
        }
        let length = rows.length;
        indexArr = [0, length - 1];
        timeStamp = [];
        for (let i = 0; i < rows.length; i++) {
          timeStamp.push(rows[i].timestamp);
        }
        historyArr = [0, length];
        let press = [],
          area = [];
        console.log(rows , 'rows',params)
        
        const parsedRows = rows.map((row) => {
          try {
            return JSON.parse(row[`data`] || '{}')
          } catch {
            return {}
          }
        })

        const keySet = new Set()
        parsedRows.forEach((obj) => {
          Object.keys(obj || {}).forEach((k) => keySet.add(k))
        })
        const keyArr = Array.from(keySet)

        let pressValue = {}, areaValue = {} , dataValue = {}, rotateValue = {}, timeValue = {}
        for (let j = 0; j < keyArr.length; j++) {
          const key = keyArr[j]
          pressValue[key] = []
          areaValue[key] = []
          dataValue[key] = []
          rotateValue[key] = []
          timeValue[key] = []
        }
        for (let i = 0; i < rows.length; i++) {
          const rowObj = parsedRows[i] || {}
          for (let j = 0; j < keyArr.length; j++) {
            const key = keyArr[j]
            const item = rowObj[key]
            const data = Array.isArray(item) ? item : item?.arr
            if (!Array.isArray(data)) continue
            dataValue[key].push(data)
            timeValue[key].push(rows[i].timestamp)
            pressValue[key].push(data.reduce((a, b) => a + b, 0))
            areaValue[key].push(data.filter((a) => a > 0).length)
            // 提取 IMU 四元数数据 (rotate)，保持与 dataValue 长度一致
            if (item?.rotate && Array.isArray(item.rotate)) {
              rotateValue[key].push(item.rotate)
            } else {
              rotateValue[key].push(null)
            }
          }
        }

        resolve({
          length,
          pressArr: pressValue,
          areaArr: areaValue,
          dataArr : dataValue,
          rotateArr: rotateValue,
          timeArr: timeValue,
          rows: rows
        })

        // server.clients.forEach(function each(client) {
        //   /**
        //    * 首次读取串口，将数据长度和串口端口数
        //    *  */
        //   const jsonData = JSON.stringify({
        //     length: length,
        //     time: timeStamp,
        //     index: nowIndex,
        //     pressArr: press,
        //     areaArr: area,
        //     // length: csvSitData.length,
        //     sitData:
        //       file === "bigBed"
        //         ? new Array(2048).fill(0)
        //         : new Array(1024).fill(0),
        //   });
        //   if (client.readyState === WebSocket.OPEN) {
        //     client.send(jsonData);
        //   }
        // });

      }
    });
  })

}

async function getCsvData(file) {
  const results = []
  return new Promise((resolve) => {
    fs.createReadStream(file)
      .pipe(csv())
      .on("data", (data) => {

        results.push({ ...data, file: file })
      })
      .on("end", () => {
        // console.log(results)
        resolve(results)
      });
  })
}

async function changeDbDataName({ db, params }) {
  const sql = `UPDATE matrix SET "date" = ? WHERE "date" = ?`;
  db.run(sql, params, function (err) {
    if (err) {
      return console.error('更新失败:', err.message);
    }
    console.log(`更新完成，共修改了 ${this.changes} 行`);
  });
}

module.exports = {
  initDb,
  dbLoadCsv,
  deleteDbData,
  dbGetData,
  getCsvData,
  changeDbDataName,
  changeDbName
}
