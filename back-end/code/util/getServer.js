const { default: axios } = require("axios");
const { backendAddress } = require("./config");

    /**
     * 
     * @param {string} uuid 传入电脑的uuid
     * @returns 服务器查询uuid的密钥
     */
    async function getKeyfromWinuuid(uuid) {
        return 1
        const response = await axios.get(`${backendAddress}/getKey?uuid=${uuid}`)
        console.log(response.data)
        return response.data
        return 1
    }





module.exports = {
    getKeyfromWinuuid
}