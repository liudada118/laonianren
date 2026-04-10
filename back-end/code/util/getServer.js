const { backendAddress } = require("./config");

    /**
     * 
     * @param {string} uuid 传入电脑的uuid
     * @returns 服务器查询uuid的密钥
     */
    async function getKeyfromWinuuid(uuid) {
        return 1
        const response = await fetch(`${backendAddress}/getKey?uuid=${uuid}`)
        const data = await response.json()
        console.log(data)
        return data
        return 1
    }





module.exports = {
    getKeyfromWinuuid
}
