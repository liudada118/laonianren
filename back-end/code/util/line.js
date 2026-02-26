function hand(arr) {
    let wsPointData = [...arr];
    // 1-15行调换
    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 32; j++) {
            [wsPointData[i * 32 + j], wsPointData[(14 - i) * 32 + j]] = [
                wsPointData[(14 - i) * 32 + j],
                wsPointData[i * 32 + j],
            ];
        }
    }

    let b = wsPointData.splice(0, 15 * 32);

    wsPointData = wsPointData.concat(b);

    for (let i = 0; i < 32; i++) {
        for (let j = 0; j < 16; j++) {
            [wsPointData[i * 32 + j], wsPointData[i * 32 + 31 - j]] = [wsPointData[i * 32 + 31 - j], wsPointData[i * 32 + j],]
        }
    }
    // wsPointData = press6(wsPointData, 32, 32, 'col')
    return wsPointData
}

function jqbed(arr) {
    let wsPointData = [...arr];
    // 1-15行调换
    for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 32; j++) {
            [wsPointData[i * 32 + j], wsPointData[(14 - i) * 32 + j]] = [
                wsPointData[(14 - i) * 32 + j],
                wsPointData[i * 32 + j],
            ];
        }
    }

    let b = wsPointData.splice(0, 15 * 32);

    wsPointData = wsPointData.concat(b);
    // wsPointData = press6(wsPointData, 32, 32, 'col')
    return wsPointData
}

function arrToRealLine(arr, arrX, arrY) {
    const realX = [], realY = []
    arrX.forEach((a) => {
        if (Array.isArray(a)) {
            // for(let i = )
            if (a[0] > a[1]) {
                for (let i = a[0]; i >= a[1]; i--) {
                    realX.push(i)
                }
            } else {
                for (let i = a[0]; i <= a[1]; i++) {
                    realX.push(i)
                }
            }
        } else {
            realX.push(a)
        }
    })

    arrY.forEach((a) => {
        if (Array.isArray(a)) {
            // for(let i = )
            if (a[0] > a[1]) {
                for (let i = a[0]; i >= a[1]; i--) {
                    realY.push(i)
                }
            } else {
                for (let i = a[0]; i <= a[1]; i++) {
                    realY.push(i)
                }
            }
        } else {
            realY.push(a)
        }
    })

    let newArr = []

    console.log(realY.length ,realX.length,JSON.stringify(realY) )
    for (let i = 0; i < realY.length; i++) {
        for (let j = 0; j < realX.length; j++) {
            const realXCoo = realY[i]
            const realYCoo = realX[j]
            newArr.push(arr[realXCoo * 64 + realYCoo])
        }
    }


    return newArr
}


// endi 1.0
// function endiSit(arr) {
//     let arrX = [[22, 0], [23, 44]]
//     let arrY = [[1, 32], 0, [63, 63 - 11]]

//     function rotate90(arr, height, width) {
//         //逆时针旋转 90 度
//         //列 = 行
//         //行 = n - 1 - 列(j);  n表示总行数
//         let matrix = [];
//         for (let i = 0; i < height; i++) {
//             matrix[i] = [];
//             for (let j = 0; j < width; j++) {
//                 matrix[i].push(arr[i * height + j]);
//             }
//         }

//         var temp = [];
//         var len = matrix.length;
//         for (var i = 0; i < len; i++) {
//             for (var j = 0; j < len; j++) {
//                 var k = len - 1 - j;
//                 if (!temp[k]) {
//                     temp[k] = [];
//                 }
//                 temp[k][i] = matrix[i][j];
//             }
//         }
//         let res = [];
//         for (let i = 0; i < temp.length; i++) {
//             res = res.concat(temp[i]);
//         }
//         return res;
//     }
//     let newArr = arrToRealLine(arr, arrX, arrY)
//     newArr = rotate90(newArr, 45, 45)
//     return newArr

// }

// endi 2.0

function endiSit(arr) {
    let arrX = [[63, 19]]
    let arrY = [[20, 32], 0, [63, 56], [33, 55]]

    let newArr = arrToRealLine(arr, arrX, arrY)
    // newArr = rotate90(newArr, 45, 45)
    return newArr

}



function endiBack(arr) {
    let arrX = [[14, 63]]
    let arrY = [[0, 63]]
    return arrToRealLine(arr, arrX, arrY)
}
// endiSit()

function backYToX(y) {
  if (y >= 123) return 20; // 平台饱和段
  return Math.exp((y - 28.9905) / 31.3511);
}

function sitYToX(y) {
  if (y >= 121) return 20; // 饱和平台
  return Math.exp((y - 47.47) / 24.52) - 0.052;
}


module.exports = {
    hand,
    jqbed,
    endiSit,
    endiBack,
    backYToX,
    sitYToX
}