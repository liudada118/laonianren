const { SerialPort } = require("serialport");
var os = require('os');

/**
 * 返回所有可用的串口
 * @param {*obj} ports 全部串口和串口的全部信息
 * @returns 筛选后的串口列表
 */
const getPort = (ports) => {
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
 * 创建串口连接
 * @param {*string} path 串口名称
 * @param {*object} parser 数据通道
 * @param {*number} baudRate 波特率（默认 1000000）
 * @returns 串口连接实例
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
        // 管道添加解析器
        port.pipe(parser);
    } catch (e) {
        console.log(e, "e");
    }
    return port
}


module.exports = {
    newSerialPortLink,
    getPort
}
