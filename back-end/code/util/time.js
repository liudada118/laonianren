 function timeStampTo_Date(data) {
    var date = new Date(data);  // 参数需要毫秒数，所以这里将秒数乘于 1000
    Y = date.getFullYear() + '-';
    // M = (date.getMonth() + 1 < 10 ? '0' + (date.getMonth() + 1) : date.getMonth() + 1) + '/';
    M = (date.getMonth() + 1) + '-';
    D = date.getDate() + ' ';
    h = (date.getHours() < 10 ? '0' + date.getHours() : date.getHours()) + '-';
    m = (date.getMinutes() < 10 ? '0' + date.getMinutes() : date.getMinutes()) + '-';
    s = date.getSeconds() < 10 ? '0' + date.getSeconds() : date.getSeconds();

    // document.write(Y+M+D+h+m+s);
    return Y + M + D + h + m + s
  }


  module.exports = {
    timeStampTo_Date
}