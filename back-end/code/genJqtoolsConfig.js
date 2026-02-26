const module2 = require('./util/aes_ecb')

const obj = {
    value: "bed",
    typeArr: ["bed", 'car'],
    optimalObj: {
        bed: { gauss: 2.6, color: 355, filter: 6, height: 2.02, coherent: 1 },
        car: { gauss: 2, color: 495, filter: 0, height: 3.36, coherent: 1 }
    },
    maxObj: {
        bed: { gauss: 4, color: 2000, filter: 20, height: 8, coherent: 10 },
        car: { gauss: 4, color: 2000, filter: 20, height: 8, coherent: 10 }
    }
}

const config = JSON.stringify(obj)

let str = module2.encStr(`${config}`);

let str1 = module2.decryptStr(str)
let str2 = module2.decryptStr('17b3d1c8ecbc2c4fe1225bffb575880fc88aee6c2c8a0edaee73653c0d9b508b03bce9e0a16ac3637d2f4759e3eafe52')
const readline = require('readline');

let str3 = module2.decryptStr('c37cc172b86fd1c5cdaf5d320e74afd05073f8bd8440c030a266d2b41bc2bba49c01949d70f28177a329587c0eac6157')
// console.log(str, str1,(str2), str3)
console.log(str, str1, '111')
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// ask user for the anme input
// rl.question(`请输入一个密钥结束的时间天数`, (day) => {

//     // ask for nationality
//     const file = day.split('+')[0]
//     const dates = day.split('+')[1]

//     const date = new Date().getTime() + parseInt(dates) * 24 * 60 * 60 * 1000
//     // log user details
//     let obj = { date, file }
//     console.log(obj)
//     console.log(`${day}天的密钥是${module2.encStr(JSON.stringify(obj))}`);



// });
// let str = module2.encStr(`45`);

// let str1 = module2.decryptStr(str)
// let str2 = module2.decryptStr('83ade528084c5547836f55dbcfa68742')

// let str3 = module2.decryptStr('325699aacaf28e5743c313673d3e2c066f28abf9846a45a456735f8ecab8e5439405205fc2199e4e1374ceeb904b059659ce62fd6f047a5460f665a7d07f32270a32a94dc7c8ddc3790ef5fea6b95fd5')
// console.log(str , str1 , str2 , str3)
