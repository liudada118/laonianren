const { SerialPort } = require("serialport");
var os = require('os');

let parserArr = {}

/**
 * 返回所有ch340的串口
 * @param {*obj} ports 全部串口和串口的全部信息
 * @returns 筛选出ch340的串口
 */
const getPort = (ports) => {
    // console.log(ports)
    if (os.platform == 'win32') {
        return ports.filter((port) => {
            return port.manufacturer == 'wch.cn'
        })
    } else if (os.platform == 'darwin') {
        return ports.filter((port) => {
            return port.path.includes('usb')
        })
    } else {
        return ports
    }
}


/**
 * 
 * @param {*string} path 串口名称
 * @param {*object} parse 数据通道
 * @returns 这个串口连接所有信息
 */
const newSerialPortLink = ({ path, parser, baudRate = 1000000 }) => {
    let port
    console.log(path, parser, baudRate)
    try {
        port = new SerialPort(
            path,
            {
                baudRate: baudRate,
                autoOpen: true,
            },
            function (err) {
                console.log(err, "err");
            }
        );
        //管道添加解析器
        port.pipe(parser);
    } catch (e) {
        console.log(e, "e");
    }
    return port
}

function parseData(parserArr, objs) {
    let json = {}
    Object.keys(objs).forEach((key) => {
        const obj = parserArr[key]
        const data = objs[key]
        if (obj.port.isOpen) {

            const { order } = constantObj
            const lastData = data[order[1]]
            const nextData = data[order[2]]
            let blueArr = []
            if (lastData && lastData.length && nextData && nextData.length) {
                blueArr = [...lastData, ...nextData]
            }

            // 当前时间戳与发数据时间戳之差
            const dataStamp = new Date().getTime() - data.stamp
            json[data.type] = {}

            // 根据发送时间与最新时间戳的差值  判断设备的在离线状态
            if (dataStamp < 1000) {
                json[data.type].status = 'online'
                json[data.type].arr = blueArr
                json[data.type].rotate = data.rotate
                json[data.type].stamp = data.stamp
                // json[data.type].stampDiff = new Date().getTime() - data.stamp
            } else {
                json[data.type].status = 'offline'
            }


        }

    })
    return json
}

async function connectPort() {
    let ports = await SerialPort.list()
    // 创建并连接数据通道并且设置回调
    for (let i = 0; i < ports.length; i++) {
        const portInfo = ports[i]
        const { path } = portInfo
        // parserArr[path]
        const parserItem = parserArr[path] = parserArr[path] ? parserArr[path] : {}
        const dataItem = dataMap[path] = dataMap[path] ? dataMap[path] : {}
        // parserItem 
        parserItem.parser = new Delimiter({ delimiter: splitBuffer })

        const { parser } = parserItem

        // if()

        if (!(parserItem.port && parserItem.port.isOpen)) {
            const port = newSerialPortLink({ path, parser: parserItem.parser, baudRate })

            parserItem.port = port
            parser.on("data", function (data) {

                let buffer = Buffer.from(data);
                pointArr = new Array();

                if (![18, 1024, 130, 146].includes(buffer.length)) {

                    // console.log(JSON.stringify(buffer) , path,pointArr, pointArr.length, new Date().getTime())
                    // console.log(pointArr)
                }

                for (var i = 0; i < buffer.length; i++) {
                    pointArr[i] = buffer.readUInt8(i);
                }
                // console.log(pointArr.length)

                // 陀螺仪
                if (pointArr.length == 18) {
                    const length = pointArr.length
                    const arr = pointArr.splice(2, length)
                    dataItem.rotate = bytes4ToInt10(arr)
                }
                // 256矩阵分包
                else if (pointArr.length == 130) {
                    // 解析包数据  类型+前后帧类型+128矩阵
                    const length = pointArr.length
                    const order = pointArr[0]
                    const type = pointArr[1]
                    // console.log(constantObj.type[type], order, path, pointArr.length, new Date().getTime())

                    const arr = pointArr.splice(2, length)
                    const orderName = constantObj.order[order]
                    // 前后帧赋值,类型赋值
                    dataItem[orderName] = arr
                    dataItem.type = constantObj.type[type]
                    dataItem.stamp = new Date().getTime()
                } else if (pointArr.length == 1024) {
                    // dataItem[path]
                    dataItem.arr1024 = handLine(pointArr)
                } else if (pointArr.length == 146) {
                    const length = pointArr.length
                    const arr = pointArr.splice(length - 16, length)
                    pointArr.splice(0, 2)
                    // 下一帧赋值  时间戳赋值 四元数赋值
                    dataItem.next = pointArr
                    const stamp = new Date().getTime()
                    dataItem.stamp = stamp
                    dataItem.rotate = bytes4ToInt10(arr)
                }


                else if (![18, 1024, 130].includes(pointArr.length)) {

                    // console.log(path,pointArr, pointArr.length, new Date().getTime())
                    // console.log(pointArr)
                }
            })
        }

    }
}


module.exports = {
    connectPort,
    newSerialPortLink,
    getPort
}