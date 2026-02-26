function bytes4ToInt10(buffers) {
    // 示例：四个字节的数组 
    // const fourBytes = [0x40, 0x48, 0xF5, 0xC3];
    const res = []
    for (let i = 0; i < buffers.length / 4; i++) {
      const buffer = new ArrayBuffer(4);
      const view = new DataView(buffer);
      for (let j = 0; j < 4; j++) {
        // 创建一个 ArrayBuffer 并将四个字节写入其中 
  
        // 将四个字节写入 DataView 
        // for (let k = 0; k < 4; k++) {
        view.setUint8(j, buffers[i * 4 + j]);
        // }
        // 从 DataView 中读取浮点数 
  
      }
      const floatValue = view.getFloat32(0, true);
      // console.log(floatValue);
      res.push(floatValue)
    }
    return res
  }

  module.exports = {
    bytes4ToInt10
  }