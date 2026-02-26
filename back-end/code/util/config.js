
const baudRate921600Arr = []
const baudRate1000000Arr = ['hand' , 'bed']
const baudRate3000000Arr = ['bigHand' , 'endi' , 'foot']

const baudRateObj = {}
baudRate921600Arr.forEach((file) => {
    baudRateObj[file] = 921600
})

baudRate1000000Arr.forEach((file) => {
    baudRateObj[file] = 1000000
})

baudRate3000000Arr.forEach((file) => {
    baudRateObj[file] = 3000000
})

const typeConfig = {
    1 : 'car-back',
    2 : 'car-sit',
    3 : 'bed',
    4 : 'endi-back',
    5 : 'endi-sit'
}


const constantObj = {
    splitArr: [0xaa, 0x55, 0x03, 0x99],
    blue : ['robot'] ,
    order: {
        1: 'last',
        2: 'next'
    },
    type: {
        1: 'HL',
        2: 'HR',
        3: 'BODY',
        4: 'ALLBODY',
        5: 'FL',
        6: 'FR'
    },
    backendAddress: 'https://sensor.bodyta.com',
    blueArr : ['robot'],
    baudRateObj,
    typeConfig
}


module.exports = constantObj